// MCP App transport only; the form and validation remain in settings.js.
(() => {
  let sequence = 0;
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.jsonrpc !== '2.0') return;
    const item = pending.get(event.data.id);
    if (!item) return;
    pending.delete(event.data.id); clearTimeout(item.timer);
    if (event.data.error) item.reject(Error(event.data.error.message));
    else item.resolve(event.data.result);
  });
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(Error('设置连接超时，请重新打开插件设置。')); }, 30000);
      pending.set(id, { resolve, reject, timer });
      parent.postMessage({ jsonrpc: '2.0', id, method, params }, '*');
    });
  }
  const ready = request('ui/initialize', {
    protocolVersion: '2026-01-26', appInfo: { name: 'ueg-settings', version: '0.6.0' }, appCapabilities: {}
  }).then(() => parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/initialized' }, '*'));
  window.uegPluginApi = async (route, body) => {
    await ready;
    const result = await request('tools/call', {
      name: body ? 'ueg_save_settings' : 'ueg_get_settings',
      arguments: body ? { route, body } : {}
    });
    if (result.isError) throw Error(result.content?.find(c => c.type === 'text')?.text || '保存失败');
    return result.structuredContent;
  };
})();
