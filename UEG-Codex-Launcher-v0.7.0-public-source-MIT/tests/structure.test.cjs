const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base=path.join(__dirname,'../src/UEGCodexLauncher');
test('bridge is external JS allowed by launcher CSP',()=>{
  const html=fs.readFileSync(path.join(base,'wwwroot/launcher.html'),'utf8');
  assert.match(html,/script-src 'self'/);
  assert.match(html,/src="bridge.js"/);
  assert.match(html,/src="launcher-init.js"/);
  assert.doesNotMatch(html,/<script>\s*window\./);
});
test('project has local preview by default',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(base,'launcher.config.json'),'utf8'));
  assert.equal(config.codex.mode,'previewOnly');
  assert.equal(config.ueg.autoplay,false);
});
test('REQUIRED upstream assets and attribution are present (never silently skip)',()=>{
  const root=path.join(base,'wwwroot');
  const required=[
    ['ueg.html', 20000],
    ['assets/ueg-land.js',100],
    ['assets/ueg-seal-white.png',100],
    ['assets/ueg-lockup-white.png',100],
  ];
  for(const [name,minBytes] of required){
    const file=path.join(root,name);
    assert.ok(fs.existsSync(file),`Missing upstream asset ${name}: run scripts/fetch-upstream.ps1`);
    assert.ok(fs.statSync(file).size>minBytes,`${name} appears empty or truncated`);
  }
  for(const name of ['LICENSE','CREDITS.md']){
    const file=path.join(base,'../../upstream-attribution',name);
    assert.ok(fs.existsSync(file),`Missing upstream attribution: ${name}`);
  }
});
test('original UEG iframe protocol exists in the imported HTML',()=>{
  const original=path.join(base,'wwwroot/ueg.html');
  assert.ok(fs.existsSync(original),'Original UEG HTML is required for integration tests');
  const html=fs.readFileSync(original,'utf8');
  assert.match(html,/ueg:done/);
  assert.match(html,/ueg:need-photo/);
  assert.match(html,/assets\/ueg-land\.js/);
});

test('native host does not close on optimistic Process.Start acceptance',()=>{
  const native=fs.readFileSync(path.join(base,'MainWindow.xaml.cs'),'utf8');
  assert.doesNotMatch(native,/if\s*\(_codexLaunchAccepted\)\s*Close\s*\(/);
  assert.match(native,/previewOnly/);
});
