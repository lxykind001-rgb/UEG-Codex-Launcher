// Native WebView2 acceptance: preview, two overlay modes, languages, Esc and real foreground handoff.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
fs.mkdirSync('.cache',{recursive:true});
const base=fs.mkdtempSync(path.resolve('.cache/desktop-')),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<180;i++){try{const x=await fn();if(x)return x}catch{}await sleep(150)}throw Error('Window did not become ready')}
function native(pid=0,action='Inspect'){return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('tests/window-state.ps1'),'-LauncherPid',String(pid),'-Action',action],{encoding:'utf8',windowsHide:true}));}
async function check(display,language,preview,escape,fault=''){
 const label=[display,language,preview?'preview':'live',escape?'esc':'complete',fault].filter(Boolean).join('-'),dir=path.join(base,label);fs.mkdirSync(dir);
 fs.writeFileSync(path.join(dir,'preferences.json'),JSON.stringify({display,language}));
 let exe=path.resolve('dist',preview?'win-x64':'win-x64-local','UEGCodexLauncher.exe');
 if(fault){
  const release=path.join(base,fault);fs.cpSync(path.dirname(exe),release,{recursive:true});
  const configPath=path.join(release,'launcher.config.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,''));
  if(fault==='missing-window'){config.codex.windowTitleContains='UEG_ACCEPTANCE_NONEXISTENT_WINDOW';config.codex.readyTimeoutSeconds=5;}
  else config.codex.target='UEG.Acceptance.Nonexistent!App';
  fs.writeFileSync(configPath,JSON.stringify(config));exe=path.join(release,'UEGCodexLauncher.exe');
 }
 const child=spawn(exe,[],{stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:dir,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0'}});let browser;
 try{
  const port=await wait(async()=>{const p=parseInt(fs.readFileSync(path.join(dir,'EBWebView/DevToolsActivePort'),'utf8'));await fetch(`http://127.0.0.1:${p}/json/version`);return p});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);const page=await wait(()=>browser.contexts()[0].pages().find(p=>p.url().includes('launcher.html')));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const frame=await wait(()=>page.frames().find(f=>/ueg\.(?:en|runtime)\.html\?/.test(f.url())));
  await frame.locator('.gate-ready').first().waitFor();await sleep(500);
  assert.equal(await page.locator('#edit-card').count(),0);assert.equal(await frame.locator('#act2.on').count(),0);
  assert.equal(await frame.locator('#idName').textContent(),language==='en'?'Liu Peiqiang':'刘培强');
  const state=native(child.pid);console.log('Native',label,state);assert.equal(state.style&0x00c40000,0,'Native caption or resize frame present');if(state.transitionResult===0)assert.equal(state.transitionsDisabled,1,JSON.stringify(state));if(state.cornerResult===0)assert.equal(state.corners,1,JSON.stringify(state));
  assert(state.launcher>0,'Native probe did not find the visible launcher');
  if(!preview)assert.equal(state.exStyle&0x00040000,0,'Overlay creates a second taskbar application button');
  if(!preview&&!fault){assert.equal(state.minimized,false,'Official window was not restored');}
  if(!preview&&!fault&&display==='app')assert.deepEqual(state.bounds,state.targetBounds,'Overlay does not cover the official window');
  if(!preview&&display==='fullscreen'){const size=await page.evaluate(()=>({w:innerWidth,h:innerHeight,sw:screen.width,sh:screen.height}));assert.equal(size.w,size.sw);assert.equal(size.h,size.sh);}
  const checkLanguage=language==='en'?frame.evaluate(()=>{
    window.__chinese=new Set();const scan=()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){if(['SCRIPT','STYLE'].includes(node.parentElement.tagName))continue;if(/[\u3400-\u9fff]/.test(node.textContent))window.__chinese.add(node.textContent.trim());}};
    scan();const observer=new MutationObserver(scan);observer.observe(document.body,{subtree:true,childList:true,characterData:true});
    return new Promise(resolve=>document.addEventListener('ueg:done',()=>{observer.disconnect();resolve([...window.__chinese])},{once:true}));
  }):Promise.resolve([]);
  const closed=preview?null:page.waitForEvent('close',{timeout:process.argv.includes('--native-click')?150000:45000}).then(()=>true,()=>false);
  if(escape)await frame.locator('body').press('Escape');
  else{
   if(process.argv.includes('--native-click'))console.log('READY for native Continue click',child.pid);
   else await frame.locator('#gateButton').click();
   await frame.locator('#act2.on').waitFor({timeout:120000});await sleep(2400);
   await page.screenshot({path:path.join(base,label+'.png')});
  }
  assert.deepEqual(await checkLanguage,[],'Chinese text in English-only animation');
  if(fault){
   const actions=page.locator('#handoff-actions');await actions.waitFor({state:'visible',timeout:18000});
   assert.match(await page.locator('#status').textContent(),/Could not confirm the Codex window/);
   assert.equal(child.exitCode,null,'Failure closed the launcher');assert.equal(native().target,state.target,'Official window changed');
   const failedState=native(child.pid);assert.equal(failedState.style&0x00c40000,0);assert.equal(failedState.exStyle&8,0,'Failure kept an always-on-top cover');assert.equal(failedState.exStyle&0x00040000,0x00040000,'Failure window is not reachable from the taskbar');
   await page.screenshot({path:path.join(base,fault+'.png')});
   await page.locator('#retry-handoff').click();
   if(fault==='missing-window')await actions.waitFor({state:'hidden'});
   await actions.waitFor({state:'visible',timeout:18000});assert.equal(child.exitCode,null);
   await page.locator('#close-launcher').click();assert(await closed);
   console.log('PASS',fault,'visible failure, retry, explicit close; original official window retained');
  }
  else if(preview){await page.locator('#status').filter({hasText:language==='en'?'preview complete':'预览已完成'}).waitFor({timeout:40000});assert.equal(child.exitCode,null);}
  else if(process.argv.includes('--allow-focus-denied')){
   const outcome=await Promise.race([closed.then(x=>x?'closed':'timeout'),page.locator('#handoff-actions').waitFor({state:'visible',timeout:15000}).then(()=> 'fallback',()=> 'timeout')]);
   assert.notEqual(outcome,'timeout');
   if(outcome==='fallback'){
    assert.match(await page.locator('#status').textContent(),/Windows blocked focus/);
    assert.equal(child.exitCode,null);assert(await page.locator('#retry-handoff').isVisible());
    await page.screenshot({path:path.join(base,'focus-denied.png')});await page.locator('#close-launcher').click();
    assert(await closed);console.log('PASS Windows focus-denied fallback, retry available, explicit close');
   }else assert.equal(native().foreground,state.target);
  }else{assert(await closed,'Launcher did not close; Windows may have denied foreground focus');assert.equal(native().foreground,state.target,'Codex did not receive real foreground focus');}
  assert.deepEqual(errors,[]);console.log('PASS',label,'borderless, manual gate, language, verified outcome');
 }finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill();}
}
(async()=>{
 if(process.argv.includes('--minimized')){
  const before=native();try{assert(native(0,'Minimize').minimized);await check('app','en',false,false);assert.equal(native().target,before.target);console.log('PASS minimized official window restored and reused');}
  finally{if(native().minimized)native(0,'Restore');}
 }else if(process.argv.includes('--failures')){
  await check('app','en',false,true,'missing-window');await check('app','en',false,true,'invalid-appid');
 }else if(process.argv.includes('--native-click')||process.argv.includes('--allow-focus-denied'))await check('app','en',false,false);
 else{await check('app','en',true,false);await check('app','en',false,false);await check('fullscreen','zh-en',false,true);}
 console.log('Evidence',base)
})().catch(e=>{console.error(e);process.exitCode=1});
