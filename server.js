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

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const PYLIB_DIR = path.join(DATA_DIR, 'pylib');
const NPM_DIR = path.join(DATA_DIR, 'npm-global');
const BIN_DIR = path.join(DATA_DIR, 'bin');
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
const PROTECTED_PAGES = ['/dashboard', '/terminal', '/code', '/metrics', '/shop'];

if (!PASSWORD) {
  console.error('[fatal] DASHBOARD_PASSWORD is required');
  process.exit(1);
}
if (PASSWORD.length < 12) {
  console.error('[warn] DASHBOARD_PASSWORD should be at least 12 characters');
}

const SECRET = crypto.createHash('sha256').update('vps-control:' + PASSWORD).digest();

fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(PYLIB_DIR, { recursive: true });
fs.mkdirSync(NPM_DIR, { recursive: true });
fs.mkdirSync(BIN_DIR, { recursive: true });
if (!fs.existsSync(VIEWS_DIR)) fs.mkdirSync(VIEWS_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });

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

/* ══════════════════════════════════════════════════════════════════════════
   SHOP CATALOG
   ══════════════════════════════════════════════════════════════════════════ */

const SHOP_CATALOG = [
  {
    id: 'numpy', name: 'NumPy', category: 'python', color: '#013243',
    description: 'Fundamental package for scientific computing with arrays and matrices.',
    size: '~20 MB', license: 'BSD',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade numpy'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import numpy; print(numpy.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/numpy ' + PYLIB_DIR + '/numpy-* ' + PYLIB_DIR + '/numpy.libs'],
    persistent: true,
  },
  {
    id: 'pandas', name: 'Pandas', category: 'python', color: '#150458',
    description: 'Data analysis and manipulation library with DataFrames.',
    size: '~50 MB', license: 'BSD',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade pandas'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import pandas; print(pandas.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/pandas ' + PYLIB_DIR + '/pandas-* ' + PYLIB_DIR + '/pandas.libs'],
    persistent: true,
  },
  {
    id: 'requests', name: 'Requests', category: 'python', color: '#2C3E50',
    description: 'Elegant HTTP library for Python.',
    size: '~500 KB', license: 'Apache-2.0',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade requests'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import requests; print(requests.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/requests ' + PYLIB_DIR + '/requests-*'],
    persistent: true,
  },
  {
    id: 'flask', name: 'Flask', category: 'python', color: '#000000',
    description: 'Lightweight WSGI web application framework.',
    size: '~1 MB', license: 'BSD',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade flask'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import flask; print(flask.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/flask ' + PYLIB_DIR + '/Flask-*'],
    persistent: true,
  },
  {
    id: 'fastapi', name: 'FastAPI', category: 'python', color: '#009688',
    description: 'Modern, fast web framework for building APIs with Python.',
    size: '~2 MB', license: 'MIT',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade fastapi uvicorn'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import fastapi; print(fastapi.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/fastapi ' + PYLIB_DIR + '/uvicorn ' + PYLIB_DIR + '/fastapi-* ' + PYLIB_DIR + '/uvicorn-*'],
    persistent: true,
  },
  {
    id: 'django', name: 'Django', category: 'python', color: '#092E20',
    description: 'High-level Python web framework with batteries included.',
    size: '~10 MB', license: 'BSD',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade django'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import django; print(django.get_version())"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/django ' + PYLIB_DIR + '/Django-*'],
    persistent: true,
  },
  {
    id: 'pillow', name: 'Pillow', category: 'python', color: '#3B3B3B',
    description: 'Python Imaging Library — image processing.',
    size: '~5 MB', license: 'HPND',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade pillow'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "from PIL import Image; print(Image.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/PIL ' + PYLIB_DIR + '/pillow* ' + PYLIB_DIR + '/Pillow-*'],
    persistent: true,
  },
  {
    id: 'jupyter', name: 'JupyterLab', category: 'python', color: '#F37626',
    description: 'Interactive computing environment for notebooks.',
    size: '~80 MB', license: 'BSD',
    install: ['pip3 install --target=' + PYLIB_DIR + ' --upgrade jupyterlab'],
    verify: 'PYTHONPATH=' + PYLIB_DIR + ' python3 -c "import jupyterlab; print(jupyterlab.__version__)"',
    uninstall: ['rm -rf ' + PYLIB_DIR + '/jupyterlab* ' + PYLIB_DIR + '/jupyter_* ' + PYLIB_DIR + '/jupyterlab-*'],
    persistent: true,
  },
  {
    id: 'python3-pip', name: 'pip (standalone)', category: 'python', color: '#3776AB',
    description: 'Bootstrap pip if missing (ensurepip).',
    size: '~2 MB', license: 'MIT',
    install: ['python3 -m ensurepip --upgrade || true', 'curl -fsSL https://bootstrap.pypa.io/get-pip.py | python3 - --user || true'],
    verify: 'python3 -m pip --version || pip3 --version',
    uninstall: ['python3 -m pip uninstall -y pip || true'],
    persistent: false,
  },

  {
    id: 'typescript', name: 'TypeScript', category: 'node', color: '#3178C6',
    description: 'Typed superset of JavaScript that compiles to plain JS.',
    size: '~30 MB', license: 'Apache-2.0',
    install: ['npm install -g --prefix=' + NPM_DIR + ' typescript'],
    verify: NPM_DIR + '/bin/tsc --version',
    uninstall: ['rm -rf ' + NPM_DIR + '/lib/node_modules/typescript ' + NPM_DIR + '/bin/tsc ' + NPM_DIR + '/bin/tsserver'],
    persistent: true,
  },
  {
    id: 'pnpm', name: 'pnpm', category: 'node', color: '#F69220',
    description: 'Fast, disk space efficient package manager.',
    size: '~5 MB', license: 'MIT',
    install: ['npm install -g --prefix=' + NPM_DIR + ' pnpm'],
    verify: NPM_DIR + '/bin/pnpm --version',
    uninstall: ['rm -rf ' + NPM_DIR + '/lib/node_modules/pnpm ' + NPM_DIR + '/bin/pnpm'],
    persistent: true,
  },
  {
    id: 'pm2', name: 'PM2', category: 'node', color: '#2B037A',
    description: 'Production process manager for Node.js applications.',
    size: '~5 MB', license: 'AGPL-3.0',
    install: ['npm install -g --prefix=' + NPM_DIR + ' pm2'],
    verify: NPM_DIR + '/bin/pm2 --version',
    uninstall: ['rm -rf ' + NPM_DIR + '/lib/node_modules/pm2 ' + NPM_DIR + '/bin/pm2 ' + NPM_DIR + '/bin/pm2-*'],
    persistent: true,
  },
  {
    id: 'nodemon', name: 'Nodemon', category: 'node', color: '#76D04B',
    description: 'Auto-restart Node.js on file changes.',
    size: '~2 MB', license: 'MIT',
    install: ['npm install -g --prefix=' + NPM_DIR + ' nodemon'],
    verify: NPM_DIR + '/bin/nodemon --version',
    uninstall: ['rm -rf ' + NPM_DIR + '/lib/node_modules/nodemon ' + NPM_DIR + '/bin/nodemon'],
    persistent: true,
  },
  {
    id: 'yarn', name: 'Yarn', category: 'node', color: '#2C8EBB',
    description: 'Fast, reliable, secure dependency management.',
    size: '~5 MB', license: 'BSD-2-Clause',
    install: ['npm install -g --prefix=' + NPM_DIR + ' yarn'],
    verify: NPM_DIR + '/bin/yarn --version',
    uninstall: ['rm -rf ' + NPM_DIR + '/lib/node_modules/yarn ' + NPM_DIR + '/bin/yarn ' + NPM_DIR + '/bin/yarnpkg'],
    persistent: true,
  },

  {
    id: 'ripgrep', name: 'ripgrep', category: 'cli', color: '#D3450B',
    description: 'Blazing fast recursive search tool respecting .gitignore.',
    size: '~3 MB', license: 'MIT',
    install: [
      'cd /tmp && curl -fsSL https://github.com/BurntSushi/ripgrep/releases/download/14.1.1/ripgrep-14.1.1-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv ripgrep-14.1.1-x86_64-unknown-linux-musl/rg ' + BIN_DIR + '/rg && chmod +x ' + BIN_DIR + '/rg'
    ],
    verify: BIN_DIR + '/rg --version | head -n1',
    uninstall: ['rm -f ' + BIN_DIR + '/rg'],
    persistent: true,
  },
  {
    id: 'fd', name: 'fd', category: 'cli', color: '#D3450B',
    description: 'Simple, fast and user-friendly alternative to find.',
    size: '~3 MB', license: 'MIT',
    install: [
      'cd /tmp && curl -fsSL https://github.com/sharkdp/fd/releases/download/v10.2.0/fd-v10.2.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv fd-v10.2.0-x86_64-unknown-linux-musl/fd ' + BIN_DIR + '/fd && chmod +x ' + BIN_DIR + '/fd'
    ],
    verify: BIN_DIR + '/fd --version',
    uninstall: ['rm -f ' + BIN_DIR + '/fd'],
    persistent: true,
  },
  {
    id: 'bat', name: 'bat', category: 'cli', color: '#6B46C1',
    description: 'cat clone with syntax highlighting and Git integration.',
    size: '~5 MB', license: 'MIT/Apache-2.0',
    install: [
      'cd /tmp && curl -fsSL https://github.com/sharkdp/bat/releases/download/v0.24.0/bat-v0.24.0-x86_64-unknown-linux-musl.tar.gz | tar -xz && mv bat-v0.24.0-x86_64-unknown-linux-musl/bat ' + BIN_DIR + '/bat && chmod +x ' + BIN_DIR + '/bat'
    ],
    verify: BIN_DIR + '/bat --version',
    uninstall: ['rm -f ' + BIN_DIR + '/bat'],
    persistent: true,
  },
  {
    id: 'fzf', name: 'fzf', category: 'cli', color: '#0073B7',
    description: 'Command-line fuzzy finder.',
    size: '~2 MB', license: 'MIT',
    install: [
      'cd /tmp && curl -fsSL https://github.com/junegunn/fzf/releases/download/v0.55.0/fzf-0.55.0-linux_amd64.tar.gz | tar -xz -C ' + BIN_DIR + ' && chmod +x ' + BIN_DIR + '/fzf'
    ],
    verify: BIN_DIR + '/fzf --version',
    uninstall: ['rm -f ' + BIN_DIR + '/fzf'],
    persistent: true,
  },
  {
    id: 'tree', name: 'tree', category: 'cli', color: '#2F855A',
    description: 'Recursive directory listing in tree format.',
    size: '~100 KB', license: 'GPL-2.0',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends tree'],
    verify: 'tree --version | head -n1',
    uninstall: ['apt-get remove -y tree && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'jq', name: 'jq', category: 'cli', color: '#2F855A',
    description: 'Lightweight command-line JSON processor.',
    size: '~500 KB', license: 'MIT',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends jq'],
    verify: 'jq --version',
    uninstall: ['apt-get remove -y jq && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'htop', name: 'htop', category: 'cli', color: '#0078D4',
    description: 'Interactive process viewer.',
    size: '~200 KB', license: 'GPL-2.0',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends htop'],
    verify: 'htop --version | head -n1',
    uninstall: ['apt-get remove -y htop && apt-get autoremove -y'],
    persistent: false,
  },

  {
    id: 'rust', name: 'Rust', category: 'dev', color: '#CE422B',
    description: 'Rust toolchain with cargo, rustc, rustup.',
    size: '~400 MB', license: 'MIT/Apache-2.0',
    install: [
      'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --no-modify-path',
      'ln -sf $HOME/.cargo/bin/cargo ' + BIN_DIR + '/cargo && ln -sf $HOME/.cargo/bin/rustc ' + BIN_DIR + '/rustc && ln -sf $HOME/.cargo/bin/rustup ' + BIN_DIR + '/rustup'
    ],
    verify: BIN_DIR + '/cargo --version',
    uninstall: ['rm -rf $HOME/.cargo $HOME/.rustup', 'rm -f ' + BIN_DIR + '/cargo ' + BIN_DIR + '/rustc ' + BIN_DIR + '/rustup'],
    persistent: true,
  },

  {
    id: 'ffmpeg', name: 'FFmpeg', category: 'system', color: '#007808',
    description: 'Complete multimedia framework for audio/video processing.',
    size: '~80 MB', license: 'LGPL/GPL',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends ffmpeg'],
    verify: 'ffmpeg -version | head -n1',
    uninstall: ['apt-get remove -y ffmpeg && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'imagemagick', name: 'ImageMagick', category: 'system', color: '#4B0082',
    description: 'Image manipulation and conversion tools.',
    size: '~20 MB', license: 'ImageMagick',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends imagemagick'],
    verify: 'convert --version | head -n1',
    uninstall: ['apt-get remove -y imagemagick && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'nginx', name: 'Nginx', category: 'system', color: '#009639',
    description: 'High-performance HTTP and reverse proxy server.',
    size: '~5 MB', license: 'BSD-2-Clause',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends nginx'],
    verify: 'nginx -v 2>&1',
    uninstall: ['apt-get remove -y nginx && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'redis-tools', name: 'Redis CLI', category: 'system', color: '#DC382D',
    description: 'Command-line client for Redis.',
    size: '~2 MB', license: 'BSD-3-Clause',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends redis-tools'],
    verify: 'redis-cli --version',
    uninstall: ['apt-get remove -y redis-tools && apt-get autoremove -y'],
    persistent: false,
  },
  {
    id: 'postgresql-client', name: 'PostgreSQL Client', category: 'system', color: '#336791',
    description: 'psql command-line client for PostgreSQL.',
    size: '~10 MB', license: 'PostgreSQL',
    install: ['apt-get update -qq && apt-get install -y --no-install-recommends postgresql-client'],
    verify: 'psql --version',
    uninstall: ['apt-get remove -y postgresql-client && apt-get autoremove -y'],
    persistent: false,
  },
];

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
  env.LANG = 'en_US.UTF-8';
  env.LC_ALL = 'en_US.UTF-8';
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
    const out = await runCapture(pkg.verify, 5000);
    const versionMatch = String(out).trim().match(/(\d+\.\d+[\.\d]*)/);
    return { installed: true, version: versionMatch ? versionMatch[1] : String(out).trim().slice(0, 60) };
  } catch {
    return { installed: false };
  }
}

app.get('/api/shop/catalog', requireAuthApi, (req, res) => {
  const items = SHOP_CATALOG.map(p => ({
    id: p.id,
    name: p.name,
    category: p.category,
    color: p.color,
    description: p.description,
    size: p.size,
    license: p.license,
    persistent: p.persistent !== false,
  }));
  res.json({ items, categories: [
    { id: 'all', label: 'All' },
    { id: 'python', label: 'Python' },
    { id: 'node', label: 'Node' },
    { id: 'cli', label: 'CLI Tools' },
    { id: 'dev', label: 'Dev Tools' },
    { id: 'system', label: 'System' },
  ]});
});

app.get('/api/shop/status', requireAuthApi, async (req, res) => {
  const results = {};
  await Promise.all(SHOP_CATALOG.map(async p => {
    results[p.id] = await isInstalled(p);
  }));
  res.json(results);
});

app.get('/api/shop/status/:id', requireAuthApi, async (req, res) => {
  const pkg = SHOP_CATALOG.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  const result = await isInstalled(pkg);
  res.json(result);
});

function sseSetup(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sseSend(res, obj) {
  try { res.write('data: ' + JSON.stringify(obj) + '\n\n'); } catch {}
}

function sseKeepAlive(res) {
  const t = setInterval(() => {
    try { res.write(': keepalive\n\n'); } catch { clearInterval(t); }
  }, 15000);
  return t;
}

function runStreamingCommand(cmd, res, req) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-lc', cmd], { env: shopEnv() });
    let aborted = false;

    const onData = (stream, isErr) => {
      stream.on('data', d => {
        const text = d.toString();
        sseSend(res, { type: 'log', line: text, err: isErr });
      });
    };
    onData(child.stdout, false);
    onData(child.stderr, true);

    child.on('error', e => {
      if (aborted) return;
      reject(e);
    });

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
  const steps = action === 'install' ? pkg.install : pkg.uninstall;
  const keepAlive = sseKeepAlive(res);

  try {
    sseSend(res, { type: 'start', action, id: pkg.id, name: pkg.name, total: steps.length, persistent: pkg.persistent !== false });

    for (let i = 0; i < steps.length; i++) {
      const cmd = steps[i];
      sseSend(res, { type: 'step', index: i + 1, total: steps.length, command: cmd });
      await runStreamingCommand(cmd, res, req);
    }

    if (action === 'install' && pkg.verify) {
      sseSend(res, { type: 'verify', command: pkg.verify });
      const result = await isInstalled(pkg);
      if (result.installed) {
        sseSend(res, { type: 'verified', version: result.version || 'unknown' });
      } else {
        sseSend(res, { type: 'verify_warn', message: 'Installed but version check did not return a match.' });
      }
    }

    sseSend(res, { type: 'done', action, id: pkg.id });
  } catch (err) {
    sseSend(res, { type: 'error', message: String(err.message || err) });
  } finally {
    clearInterval(keepAlive);
    res.write('data: [DONE]\n\n');
    res.end();
  }
}

app.get('/api/shop/install/:id', requireAuthApi, (req, res) => {
  const pkg = SHOP_CATALOG.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  sseSetup(res);
  audit('shop.install', req, { id: pkg.id });
  runJob(pkg, 'install', res, req);
});

app.get('/api/shop/uninstall/:id', requireAuthApi, (req, res) => {
  const pkg = SHOP_CATALOG.find(p => p.id === req.params.id);
  if (!pkg) return res.status(404).json({ error: 'Not found' });
  sseSetup(res);
  audit('shop.uninstall', req, { id: pkg.id });
  runJob(pkg, 'uninstall', res, req);
});

/* ══════════════════════════════════════════════════════════════════════════
   METRICS
   ══════════════════════════════════════════════════════════════════════════ */

app.get('/api/metrics', requireAuthApi, (req, res) => {
  const cpus = os.cpus();
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  let diskUsed = 0;
  let diskTotal = 0;
  try {
    const stat = fs.statfsSync ? fs.statfsSync(DATA_DIR) : null;
    if (stat) {
      diskTotal = stat.blocks * stat.bsize;
      diskUsed = (stat.blocks - stat.bavail) * stat.bsize;
    }
  } catch {}

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
    disk: {
      total: diskTotal,
      used: diskUsed,
      percent: diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0,
    },
    uptime: os.uptime(),
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    node: process.version,
    tmux: hasTmux(),
    runners: Array.from(availableRunners.keys()),
    shop: {
      total: SHOP_CATALOG.length,
      categories: Array.from(new Set(SHOP_CATALOG.map(p => p.category))).length,
    },
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   FILES
   ══════════════════════════════════════════════════════════════════════════ */

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

/* ══════════════════════════════════════════════════════════════════════════
   TERMINAL
   ══════════════════════════════════════════════════════════════════════════ */

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
  env.PYTHONPATH = PYLIB_DIR + (env.PYTHONPATH ? ':' + env.PYTHONPATH : '');
  env.PATH = BIN_DIR + ':' + NPM_DIR + '/bin:' + (env.PATH || '');
  env.NPM_CONFIG_PREFIX = NPM_DIR;
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
  console.log('[ready] shop=' + SHOP_CATALOG.length + ' packages');
  console.log('[ready] data=' + DATA_DIR);
});
