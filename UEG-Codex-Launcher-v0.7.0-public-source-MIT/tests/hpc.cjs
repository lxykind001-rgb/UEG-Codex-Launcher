// Real WebView2 protocol check with isolated preferences and an invalid test AppID.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(path.resolve(path.dirname(process.execPath),'../node_modules/playwright'));
const release=path.resolve(process.env.HPC_TEST_RELEASE||'dist/win-x64-hpc-test'),cache=path.resolve('.cache'),base=fs.mkdtempSync(path.join(cache,'hpc-'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(fn){for(let i=0;i<200;i++){try{const value=await fn();if(value)return value}catch(e){if(e.message.startsWith('Launcher exited'))throw e}await sleep(150)}throw Error('WebView2 startup timed out')}
async function run(mode,action){
 const dir=path.join(base,mode+'-'+action),data=path.join(dir,'profile');fs.mkdirSync(data,{recursive:true});
 fs.writeFileSync(path.join(data,'preferences.json'),JSON.stringify({animation:'hpc',display:mode==='live'?'app':'fullscreen',language:'en'}));
 let app=release;
 if(mode==='launch'||mode==='live'){
  app=path.join(dir,'release');fs.cpSync(release,app,{recursive:true});
  const configPath=path.join(app,'launcher.config.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
  if(mode==='live'){
   const live=JSON.parse(fs.readFileSync(path.resolve('dist/win-x64-local/launcher.config.json'),'utf8').replace(/^\uFEFF/,''));
   if(process.argv.includes('--native-only'))live.window.keepOnTopDuringBoot=false;
   fs.writeFileSync(configPath,JSON.stringify(live));
  }
  else{config.codex.mode='aumid';config.codex.target='UEG.Invalid.Test!App';config.codex.windowProcessNames=['ChatGPT'];fs.writeFileSync(configPath,JSON.stringify(config));}
 }
 const child=spawn(path.join(app,'UEGCodexLauncher.exe'),[],{stdio:'ignore',env:{...process.env,
  WEBVIEW2_USER_DATA_FOLDER:data,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0'}});
 let browser;
 try{
  if(process.argv.includes('--native-only')){
   console.log('NATIVE HPC WINDOW',child.pid);
   await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Native handoff timed out')),120000);
    child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Launcher exited with '+code))});
   });
   console.log('PASS native HPC handoff to official Codex');
   return;
  }
  const port=await wait(async()=>{if(child.exitCode!==null)throw Error('Launcher exited: '+child.exitCode);const number=parseInt(fs.readFileSync(path.join(data,'EBWebView/DevToolsActivePort'),'utf8'));await fetch(`http://127.0.0.1:${number}/json/version`);return number});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page=await wait(()=>browser.contexts()[0].pages().find(p=>p.url().includes('hpc.local/boot.html')));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>window.HPCBoot?.getState().ready,{timeout:30000});
  const events=await page.evaluate(()=>HPCBoot.getEvents().map(e=>e.message));
  assert.deepEqual(events.map(e=>e.type),['boot:ready']);
  assert.equal(await page.evaluate(()=>HPCBoot.getState().mode),mode==='live'?'launch':mode);
  await page.evaluate(()=>chrome.webview.postMessage({type:'boot:done',protocolVersion:1,sessionId:'stale-session',reason:'complete'}));
  await sleep(300);assert(page.url().includes('hpc.local/boot.html'));
  await page.locator('#hpcBootCard.show').waitFor({state:'visible',timeout:20000});
  assert.equal(await page.locator('#hpcBootOrg').textContent(),'');
  assert.equal(await page.locator('#hpcBootOrg').isVisible(),false);
  if(mode==='preview'){
   if(action==='error'){
    await page.evaluate(()=>HPCBoot._test.fatal('TEST_FAILURE','test'));
    await page.waitForURL(/ueg\.local\/launcher\.html/,{timeout:15000});
    assert(await page.locator('#ueg-frame').count());
   }else{
    assert.equal(await page.locator('#hpcBootDisplayName').textContent(),'Liu Peiqiang');
    await page.locator('#hpcBootContinue').click();await sleep(1300);
    assert.deepEqual(await page.evaluate(()=>HPCBoot.getEvents().map(e=>e.message.type)),['boot:ready']);
    assert(page.url().includes('hpc.local/boot.html'));
   }
  }else if(mode==='live'){
   if(process.argv.includes('--native-click')){
    console.log('READY FOR NATIVE CONTINUE',child.pid);
    await page.waitForURL(/ueg\.local\/launcher\.html\?handoff=1/,{timeout:120000});
   }else await page.locator('#hpcBootContinue').click();
   await sleep(15000);
   if(child.exitCode===null){
    const status=await page.locator('#status').textContent().catch(()=>'(page closed)');
    const actions=await page.locator('#handoff-actions').isVisible().catch(()=>false);
    console.log('HPC live handoff pending',page.url(),status,'recovery actions:',actions);
    if(actions){
     if(process.argv.includes('--native-click'))await sleep(45000);
     else{await page.locator('#retry-handoff').click();await sleep(15000)}
    }
   }
   assert.equal(child.exitCode,0);
  }else{
   if(action==='skip')await page.locator('body').press('Escape');
   else await page.locator('#hpcBootContinue').click();
   await page.waitForURL(/ueg\.local\/launcher\.html\?handoff=1/,{timeout:15000});
   assert.equal(await page.locator('#brand').textContent(),'HPC / BOOT');
   await page.locator('#handoff-actions').waitFor({state:'visible',timeout:15000});
   assert.match(await page.locator('#status').textContent(),/Could not confirm the Codex window/);
   assert.equal(child.exitCode,null);
   await page.locator('#close-launcher').click();
  }
  assert.deepEqual(errors,[]);console.log('PASS WebView2 HPC',mode,action,'session filtering and safe handoff');
 }finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();await sleep(400)}
}
(async()=>{try{if(process.argv.includes('--live'))await run('live','continue');
 else{await run('preview','continue');await run('preview','error');await run('launch','continue');await run('launch','skip')}}
 finally{if(base.startsWith(cache+path.sep))fs.rmSync(base,{recursive:true,force:true})}})()
 .catch(e=>{console.error(e);process.exitCode=1});
