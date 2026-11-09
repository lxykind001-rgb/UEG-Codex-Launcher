// Optional Node.js local browser preview, no npm install, never binds public interfaces.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../src/UEGCodexLauncher/wwwroot');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.wav':'audio/wav','.json':'application/json'};
const port = 8765;
createServer(async (req,res) => {
  try {
    const filename = decodeURIComponent(new URL(req.url, `http://127.0.0.1:${port}`).pathname);
    const path = resolve(root, '.' + filename);
    if (path !== root && !path.startsWith(root + sep)) {res.writeHead(403);res.end();return;}
    if ((await stat(path)).isDirectory()) {res.writeHead(403);res.end();return;}
    const data = await readFile(path);
    res.writeHead(200, {'Content-Type':types[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'});
    res.end(data);
  } catch {res.writeHead(404);res.end('Missing UEG asset or invalid request');}
}).listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${port}/launcher.html?demo=1`));
