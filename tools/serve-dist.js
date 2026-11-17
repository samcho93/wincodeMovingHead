#!/usr/bin/env node
// serve-dist.js — serve the static build for a quick check:  node tools/serve-dist.js [dir] [port]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const dir = path.resolve(process.argv[2] || 'dist'), port = +(process.argv[3] || 7741);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.pdf': 'application/pdf' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(dir, p));
  if (!f.startsWith(dir)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, b) => { if (e) { res.writeHead(404); return res.end('404'); } res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(b); });
}).listen(port, () => console.log(`static build → http://127.0.0.1:${port}`));
