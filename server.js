/**
 * VPS Control — Backend Server
 * ────────────────────────────────────────────────────────────────────────────
 * Kiến trúc:
 *   • Auth      : password → HMAC-signed cookie (stateless, không cần DB/Redis)
 *   • HTTP APIs : /api/auth/*, /api/metrics, /api/files/*, /api/terminal/*
 *   • WebSocket : /ws/terminal — mỗi connection = 1 PTY, có thể attach vào
 *                 tmux session để giữ state qua reload / mất mạng
 *
 * Biến môi trường:
 *   DASHBOARD_PASSWORD  (bắt buộc)          — mật khẩu đăng nhập
 *   PORT                (mặc định 3000)     — cổng HTTP
 *   DATA_DIR            (mặc định ./data)   — thư mục lưu file lâu dài
 *   SHELL               (mặc định /bin/bash) — shell cho PTY (khi không có tmux)
 */

'use strict';

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');

/* ══════════════════════════════════════════════════════════════════════════
   1. CONFIG
   ══════════════════════════════════════════════════════════════════════════ */

const PORT         = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR     = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR    = path.join(DATA_DIR, 'files');
const PASSWORD     = process.env.DASHBOARD_PASSWORD;

const SESSION_MAX_AGE_MS  = 7  * 24 * 60 * 60 * 1000;  // 7 ngày
const REMEMBER_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;  // 30 ngày ("remember me")

const COOKIE_NAME = 'vps_session';
const MAX_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;              // 15 phút

// SECRET được derive từ password → đổi password = invalidate toàn bộ session cũ.
// Không cần thêm env var, không cần lưu secret ở đâu.
const SECRET = PASSWORD
  ? crypto.createHash('sha256').update('vps-control:' + PASSWORD).digest()
  : null;

/* ══════════════════════════════════════════════════════════════════════════
   2. STARTUP VALIDATION — fail fast nếu thiếu password
   ══════════════════════════════════════════════════════════════════════════ */

if (!PASSWORD) {
  console.error('\x1b[31m✗ FATAL: DASHBOARD_PASSWORD is required.\x1b[0m');
  console.error('  Local   : export DASHBOARD_PASSWORD="your-strong-password"');
  console.error('  Railway : Settings → Variables → DASHBOARD_PASSWORD');
  process.exit(1);
}

if (PASSWORD.length < 12) {
  console.warn('\x1b[33m⚠ DASHBOARD_PASSWORD is shorter than 12 characters. Use a longer one.\x1b[0m');
}

fs.mkdirSync(FILES_DIR, { recursive: true });

/* ══════════════════════════════════════════════════════════════════════════
   3. EXPRESS APP
   ══════════════════════════════════════════════════════════════════════════ */

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);       // Railway terminate TLS ở edge → cần trust proxy
app.disable('x-powered-by');     // giảm fingerprinting

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  etag: true,
  maxAge: '5m',
}));

/* ══════════════════════════════════════════════════════════════════════════
   4. SESSION — HMAC-signed stateless cookie
   ──────────────────────────────────────────────────────────────────────────
   Format:  base64url(JSON({exp})) + "." + base64url(HMAC-SHA256(payload, SECRET))
   Verify:  tính lại HMAC, so sánh timing-safe, check exp
   ══════════════════════════════════════════════════════════════════════════ */

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signSession(expiresAt) {
  const payload = b64urlEncode(JSON.stringify({ exp: expiresAt }));
  const sig = b64urlEncode(
    crypto.createHmac('sha256', SECRET).update(payload).digest()
  );
  return `${payload}.${sig}`;
}

function verifySessionToken(token) {
  if (typeof token !== 'string') return null;

  const dot = token.indexOf('.');
  if (dot < 1) return null;

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;

  const expected = b64urlEncode(
    crypto.createHmac('sha256', SECRET).update(payload).digest()
  );

  // timingSafeEqual yêu cầu cùng độ dài → check trước
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    try { out[k] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySessionToken(cookies[COOKIE_NAME]);
}

function setSessionCookie(req, res, maxAgeMs) {
  const token = signSession(Date.now() + maxAgeMs);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';

  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',           // JS không đọc được → chống XSS đánh cắp session
    'SameSite=Lax',       // chống CSRF cơ bản
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (secure) parts.push('Secure');   // chỉ gửi qua HTTPS

  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAuth(req, res, next) {
  if (!getSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

/* ══════════════════════════════════════════════════════════════════════════
   5. RATE LIMIT LOGIN — in-memory, per IP
   ══════════════════════════════════════════════════════════════════════════ */

const loginAttempts = new Map();   // ip → { count, resetAt }

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = loginAttempts.get(ip);

  if (!rec || rec.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return { ok: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (rec.count >= MAX_ATTEMPTS) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }

  rec.count++;
  return { ok: true, remaining: MAX_ATTEMPTS - rec.count };
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

// Cleanup định kỳ để Map không phình to
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of loginAttempts) {
    if (rec.resetAt < now) loginAttempts.delete(ip);
  }
}, 60_000).unref();

/* ══════════════════════════════════════════════════════════════════════════
   6. AUTH ROUTES
   ══════════════════════════════════════════════════════════════════════════ */

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    res.set('Retry-After', String(rl.retryAfter));
    return res.status(429).json({
      error: `Too many attempts. Try again in ${rl.retryAfter}s.`,
    });
  }

  const { password, remember } = req.body || {};
  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password is required.' });
  }

  // Hash cả hai để có cùng độ dài → timingSafeEqual hoạt động đúng
  const given  = crypto.createHash('sha256').update(password).digest();
  const actual = crypto.createHash('sha256').update(PASSWORD).digest();
  const ok = crypto.timingSafeEqual(given, actual);

  if (!ok) {
    return res.status(401).json({
      error: 'Invalid password.',
      remaining: rl.remaining,
    });
  }

  clearRateLimit(ip);
  const maxAge = remember ? REMEMBER_MAX_AGE_MS : SESSION_MAX_AGE_MS;
  setSessionCookie(req, res, maxAge);

  res.json({ ok: true, expiresIn: maxAge });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ ok: true, exp: session.exp });
});

/* ══════════════════════════════════════════════════════════════════════════
   7. HEALTH — public, cho Railway/Docker healthcheck
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

/* ══════════════════════════════════════════════════════════════════════════
   8. METRICS
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/metrics', requireAuth, (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  const usedMem  = totalMem - freeMem;

  res.json({
    cpu: {
      cores:  cpus.length,
      load1:  load[0],
      load5:  load[1],
      load15: load[2],
      usage:  Math.min(100, (load[0] / cpus.length) * 100),
    },
    mem: {
      total:   totalMem,
      used:    usedMem,
      free:    freeMem,
      percent: (usedMem / totalMem) * 100,
    },
    uptime:   os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch:     os.arch(),
    node:     process.version,
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   9. FILE APIs
   ──────────────────────────────────────────────────────────────────────────
   Whitelist tên file để chống path traversal & command injection
   ══════════════════════════════════════════════════════════════════════════ */

function safeFilename(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const base = path.basename(raw);
  if (base !== raw) return null;                  // chặn "a/../b"
  if (base.length > 200) return null;
  if (base === '.' || base === '..') return null;
  if (!/^[a-zA-Z0-9._\- ]+$/.test(base)) return null;
  return base;
}

app.get('/api/files', requireAuth, (req, res) => {
  try {
    const files = fs.readdirSync(FILES_DIR)
      .map(name => {
        const st = fs.statSync(path.join(FILES_DIR, name));
        return { name, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:name', requireAuth, (req, res) => {
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });

  const p = path.join(FILES_DIR, name);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Not found' });

  try {
    res.json({ name, content: fs.readFileSync(p, 'utf8') });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files', requireAuth, (req, res) => {
  const { name, content } = req.body || {};
  const safe = safeFilename(name);
  if (!safe) return res.status(400).json({ error: 'Invalid filename' });

  try {
    fs.writeFileSync(path.join(FILES_DIR, safe), content || '', 'utf8');
    res.json({ ok: true, name: safe });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:name', requireAuth, (req, res) => {
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });

  const p = path.join(FILES_DIR, name);
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════════════════
   10. TERMINAL — tmux session management
   ──────────────────────────────────────────────────────────────────────────
   Mỗi tab terminal = 1 tmux session tên "vps-<sid>".
   Client tạo sid (UUID), lưu localStorage.
   Reload trang → client gửi lại sid → attach vào tmux cũ → state nguyên vẹn.
   ══════════════════════════════════════════════════════════════════════════ */

let tmuxAvailableCache = null;

function hasTmux() {
  if (tmuxAvailableCache !== null) return tmuxAvailableCache;

  const r = spawnSync('command', ['-v', 'tmux'], {
    shell: true,
    stdio: 'ignore',
  });
  tmuxAvailableCache = r.status === 0;

  if (!tmuxAvailableCache) {
    console.warn('\x1b[33m⚠ tmux not found — terminal sessions will NOT persist across reloads.\x1b[0m');
  }
  return tmuxAvailableCache;
}

function safeSid(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(raw)) return null;
  return raw;
}

function tmuxSessionName(sid) {
  return `vps-${sid}`;
}

function listTmuxSessions() {
  if (!hasTmux()) return [];

  const r = spawnSync(
    'tmux',
    ['list-sessions', '-F', '#{session_name}'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
  );
  if (r.status !== 0) return [];

  return (r.stdout || '')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.startsWith('vps-'))
    .map(s => s.slice(4));
}

app.get('/api/terminal/sessions', requireAuth, (req, res) => {
  res.json({
    tmux: hasTmux(),
    sessions: listTmuxSessions(),
  });
});

app.delete('/api/terminal/:sid', requireAuth, (req, res) => {
  const sid = safeSid(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'Invalid session id' });

  if (!hasTmux()) return res.json({ ok: true, killed: false });

  const r = spawnSync(
    'tmux',
    ['kill-session', '-t', tmuxSessionName(sid)],
    { stdio: 'ignore' }
  );
  res.json({ ok: true, killed: r.status === 0 });
});

/* ══════════════════════════════════════════════════════════════════════════
   11. PTY SPAWN
   ──────────────────────────────────────────────────────────────────────────
   Quan trọng: KHÔNG truyền DASHBOARD_PASSWORD xuống shell con
   ══════════════════════════════════════════════════════════════════════════ */

function buildChildEnv() {
  const env = { ...process.env };

  // Xoá secret khỏi môi trường shell con
  delete env.DASHBOARD_PASSWORD;
  delete env.PORT;
  delete env.NODE_ENV;

  env.TERM       = 'xterm-256color';
  env.COLORTERM  = 'truecolor';
  env.LANG       = 'en_US.UTF-8';
  env.LC_ALL     = 'en_US.UTF-8';

  return env;
}

function spawnShellForSid(sid, cols, rows) {
  const env = buildChildEnv();
  const cwd = FILES_DIR;

  if (sid && hasTmux()) {
    // tmux new-session -A -s <name>:
    //   - nếu session tồn tại → attach
    //   - nếu chưa → tạo mới
    return pty.spawn(
      'tmux',
      ['new-session', '-A', '-s', tmuxSessionName(sid)],
      { name: 'xterm-256color', cols, rows, cwd, env }
    );
  }

  // Fallback: shell thô, không có persistence
  const shell = process.env.SHELL || '/bin/bash';
  return pty.spawn(shell, [], {
    name: 'xterm-256color', cols, rows, cwd, env,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
   12. WEBSOCKET SERVER
   ──────────────────────────────────────────────────────────────────────────
   Cookie auth được check trong 'upgrade' event — trước khi bắt tay WS.
   Browser tự gửi cookie trong WS handshake nên không cần token query.
   ══════════════════════════════════════════════════════════════════════════ */

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  // Kiểm tra path
  let pathname;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    return socket.destroy();
  }

  if (pathname !== '/ws/terminal') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    return socket.destroy();
  }

  // Cookie auth
  if (!getSession(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }

  wss.handleUpgrade(req, socket, head, ws => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sid = safeSid(url.searchParams.get('sid'));
  const initCols = clampInt(url.searchParams.get('cols'), 20, 500, 80);
  const initRows = clampInt(url.searchParams.get('rows'), 5, 200, 24);

  let ptyProcess;
  try {
    ptyProcess = spawnShellForSid(sid, initCols, initRows);
  } catch (err) {
    sendControl(ws, 'error', { message: `Cannot spawn shell: ${err.message}` });
    return ws.close();
  }

  sendControl(ws, 'ready', { sid, tmux: hasTmux() });

  // PTY → browser (raw bytes — xterm.js tự parse ANSI)
  ptyProcess.onData(data => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    sendControl(ws, 'exit', { code: exitCode, signal });
    if (ws.readyState === ws.OPEN) ws.close();
  });

  // Browser → PTY
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'input' && typeof msg.data === 'string') {
        ptyProcess.write(msg.data);

      } else if (msg.type === 'resize') {
        const c = clampInt(msg.cols, 20, 500, 80);
        const r = clampInt(msg.rows, 5, 200, 24);
        try { ptyProcess.resize(c, r); } catch { /* race condition khi đóng */ }
      }
    } catch {
      // Fallback: cho phép raw keystroke (tiện debug bằng CLI)
      try { ptyProcess.write(raw.toString()); } catch {}
    }
  });

  // Cleanup — lưu ý: tmux session KHÔNG chết khi client disconnect,
  // vì tmux chạy như daemon. Chỉ có tmux client (PTY process) bị kill.
  const cleanup = () => {
    try { ptyProcess.kill(); } catch {}
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  // Heartbeat để giữ kết nối qua proxy
  const pingInterval = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try { ws.ping(); }
      catch { clearInterval(pingInterval); }
    } else {
      clearInterval(pingInterval);
    }
  }, 30_000);

  ws.on('close', () => clearInterval(pingInterval));
});

function sendControl(ws, event, data = {}) {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify({ type: 'control', event, ...data }));
  } catch {}
}

function clampInt(value, min, max, fallback) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ══════════════════════════════════════════════════════════════════════════
   13. SPA FALLBACK
   ──────────────────────────────────────────────────────────────────────────
   Mọi route không phải /api/* hoặc /ws/* → trả index.html (client-side routing)
   ══════════════════════════════════════════════════════════════════════════ */

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
    if (err) next();
  });
});

// Error handler — không rò rỉ stack trace ra ngoài
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
});

/* ══════════════════════════════════════════════════════════════════════════
   14. START
   ══════════════════════════════════════════════════════════════════════════ */

server.listen(PORT, '0.0.0.0', () => {
  console.log('\x1b[32m✓ VPS Control running\x1b[0m');
  console.log(`  Port       : ${PORT}`);
  console.log(`  Shell      : ${process.env.SHELL || '/bin/bash'}`);
  console.log(`  tmux       : ${hasTmux() ? 'available (session persistence ON)' : 'missing'}`);
  console.log(`  Data dir   : ${DATA_DIR}`);
  console.log(`  Auth       : password (${PASSWORD.length} chars)`);
});
