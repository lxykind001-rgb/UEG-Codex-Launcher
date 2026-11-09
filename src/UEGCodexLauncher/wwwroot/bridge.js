/* UEG Codex bridge. No external packages. Upstream preview/ueg.html is NOT modified. */
(function (root) {
  'use strict';
  const textKeys = ['name','id','en','post','level','issuer','valid','scope','bio'];
  function safeText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
  }
  function normalize(input) {
    const obj = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const output = {};
    for (const key of textKeys) output[key] = safeText(obj[key], key === 'name' ? 80 : 180);
    output.auto = obj.auto !== false;
    // This flag belongs to the launcher, not the original UEG iframe.
    output.previewOnly = obj.previewOnly === true;
    output.language = obj.language === 'en' ? 'en' : 'zh-en';
    output.voice = ['male', 'female', 'off'].includes(obj.voice) ? obj.voice : 'off';
    // Only trusted local image data from native host, never remote image URLs.
    output.photo = typeof obj.photo === 'string' &&
      /^data:image\/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$/.test(obj.photo) &&
      obj.photo.length <= 720000 ? obj.photo : '';
    // Upstream QR payload is the encoded bit-matrix N:base64, not raw QR text.
    output.qr = typeof obj.qr === 'string' && /^\d{2,3}:[a-zA-Z0-9+/=]+$/.test(obj.qr) &&
      obj.qr.length <= 16000 ? obj.qr : '';
    return output;
  }
  function buildUegUrl(input) {
    const config = normalize(input);
    const params = new URLSearchParams();
    for (const key of textKeys) if (config[key]) params.set(key, config[key]);
    if (config.language === 'en' && config.en) params.set('name', config.en);
    if (!config.auto) params.set('auto', '0');
    if (config.voice === 'off') params.set('audio', '0');
    else params.set('voice', config.voice);
    if (config.qr) params.set('qr', config.qr);
    // Intentionally no photo in query. Parent sends it via postMessage.
    return (config.language === 'en' ? 'ueg.en.html?' : 'ueg.runtime.html?') + params.toString();
  }
  function install(win, doc) {
    const frame = doc.getElementById('ueg-frame');
    const splash = doc.getElementById('splash');
    const status = doc.getElementById('status');
    const actions = doc.getElementById('handoff-actions');
    const retry = doc.getElementById('retry-handoff');
    const close = doc.getElementById('close-launcher');
    let state = 'idle';
    let config = null;
    const origin = win.location.origin;
    const notify = (type, extra) => {
      const payload = Object.assign({type}, extra || {});
      if (win.chrome && win.chrome.webview && typeof win.chrome.webview.postMessage === 'function') {
        win.chrome.webview.postMessage(payload);
      } else {
        win.dispatchEvent(new CustomEvent('ueg-launcher:' + type, {detail: payload}));
      }
    };
    if (retry && typeof retry.addEventListener === 'function')
      retry.addEventListener('click', () => { if (state === 'finished' && config && !config.previewOnly) {
        if (actions && actions.style) actions.style.display = 'none';
        notify('ueg:retry');
      }});
    if (close && typeof close.addEventListener === 'function')
      close.addEventListener('click', () => { if (state === 'finished') notify('ueg:close-request'); });
    function showHandoff(data) {
      if (state !== 'finished' || !config || config.previewOnly) return;
      if (!data || !['waiting','failed','focus-denied'].includes(data.state)) return;
      status.textContent = typeof data.message === 'string' ? data.message.slice(0, 1000) : '';
      if (actions && actions.style)
        actions.style.display = data.state === 'waiting' ? 'none' : 'flex';
    }
    function sendPhoto() {
      if (config && config.photo && frame.contentWindow)
        frame.contentWindow.postMessage({type:'ueg:photo', photo:config.photo}, origin);
    }
    function start(raw) {
      if (state !== 'idle') return false;
      config = normalize(raw);
      state = 'started';
      status.textContent = config.language === 'en' ? 'Loading UEG' : 'UEG 界面加载中';
      if (config.language === 'en') {
        if (retry) retry.textContent = 'Retry Codex handoff';
        if (close) close.textContent = 'Close launcher';
      }
      frame.addEventListener('load', function onFrameLoad() {
        // Document may request photo before iframe load; respond both proactively and on demand.
        sendPhoto();
        frame.classList.add('active');
        const gate = frame.contentDocument?.getElementById('gateButton');
        if (gate) gate.textContent = config.language === 'en'
          ? (config.previewOnly ? 'Continue preview' : 'Continue to Codex')
          : (config.previewOnly ? '继续预览' : '继续进入 Codex');
        frame.focus();
        splash.style.display = 'none';
        notify('ueg:ready');
      }, {once:true});
      frame.src = buildUegUrl(config);
      return true;
    }
    win.addEventListener('message', function (event) {
      if (state !== 'started' || event.source !== frame.contentWindow || event.origin !== origin) return;
      if (event.data === 'ueg:need-photo') {sendPhoto(); return;}
      if (event.data === 'ueg:done') {
        state = 'finished';
        // Both browser and WebView2 must show a visible result. Earlier versions
        // mistakenly left the completed iframe in place for native previewOnly.
        frame.classList.remove('active');
        splash.style.display = 'flex';
        status.textContent = config && config.previewOnly
          ? 'UEG 预览已完成；关闭窗口即可退出'
          : (win.chrome && win.chrome.webview
              ? '授权动画已完成；等待 Codex 窗口交接（尚未确认）'
              : '演示已完成；刷新页面可重新预览');
        if (config.language === 'en') status.textContent = config.previewOnly
          ? 'UEG preview complete. Close this window to exit.' : 'Animation complete. Connecting to Codex…';
        notify('ueg:done');
      }
    });
    if (win.chrome && win.chrome.webview) {
      win.chrome.webview.addEventListener('message', function (event) {
        const data = event.data;
        if (data && data.type === 'ueg:init') start(data.config);
        else if (data && data.type === 'ueg:handoff-status') showHandoff(data);
      });
      notify('ueg:host-ready');
    } else if (win.location.search.includes('demo=1')) {
      start({name:'演示操作员', en:'DEMO OPERATOR', post:'ACCESS TERMINAL', voice:'off', auto:false});
    } else {
      status.textContent = '浏览器预览请添加 ?demo=1（正式使用由 Windows 启动器配置）';
    }
    return {start, getState: () => state};
  }
  const api = {normalize, buildUegUrl, install};
  root.UEGBridge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
