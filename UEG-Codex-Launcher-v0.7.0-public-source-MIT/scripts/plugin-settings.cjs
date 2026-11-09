// Local MCP adapter: exposes a native plugin-settings button and reuses the existing form/server.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const run=promisify(execFile),root=path.resolve(__dirname,'..'),uri='ui://ueg/settings';
const empty={type:'object',properties:{},additionalProperties:false};
const object={type:'object'},output={type:'object',properties:{schema:object,values:object,layout:{type:'array',items:object}},required:['schema','values']};
const privateUi={ui:{visibility:['app']}};
const tools=[
 {name:'ueg_settings_read',title:'UEG 设置入口',inputSchema:empty,outputSchema:output,annotations:{readOnlyHint:true,openWorldHint:false},_meta:privateUi},
 {name:'ueg_settings_update',title:'UEG 设置',inputSchema:{type:'object',properties:{set:empty},required:['set'],additionalProperties:false},outputSchema:{type:'object',properties:{values:object},required:['values']},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},_meta:privateUi},
 {name:'ueg_open_settings',title:'打开 UEG 设置',description:'调整启动覆盖、字幕、身份卡选择、草稿预览与单卡重置。',inputSchema:empty,annotations:{readOnlyHint:true,openWorldHint:false},_meta:{ui:{resourceUri:uri,visibility:['app']},'openai/outputTemplate':uri}},
 {name:'ueg_get_settings',title:'读取 UEG 设置',inputSchema:empty,annotations:{readOnlyHint:true,openWorldHint:false},_meta:privateUi},
 {name:'ueg_save_settings',title:'保存 UEG 设置',inputSchema:{type:'object',properties:{route:{type:'string',enum:['/preferences','/card','/selection','/reset']},body:object},required:['route','body'],additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false},_meta:privateUi}
];
let endpoint;
async function api(route='',body,restarted=false){
 if(!endpoint){
  const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/open-settings.ps1')];
  if(process.env.UEG_SETTINGS_ENDPOINT_FILE)args.push('-EndpointFile',process.env.UEG_SETTINGS_ENDPOINT_FILE);
  const {stdout}=await run('powershell.exe',args,{windowsHide:true,timeout:25000});
  const match=stdout.match(/http:\/\/127\.0\.0\.1:\d+\/#([A-F0-9]{64})/);
  if(!match)throw Error('无法启动本机设置服务');
  endpoint=new URL(match[0]);
 }
 let response;
 try{
  response=await fetch(endpoint.origin+'/api'+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+endpoint.hash.slice(1),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 }catch{endpoint=null;if(!body&&!restarted)return api(route,body,true);throw Error('设置服务已断开，请重新打开设置。');}
 if(response.status===403){endpoint=null;if(!body&&!restarted)return api(route,body,true);throw Error('设置连接已失效，请重新打开设置。');}
 const result=await response.json();if(!response.ok)throw Error(result.error||'保存失败');return result;
}
function resource(){
 const web=path.join(root,'src/UEGCodexLauncher/wwwroot');
 const css=fs.readFileSync(path.join(web,'settings.css'),'utf8');
 const bridge=fs.readFileSync(path.join(__dirname,'plugin-settings-ui.js'),'utf8');
 const original=fs.readFileSync(path.join(web,'settings.js'),'utf8');
 const anchor='async function api(route,body){';
 if(!original.includes(anchor))throw Error('设置表单接口不匹配');
 const js=original.replace(anchor,anchor+' return window.uegPluginApi(route,body);');
 const html=fs.readFileSync(path.join(web,'settings.html'),'utf8')
  .replace('<link rel="stylesheet" href="settings.css">','<style>'+css+'</style>')
  .replace('<script src="settings.js"></script>','<script>'+bridge+'</script><script>'+js+'</script>');
 return {uri,mimeType:'text/html;profile=mcp-app',text:html,_meta:{ui:{prefersBorder:true,csp:{connectDomains:[],resourceDomains:[]}},'openai/ui':{availableDisplayModes:['inline'],preferredDisplayMode:'inline'}}};
}
const packed=structuredContent=>({content:[],structuredContent});
async function call(name,args){
 if(!args||Array.isArray(args)||typeof args!=='object')throw Error('无效参数');
 if(name!=='ueg_save_settings'&&name!=='ueg_settings_update'&&Object.keys(args).length)throw Error('此入口不接受参数');
 switch(name){
  case 'ueg_settings_read':return packed({schema:{type:'object',properties:{}},values:{},layout:[{kind:'group',title:'启动画面与账户角色',items:[{kind:'tool',tool:'ueg_open_settings'}]}]});
  case 'ueg_settings_update':throw Error('请点击“打开 UEG 设置”，在表单内保存。');
  case 'ueg_open_settings':return packed({});
  case 'ueg_get_settings':return packed(await api());
  case 'ueg_save_settings':
   if(Object.keys(args).some(k=>!['route','body'].includes(k))||!['/preferences','/card','/selection','/reset'].includes(args.route)||!args.body||Array.isArray(args.body)||typeof args.body!=='object'||Buffer.byteLength(JSON.stringify(args.body))>750000)throw Error('无效设置请求');
   return packed(await api(args.route,args.body));
  default:throw Error('未知设置操作');
 }
}
async function dispatch(method,params){
 switch(method){
  case 'initialize':return {protocolVersion:'2025-11-25',serverInfo:{name:'ueg-settings',version:'0.7.0'},capabilities:{tools:{},resources:{},experimental:{'openai/settings':{readTool:'ueg_settings_read',updateTool:'ueg_settings_update'}}}};
  case 'ping':return {};
  case 'tools/list':return {tools};
  case 'resources/list':return {resources:[{uri,name:'UEG 启动设置',mimeType:'text/html;profile=mcp-app'}]};
  case 'resources/templates/list':return {resourceTemplates:[]};
  case 'resources/read':if(params.uri!==uri)throw Error('未知设置页面');return {contents:[resource()]};
  case 'tools/call':try{return await call(params.name,params.arguments??{});}catch(e){return {isError:true,content:[{type:'text',text:e.message}]};}
  default:throw Error('不支持此方法');
 }
}
(async()=>{
 for await(const line of readline.createInterface({input:process.stdin,crlfDelay:Infinity})){
  let request;
  try{
   request=JSON.parse(line);if(request.id===undefined)continue;
   const result=await dispatch(request.method,request.params??{});
   process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\n');
  }catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request?.id??null,error:{code:request?-32601:-32700,message:request?'设置协议请求失败':'Invalid JSON'}})+'\n');}
 }
})().catch(()=>{process.exitCode=1;});
