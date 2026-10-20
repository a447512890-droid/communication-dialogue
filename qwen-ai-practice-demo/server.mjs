import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);

// Small .env loader so the demo has no runtime dependencies.
const envPath = path.join(here, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith('#') && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

const port = Number(process.env.PORT || 8766);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(302, { Location: '/%E5%8E%9F%E5%9E%8B/' });
    return res.end();
  }
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return send(res, 200, { configured: Boolean(process.env.DASHSCOPE_API_KEY), model: process.env.QWEN_MODEL || 'qwen3.8-omni-flash-realtime' });
  }
  if (req.method === 'POST' && url.pathname === '/api/realtime-sdp') {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) return send(res, 503, { error: '尚未配置 DASHSCOPE_API_KEY。请复制 .env.example 为 .env 并填写。' });
    const model = process.env.QWEN_MODEL || 'qwen3.8-omni-flash-realtime';
    let offer = '';
    try {
      console.log(`[realtime] SDP offer received; model=${model}`);
      for await (const chunk of req) {
        offer += chunk;
        if (offer.length > 1_000_000) return send(res, 413, { error: 'SDP 请求过大' });
      }
      const upstream = await fetch(`https://maas.qianwenaiapi.com/api/v1/webrtc/realtime?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/sdp' },
        body: offer,
        signal: AbortSignal.timeout(30_000)
      });
      const answer = await upstream.text();
      if (!upstream.ok) {
        console.error(`[realtime] upstream rejected SDP; status=${upstream.status}; detail=${answer.slice(0, 1200)}`);
        return send(res, upstream.status, { error: `千问实时服务拒绝连接（${upstream.status}）`, detail: answer.slice(0, 4000) });
      }
      console.log(`[realtime] SDP answer received; status=${upstream.status}`);
      return send(res, 200, answer, 'application/sdp');
    } catch (error) {
      console.error(`[realtime] SDP exchange failed: ${error.message}`);
      return send(res, 502, { error: '连接千问实时服务失败', detail: error.message });
    }
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
  const relative = decodeURIComponent(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
  const publicPaths = ['/原型/', '/docs/', '/assets/'];
  const demoFiles = ['/qwen-ai-practice-demo/index.html', '/qwen-ai-practice-demo/app.js', '/qwen-ai-practice-demo/styles.css'];
  if (!publicPaths.some(prefix => relative.startsWith(prefix)) && !demoFiles.includes(relative)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  if (relative.split('/').some(part => part.startsWith('.'))) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const file = path.resolve(root, `.${relative}`);
  const allowedDirectories = ['原型', 'docs', 'assets'].map(name => path.join(root, name));
  if (!allowedDirectories.some(dir => file.startsWith(dir + path.sep)) && !demoFiles.some(name => file === path.join(root, name))) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  const ext = path.extname(file);
  if (!Object.hasOwn(mime, ext) && !['.md', '.png', '.jpg', '.jpeg', '.webp', '.woff', '.woff2'].includes(ext)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

server.listen(port, '127.0.0.1', () => console.log(`Qwen AI 陪练 demo: http://127.0.0.1:${port}`));
