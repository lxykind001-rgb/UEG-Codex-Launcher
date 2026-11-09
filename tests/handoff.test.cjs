const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname,'../src/UEGCodexLauncher');

test('handoff keeps previewOnly default and has explicit identity and bounded wait configuration', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root,'launcher.config.json'),'utf8'));
  assert.equal(config.codex.mode, 'previewOnly');
  assert.deepEqual(config.codex.windowProcessNames, []);
  assert.ok(config.codex.readyTimeoutSeconds >= 5 && config.codex.readyTimeoutSeconds <= 180);
  const native = fs.readFileSync(path.join(root,'CodexWindowManager.cs'),'utf8');
  assert.match(native, /GetWindowThreadProcessId/);
  assert.match(native, /WindowProcessNames/);
  assert.match(native, /GetForegroundWindow/);
  assert.match(native, /IsIconic/);
  assert.doesNotMatch(native, /FindWindow\s*\(/); // no title-only process finding
});

test('native handoff cannot close before a verified foreground window is found', () => {
  const native = fs.readFileSync(path.join(root,'MainWindow.xaml.cs'),'utf8');
  const focus = native.indexOf('if (await CodexWindowManager.TryForegroundAsync(');
  const close = native.indexOf('Close();', focus);
  assert.ok(focus > 0 && close > focus);
  assert.match(native, /!_previewOnly/);
  assert.match(native, /ueg:retry/);
  assert.match(native, /_handoffRunning/);
});

test('bridge exposes local handoff actions but cannot change preview state', () => {
  const bridge = require(path.join(root, 'wwwroot/bridge.js'));
  const winEvents = {}, hostEvents = {}, clickEvents = {}, msgs = {}, posts=[];
  const frameWin = {postMessage(){}};
  const frame = {contentWindow:frameWin, addEventListener(n,fn){msgs[n]=fn;}, classList:{add(){},remove(){}}, focus(){},src:''};
  const splash={style:{display:'none'}};
  const actions={style:{display:'none'}};
  const status={textContent:''};
  const retry={addEventListener(n,fn){clickEvents['retry:'+n]=fn;}};
  const close={addEventListener(n,fn){clickEvents['close:'+n]=fn;}};
  const elements={'ueg-frame':frame,splash,status,'handoff-actions':actions,'retry-handoff':retry,'close-launcher':close};
  const win={location:{origin:'https://ueg.local', search:''},chrome:{webview:{postMessage(p){posts.push(p);},addEventListener(n,fn){hostEvents[n]=fn;}}},addEventListener(n,fn){winEvents[n]=fn;}};
  const state=bridge.install(win,{getElementById(id){return elements[id];}});
  hostEvents.message({data:{type:'ueg:init',config:{previewOnly:false,auto:false}}});
  msgs.load();
  winEvents.message({source:frameWin,origin:'https://ueg.local',data:'ueg:done'});
  assert.equal(state.getState(),'finished');
  hostEvents.message({data:{type:'ueg:handoff-status',state:'failed',message:'No verified Codex window'}});
  assert.equal(actions.style.display,'flex');
  assert.match(status.textContent,/No verified/);
  clickEvents['retry:click']();
  assert.equal(posts.filter(p=>p.type==='ueg:retry').length,1);
  assert.equal(actions.style.display,'none');
  hostEvents.message({data:{type:'ueg:handoff-status',state:'focus-denied',message:'Windows blocked focus'}});
  assert.equal(actions.style.display,'flex');
  clickEvents['close:click']();
  assert.equal(posts.filter(p=>p.type==='ueg:close-request').length,1);
});

test('previewOnly does not show recovery buttons or emit focus retry', () => {
  const bridge = require(path.join(root,'wwwroot/bridge.js'));
  const host={},windowEvents={},frames={},posts=[];
  const frameWindow={postMessage(){}};
  const frame={contentWindow:frameWindow,addEventListener(n,f){frames[n]=f;},classList:{add(){},remove(){}},focus(){}};
  const actions={style:{display:'none'}};
  const retry={addEventListener(n,fn){this.click=fn;}};
  const elems={'ueg-frame':frame,splash:{style:{display:'none'}},status:{textContent:''},'handoff-actions':actions,'retry-handoff':retry,'close-launcher':{addEventListener(){}}};
  const win={location:{origin:'https://ueg.local',search:''},chrome:{webview:{postMessage(x){posts.push(x);},addEventListener(n,f){host[n]=f;}}},addEventListener(n,f){windowEvents[n]=f;}};
  bridge.install(win,{getElementById(n){return elems[n];}});
  host.message({data:{type:'ueg:init',config:{previewOnly:true}}});
  frames.load();
  windowEvents.message({source:frameWindow,origin:'https://ueg.local',data:'ueg:done'});
  host.message({data:{type:'ueg:handoff-status',state:'failed',message:'not applicable'}});
  assert.equal(actions.style.display,'none');
  retry.click();
  assert.equal(posts.filter(x=>x.type==='ueg:retry').length,0);
});
