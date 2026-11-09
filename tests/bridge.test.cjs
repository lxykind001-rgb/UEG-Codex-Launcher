const assert = require('node:assert/strict');
const test = require('node:test');
const bridge = require('../src/UEGCodexLauncher/wwwroot/bridge.js');

test('query contains harmless text, mode, voice; no photo', () => {
  const url = bridge.buildUegUrl({name: '蓝汐 & 蓝璃', auto:false, voice:'male',photo:'data:image/png;base64,AA==' });
  const parsed = new URL(url, 'https://ueg.local/');
  assert.equal(parsed.searchParams.get('name'),'蓝汐 & 蓝璃');
  assert.equal(parsed.searchParams.get('auto'),'0');
  assert.equal(parsed.searchParams.get('voice'),'male');
  assert.equal(parsed.searchParams.has('photo'),false);
});

test('audio off parameter applied', () => {
  const parsed = new URL(bridge.buildUegUrl({voice:'off'}), 'https://ueg.local/');
  assert.equal(parsed.searchParams.get('audio'),'0');
});

test('reject remote avatar and unsafe QR value', () => {
  const p = bridge.normalize({photo:'https://evil.example/face.png',qr:'http://bad',name:'A\nB'});
  assert.equal(p.photo,'');
  assert.equal(p.qr,'');
  assert.equal(p.name,'AB');
});

test('valid matrix payload is forwarded in QR query', () => {
  const parsed = new URL(bridge.buildUegUrl({qr:'21:YWJj'}), 'https://ueg.local/');
  assert.equal(parsed.searchParams.get('qr'),'21:YWJj');
});

test('invalid voice falls back to mute', () => {
  const parsed = new URL(bridge.buildUegUrl({voice:'custom-remote-url'}), 'https://ueg.local/');
  assert.equal(parsed.searchParams.get('audio'),'0');
  assert.equal(parsed.searchParams.has('voice'),false);
});

test('duplicate start cannot cause repeated iframe recreation', () => {
  const listeners = {};
  const sent = [];
  const frameListeners = {};
  const frameWin = {postMessage(message, origin) {sent.push([message,origin]);}};
  const frame = {contentWindow:frameWin,focus(){},classList:{add() {},remove(){}},addEventListener(name,fn) {frameListeners[name]=fn;},src:''};
  const splash = {style:{display:''}};
  const status={textContent:''};
  const mockWin={location:{origin:'https://ueg.local',search:'?demo=1'},addEventListener(name,fn){listeners[name]=fn;},dispatchEvent() {}};
  const originalCustomEvent=global.CustomEvent;
  global.CustomEvent=class {constructor(name,options){this.type=name;this.detail=options.detail;}};
  try {
    const instance=bridge.install(mockWin,{getElementById(name){return {'ueg-frame':frame,splash,status}[name];}});
    assert.equal(instance.getState(),'started');
    assert.equal(instance.start({name:'再次'}),false);
    frameListeners.load();
    listeners.message({source:frameWin,origin:'https://untrusted.test',data:'ueg:done'});
    assert.equal(instance.getState(),'started');
    listeners.message({source:frameWin,origin:'https://ueg.local',data:'ueg:done'});
    assert.equal(instance.getState(),'finished');
    listeners.message({source:frameWin,origin:'https://ueg.local',data:'ueg:done'});
    assert.equal(instance.getState(),'finished');
  } finally {global.CustomEvent=originalCustomEvent;}
});

test('frame photo request receives local image data and one completion notification', () => {
  const listens = {}, nativeMessages=[], frameEvents={}, posts=[];
  const frameWindow={postMessage(data,origin){posts.push({data,origin});}};
  const frame={contentWindow:frameWindow,focus(){},classList:{add(){},remove(){}},addEventListener(name,fn){frameEvents[name]=fn;},src:''};
  const webview={postMessage(data){nativeMessages.push(data);},addEventListener(name,fn){listens['host:'+name]=fn;}};
  const win={location:{origin:'https://ueg.local',search:''},chrome:{webview},addEventListener(name,fn){listens[name]=fn;}};
  const doc={getElementById(id){return id==='ueg-frame'?frame:id==='splash'?{style:{}}:{textContent:''};}};
  const instance=bridge.install(win,doc);
  assert.equal(nativeMessages[0].type,'ueg:host-ready');
  listens['host:message']({data:{type:'ueg:init',config:{photo:'data:image/png;base64,YWJj',auto:false}}});
  assert.equal(instance.getState(),'started');
  listens.message({source:frameWindow,origin:'https://ueg.local',data:'ueg:need-photo'});
  assert.equal(posts.length,1);
  assert.deepEqual(posts[0].data,{type:'ueg:photo',photo:'data:image/png;base64,YWJj'});
  assert.equal(posts[0].origin,'https://ueg.local');
  frameEvents.load();
  listens.message({source:frameWindow,origin:'https://ueg.local',data:'ueg:done'});
  listens.message({source:frameWindow,origin:'https://ueg.local',data:'ueg:done'});
  assert.equal(nativeMessages.filter(x=>x.type==='ueg:done').length,1);
});


test('native WebView2 previewOnly restores a clear completion screen', () => {
  const listens = {}, messages = [], frameEvents = {};
  const winFrame = {postMessage(){}};
  const frame = {contentWindow:winFrame,focus(){this.focused=true;},classList:{add(){},remove(x){if(x==='active')this.removed=true;}},addEventListener(n,fn){frameEvents[n]=fn;},src:''};
  const splash={style:{display:'none'}};
  const status={textContent:''};
  const webview={postMessage(data){messages.push(data);},addEventListener(n,fn){listens['host:'+n]=fn;}};
  const win={location:{origin:'https://ueg.local',search:''},chrome:{webview},addEventListener(n,fn){listens[n]=fn;}};
  const doc={getElementById(id){return {'ueg-frame':frame,splash,status}[id];}};
  const instance=bridge.install(win,doc);
  listens['host:message']({data:{type:'ueg:init',config:{name:'演示',previewOnly:true,auto:false}}});
  frameEvents.load();
  assert.equal(frame.focused,true);
  listens.message({source:winFrame,origin:'https://ueg.local',data:'ueg:done'});
  assert.equal(instance.getState(),'finished');
  assert.equal(splash.style.display,'flex');
  assert.equal(frame.classList.removed,true);
  assert.match(status.textContent,/预览已完成/);
  assert.equal(messages.filter(x=>x.type==='ueg:done').length,1);
});
