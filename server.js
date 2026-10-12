'use strict';

const express = require('express');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');
const os = require('os');
const fs = require('fs');
const path = require('path');

const createCatalog = require('./shop-catalog.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const PYLIB_DIR = path.join(DATA_DIR, 'pylib');
const NPM_DIR = path.join(DATA_DIR, 'npm-global');
const BIN_DIR = path.join(DATA_DIR, 'bin');
const SSHX_DIR = path.join(DATA_DIR, 'sshx');
const TAILSCALE_DIR = path.join(DATA_DIR, 'tailscale');
const SYSTEM_DIR = path.join(DATA_DIR, 'system');
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
const PROTECTED_PAGES = ['/dashboard', '/terminal', '/code', '/metrics', '/shop', '/connection', '/setting'];

if (!PASSWORD) {
  console.error('[fatal] DASHBOARD_PASSWORD is required');
  process.exit(1);
}
if (PASSWORD.length < 12) {
  console.error('[warn] DASHBOARD_PASSWORD should be at least 12 characters');
}

const SECRET = crypto.createHash('sha256').update('vps-control:' + PASSWORD).digest();

for (const dir of [FILES_DIR, WORKSPACES_DIR, PYLIB_DIR, NPM_DIR, BIN_DIR, SSHX_DIR, TAILSCALE_DIR, SYSTEM_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(VIEWS_DIR)) fs.mkdirSync(VIEWS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

const SHOP_CATALOG = createCatalog({ PYLIB_DIR, NPM_DIR, BIN_DIR });
const CATALOG_INDEX = new Map(SHOP_CATALOG.map(p => [p.id, p]));

function q(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }

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

function shopEnv() {
  const env = { ...process.env };
  delete env.DASHBOARD_PASSWORD;
  delete env.NODE_ENV;
  env.PYTHONPATH = PYLIB_DIR + (env.PYTHONPATH ? ':' + env.PYTHONPATH : '');
  env.PATH = BIN_DIR + ':' + NPM_DIR + '/bin:' + (env.PATH || '');
  env.NPM_CONFIG_PREFIX = NPM_DIR;
  env.HOME = env.HOME || '/root';
  env.DEBIAN_FRONTEND = 'noninteractive';
  env.TERM = 'xterm-256color';
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  return env;
}

function runCapture(cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', cmd], { env: shopEnv() });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('Timeout: ' + cmd));
    }, timeoutMs || 20000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || 'exit ' + code).trim()));
    });
  });
}

async function isInstalled(pkg) {
  if (!pkg.verify) return { installed: false };
  try {
    const out = await runCapture(pkg.verify, 6000);
    const trimmed = String(out).trim();
    const versionMatch = trimmed.match(/(\d+\.\d+(?:[\.\-\w]+)?)/);
    return {
      installed: true,
      version: versionMatch ? versionMatch[1] : trimmed.slice(0, 60)
    };
  } catch {
    return { installed: false };
  }
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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
    'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + Math.floor(maxAge / 1000),
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
app.use('/static', express.static(PUBLIC_DIR, { index: false, maxAge: '1h', etag: true, dotfiles: 'deny' }));

/* AUTH */
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
  if (typeof password !== 'string' || password.length === 0) return res.status(400).json({ error: 'Password required' });
  const given = crypto.createHash('sha256').update(password).digest();
  const actual = crypto.createHash('sha256').update(PASSWORD).digest();
  if (!crypto.timingSafeEqual(given, actual)) {
    audit('login.fail', req, { remaining: rl.remaining });
    return res.status(401).json({ error: 'Invalid password', remaining: rl.remaining });
  }
  attempts.delete(ip);
  setSessionCookie(req, res, remember ? REMEMBER_TTL : SESSION_TTL);
  audit('login.ok', req, { remember });
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

/* PAGE ROUTES */
app.get('/', (req, res) => {
  if (getSession(req)) return res.redirect(DEFAULT_PAGE);
  res.redirect(LOGIN_PAGE);
});
app.get(LOGIN_PAGE, (req, res) => {
  if (getSession(req)) return res.redirect(safeNext(req.query.next));
  res.sendFile(path.join(VIEWS_DIR, 'login.html'));
});
for (const page of PROTECTED_PAGES) {
  app.get(page, requireAuthPage, (req, res) => {
    res.sendFile(path.join(VIEWS_DIR, 'app.html'));
  });
}

/* METRICS */
app.get('/api/metrics', requireAuthApi, (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  let diskUsed = 0, diskTotal = 0;
  try {
    if (fs.statfsSync) {
      const stat = fs.statfsSync(DATA_DIR);
      diskTotal = stat.blocks * stat.bsize;
      diskUsed = (stat.blocks - stat.bavail) * stat.bsize;
    }
  } catch {}
  res.json({
    cpu: { cores: cpus.length, model: cpus[0] ? cpus[0].model : 'unknown', speed: cpus[0] ? cpus[0].speed : 0, load1: load[0], load5: load[1], load15: load[2], usage: Math.min(100, (load[0] / Math.max(1, cpus.length)) * 100) },
    mem: { total: totalMem, used: usedMem, free: freeMem, percent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0 },
    disk: { total: diskTotal, used: diskUsed, percent: diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0 },
    uptime: os.uptime(), hostname: os.hostname(), platform: os.platform(), arch: os.arch(), release: os.release(), node: process.version,
    tmux: hasTmux(),
    runners: Array.from(availableRunners.keys()),
    shop: { total: SHOP_CATALOG.length, categories: Array.from(new Set(SHOP_CATALOG.map(p => p.category))).length, essentials: SHOP_CATALOG.filter(p => p.priority === 'essential').length },
    workspaces: listWorkspaces().length,
  });
});

/* WORKSPACES */
function safeWorkspaceName(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  const base = raw.trim().toLowerCase().replace(/\s+/g, '-');
  if (base.length < 1 || base.length > 48) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(base)) return null;
  if (base === '.' || base === '..') return null;
  return base;
}

function workspaceRoot(name) {
  if (!name || name === 'default') return FILES_DIR;
  return path.join(WORKSPACES_DIR, name);
}

function listWorkspaces() {
  const out = [{ id: 'default', name: 'default', path: FILES_DIR, isDefault: true }];
  try {
    const entries = fs.readdirSync(WORKSPACES_DIR, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const p = path.join(WORKSPACES_DIR, e.name);
      let fileCount = 0, size = 0;
      try {
        const files = fs.readdirSync(p);
        for (const f of files) {
          try {
            const st = fs.statSync(path.join(p, f));
            if (st.isFile()) { fileCount++; size += st.size; }
          } catch {}
        }
      } catch {}
      let mtime = new Date(0);
      try { mtime = fs.statSync(p).mtime; } catch {}
      out.push({ id: e.name, name: e.name, path: p, fileCount, size, mtime, isDefault: false });
    }
  } catch {}
  return out;
}

app.get('/api/workspaces', requireAuthApi, (req, res) => {
  res.json({ items: listWorkspaces() });
});

app.post('/api/workspaces', requireAuthApi, (req, res) => {
  const body = req.body || {};
  const name = safeWorkspaceName(body.name);
  if (!name) return res.status(400).json({ error: 'Invalid workspace name' });
  if (name === 'default') return res.status(400).json({ error: 'Name reserved' });
  const full = path.join(WORKSPACES_DIR, name);
  if (fs.existsSync(full)) return res.status(409).json({ error: 'Workspace already exists' });
  try {
    fs.mkdirSync(full, { recursive: true });
    const readme = ['# ' + name, '', 'Created: ' + new Date().toISOString(), '', 'Write code here. Files inside this workspace are isolated from other workspaces.', 'All files persist on the /data volume.', ''].join('\n');
    fs.writeFileSync(path.join(full, 'README.md'), readme, 'utf8');
    audit('workspace.create', req, { name });
    res.json({ ok: true, workspace: { id: name, name, path: full } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/workspaces/:name', requireAuthApi, (req, res) => {
  const name = safeWorkspaceName(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid workspace name' });
  if (name === 'default') return res.status(400).json({ error: 'Cannot delete default workspace' });
  const full = path.join(WORKSPACES_DIR, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  try {
    fs.rmSync(full, { recursive: true, force: true });
    audit('workspace.delete', req, { name });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/workspaces/:name/stats', requireAuthApi, (req, res) => {
  const name = safeWorkspaceName(req.params.name) || 'default';
  const full = workspaceRoot(name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  let fileCount = 0, dirCount = 0, size = 0;
  (function walk(p) {
    let entries;
    try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const fp = path.join(p, e.name);
      try {
        if (e.isDirectory()) { dirCount++; walk(fp); }
        else if (e.isFile()) { fileCount++; size += fs.statSync(fp).size; }
      } catch {}
    }
  })(full);
  res.json({ name, fileCount, dirCount, size });
});

/* FILES */
function resolveWorkspace(req) {
  const ws = req.query.ws;
  if (!ws || ws === 'default') return FILES_DIR;
  const safe = safeWorkspaceName(ws);
  if (!safe) return null;
  const full = path.join(WORKSPACES_DIR, safe);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return null;
  return full;
}

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

function fileMeta(baseDir, name) {
  const full = path.join(baseDir, name);
  const st = fs.statSync(full);
  const ext = path.extname(name).toLowerCase();
  const runner = availableRunners.get(ext);
  const entry = { name, size: st.size, mtime: st.mtime, ext, language: runner ? runner.lang : null };
  if (runner) entry.run = { lang: runner.lang, cmd: runner.cmd(full) };
  return entry;
}

app.get('/api/files', requireAuthApi, (req, res) => {
  const baseDir = resolveWorkspace(req);
  if (!baseDir) return res.status(400).json({ error: 'Invalid workspace' });
  try {
    const files = fs.readdirSync(baseDir)
      .map(name => {
        try {
          const full = path.join(baseDir, name);
          if (!fs.statSync(full).isFile()) return null;
          return fileMeta(baseDir, name);
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
  const baseDir = resolveWorkspace(req);
  if (!baseDir) return res.status(400).json({ error: 'Invalid workspace' });
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  const full = path.join(baseDir, name);
  if (!fs.existsSync(full)) return res.status(404).json({ error: 'Not found' });
  try {
    const content = fs.readFileSync(full, 'utf8');
    res.json({ ...fileMeta(baseDir, name), content });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/files', requireAuthApi, (req, res) => {
  const baseDir = resolveWorkspace(req);
  if (!baseDir) return res.status(400).json({ error: 'Invalid workspace' });
  const body = req.body || {};
  const safe = safeFilename(body.name);
  if (!safe) return res.status(400).json({ error: 'Invalid filename' });
  try {
    const content = typeof body.content === 'string' ? body.content : '';
    fs.writeFileSync(path.join(baseDir, safe), content, 'utf8');
    audit('file.write', req, { name: safe, bytes: content.length, ws: req.query.ws || 'default' });
    res.json({ ok: true, name: safe, meta: fileMeta(baseDir, safe) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/files/:name', requireAuthApi, (req, res) => {
  const baseDir = resolveWorkspace(req);
  if (!baseDir) return res.status(400).json({ error: 'Invalid workspace' });
  const name = safeFilename(req.params.name);
  if (!name) return res.status(400).json({ error: 'Invalid filename' });
  const full = path.join(baseDir, name);
  try {
    if (fs.existsSync(full)) fs.unlinkSync(full);
    audit('file.delete', req, { name, ws: req.query.ws || 'default' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* TERMINAL */
function safeSid(raw) {
  if (typeof raw !== 'string') return null;
  if (!/^[a-zA-Z0-9_-]{6,64}$/.test(raw)) return null;
  return raw;
}

function tmuxName(sid) { return 'vps-' + sid; }

function listTmuxSessions() {
  if (!hasTmux()) return [];
  const r = spawnSync('tmux', ['list-sessions', '-F', '#{session_name}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  if (r.status !== 0) return [];
  return String(r.stdout || '').split('\n').map(s => s.trim()).filter(s => s.startsWith('vps-')).map(s => s.slice(4));
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
  env.LANG = 'C.UTF-8';
  env.LC_ALL = 'C.UTF-8';
  env.PYTHONPATH = PYLIB_DIR + (env.PYTHONPATH ? ':' + env.PYTHONPATH : '');
  env.PATH = BIN_DIR + ':' + NPM_DIR + '/bin:' + (env.PATH || '');
  env.NPM_CONFIG_PREFIX = NPM_DIR;
  return env;
}

function spawnShell(sid, cols, rows, cwd) {
  const env = buildChildEnv();
  const workDir = cwd || FILES_DIR;
  if (sid && hasTmux()) {
    return pty.spawn('tmux', ['new-session', '-A', '-s', tmuxName(sid), '-c', workDir], {
      name: 'xterm-256color', cols, rows, cwd: workDir, env,
    });
  }
  const shell = process.env.SHELL || '/bin/bash';
  return pty.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: workDir, env });
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return socket.destroy(); }
  if (pathname !== '/ws/terminal') {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n'); return socket.destroy();
  }
  if (!getSession(req)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy();
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const sid = safeSid(url.searchParams.get('sid'));
  const cols = clampInt(url.searchParams.get('cols'), 20, 500, 80);
  const rows = clampInt(url.searchParams.get('rows'), 5, 200, 24);
  const wsName = url.searchParams.get('ws');
  let cwd = FILES_DIR;
  if (wsName && wsName !== 'default') {
    const safe = safeWorkspaceName(wsName);
    if (safe) {
      const full = path.join(WORKSPACES_DIR, safe);
      if (fs.existsSync(full)) cwd = full;
    }
  }

  let ptyProcess;
  try { ptyProcess = spawnShell(sid, cols, rows, cwd); }
  catch (err) {
    try { ws.send(JSON.stringify({ type: 'control', event: 'error', message: String(err.message) })); } catch {}
    return ws.close();
  }

  audit('terminal.open', req, { sid, tmux: hasTmux(), cwd });
  try { ws.send(JSON.stringify({ type: 'control', event: 'ready', sid, tmux: hasTmux(), cwd })); } catch {}

  ptyProcess.onData(data => { if (ws.readyState === ws.OPEN) { try { ws.send(data); } catch {} } });
  ptyProcess.onExit(({ exitCode, signal }) => {
    try { ws.send(JSON.stringify({ type: 'control', event: 'exit', code: exitCode, signal })); } catch {}
    try { ws.close(); } catch {}
  });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { try { ptyProcess.write(raw.toString()); } catch {} return; }
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
      const full = path.join(cwd, name);
      if (!fs.existsSync(full)) return;
      const cmd = runner.cmd(full);
      try { ptyProcess.write(cmd + '\n'); } catch {}
      audit('terminal.run', req, { sid, file: name, lang: runner.lang });
    }
  });

  const cleanup = () => { try { ptyProcess.kill(); } catch {} };
  ws.on('close', cleanup);
  ws.on('error', cleanup);

  const ping = setInterval(() => {
    if (ws.readyState === ws.OPEN) { try { ws.ping(); } catch { clearInterval(ping); } }
    else clearInterval(ping);
  }, 30000);
  ws.on('close', () => clearInterval(ping));
});

/* SHOP */
function publicPkg(pkg, status) {
  return {
    id: pkg.id, name: pkg.name, category: pkg.category, color: pkg.color,
    description: pkg.description, size: pkg.size, sizeBytes: pkg.sizeBytes || 0,
    license: pkg.license || '—', homepage: pkg.homepage || '', tags: pkg.tags || [],
    priority: pkg.priority || 'optional', persistent: pkg.persistent !== false,
    status: status || null,
  };
}

function categoryLabel(id) {
  const labels = {
    all: 'All', essential: 'Essentials',
    'python-data': 'Python · Data', 'python-web': 'Python · Web', 'python-auto': 'Python · Automation',
    'python-media': 'Python · Media', 'python-ai': 'Python · AI',
    node: 'Node.js', runtime: 'Runtimes', cli: 'CLI Tools', system: 'System',
    network: 'Network', security: 'Security', db: 'Databases', media: 'Media',
    text: 'Text & Documents', archive: 'Archive', build: 'Build Tools',
    cloud: 'Cloud CLIs', editor: 'Editors', terminal: 'Terminal', testing: 'Testing', misc: 'Misc'
  };
  return labels[id] || id;
}

app.get('/api/shop/catalog', requireAuthApi, (req, res) => {
  const filterCategory = req.query.category;
  const filterSearch = (req.query.search || '').toLowerCase().trim();
  const filterPriority = req.query.priority;
  const filterTags = (req.query.tags || '').split(',').map(s => s.trim()).filter(Boolean);
  const sort = req.query.sort || 'priority';

  let items = SHOP_CATALOG.slice();

  if (filterCategory && filterCategory !== 'all') {
    if (filterCategory === 'essential') items = items.filter(p => p.priority === 'essential');
    else items = items.filter(p => p.category === filterCategory);
  }
  if (filterPriority && filterPriority !== 'all') items = items.filter(p => p.priority === filterPriority);
  if (filterTags.length > 0) items = items.filter(p => filterTags.every(t => (p.tags || []).includes(t)));
  if (filterSearch) {
    items = items.filter(p => {
      const hay = (p.name + ' ' + p.description + ' ' + (p.tags || []).join(' ')).toLowerCase();
      return hay.includes(filterSearch);
    });
  }
  if (sort === 'name') items.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === 'size') items.sort((a, b) => (a.sizeBytes || 0) - (b.sizeBytes || 0));
  else if (sort === 'size-desc') items.sort((a, b) => (b.sizeBytes || 0) - (a.sizeBytes || 0));
  else {
    const order = { essential: 0, recommended: 1, optional: 2 };
    items.sort((a, b) => {
      const oa = order[a.priority] ?? 3, ob = order[b.priority] ?? 3;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }

  const allCategories = Array.from(new Set(SHOP_CATALOG.map(p => p.category))).sort();
  const categories = [
    { id: 'all', label: 'All', count: SHOP_CATALOG.length },
    { id: 'essential', label: 'Essentials', count: SHOP_CATALOG.filter(p => p.priority === 'essential').length },
  ];
  allCategories.forEach(c => categories.push({ id: c, label: categoryLabel(c), count: SHOP_CATALOG.filter(p => p.category === c).length }));

  res.json({ items: items.map(p => publicPkg(p)), categories, total: SHOP_CATALOG.length, matched: items.length });
});

app.get('/api/shop/essentials', requireAuthApi, (req, res) => {
  const essentials = SHOP_CATALOG.filter(p => p.priority === 'essential');
  res.json({ items: essentials.map(p => publicPkg(p)), total: essentials.length });
});

app.get('/api/shop/status', requireAuthApi, async (req, res) => {
  const results = {};
  await Promise.all(SHOP_CATALOG.map(async p => { results[p.id] = await isInstalled(p); }));
  res.json(results);
});

app.get('/api/shop/status/:id', requireAuthApi, async (req, res) => {
  const pkg = CATALOG_INDEX.get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  res.json(await isInstalled(pkg));
});

app.get('/api/shop/paths', requireAuthApi, (req, res) => {
  res.json({ pylib: PYLIB_DIR, npm: NPM_DIR, bin: BIN_DIR, pythonpath: shopEnv().PYTHONPATH, path: shopEnv().PATH });
});

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sseSend(res, obj) { try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch {} }

function sseKeepAlive(res) {
  const t = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { clearInterval(t); } }, 15000);
  return t;
}

function runStreamingCommand(cmd, res, req, envOverride) {
  return new Promise((resolve, reject) => {
    const env = envOverride || shopEnv();
    const child = spawn('bash', ['-lc', cmd], { env });
    let aborted = false;
    child.stdout.on('data', d => { sseSend(res, { type: 'log', line: d.toString(), err: false }); });
    child.stderr.on('data', d => { sseSend(res, { type: 'log', line: d.toString(), err: true }); });
    child.on('error', e => { if (aborted) return; reject(e); });
    child.on('close', code => {
      if (aborted) return;
      if (code === 0) resolve();
      else reject(new Error('Command exited with code ' + code));
    });
    const cleanup = () => {
      aborted = true;
      try { child.kill('SIGTERM'); } catch {}
      setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
    };
    req.on('close', cleanup);
  });
}

async function runJob(pkg, action, res, req) {
  const steps = action === 'install' ? (pkg.install || []) : (pkg.uninstall || []);
  const keepAlive = sseKeepAlive(res);
  try {
    sseSend(res, { type: 'start', action, id: pkg.id, name: pkg.name, total: steps.length, persistent: pkg.persistent !== false });
    for (let i = 0; i < steps.length; i++) {
      sseSend(res, { type: 'step', index: i + 1, total: steps.length, command: steps[i] });
      await runStreamingCommand(steps[i], res, req);
    }
    if (action === 'install' && pkg.verify) {
      sseSend(res, { type: 'verify', command: pkg.verify });
      const result = await isInstalled(pkg);
      if (result.installed) sseSend(res, { type: 'verified', version: result.version || 'unknown' });
      else sseSend(res, { type: 'verify_warn', message: 'Installed but verification did not return a version.' });
    }
    sseSend(res, { type: 'done', action, id: pkg.id });
  } catch (err) {
    sseSend(res, { type: 'error', message: String(err.message || err) });
  } finally {
    clearInterval(keepAlive);
    try { res.write('data: [DONE]\n\n'); } catch {}
    try { res.end(); } catch {}
  }
}

app.get('/api/shop/install/:id', requireAuthApi, (req, res) => {
  const pkg = CATALOG_INDEX.get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  sseSetup(res);
  audit('shop.install', req, { id: pkg.id });
  runJob(pkg, 'install', res, req);
});

app.get('/api/shop/uninstall/:id', requireAuthApi, (req, res) => {
  const pkg = CATALOG_INDEX.get(req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  sseSetup(res);
  audit('shop.uninstall', req, { id: pkg.id });
  runJob(pkg, 'uninstall', res, req);
});

async function runBatch(pkgs, action, res, req) {
  const keepAlive = sseKeepAlive(res);
  try {
    sseSend(res, { type: 'batch-start', total: pkgs.length, ids: pkgs.map(p => p.id) });
    let success = 0, fail = 0;
    for (let i = 0; i < pkgs.length; i++) {
      const pkg = pkgs[i];
      sseSend(res, { type: 'batch-package-start', index: i + 1, total: pkgs.length, id: pkg.id, name: pkg.name });
      try {
        const steps = action === 'install' ? (pkg.install || []) : (pkg.uninstall || []);
        for (let j = 0; j < steps.length; j++) {
          sseSend(res, { type: 'batch-step', id: pkg.id, index: j + 1, total: steps.length, command: steps[j] });
          await runStreamingCommand(steps[j], res, req);
        }
        let verified = false, version = null;
        if (action === 'install' && pkg.verify) {
          sseSend(res, { type: 'batch-verify', id: pkg.id });
          const result = await isInstalled(pkg);
          verified = result.installed;
          version = result.version || null;
        }
        sseSend(res, { type: 'batch-package-done', id: pkg.id, success: true, verified, version });
        success++;
      } catch (err) {
        sseSend(res, { type: 'batch-package-error', id: pkg.id, message: String(err.message || err) });
        fail++;
      }
    }
    sseSend(res, { type: 'batch-done', success, fail, total: pkgs.length });
  } catch (err) {
    sseSend(res, { type: 'batch-error', message: String(err.message || err) });
  } finally {
    clearInterval(keepAlive);
    try { res.write('data: [DONE]\n\n'); } catch {}
    try { res.end(); } catch {}
  }
}

app.post('/api/shop/install-batch', requireAuthApi, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No package ids provided' });
  if (ids.length > 20) return res.status(400).json({ error: 'Batch limited to 20 packages' });
  const pkgs = ids.map(id => CATALOG_INDEX.get(id)).filter(Boolean);
  if (pkgs.length === 0) return res.status(404).json({ error: 'No matching packages' });
  sseSetup(res);
  audit('shop.install-batch', req, { ids: pkgs.map(p => p.id) });
  runBatch(pkgs, 'install', res, req);
});

app.post('/api/shop/uninstall-batch', requireAuthApi, (req, res) => {
  const ids = Array.isArray((req.body || {}).ids) ? req.body.ids.filter(x => typeof x === 'string') : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No package ids provided' });
  if (ids.length > 20) return res.status(400).json({ error: 'Batch limited to 20 packages' });
  const pkgs = ids.map(id => CATALOG_INDEX.get(id)).filter(Boolean);
  if (pkgs.length === 0) return res.status(404).json({ error: 'No matching packages' });
  sseSetup(res);
  audit('shop.uninstall-batch', req, { ids: pkgs.map(p => p.id) });
  runBatch(pkgs, 'uninstall', res, req);
});

/* SSHX */
const SSHX_BIN = path.join(BIN_DIR, 'sshx');
const SSHX_STATE_FILE = path.join(SSHX_DIR, 'sessions.json');
const sshxProcesses = new Map();

function loadSshxState() {
  try {
    if (!fs.existsSync(SSHX_STATE_FILE)) return { sessions: [] };
    return JSON.parse(fs.readFileSync(SSHX_STATE_FILE, 'utf8'));
  } catch { return { sessions: [] }; }
}

function saveSshxState(state) {
  try { fs.writeFileSync(SSHX_STATE_FILE, JSON.stringify(state, null, 2), 'utf8'); } catch {}
}

function sshxInstalled() {
  try {
    return fs.existsSync(SSHX_BIN) && !!(fs.statSync(SSHX_BIN).mode & 0o111);
  } catch { return false; }
}

function checkPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function reapSshxSessions() {
  const state = loadSshxState();
  const alive = state.sessions.filter(s => s.pid && checkPidAlive(s.pid));
  if (alive.length !== state.sessions.length) {
    state.sessions = alive;
    saveSshxState(state);
  }
  return state.sessions;
}

app.get('/api/sshx/status', requireAuthApi, (req, res) => {
  res.json({
    installed: sshxInstalled(),
    sessions: reapSshxSessions(),
    version: (() => {
      try {
        if (!sshxInstalled()) return null;
        const r = spawnSync(SSHX_BIN, ['--version'], { encoding: 'utf8', timeout: 3000 });
        return r.status === 0 ? String(r.stdout || '').trim() : null;
      } catch { return null; }
    })(),
  });
});

app.get('/api/sshx/install', requireAuthApi, (req, res) => {
  sseSetup(res);
  audit('sshx.install', req);
  const keepAlive = sseKeepAlive(res);
  (async () => {
    try {
      sseSend(res, { type: 'start', action: 'install', name: 'sshx' });

      sseSend(res, { type: 'step', index: 1, total: 3, command: 'Run official installer' });
      await runStreamingCommand('curl -sSf https://sshx.io/get | sh', res, req);

      sseSend(res, { type: 'step', index: 2, total: 3, command: 'Persist binary to ' + BIN_DIR });
      await runStreamingCommand(
        `if [ -x /usr/local/bin/sshx ]; then ` +
        `mkdir -p ${q(BIN_DIR)} && cp -f /usr/local/bin/sshx ${q(SSHX_BIN)} && chmod +x ${q(SSHX_BIN)}; ` +
        `elif [ -x ${q(SSHX_BIN)} ]; then chmod +x ${q(SSHX_BIN)}; ` +
        `else echo "sshx binary not found after install" >&2; exit 1; fi`,
        res, req
      );

      sseSend(res, { type: 'step', index: 3, total: 3, command: 'Verify installation' });
      await runStreamingCommand(`${q(SSHX_BIN)} --version`, res, req);

      sseSend(res, { type: 'done', action: 'install', id: 'sshx' });
    } catch (err) {
      sseSend(res, { type: 'error', message: String(err.message || err) });
    } finally {
      clearInterval(keepAlive);
      try { res.write('data: [DONE]\n\n'); } catch {}
      try { res.end(); } catch {}
    }
  })();
});

app.post('/api/sshx/start', requireAuthApi, (req, res) => {
  if (!sshxInstalled()) return res.status(400).json({ error: 'sshx not installed' });
  const body = req.body || {};
  const name = typeof body.name === 'string' && body.name.trim()
    ? body.name.trim().slice(0, 40).replace(/[^\w\s.\-]/g, '')
    : null;
  const wsName = body.ws && body.ws !== 'default' ? safeWorkspaceName(body.ws) : null;

  const id = crypto.randomBytes(6).toString('hex');

  const args = [];
  if (name) args.push('--name', name);

  const cwd = wsName ? path.join(WORKSPACES_DIR, wsName) : FILES_DIR;
  const env = buildChildEnv();

  let child;
  try {
    child = spawn(SSHX_BIN, args, { cwd, env, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const session = {
    id, name: name || 'session-' + id.slice(0, 4),
    pid: child.pid, url: null, startedAt: new Date().toISOString(),
    workspace: wsName || 'default', status: 'starting'
  };

  let buffer = '';
  let resolved = false;
  const urlRegex = /(https:\/\/sshx\.io\/s\/[a-zA-Z0-9]+)/;

  const handleData = (chunk) => {
    buffer += chunk.toString();
    if (!resolved) {
      const m = buffer.match(urlRegex);
      if (m) {
        session.url = m[1];
        session.status = 'running';
        resolved = true;
        sshxProcesses.set(child.pid, { session, child });
        const st = loadSshxState();
        st.sessions.push(session);
        saveSshxState(st);
        audit('sshx.start', req, { id, url: session.url });
        if (!res.headersSent) res.json({ ok: true, session });
      }
    }
    if (buffer.length > 20000) buffer = buffer.slice(-10000);
  };

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  child.on('exit', code => {
    const st = loadSshxState();
    st.sessions = st.sessions.filter(s => s.id !== id);
    saveSshxState(st);
    sshxProcesses.delete(child.pid);
    if (!resolved && !res.headersSent) {
      res.status(500).json({ error: 'sshx exited with code ' + code + '\nOutput: ' + buffer.slice(0, 500) });
    }
  });

  setTimeout(() => {
    if (!resolved && !res.headersSent) {
      try { child.kill('SIGTERM'); } catch {}
      res.status(504).json({ error: 'Timeout waiting for sshx URL. Output: ' + buffer.slice(0, 500) });
    }
  }, 20000);
});

app.post('/api/sshx/stop/:id', requireAuthApi, (req, res) => {
  const id = String(req.params.id || '');
  const state = loadSshxState();
  const session = state.sessions.find(s => s.id === id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  try { process.kill(session.pid, 'SIGTERM'); } catch {}
  state.sessions = state.sessions.filter(s => s.id !== id);
  saveSshxState(state);
  sshxProcesses.delete(session.pid);
  audit('sshx.stop', req, { id });
  res.json({ ok: true });
});

app.post('/api/sshx/stop-all', requireAuthApi, (req, res) => {
  const state = loadSshxState();
  for (const s of state.sessions) {
    try { process.kill(s.pid, 'SIGTERM'); } catch {}
    sshxProcesses.delete(s.pid);
  }
  state.sessions = [];
  saveSshxState(state);
  audit('sshx.stopAll', req);
  res.json({ ok: true, killed: true });
});

/* TAILSCALE */
const TAILSCALE_SOCKET = path.join(TAILSCALE_DIR, 'tailscaled.sock');
const TAILSCALE_STATE = path.join(TAILSCALE_DIR, 'tailscaled.state');
const TAILSCALED_PID_FILE = path.join(TAILSCALE_DIR, 'tailscaled.pid');

function whichTailscale() {
  const r = spawnSync('command', ['-v', 'tailscale'], { shell: true, encoding: 'utf8' });
  if (r.status !== 0) return null;
  return String(r.stdout || '').trim() || '/usr/bin/tailscale';
}

function tailscaleInstalled() { return !!whichTailscale(); }

function tailscaledRunning() {
  if (!fs.existsSync(TAILSCALED_PID_FILE)) return false;
  try {
    const pid = parseInt(fs.readFileSync(TAILSCALED_PID_FILE, 'utf8').trim(), 10);
    if (!Number.isFinite(pid)) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function tsCmd(args, timeout) {
  const bin = whichTailscale() || 'tailscale';
  const r = spawnSync(bin, ['--socket=' + TAILSCALE_SOCKET, ...args], {
    encoding: 'utf8', timeout: timeout || 8000, env: shopEnv()
  });
  return { status: r.status, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

async function startTailscaled() {
  if (tailscaledRunning()) return true;
  const bin = spawnSync('command', ['-v', 'tailscaled'], { shell: true, encoding: 'utf8' });
  const daemonBin = String(bin.stdout || '').trim() || '/usr/sbin/tailscaled';
  const child = spawn(daemonBin, [
    '--state=' + TAILSCALE_STATE,
    '--socket=' + TAILSCALE_SOCKET,
    '--tun=userspace-networking',
    '--socks5-server=localhost:1055',
    '--outbound-http-proxy-listen=localhost:1055'
  ], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: shopEnv()
  });
  child.unref();
  fs.writeFileSync(TAILSCALED_PID_FILE, String(child.pid), 'utf8');
  await new Promise(r => setTimeout(r, 2500));
  return tailscaledRunning();
}

app.get('/api/tailscale/status', requireAuthApi, (req, res) => {
  const installed = tailscaleInstalled();
  const running = tailscaledRunning();
  let ip = null, backend = 'unknown', hostname = null;
  if (installed && running) {
    try {
      const r = tsCmd(['status', '--json'], 5000);
      if (r.status === 0 && r.stdout) {
        try {
          const j = JSON.parse(r.stdout);
          backend = j.BackendState || 'unknown';
          if (j.Self) {
            hostname = j.Self.HostName || null;
            const ips = j.Self.TailscaleIPs || [];
            ip = ips[0] || null;
          }
        } catch {}
      }
    } catch {}
  }
  res.json({
    installed, running, ip, hostname, backend,
    loginRequired: installed && running && backend !== 'Running',
    socketPath: TAILSCALE_SOCKET,
  });
});

app.get('/api/tailscale/install', requireAuthApi, (req, res) => {
  sseSetup(res);
  audit('tailscale.install', req);
  const keepAlive = sseKeepAlive(res);
  (async () => {
    try {
      sseSend(res, { type: 'start', action: 'install', name: 'tailscale' });
      sseSend(res, { type: 'step', index: 1, total: 2, command: 'Add Tailscale apt repository and install' });
      await runStreamingCommand(
        `curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.noarmor.gpg | tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null && ` +
        `curl -fsSL https://pkgs.tailscale.com/stable/debian/bookworm.tailscale-keyring.list | tee /etc/apt/sources.list.d/tailscale.list && ` +
        `apt-get update -qq && apt-get install -y --no-install-recommends tailscale`,
        res, req
      );
      sseSend(res, { type: 'step', index: 2, total: 2, command: 'Verify installation' });
      await runStreamingCommand('tailscale --version | head -n1', res, req);
      sseSend(res, { type: 'done', action: 'install', id: 'tailscale' });
    } catch (err) {
      sseSend(res, { type: 'error', message: String(err.message || err) });
    } finally {
      clearInterval(keepAlive);
      try { res.write('data: [DONE]\n\n'); } catch {}
      try { res.end(); } catch {}
    }
  })();
});

app.post('/api/tailscale/start-daemon', requireAuthApi, async (req, res) => {
  if (!tailscaleInstalled()) return res.status(400).json({ error: 'tailscale not installed' });
  try {
    const ok = await startTailscaled();
    audit('tailscale.startDaemon', req, { ok });
    if (!ok) return res.status(500).json({ error: 'Failed to start tailscaled' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tailscale/stop-daemon', requireAuthApi, (req, res) => {
  if (fs.existsSync(TAILSCALED_PID_FILE)) {
    try {
      const pid = parseInt(fs.readFileSync(TAILSCALED_PID_FILE, 'utf8').trim(), 10);
      process.kill(pid, 'SIGTERM');
    } catch {}
    try { fs.unlinkSync(TAILSCALED_PID_FILE); } catch {}
  }
  audit('tailscale.stopDaemon', req);
  res.json({ ok: true });
});

app.post('/api/tailscale/login-interactive', requireAuthApi, async (req, res) => {
  if (!tailscaleInstalled()) return res.status(400).json({ error: 'tailscale not installed' });
  if (!tailscaledRunning()) await startTailscaled();
  if (!tailscaledRunning()) return res.status(500).json({ error: 'tailscaled not running' });

  const args = ['--socket=' + TAILSCALE_SOCKET, 'up', '--accept-routes', '--accept-dns=false'];
  const body = req.body || {};
  if (typeof body.hostname === 'string' && body.hostname.trim()) {
    args.push('--hostname=' + body.hostname.trim().slice(0, 40).replace(/[^a-zA-Z0-9-]/g, ''));
  }
  if (body.advertiseExitNode) args.push('--advertise-exit-node');

  const bin = whichTailscale();
  const child = spawn(bin, args, { env: shopEnv() });

  let buffer = '';
  let resolved = false;
  const urlRegex = /(https:\/\/login\.tailscale\.com\/[a-z]\/[a-f0-9]+)/i;

  const handle = (chunk) => {
    buffer += chunk.toString();
    if (!resolved) {
      const m = buffer.match(urlRegex);
      if (m) {
        resolved = true;
        audit('tailscale.login.url', req, { url: m[1] });
        if (!res.headersSent) res.json({ ok: true, url: m[1] });
      }
    }
  };

  child.stdout.on('data', handle);
  child.stderr.on('data', handle);

  child.on('exit', code => {
    if (!resolved && !res.headersSent) {
      res.status(500).json({ error: 'tailscale up exited with code ' + code + '\n' + buffer.slice(0, 500) });
    }
  });

  setTimeout(() => {
    if (!resolved && !res.headersSent) {
      try { child.kill('SIGTERM'); } catch {}
      res.status(504).json({ error: 'Timeout waiting for login URL. Output: ' + buffer.slice(0, 500) });
    }
  }, 20000);
});

app.post('/api/tailscale/login-authkey', requireAuthApi, async (req, res) => {
  if (!tailscaleInstalled()) return res.status(400).json({ error: 'tailscale not installed' });
  if (!tailscaledRunning()) await startTailscaled();
  if (!tailscaledRunning()) return res.status(500).json({ error: 'tailscaled not running' });

  const body = req.body || {};
  const authkey = typeof body.authkey === 'string' ? body.authkey.trim() : '';
  if (!authkey) return res.status(400).json({ error: 'Auth key required' });
  if (!/^tskey-[a-zA-Z0-9-]+$/.test(authkey)) return res.status(400).json({ error: 'Invalid auth key format' });

  const args = ['up', '--authkey=' + authkey, '--accept-routes', '--accept-dns=false'];
  if (typeof body.hostname === 'string' && body.hostname.trim()) {
    args.push('--hostname=' + body.hostname.trim().slice(0, 40).replace(/[^a-zA-Z0-9-]/g, ''));
  }
  if (body.advertiseExitNode) args.push('--advertise-exit-node');

  const r = tsCmd(args, 30000);
  audit('tailscale.login.authkey', req, { status: r.status });
  if (r.status === 0) return res.json({ ok: true, output: r.stdout || 'Connected' });
  return res.status(500).json({ error: (r.stderr || r.stdout || 'Failed').slice(0, 600) });
});

app.post('/api/tailscale/logout', requireAuthApi, (req, res) => {
  if (!tailscaleInstalled()) return res.status(400).json({ error: 'not installed' });
  const r = tsCmd(['logout'], 15000);
  audit('tailscale.logout', req, { status: r.status });
  res.json({ ok: r.status === 0, output: (r.stdout + r.stderr).trim().slice(0, 500) });
});

app.post('/api/tailscale/down', requireAuthApi, (req, res) => {
  if (!tailscaleInstalled()) return res.status(400).json({ error: 'not installed' });
  const r = tsCmd(['down'], 15000);
  audit('tailscale.down', req, { status: r.status });
  res.json({ ok: r.status === 0, output: (r.stdout + r.stderr).trim().slice(0, 500) });
});

/* SYSTEM */
function readPasswdFile() {
  try {
    const content = fs.readFileSync('/etc/passwd', 'utf8');
    return content.split('\n').filter(Boolean).map(line => {
      const [name, , uid, gid, gecos, home, shell] = line.split(':');
      return { name, uid: parseInt(uid, 10), gid: parseInt(gid, 10), home, shell, gecos };
    }).filter(u => u.name && u.uid >= 0);
  } catch { return []; }
}

app.get('/api/system/users', requireAuthApi, (req, res) => {
  const users = readPasswdFile();
  const currentUid = process.getuid ? process.getuid() : 0;
  const list = users.map(u => ({
    name: u.name,
    uid: u.uid,
    gid: u.gid,
    home: u.home,
    shell: u.shell,
    isSystem: u.uid < 1000 && u.uid !== 0,
    isRoot: u.uid === 0,
    isCurrent: u.uid === currentUid,
    canChangePassword: u.uid === 0 || u.uid >= 1000,
  }));
  res.json({
    users: list,
    currentUser: process.env.USER || (currentUid === 0 ? 'root' : 'unknown'),
    isRoot: currentUid === 0,
    whoami: (() => {
      try { return String(spawnSync('whoami', { encoding: 'utf8' }).stdout || '').trim(); } catch { return 'unknown'; }
    })(),
  });
});

function validatePassword(pw) {
  if (typeof pw !== 'string') return { ok: false, error: 'Password must be a string' };
  if (pw.length < 6) return { ok: false, error: 'Password must be at least 6 characters' };
  if (pw.length > 128) return { ok: false, error: 'Password too long (max 128)' };
  if (pw.includes('\n') || pw.includes('\r')) return { ok: false, error: 'Password cannot contain newlines' };
  if (pw.includes(':')) return { ok: false, error: 'Password cannot contain colon' };
  return { ok: true };
}

app.post('/api/system/password', requireAuthApi, (req, res) => {
  const body = req.body || {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const confirm = typeof body.confirm === 'string' ? body.confirm : '';

  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username)) return res.status(400).json({ error: 'Invalid username' });
  if (password !== confirm) return res.status(400).json({ error: 'Passwords do not match' });

  const v = validatePassword(password);
  if (!v.ok) return res.status(400).json({ error: v.error });

  const users = readPasswdFile();
  const user = users.find(u => u.name === username);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const currentUid = process.getuid ? process.getuid() : 0;
  if (currentUid !== 0 && user.uid !== currentUid) {
    return res.status(403).json({ error: 'Not authorized to change this user\'s password' });
  }

  try {
    const result = spawnSync('chpasswd', [], {
      input: username + ':' + password + '\n',
      encoding: 'utf8',
      env: shopEnv()
    });
    if (result.status !== 0) {
      return res.status(500).json({ error: 'chpasswd failed: ' + (result.stderr || result.stdout || 'unknown') });
    }
    audit('system.password.change', req, { username, method: 'chpasswd' });

    const persistFile = path.join(SYSTEM_DIR, 'passwords.json');
    let stored = {};
    try { stored = JSON.parse(fs.readFileSync(persistFile, 'utf8')); } catch {}
    stored[username] = {
      changedAt: new Date().toISOString(),
      ephemeral: true,
      note: 'Container redeploy will reset this. Re-apply from Settings after redeploy.'
    };
    try { fs.writeFileSync(persistFile, JSON.stringify(stored, null, 2), 'utf8'); } catch {}

    res.json({ ok: true, username, note: 'Password changed. Persists until container redeploy.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/system/info', requireAuthApi, (req, res) => {
  const currentUid = process.getuid ? process.getuid() : 0;
  let sshdRunning = false;
  try {
    const r = spawnSync('pgrep', ['-x', 'sshd'], { encoding: 'utf8' });
    sshdRunning = r.status === 0;
  } catch {}
  res.json({
    uid: currentUid,
    isRoot: currentUid === 0,
    user: (() => {
      try { return String(spawnSync('whoami', { encoding: 'utf8' }).stdout || '').trim(); } catch { return 'unknown'; }
    })(),
    hostname: os.hostname(),
    sshd: {
      running: sshdRunning,
      port22Open: sshdRunning,
      note: 'Railway containers typically do not expose port 22 publicly. Use SSHX or Tailscale for remote access.'
    },
    paths: {
      data: DATA_DIR,
      workspaces: WORKSPACES_DIR,
      files: FILES_DIR,
      pylib: PYLIB_DIR,
      bin: BIN_DIR,
    },
    version: {
      node: process.version,
      platform: os.platform(),
      arch: os.arch(),
      release: os.release(),
    }
  });
});

/* FALLBACK + ERROR */
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
  console.log('[ready] shop=' + SHOP_CATALOG.length + ' packages');
  console.log('[ready] workspaces=' + listWorkspaces().length);
  console.log('[ready] data=' + DATA_DIR);
  console.log('[ready] sshx=' + (sshxInstalled() ? 'installed' : 'not installed'));
  console.log('[ready] tailscale=' + (tailscaleInstalled() ? 'installed' : 'not installed'));
});
