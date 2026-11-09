// Real local server + browser, isolated storage; never changes the user's role card.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
fs.mkdirSync('.cache',{recursive:true});
const base=fs.mkdtempSync(path.resolve('.cache/settings-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function preview(env,name,guest){
 const child=spawn(path.resolve('dist/win-x64/UEGCodexLauncher.exe'),[],{stdio:'ignore',env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0'}});let browser;
 try{
  let port;
  for(let i=0;i<150;i++){
   try{port=parseInt(fs.readFileSync(path.join(env.WEBVIEW2_USER_DATA_FOLDER,'EBWebView/DevToolsActivePort'),'utf8'));await fetch(`http://127.0.0.1:${port}/json/version`);break;}catch{port=null;await sleep(150);}
  }
  assert(port,'Preview did not become ready');browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let frame;
  for(let i=0;i<150;i++){
   frame=browser.contexts()[0].pages().flatMap(p=>p.frames()).find(f=>/ueg\.(?:en|runtime)\.html\?/.test(f.url()));
   if(frame)break;await sleep(150);
  }
  assert(frame);await frame.locator('.gate-ready').first().waitFor();
  assert.equal(await frame.locator('#idName').textContent(),name);
  const id=await frame.locator('#idSerial').textContent();
  if(guest)assert.notEqual(id,'UEG-QA-05');else assert.equal(id,'UEG-QA-05');
  assert.equal(await frame.locator('#idPhoto').evaluate(e=>e.style.backgroundImage.includes('data:image/png;base64,')),!guest);
  await frame.locator('body').press('Escape');
  console.log('PASS saved settings -> real WebView2',guest?'guest defaults; no saved identity leaked':name);
 }finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();await sleep(600);}
}
async function check(guest){
 const dir=path.join(base,guest?'guest':'signed');fs.mkdirSync(dir);const endpoint=path.join(dir,'endpoint.json');
 const env={...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(base,'signed','data')};
 if(guest){env.CODEX_HOME=path.join(dir,'home');fs.mkdirSync(env.CODEX_HOME);fs.writeFileSync(path.join(env.CODEX_HOME,'config.toml'),'cli_auth_credentials_store="file"\n');delete env.OPENAI_API_KEY;delete env.CODEX_API_KEY;}
 const child=spawn(path.resolve('dist/win-x64/UEGCodexLauncher.exe'),['--settings-server',endpoint],{env,windowsHide:true,stdio:'ignore'});let browser;
 try{
  for(let i=0;!fs.existsSync(endpoint)&&i<100;i++)await sleep(100);
  const {url}=JSON.parse(fs.readFileSync(endpoint,'utf8')),parsed=new URL(url),auth={Authorization:'Bearer '+parsed.hash.slice(1)};
  const api=async(route='',body,extra={})=>fetch(parsed.origin+'/api'+route,{method:body?'POST':'GET',headers:{...auth,...(body?{'Content-Type':'application/json'}:{}),...extra},body:body?JSON.stringify(body):undefined});
  assert.equal((await fetch(parsed.origin+'/api')).status,403);
  assert.equal((await api('',undefined,{Origin:'https://untrusted.invalid'})).status,403);
  assert.equal((await api('/preferences',{display:'bad',language:'en'})).status,400);
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:700,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>!document.querySelector('#preferences button').disabled);
  await page.locator('select[name=display]').selectOption('fullscreen');await page.locator('select[name=language]').selectOption('en');
  await page.locator('#preferences button').click();await page.getByText('已保存，下次启动生效。',{exact:true}).waitFor();
  const current=await (await api()).json();assert.deepEqual(current.preferences,{display:'fullscreen',language:'en'});
  if(guest){assert.equal(current.email,null);assert(await page.locator('#save-card').isDisabled());assert.equal((await api('/card',{email:'wrong@example.test',card:{name:'Wrong'}})).status,400);await page.locator('#preview-card').click();assert.equal(await page.locator('#preview-name').textContent(),'Liu Peiqiang');await page.locator('#close-preview').click();}
  else{
   assert(current.email&&current.email.includes('@'),'Local account service did not return a signed-in email');
   await page.locator('input[name=name]').fill('测试角色');await page.locator('input[name=en]').fill('Test Operator');await page.locator('input[name=id]').fill('UEG-QA-05');
   await page.locator('#card-photo').setInputFiles(path.resolve('src/UEGCodexLauncher/wwwroot/assets/ueg-seal-white.png'));
   await page.locator('#save-card').click();await page.getByText('已保存到此邮箱，下次启动生效。',{exact:true}).waitFor();
   assert.equal((await api('/card',{email:'wrong@example.test',card:{name:'Wrong'}})).status,400);
   await page.locator('#reload').click();await page.waitForFunction(()=>!document.querySelector('#save-card').disabled);
   assert.equal(await page.locator('input[name=id]').inputValue(),'UEG-QA-05');assert((await (await api()).json()).card.photo.startsWith('data:image/png;base64,'));
   await page.screenshot({path:path.join(base,'settings.png'),fullPage:true,mask:[page.locator('#bound-account')]});
  }
  await page.setViewportSize({width:360,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Settings overflow narrow panel');
  assert.deepEqual(errors,[]);console.log('PASS settings',guest?'guest locked; preferences saved':'signed-in role/photo save + readback; wrong account rejected','auth/origin/validation/narrow panel');
  await preview(env,guest?'Liu Peiqiang':'Test Operator',guest);
  if(!guest){
   await page.locator('select[name=language]').selectOption('zh-en');await page.locator('#preferences button').click();
   await page.waitForFunction(()=>!document.querySelector('#preferences button').disabled);
   await preview(env,'测试角色',false);
  }
 }finally{if(browser)await browser.close();child.kill();}
}
(async()=>{await check(false);await check(true);console.log('Evidence',base)})().catch(e=>{console.error(e);process.exitCode=1});
