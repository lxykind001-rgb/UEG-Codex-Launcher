// Actual WebView2 probe; collect in-page to avoid polling the renderer.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {chromium}=require('playwright');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn){for(let i=0;i<180;i++){try{const x=await fn();if(x)return x}catch{}await sleep(150)}throw Error('Timed out waiting for WebView2')}
(async()=>{
 fs.mkdirSync('.cache',{recursive:true});
 const exe=path.resolve(process.argv[2]),dir=fs.mkdtempSync(path.resolve('.cache/perf-'));
 fs.writeFileSync(path.join(dir,'preferences.json'),JSON.stringify({display:'fullscreen',language:'zh-en'}));
 const child=spawn(exe,[],{stdio:'ignore',env:{...process.env,WEBVIEW2_USER_DATA_FOLDER:dir,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=0'}});
 let browser;
 try{
  const port=await wait(async()=>{const p=parseInt(fs.readFileSync(path.join(dir,'EBWebView/DevToolsActivePort'),'utf8'));await fetch(`http://127.0.0.1:${p}/json/version`);return p});
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  if(process.argv.includes('--gpu')){const s=await browser.newBrowserCDPSession();const info=await s.send('SystemInfo.getInfo');console.log('GPU',JSON.stringify(info.gpu));}
  const page=await wait(()=>browser.contexts()[0].pages().find(p=>p.url().includes('launcher.html')));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const frame=await wait(()=>page.frames().find(f=>/ueg(?:\.(?:en|runtime))?\.html\?/.test(f.url())));
  const session=await page.context().newCDPSession(page);
  const profiling=process.argv.includes('--profile');
  if(profiling){await session.send('Profiler.enable');await session.send('Profiler.start');}
  const measurement=frame.evaluate(profiling=>new Promise(resolve=>{
    const samples=[],costs={},longTasks=[];let last,raf;const began=performance.now();
    const observer=new PerformanceObserver(list=>longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask',buffered:true});
    if(profiling)for(const name of ['drawGlobe','drawBurst','drawFinale','buildTextTargets']){
      const fn=window[name];if(typeof fn!=='function')continue;costs[name]=[];
      window[name]=function(...args){const t=performance.now();const result=fn(...args);costs[name].push(performance.now()-t);return result;};
    }
    function tick(t){if(last)samples.push({dt:t-last,at:Math.floor((t-began)/1000),stage:document.querySelector('#act2.on')?'act2':'opening'});last=t;raf=requestAnimationFrame(tick)}
    raf=requestAnimationFrame(tick);
    document.addEventListener('ueg:done',()=>{
      cancelAnimationFrame(raf);observer.disconnect();const values=samples.map(x=>x.dt).sort((a,b)=>a-b);
      resolve({dims:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},frames:values.length,p95:values[Math.floor(values.length*.95)],max:values.at(-1),over50:values.filter(v=>v>50).length,
        longTasks, began, stalls:samples.filter(x=>x.dt>50), stages:Object.fromEntries(['opening','act2'].map(s=>{const a=samples.filter(x=>x.stage===s).map(x=>x.dt).sort((a,b)=>a-b);return [s,{frames:a.length,p95:a[Math.floor(a.length*.95)],over50:a.filter(v=>v>50).length}]})),
        costs:Object.fromEntries(Object.entries(costs).map(([k,v])=>[k,{count:v.length,max:Math.max(...v),avg:v.reduce((a,b)=>a+b,0)/v.length}]))});
    },{once:true});
  }),profiling);
  await frame.locator('.gate-ready').first().waitFor();await frame.locator('#gateButton').click();
  const result={exe,...await measurement,errors};
  if(profiling){const p=await session.send('Profiler.stop');fs.writeFileSync(path.join(dir,'cpu.json'),JSON.stringify(p));console.log('CPU',p.profile.nodes.filter(n=>n.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,15).map(n=>[n.callFrame.functionName,n.hitCount]));}
  console.log(JSON.stringify(result));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));
  assert(result.frames>300);assert.equal(errors.length,0);
  if(process.argv.includes('--assert-smooth'))assert(result.p95<=25&&result.over50/result.frames<=.01,'Frame pacing exceeds 25 ms p95 / 1% frames above 50 ms');
 }finally{if(browser)await browser.close().catch(()=>{});if(child.exitCode===null)child.kill()}
})().catch(e=>{console.error(e);process.exitCode=1});
