// Check the identity card's actual text boxes against the QR and neighbouring fields.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');
fs.mkdirSync('.cache',{recursive:true});
const evidence=fs.mkdtempSync(path.resolve('.cache/card-layout-'));
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const language of ['runtime','en'])for(const [width,height] of [[1090,760],[1280,720],[1920,1080]]){
   const page=await browser.newPage({viewport:{width,height}});
   await page.goto(pathToFileURL(path.resolve(`src/UEGCodexLauncher/wwwroot/ueg.${language}.html`)).href+'?auto=0&audio=0');
   await page.evaluate(()=>{document.querySelector('#act2').classList.add('on');document.querySelector('#begin')?.remove();});
   await page.waitForTimeout(2600);
   const issues=await page.evaluate(()=>{
    const qr=document.querySelector('#idQr').getBoundingClientRect(),card=document.querySelector('.idcard2').getBoundingClientRect();
    const overlap=(a,b)=>a.left<b.right-1&&a.right>b.left+1&&a.top<b.bottom-1&&a.bottom>b.top+1;
    const errors=[];
    for(const field of document.querySelectorAll('.idMain .name,.idMain .en,.fields span,.fields b')){
     const range=document.createRange();range.selectNodeContents(field);
     const cell=field.closest('.fields div');
     for(const rect of range.getClientRects()){
      if(overlap(rect,qr))errors.push(`${field.id||field.textContent}: text overlaps QR`);
      if(rect.left<card.left||rect.right>card.right||rect.top<card.top||rect.bottom>card.bottom)errors.push(`${field.id}: text outside card`);
      if(cell)for(const other of document.querySelectorAll('.fields div'))if(other!==cell&&overlap(rect,other.getBoundingClientRect()))errors.push(`${field.id||field.textContent}: text overlaps another field`);
     }
    }
    if(qr.left<card.left||qr.right>card.right||qr.bottom>card.bottom)errors.push('QR outside card');
    if(overlap(qr,document.querySelector('.idFoot2').getBoundingClientRect()))errors.push('QR overlaps card footer');
    return [...new Set(errors)];
   });
   await page.screenshot({path:path.join(evidence,`${language}-${width}.png`)});
   console.log(language,width,issues);await page.close();
   assert.deepEqual(issues,[]);
  }
 }finally{await browser.close();console.log('Evidence',evidence);}
})().catch(e=>{console.error(e);process.exitCode=1});
