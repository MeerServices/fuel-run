#!/usr/bin/env node
/*
  Fuel Run controller bridge
  --------------------------
  A browser cannot listen on UDP. This small program does it for the game:
  it listens for the controller on UDP port 6001 and passes every message on
  to the game over a WebSocket. It also serves the game itself, so you can
  open it on this computer or on any phone or tablet in the same network:

      http://localhost:6002            (on this computer)
      http://<ip-of-this-computer>:6002 (on another device)

  Start:   node fuel-run-bridge.js
  Options: --udp 6001   UDP port of the controller
           --port 6002  web + WebSocket port for the game
  No extra packages needed (Node.js 16 or newer).
*/
const dgram = require('dgram'), http = require('http'), https = require('https'), crypto = require('crypto'),
      fs = require('fs'), path = require('path'), os = require('os');

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const UDP_PORT = +arg('udp', 6001), WEB_PORT = +arg('port', 6002);
const SITE = 'https://meerservices.github.io/fuel-run/';
const clients = new Set();
let last = '';

/* ---------- WebSocket (server side, text frames only) ---------- */
function wsFrame(str) {
  const data = Buffer.from(str), n = data.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255])
    : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, data]);
}
function broadcast(str) { const f = wsFrame(str); for (const c of clients) { try { c.write(f); } catch (e) { clients.delete(c); } } }
function onUpgrade(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  sock.setNoDelay(true); clients.add(sock);
  console.log(`[game] connected (${clients.size} open)`);
  sock.write(wsFrame(JSON.stringify({ bridge: 'fuel-run', udp: UDP_PORT })));
  sock.on('data', buf => {  // answer pings, honour close
    const op = buf[0] & 15;
    if (op === 8) { try { sock.end(Buffer.from([0x88, 0])); } catch (e) {} clients.delete(sock); }
    if (op === 9) { try { sock.write(Buffer.from([0x8A, 0])); } catch (e) {} }
  });
  const bye = () => { if (clients.delete(sock)) console.log(`[game] disconnected (${clients.size} open)`); };
  sock.on('close', bye); sock.on('error', bye);
}

/* ---------- UDP from the controller ---------- */
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udp.on('message', (msg, from) => {
  const text = msg.toString('utf8').trim();
  let ok = true; try { JSON.parse(text); } catch (e) { ok = false; }
  if (!ok) { console.log(`[udp] ignored (not JSON) from ${from.address}: ${text.slice(0, 80)}`); return; }
  if (text !== last) console.log(`[udp] ${from.address}: ${text}`);
  last = text;
  broadcast(text);
});
udp.on('error', e => { console.error('[udp] ' + e.message); process.exit(1); });
udp.bind(UDP_PORT, '0.0.0.0', () => { try { udp.setBroadcast(true); } catch (e) {} console.log(`[udp] listening on port ${UDP_PORT}`); });

/* ---------- serve the game ---------- */
const cache = {};
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.css': 'text/css' };
function fetchSite(p) {
  return new Promise((res, rej) => https.get(SITE + p, r => {
    if (r.statusCode !== 200) { rej(new Error('HTTP ' + r.statusCode)); r.resume(); return; }
    const ch = []; r.on('data', d => ch.push(d)); r.on('end', () => res(Buffer.concat(ch)));
  }).on('error', rej));
}
const web = http.createServer(async (req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]).replace(/^\/+/, '');
  if (!p) p = 'index.html';
  if (p.includes('..')) { res.writeHead(400); res.end(); return; }
  const local = path.join(__dirname, p);
  try {
    let body;
    if (fs.existsSync(local) && fs.statSync(local).isFile()) body = fs.readFileSync(local);  // a copy next to this file wins
    else { if (!cache[p]) cache[p] = await fetchSite(p); body = cache[p]; }                    // otherwise the online version
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found: ' + p + ' (' + e.message + ')'); }
});
web.on('upgrade', onUpgrade);
web.listen(WEB_PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`[web] game:  http://localhost:${WEB_PORT}` + ips.map(ip => `   http://${ip}:${WEB_PORT}`).join(''));
  console.log(`[web] or connect the game to  ws://localhost:${WEB_PORT}  (CONFIG > Controller)`);
});
setInterval(() => broadcast('{"ping":1}'), 15000);
