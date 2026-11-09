const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Structural WAV checks ONLY. These do not assert that audio is audible or that
// a physical microphone/speaker exists. Playback is an independent acceptance item.
test('all ten local UEG WAVs have valid PCM headers and non-empty samples (no audio hardware)', () => {
  const dir = path.join(__dirname,'../src/UEGCodexLauncher/wwwroot/voice');
  for (const voice of ['male','female']) {
    for (let i=1;i<=5;i++) {
      const name = `voice-${voice}-${i}.wav`;
      const b=fs.readFileSync(path.join(dir,name));
      assert.equal(b.toString('ascii',0,4),'RIFF',name);
      assert.equal(b.toString('ascii',8,12),'WAVE',name);
      assert.equal(b.readUInt32LE(4)+8,b.length,'RIFF file size mismatch: '+name);
      assert.equal(b.toString('ascii',12,16),'fmt ',name);
      assert.equal(b.readUInt16LE(20),1,'PCM expected: '+name);
      const channels=b.readUInt16LE(22), sampleRate=b.readUInt32LE(24), bits=b.readUInt16LE(34);
      assert.ok(channels>=1 && channels<=2,name);
      assert.ok(sampleRate>=8000 && sampleRate<=96000,name);
      assert.equal(bits,16,name);
      // Find PCM 'data' subchunk; do not assume it follows fmt immediately.
      let offset=12,data=null;
      while(offset+8<=b.length) {
        const len=b.readUInt32LE(offset+4);
        if(offset+8+len>b.length) break;
        if(b.toString('ascii',offset,offset+4)==='data') {data=b.subarray(offset+8,offset+8+len);break;}
        offset+=8+len+(len%2);
      }
      assert.ok(data && data.length>sampleRate*channels*bits/8*0.25,`missing or short PCM data: ${name}`);
      assert.ok(data.some(x=>x!==0),`silent-zero WAV: ${name}`);
    }
  }
});
