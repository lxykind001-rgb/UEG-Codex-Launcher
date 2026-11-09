// Native settings capability + MCP App form -> real loopback service, isolated user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),readline=require('node:readline');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
fs.mkdirSync('.cache',{recursive:true});
const dir=fs.mkdtempSync(path.resolve('.cache/plugin-settings-')),endpoint=path.join(dir,'endpoint.json');
const child=spawn(process.execPath,[path.resolve('scripts/plugin-settings.cjs')],{windowsHide:true,env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:path.join(dir,'profile'),UEG_SETTINGS_ENDPOINT_FILE:endpoint},stdio:['pipe','pipe','pipe']});
let id=0,browser;const pending=new Map();
readline.createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line),entry=pending.get(value.id);if(entry){clearTimeout(entry.timer);pending.delete(value.id);entry.resolve(value);}});
child.stderr.resume();
function rpc(method,params={}){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('RPC timeout: '+method));},60000);pending.set(key,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});}
const tool=async(name,args={})=>(await rpc('tools/call',{name,arguments:args})).result;
(async()=>{
 try{
  const init=(await rpc('initialize',{protocolVersion:'2025-11-25',clientInfo:{name:'ueg-acceptance',version:'1'},capabilities:{}})).result;
  assert.equal(init.capabilities.experimental['openai/settings'].readTool,'ueg_settings_read');
  const list=(await rpc('tools/list')).result.tools;
  assert(list.every(t=>t._meta.ui.visibility.includes('app')));
  const settings=(await tool('ueg_settings_read')).structuredContent;
  assert.equal(settings.layout[0].items[0].tool,'ueg_open_settings');
  const open=list.find(t=>t.name==='ueg_open_settings');
  assert(!(await tool(open.name)).isError);
  const resource=(await rpc('resources/read',{uri:open._meta.ui.resourceUri})).result.contents[0];
  assert.equal(resource.mimeType,'text/html;profile=mcp-app');assert(!resource.text.includes('http://127.0.0.1:'));
  assert((await tool('ueg_save_settings',{route:'/arbitrary',body:{}})).isError);
  assert((await tool('ueg_save_settings',{route:'/preferences',body:{display:'invalid',language:'en'}})).isError);
  assert((await rpc('resources/read',{uri:'file:///not-permitted'})).error);
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:920,height:980}});
  let chatMessages=0;
  await page.exposeFunction('hostRpc',async message=>{
   if(message.method==='ui/initialize')return {protocolVersion:'2026-01-26',hostInfo:{name:'acceptance',version:'1'},hostCapabilities:{},hostContext:{}};
   if(message.method==='ui/message'){chatMessages++;throw Error('Unexpected conversation message');}
   assert.equal(message.method,'tools/call');return (await rpc(message.method,message.params)).result;
  });
  await page.setContent('<iframe title="UEG settings" style="width:100%;height:940px;border:0"></iframe>');
  await page.evaluate(html=>{
   const iframe=document.querySelector('iframe');
   addEventListener('message',async event=>{
    if(event.source!==iframe.contentWindow||event.data?.jsonrpc!=='2.0'||event.data.id===undefined)return;
    try{const result=await window.hostRpc(event.data);iframe.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,result},'*');}
    catch(e){iframe.contentWindow.postMessage({jsonrpc:'2.0',id:event.data.id,error:{code:-32603,message:e.message}},'*');}
   });
   iframe.srcdoc=html;
  },resource.text);
  const frame=page.frameLocator('iframe');
  await frame.locator('#preferences button').waitFor();
  await frame.locator('#preferences button').evaluate(button=>new Promise((resolve,reject)=>{const start=Date.now();const timer=setInterval(()=>{if(!button.disabled){clearInterval(timer);resolve();}else if(Date.now()-start>30000){clearInterval(timer);reject(Error('Settings did not load'));}},100);}));
  await frame.locator('select[name=display]').selectOption('fullscreen');await frame.locator('select[name=language]').selectOption('en');await frame.locator('#preferences button').click();
  await frame.locator('#preferences-status').filter({hasText:'已保存'}).waitFor();
  let data=(await tool('ueg_get_settings')).structuredContent;
  assert.deepEqual(data.preferences,{display:'fullscreen',language:'en'});
  if(data.email){
   await frame.locator('input[name=name]').fill('只在预览');await frame.locator('#preview-card').click();
   assert.equal(await frame.locator('#preview-name').textContent(),'只在预览');
   assert.notEqual((await tool('ueg_get_settings')).structuredContent.card.name,'只在预览');
   await frame.locator('#close-preview').click();
   await frame.locator('input[name=name]').fill('插件直开测试');await frame.locator('input[name=id]').fill('UEG-PLUGIN-QA');
   await frame.locator('input[name=label]').fill('测试档案');
   await frame.locator('#card-photo').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=','base64')});
   await frame.locator('#save-card').click();await frame.locator('#card-status').filter({hasText:'已保存'}).waitFor();
   data=(await tool('ueg_get_settings')).structuredContent;
   assert.equal(data.card.name,'插件直开测试');assert.equal(data.card.id,'UEG-PLUGIN-QA');assert(data.card.photo.startsWith('data:image/png;base64,'));
   assert.equal(data.profiles.length,1);assert.equal(data.profiles[0].label,'测试档案');
   await frame.locator('#profile-select').selectOption(data.profiles[0].key);await frame.locator('#save-selection').click();
   await frame.locator('#selection-status').filter({hasText:'已指定'}).waitFor();
   assert.equal((await tool('ueg_get_settings')).structuredContent.nextCardKey,data.profiles[0].key);
   assert((await tool('ueg_save_settings',{route:'/card',body:{email:'not-the-bound-account@example.invalid',card:data.card}})).isError);
   await frame.locator('#reload').click();await frame.locator('input[name=id]').evaluate(input=>new Promise(resolve=>{const timer=setInterval(()=>{if(!input.closest('fieldset').disabled){clearInterval(timer);resolve();}},100);}));
   assert.equal(await frame.locator('input[name=id]').inputValue(),'UEG-PLUGIN-QA');
  }else assert(await frame.locator('#card-fields').isDisabled());
  const oldServer=JSON.parse(fs.readFileSync(endpoint,'utf8')).pid;process.kill(oldServer);
  await new Promise(resolve=>setTimeout(resolve,300));
  const reopened=(await tool('ueg_get_settings')).structuredContent;
  assert.deepEqual(reopened.preferences,{display:'fullscreen',language:'en'});
  assert.notEqual(JSON.parse(fs.readFileSync(endpoint,'utf8')).pid,oldServer);
  await frame.locator('#bound-account').evaluate(el=>el.textContent='[账户已脱敏]');await page.screenshot({path:path.join(dir,'settings.png')});
  if(data.email){
   await frame.locator('#reset-card').click();await frame.locator('#confirm-reset').click();
   await frame.locator('#selection-status').filter({hasText:'已重置'}).waitFor();
   const after=(await tool('ueg_get_settings')).structuredContent;
   assert.equal(after.card.name,'');assert.equal(after.profiles.length,0);assert.equal(after.nextCardKey,'');
  }
  assert.equal(chatMessages,0);console.log('PASS settings capability, modal form transport, preferences save, account isolation, avatar, reload and expired-service restart; no chat message');
  console.log('Evidence',dir);
 }finally{
  if(browser)await browser.close();child.kill();for(const value of pending.values())clearTimeout(value.timer);
  if(fs.existsSync(endpoint)){const own=JSON.parse(fs.readFileSync(endpoint,'utf8'));try{process.kill(own.pid);}catch{}}
 }
})().catch(e=>{console.error(e);process.exitCode=1});
