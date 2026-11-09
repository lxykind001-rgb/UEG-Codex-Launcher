// Generate a translated page; preserve the upstream page and assets byte-for-byte.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../src/UEGCodexLauncher/wwwroot');
let html=fs.readFileSync(path.join(root,'ueg.html'),'utf8');
// CSS initially hides the globe, but upstream only checks inline opacity === '0'.
// Match the explicit reveal in endBurst; don't render an invisible second globe.
const hiddenCheck = "document.getElementById('globeLayer').style.opacity === '0'";
if(!html.includes(hiddenCheck))throw Error('Upstream globe visibility anchor missing');
html=html.replace(hiddenCheck,"document.getElementById('globeLayer').style.opacity !== '1'");
// Upstream performs 256 GPU readbacks during startup; read the atlas once and
// sum the same per-cell alpha bytes in memory (identical ink values).
html=html.replace("const actx2 = atlas.getContext('2d')", "const actx2 = atlas.getContext('2d')\n    const atlasPixels = actx2.getImageData(0, 0, atlas.width, atlas.height).data")
 .replace('const px = actx2.getImageData(sx, sy, CELL, CELL).data', '')
 .replace('for (let k = 3; k < px.length; k += 4) acc += px[k]', 'for (let y = sy; y < sy + CELL; y += 1) for (let x = sx; x < sx + CELL; x += 1) acc += atlasPixels[(y * atlas.width + x) * 4 + 3]');
// This canvas is only sampled once for point placement, never composited onscreen.
html=html.replace("const bctx2 = board.getContext('2d')","const bctx2 = board.getContext('2d', { willReadFrequently: true })");
// Sampling is only for particle positions, so half-resolution avoids a full-screen
// pixel readback. Particle coordinates and visible canvas stay at native resolution.
html=html.replace('board.width = Math.round(window.innerWidth)', 'board.width = Math.round(window.innerWidth / 2)')
 .replace('board.height = Math.round(window.innerHeight)', 'board.height = Math.round(window.innerHeight / 2)')
 .replace('const step = 5', 'const step = 3')
 .replace('hits.push({ x: jx, y: jy, edge })','hits.push({ x: jx * 2, y: jy * 2, edge })');
// Bake glow + ink once. The burst draws up to 3 trails per point; two image calls
// per trail exceeded the frame budget. Keep all points/trails and halve the calls.
const glyphStart=html.indexOf('  const drawGlyph =');
const glyphEnd=html.indexOf('\n  let burstSeeds',glyphStart);
if(glyphStart<0||glyphEnd<0)throw Error('Upstream glyph renderer anchor missing');
html=html.slice(0,glyphStart)+`  const glyphAtlas = document.createElement('canvas')
  glyphAtlas.width = atlas.width; glyphAtlas.height = atlas.height
  const glyphContext = glyphAtlas.getContext('2d')
  glyphContext.globalAlpha = 0.5; glyphContext.drawImage(atlasGlow, 0, 0)
  glyphContext.globalAlpha = 1; glyphContext.drawImage(atlas, 0, 0)
  const drawGlyph = (ctx, cell, x, y, size, alpha) => {
    ctx.globalAlpha = alpha
    ctx.drawImage(glyphAtlas, (cell % GLYPH_COLS) * CELL, Math.floor(cell / GLYPH_COLS) * CELL, CELL, CELL, x, y, size, size)
  }
`+html.slice(glyphEnd);
// Lay out the identity screen before the gate opens; start its CSS animations only on reveal.
html=html.replace('.act2{position:absolute;inset:0;display:none;z-index:5}', '.act2{position:absolute;inset:0;display:block;visibility:hidden;z-index:5}')
 .replace('.act2.on{display:block}', '.act2.on{visibility:visible}.act2:not(.on) *{animation:none!important}');
// The upstream QR is 146px wide but its grid column reserves only 104px.
// On smaller app windows, put it under the photo to leave readable text columns.
html=html.replace('</style>',`.idBody2{grid-template-columns:132px minmax(0,1fr) 146px}
  .fields{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px}
  .fields div{min-width:0}.fields b{overflow-wrap:anywhere}
  .qrCanvas{width:100%;height:100%}
  @media(max-width:1400px){
    .idBody2{grid-template-columns:132px minmax(0,1fr);row-gap:12px}
    .idPhoto2{height:144px}
    .idMain{grid-column:2;grid-row:1 / span 2}
    .qr{grid-column:1;grid-row:2;width:132px;height:132px;justify-self:start;align-self:start}
  }</style>`);
fs.writeFileSync(path.join(root,'ueg.runtime.html'),html);
const text={
 'UEG 启动动画 · 第一幕（v2）':'UEG Startup',
 'UEG 联合政府 · 身份管理局':'UEG · Identity Bureau',
 'LEVEL 3 · 生活区通行':'LEVEL 3 · Habitat access',
 '本次会话 · 随登出失效':'This session · Until sign-out',
 '550C 终端 · 只读查询':'550C · Read-only access',
 '虹膜 · 指纹':'Iris · Fingerprint',
 '正在检查登录环境':'CHECKING LOGIN ENVIRONMENT',
 '申请访问许可':'REQUEST ACCESS', '身份许可':'IDENTITY PERMIT',
 '证件编号':'ID NUMBER', '签发机构':'ISSUER', '授权等级':'CLEARANCE',
 '有效期':'VALIDITY','许可范围':'SCOPE','生物特征':'BIOMETRICS','核验状态':'STATUS',
 '比对中…':'VERIFYING…','比对进度':'PROGRESS','比对完成':'MATCH COMPLETE','核验通过':'VERIFIED',
 '安全通道已建立':'Secure channel established','读取联合政府员工库 (46 条)':'Reading UEG personnel records',
 '刘培强':'Liu Peiqiang','联合政府':'UNITED EARTH GOVERNMENT',
 '重播':'REPLAY','时间轴':'TIMELINE','总 3.2s 后进入待机循环':'IDLE LOOP AFTER 3.2s'
};
for(const [from,to] of Object.entries(text)){
 if(!html.includes(from))throw Error('Upstream translation anchor missing: '+from);
 html=html.replaceAll(from,to);
}
html=html.replace(/const SURNAMES = \[[^\n]+/,"const SURNAMES = ['Liu ', 'Wang ', 'Zhang ', 'Li ', 'Chen ', 'Zhou ', 'Wu ', 'Xu ', 'Sun ', 'Ma ', 'Zhu ', 'Hu ', 'Lin ', 'Guo ', 'He ', 'Gao ']")
 .replace(/const GIVEN = \[[^\n]+/,"const GIVEN = ['Peiqiang', 'Qihang', 'Ziang', 'Muyang', 'Mingyuan', 'Siyuan', 'Yunzhou', 'Xinghe', 'Yunfan', 'Yuanhang', 'Ruoshui', 'Zhiyuan', 'Changan', 'Wangshu', 'Heyi', 'Qingyue']")
 .replace('lang="zh-CN"','lang="en"')
 .replaceAll('assets/ueg-lockup-white.png','ueg-lockup-en.svg')
 .replace('</style>','.stampText{font-size:24px;letter-spacing:.12em}.fields b{overflow-wrap:anywhere}.fields span{letter-spacing:.08em}</style>');
const seal=fs.readFileSync(path.join(root,'assets/ueg-seal-white.png')).toString('base64');
fs.writeFileSync(path.join(root,'ueg-lockup-en.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="240" viewBox="0 0 1100 240"><image href="data:image/png;base64,${seal}" x="0" y="10" width="220" height="220"/><path d="M260 25V215" stroke="#eef3f8" stroke-width="2"/><g fill="#eef3f8" font-family="Segoe UI,Arial,sans-serif"><text x="300" y="135" font-size="100" font-weight="700" letter-spacing="10">UEG</text><text x="305" y="190" font-size="30" letter-spacing="3">UNITED EARTH GOVERNMENT</text></g></svg>`);
fs.writeFileSync(path.join(root,'ueg.en.html'),html);
console.log('Generated runtime pages and English lockup; upstream retained');
