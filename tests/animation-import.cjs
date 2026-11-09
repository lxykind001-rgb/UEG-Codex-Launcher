// One self-contained HTML in an isolated release; no user settings or shortcut changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require(path.resolve(path.dirname(process.execPath),'../node_modules/playwright'));
fs.mkdirSync('.cache',{recursive:true});
const base=fs.mkdtempSync(path.resolve('.cache/animation-import-')),release=path.join(base,'release'),profile=path.join(base,'profile');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const html=`<!doctype html><meta charset="utf-8"><span id="name"></span><button id="go">Continue</button><button id="fail">Error</button>
<script>chrome.webview.addEventListener('message',e=>{if(e.data.type!=='boot:init')return;
document.querySelector('#name').textContent=e.data.card.displayName;
const id=e.data.sessionId,send=(type,extra={})=>chrome.webview.postMessage({type,protocolVersion:1,sessionId:id,...extra});
send('boot:ready');document.querySelector('#go').onclick=()=>send('boot:done',{reason:'complete'});
document.querySelector('#fail').onclick=()=>send('boot:error',{code:'TEST',message:'test'});});</script>`;
async function wait(fn){for(let i=0;i<200;i++){try{const value=await fn();if(value)return value}catch{}await sleep(150)}throw Error('Timed out');}
(async()=>{
 fs.cpSync(path.resolve(process.env.ANIMATION_TEST_RELEASE||'dist/win-x64'),release,{recursive:true});
 fs.mkdirSync(path.join(release,'animation'));fs.mkdirSync(profile);
 fs.writeFileSync(path.join(release,'animation','demo.html'),html);
 fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({display:'fullscreen',language:'en',animation:'demo'}));
 const exe=path.join(release,'UEGCodexLauncher.exe'),env={...process.env,WEBVIEW2_USER_DATA_FOLDER:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0'};
 const endpoint=path.join(base,'endpoint.json'),settings=spawn(exe,['--settings-server',endpoint],{env,stdio:'ignore'});let launcher,browser,settingsBrowser;
 try{
  await wait(()=>fs.existsSync(endpoint));const {url}=JSON.parse(fs.readFileSync(endpoint,'utf8')),u=new URL(url);
  const response=await fetch(u.origin+'/api/animations',{headers:{Authorization:'Bearer '+u.hash.slice(1)}});
  assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.animations.find(item=>item.id==='demo').buttonCount,2);
  settingsBrowser=await chromium.launch({channel:'msedge',headless:true});
  const settingsPage=await settingsBrowser.newPage();await settingsPage.goto(url);
  await settingsPage.locator('#scan-animations').click();
  await settingsPage.waitForFunction(()=>[...document.querySelectorAll('select[name=animation] option')].some(option=>option.value==='demo'));
  launcher=spawn(exe,[],{env,stdio:'ignore'});
  const port=await wait(async()=>{const n=parseInt(fs.readFileSync(path.join(profile,'EBWebView/DevToolsActivePort'),'utf8'));await fetch(`http://127.0.0.1:${n}/json/version`);return n});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await wait(()=>browser.contexts()[0].pages().find(p=>p.url().includes('animation.local/demo.html')));
  await page.locator('#name').getByText('Liu Peiqiang').waitFor();
  await page.locator('#go').click();await sleep(300);assert(page.url().includes('animation.local/demo.html'));
  await page.locator('#fail').click();await page.waitForURL(/ueg\.local\/launcher\.html/,{timeout:15000});
  console.log('PASS single HTML scan button (2 buttons), boot:init, preview isolation and UEG fallback');
 }finally{if(browser)await browser.close().catch(()=>{});if(settingsBrowser)await settingsBrowser.close().catch(()=>{});if(launcher?.exitCode===null)launcher.kill();if(settings.exitCode===null)settings.kill();await sleep(500);}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{
 if(base.startsWith(path.resolve('.cache')+path.sep))fs.rmSync(base,{recursive:true,force:true});
});
