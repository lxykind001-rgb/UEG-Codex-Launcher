// Verify the installed plugin through the official backend, without a chat or model turn.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{spawn}=require('node:child_process');
const config=JSON.parse(fs.readFileSync('marketplace/plugins/ueg-startup/.mcp.json','utf8'));
assert(config.mcpServers.ueg_settings);
const child=spawn('codex',['app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stderr.resume();let id=0;const pending=new Map();
readline.createInterface({input:child.stdout}).on('line',line=>{const result=JSON.parse(line),entry=pending.get(result.id);if(entry){clearTimeout(entry.timer);pending.delete(result.id);entry.resolve(result);}});
function rpc(method,params){return new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('Timeout: '+method)),45000);pending.set(key,{resolve,timer});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});}
(async()=>{try{
 assert(!(await rpc('initialize',{clientInfo:{name:'ueg_plugin_check',version:'1'},capabilities:{experimentalApi:true}})).error);
 child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
 const read=await rpc('plugin/read',{marketplacePath:path.resolve('marketplace/.agents/plugins/marketplace.json'),pluginName:'ueg-startup'});
 assert(!read.error);const plugin=read.result.plugin;
 assert(plugin.summary.installed&&plugin.summary.enabled);assert(plugin.mcpServers.includes('ueg_settings'));
 const discovered=await rpc('mcpServerStatus/list',{serverName:'ueg_settings',detail:'full'});
 assert(!discovered.error);const server=discovered.result.data.find(s=>s.name==='ueg_settings');
 assert.equal(server.pluginId,'ueg-startup@ueg-local');assert.equal(server.toolsError,null);
 assert.equal(server.serverCapabilities.experimental['openai/settings'].readTool,'ueg_settings_read');
 assert.equal(server.tools.ueg_open_settings._meta.ui.resourceUri,'ui://ueg/settings');
 assert(server.resources.some(r=>r.uri==='ui://ueg/settings'&&r.mimeType==='text/html;profile=mcp-app'));
 const evidence={pluginId:server.pluginId,version:plugin.summary.localVersion,installed:true,enabled:true,server:'ueg_settings',settings:server.serverCapabilities.experimental['openai/settings'],resource:server.resources[0],toolNames:Object.keys(server.tools)};
 fs.mkdirSync('.cache',{recursive:true});
 fs.writeFileSync('.cache/plugin-settings-host.json',JSON.stringify(evidence,null,2));
 console.log('PASS official plugin/read and MCP discovery: installed, enabled, native settings capability, modal tool and UI resource');
}finally{child.kill();for(const entry of pending.values())clearTimeout(entry.timer);}})().catch(e=>{console.error(e);process.exitCode=1;});
