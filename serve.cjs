// 本地配套服务：
//   1) 静态托管当前目录（http://127.0.0.1:8791/）
//   2) POST /api/save —— 页面数据变更时自动写入 index.html 同目录的「个税数据.json」
// 用 node serve.cjs 启动，浏览器访问 http://127.0.0.1:8791/ 即可享受零点击自动落盘。
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = __dirname;
const SAVE_FILE = path.join(root, '个税数据.json');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { p = '/'; }

  if (p === '/api/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, file: SAVE_FILE }));
    return;
  }
  if (p === '/api/save' && req.method === 'POST') {
    let body = '';
    let oversize = false;
    req.on('data', c => {
      body += c;
      if (body.length > 2e6) { oversize = true; req.destroy(); }
    });
    req.on('end', () => {
      if (oversize) { res.writeHead(413); res.end('too large'); return; }
      fs.writeFile(SAVE_FILE, body, err => {
        if (err) { res.writeHead(500); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"ok":true}');
      });
    });
    return;
  }

  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}).listen(8791, '127.0.0.1', () => console.log('serving http://127.0.0.1:8791/  (auto-save -> ' + SAVE_FILE + ')'));
