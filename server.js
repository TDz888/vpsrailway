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

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const VIEWS_DIR = path.join(__dirname, 'views');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PASSWORD = process.env.DASHBOARD_PASSWORD;

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const REMEMBER_TTL = 30 * 24 * 60 * 60 * 1000;
const SESSION_HARD_CAP = 30 * 24 * 60 * 60 * 1000;

const COOKIE_NAME = 'vps_session';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;

const LOGIN_PAGE = '/login';
const DEFAULT_PAGE = '/dashboard';
const PROTECTED_PAGES = ['/dashboard', '/terminal', '/code', '/metrics'];

if (!PASSWORD) {
  console.error('[fatal] DASHBOARD_PASSWORD is required');
  process.exit(1);
}
if (PASSWORD.length < 12) {
  console.error('[warn] DASHBOARD_PASSWORD should be at least 12 characters');
}

const SECRET = crypto.createHash('sha256').update('vps-control:' + PASSWORD).digest();

fs.mkdirSync(FILES_DIR, { recursive: true });
if (!fs.existsSync(VIEWS_DIR)) fs.mkdirSync(VIEWS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

function q(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

const RUNNERS = {
  '.py':   { lang: 'Python',   bin: 'python3', cmd: f => `python3 ${q(f)}` },
  '.pyw':  { lang: 'Python',   bin: 'python3', cmd: f => `python3 ${q(f)}` },
  '.js':   { lang: 'Node.js',  bin: 'node',    cmd: f => `node ${q(f)}` },
  '.mjs':  { lang: 'Node.js',  bin: 'node',    cmd: f => `node ${q(f)}` },
  '.cjs':  { lang: 'Node.js',  bin: 'node',    cmd: f => `node ${q(f)}` },
  '.sh':   { lang: 'Bash',     bin: 'bash',    cmd: f => `bash ${q(f)}` },
  '.bash': { lang: 'Bash',     bin: 'bash',    cmd: f => `bash ${q(f)}` },
  '.c':    { lang: 'C',        bin: 'gcc',     cmd: f => `gcc -O2 -o /tmp/vps-run.out ${q(f)} && /tmp/vps-run.out` },
  '.cpp':  { lang: 'C++',      bin: 'g++',     cmd: f => `g++ -O2 -std=c++17 -o /tmp/vps-run.out ${q(f)} && /tmp/vps-run.out` },
  '.cc':   { lang: 'C++',      bin: 'g++',     cmd: f => `g++ -O2 -std=c++17 -o /tmp/vps-run.out ${q(f)} && /tmp/vps-run.out` },
  '.cxx':  { lang: 'C++',      bin: 'g++',     cmd: f => `g++ -O2 -std=c++17 -o /tmp/vps-run.out ${q(f)} && /tmp/vps-run.out` },
  '.go':   { lang: 'Go',       bin: 'go',      cmd: f => `go run ${q(f)}` },
};

const availableRunners = new Map();

function detectRuntimes() {
  const cache = new Map();
  for (const [ext, cfg] of Object.entries(RUNNERS)) {
    let ok = cache.get(cfg.bin);
    if (ok === undefined) {
      const r = spawnSync('command', ['-v', cfg.bin], { shell: true, stdio: 'ignore' });
      ok = r.status === 0;
      cache.set(cfg.bin, ok);
    }
    if (ok) availableRunners.set(ext, cfg);
  }
}
detectRuntimes();

let tmuxCache = null;
function hasTmux() {
  if (tmuxCache !== null) return tmuxCache;
  const r = spawnSync('command', ['-v', 'tmux'], { shell: true, stdio: 'ignore' });
  tmuxCache = r.status === 0;
  return tmuxCache;
}

function audit(action, req, extra) {
  const ip = (req && (req.ip || (req.socket && req.socket.remoteAddress))) || '-';
  const ua = req && req.headers ? String(req.headers['user-agent'] || '-').slice(0, 90) : '-';
  const payload = extra ? ' ' + JSON.stringify(extra) : '';
  console.log(`[audit] ${new Date().toISOString()} ${action} ip=${ip}${payload}`);
}

const app = express();
const server = http.createServer(app);

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const host = req.headers.host;
  try {
    const o = new URL(origin);
    if (o.host !== host) {
      audit('csrf.block', req, { origin, host });
      return res.status(403).json({ error: 'Cross-origin request blocked' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid origin' });
  }
  next();
});

app.use(express.json({ limit: '4mb' }));
app.use('/static', express.static(PUBLIC_DIR, {
  index: false,
  maxAge: '1h',
  etag: true,
  dotfiles: 'deny',
}));

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function signSession(expiresAt) {
  const payload = b64urlEncode(JSON.stringify({ exp: expiresAt, iat: Date.now() }));
  const sig = b64urlEncode(crypto.createHmac('sha256', SECRET).update(payload).digest());
  return payload + '.' + sig;
}

function verifySession(token) {
  if (typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payload || !sig) return null;
  const expected = b64urlEncode(crypto.createHmac('sha256', SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(b64urlDecode(payload).toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (typeof data.iat === 'number' && Date.now() - data.iat > SESSION_HARD_CAP) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    const v = part.slice(eq + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch { out[k] = v; }
  }
  return out;
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie);
  return verifySession(cookies[COOKIE_NAME]);
}

function setSessionCookie(req, res, maxAge) {
  const token = signSession(Date.now() + maxAge);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    COOKIE_NAME + '=' + encodeURIComponent(token),
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=' + Math.floor(maxAge / 1000),
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

function requireAuthApi(req, res, next) {
  if (!getSession(req)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

function requireAuthPage(req, res, next) {
  if (!getSession(req)) {
    const target = encodeURIComponent(req.originalUrl || DEFAULT_PAGE);
    return res.redirect(LOGIN_PAGE + '?next=' + target);
  }
  next();
}

function safeNext(target) {
  if (typeof target !== 'string' || !target) return DEFAULT_PAGE;
  const candidates = [target];
  try { candidates.push(decodeURIComponent(target)); } catch {}
  for (const c of candidates) {
    if (!c.startsWith('/')) return DEFAULT_PAGE;
    if (c.startsWith('//')) return DEFAULT_PAGE;
    if (c.includes('\\')) return DEFAULT_PAGE;
    if (c.startsWith('/login')) return DEFAULT_PAGE;
  }
  return target;
}

const attempts = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || rec.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return { ok: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (rec.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfter: Math.ceil((rec.resetAt - now) / 1000) };
  }
  rec.count++;
  return { ok: true, remaining: RATE_LIMIT_MAX - rec.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of attempts) {
    if (rec.resetAt < now) attempts.delete(ip);
  }
}, 60000).unref();

app.post('/api/auth/login', (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    audit('login.ratelimited', req, { retryAfter: rl.retryAfter });
    res.set('Retry-After', String(rl.retryAfter));
    return res.status(429).json({ error: `Too many attempts. Retry in ${rl.retryAfter}s.` });
  }

  const body = req.body || {};
  const password = body.password;
  const remember = !!body.remember;
  const next = safeNext(body.next);

  if (typeof password !== 'string' || password.length === 0) {
    return res.status(400).json({ error: 'Password required' });
  }

  const given = crypto.createHash('sha256').update(password).digest();
  const actual = crypto.createHash('sha256').update(PASSWORD).digest();

  if (!crypto.timingSafeEqual(given, actual)) {
    audit('login.fail', req, { remaining: rl.remaining });
    return res.status(401).json({ error: 'Invalid password', remaining: rl.remaining });
  }

  attempts.delete(ip);
  setSessionCookie(req, res, remember ? REMEMBER_TTL : SESSION_TTL);
  audit('login.ok', req, { remember, next });
  res.json({ ok: true, next, expiresIn: remember ? REMEMBER_TTL : SESSION_TTL });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  audit('logout', req);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ ok: true, exp: s.exp, iat: s.iat });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime(), tmux: hasTmux() });
});

app.get('/', (req, res) => {
  if (getSession(req)) return res.redirect(DEFAULT_PAGE);
  res.redirect(LOGIN_PAGE);
});

app.get(LOGIN_PAGE, (req, res) => {
  if (getSession(req)) {
    return res.redirect(safeNext(req.query.next));
  }
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});

for (const page of PROTECTED_PAGES) {
  app.get(page, requireAuthPage, (req, res) => {
    res.sendFile(path.join(VIEWS_DIR, 'app.html'));
  });
}

app.get('/api/metrics', requireAuthApi, (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  res.json({
    cpu: {
      cores: cpus.length,
      model: cpus[0] ? cpus[0].model : 'unknown',
      speed: cpus[0] ? cpus[0].speed : 0,
      load1: load[0],
      load5: load[1],
      load15: load[2],
      usage: Math.min(100, (load[0] / Math.max(1, cpus.length)) * 100),
    },
    mem: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      percent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
    },
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    tmux: hasTmux(),
    runners: Array.from(availableRunners.keys()),
  });
});

function safeFilename(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const base = path.basename(raw);
  if (base !== raw) return null;
  if (base.length > 200) return null;
  if (base === '.' || base === '..') return null;
  if (base.startsWith('.')) return null;
  if (!/^[a-zA-Z0-9._\- ]+$/.test(base)) return null;
  return base;
}

function fileMeta(name) {
  const full = path.join(FILES_DIR, name);
  const st = fs.statSync(full);
  const ext = path.extname(name).toLowerCase();
  const runner = availableRunners.get(ext);
  const entry = {
    name,
    size: st.size,
    mtime: st.mtime,
    ext,
    language: runner ? runner.lang : null,
  };
  if (runner) {
    entry.run = { lang: runner.lang, cmd: runner.cmd(full) };
  }
  return entry;
}

app.get('/api/files', requireAuthApi, (req, res) => {
  try {
    const files = fs.readdirSync(FILES_DIR)
      .map(name => {
        try {
          const full = path.join(FILES_DIR, name);
          if (!fs.statSync(full).isFile()) return null;
          return fileMeta(name);
        } catch { return null; }
      })
      .filter(Boolean)
      .sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/files/:name', requireAuthApi, (req, res) => {
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  const full = path.join(FILES_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  try {
    const content = fs.readFileSync(full, 'utf8');
    const meta = fileMeta(name);
    res.json({ ...meta, content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files', requireAuthApi, (req, res) => {
  const body = req.body || {};
  const safe = safeFilename(body.name);
  if (!safe) return res.status(400).json({ error: 'Invalid filename' });
  try {
    const content = typeof body.content === 'string' ? body.content : '';
    fs.writeFileSync(path.join(FILES_DIR, safe), content, 'utf8');
    audit('file.write', req, { name: safe, bytes: content.length });
    res.json({ ok: true, name: safe, meta: fileMeta(safe) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:name', requireAuthApi, (req, res) => {
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  const full = path.join(FILES_DIR, name);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
    audit('file.delete', req, { name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function safeSid(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(raw)) return null;
  return raw;
}

function tmuxName(sid) { return 'vps-' + sid; }

function listTmuxSessions() {
  if (!hasTmux()) return [];
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0) return [];
  return String(r.stdout || '')
    .split('\n').map(s => s.trim())
    .filter(s => s.startsWith('vps-'))
    .map(s => s.slice(4));
}

app.get('/api/terminal/sessions', requireAuthApi, (req, res) => {
  res.json({ tmux: hasTmux(), sessions: listTmuxSessions() });
});

app.delete('/api/terminal/:sid', requireAuthApi, (req, res) => {
  const sid = safeSid(req.params.sid);
  if (!sid) return res.status(400).json({ error: 'Invalid session id' });
  if (!hasTmux()) return res.json({ ok: true, killed: false });
  const r = spawnSync('tmux', ['kill-session', '-t', tmuxName(sid)], { stdio: 'ignore' });
  audit('terminal.kill', req, { sid, killed: r.status === 0 });
  res.json({ ok: true, killed: r.status === 0 });
});

function buildChildEnv() {
  const env = { ...process.env };
  delete env.DASHBOARD_PASSWORD;
  delete env.NODE_ENV;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.LANG = 'en_US.UTF-8';
  env.LC_ALL = 'en_US.UTF-8';
  return env;
}

function spawnShell(sid, cols, rows) {
  const env = buildChildEnv();
  const cwd = FILES_DIR;
  if (sid && hasTmux()) {
    return pty.spawn('tmux', ['new-session', '-A', '-s', tmuxName(sid)], {
      name: 'xterm-256color', cols, rows, cwd, env,
    });
  }
  const shell = process.env.SHELL || '/bin/bash';
  return pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd, env });
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
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
  if (!getSession(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sid = safeSid(url.searchParams.get('sid'));
  const cols = clampInt(url.searchParams.get('cols'), 20, 500, 80);
  const rows = clampInt(url.searchParams.get('rows'), 5, 200, 24);

  let ptyProcess;
  try {
    ptyProcess = spawnShell(sid, cols, rows);
  } catch (err) {
    try { ws.send(JSON.stringify({ type: 'control', event: 'error', message: String(err.message) })); } catch {}
    return ws.close();
  }

  audit('terminal.open', req, { sid, tmux: hasTmux() });

  try {
    ws.send(JSON.stringify({ type: 'control', event: 'ready', sid, tmux: hasTmux() }));
  } catch {}

  ptyProcess.onData(data => {
    if (ws.readyState === ws.OPEN) {
      try { ws.send(data); } catch {}
    }
  });

  ptyProcess.onExit(({ exitCode, signal }) => {
    try { ws.send(JSON.stringify({ type: 'control', event: 'exit', code: exitCode, signal })); } catch {}
    try { ws.close(); } catch {}
  });

  ws.on('message', raw => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      try { ptyProcess.write(raw.toString()); } catch {}
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'input' && typeof msg.data === 'string') {
      try { ptyProcess.write(msg.data); } catch {}

    } else if (msg.type === 'resize') {
      const c = clampInt(msg.cols, 20, 500, 80);
      const r = clampInt(msg.rows, 5, 200, 24);
      try { ptyProcess.resize(c, r); } catch {}

    } else if (msg.type === 'run' && typeof msg.file === 'string') {
      const name = safeFilename(msg.file);
      if (!name) return;
      const ext = path.extname(name).toLowerCase();
      const runner = availableRunners.get(ext);
      if (!runner) return;
      const full = path.join(FILES_DIR, name);
      if (!fs.existsSync(full)) return;
      const cmd = runner.cmd(full);
      try { ptyProcess.write(cmd + '\n'); } catch {}
      audit('terminal.run', req, { sid, file: name, lang: runner.lang });
    }
  });

  const cleanup = () => {
    try { ptyProcess.kill(); } catch {}
  };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) {
      try { ws.ping(); } catch { clearInterval(ping); }
    } else {
      clearInterval(ping);
    }
  }, 30000);
  ws.on('close', () => clearInterval(ping));
});

app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (getSession(req)) return res.redirect(DEFAULT_PAGE);
  res.redirect(LOGIN_PAGE);
});

app.use((err, req, res, next) => {
  console.error('[error]', err && err.message);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Internal server error' });
  res.status(500).type('text/plain').send('Internal server error');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('[ready] vps-control listening on :' + PORT);
  console.log('[ready] shell=' + (process.env.SHELL || '/bin/bash') + ' tmux=' + hasTmux());
  console.log('[ready] runners=' + (Array.from(availableRunners.keys()).join(',') || 'none'));
  console.log('[ready] data=' + DATA_DIR);
});
