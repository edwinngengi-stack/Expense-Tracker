'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { CATEGORIES } = require('./categories');
const auth = require('./auth');
const transactions = require('./transactions');
const reports = require('./reports');
const { validateRegister, validateTransaction, isRealDate, isMonth } = require('./validation');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 10 * 1024;
const MAX_FAILED_LOGINS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
      reject(new HttpError(415, 'Send the data as JSON.'));
      return;
    }

    let size = 0;
    let finished = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        finished = true;
        reject(new HttpError(413, 'The request is too large.'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (finished) return;
      finished = true;
      try {
        const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('bad');
        resolve(data);
      } catch {
        reject(new HttpError(400, 'The request body is not valid JSON.'));
      }
    });

    req.on('error', reject);
  });
}

function isDuplicateEmailError(err) {
  return /UNIQUE constraint failed: users\.email/.test(String(err && err.message));
}

function csvCell(value) {
  if (typeof value === 'number') return String(value);
  let s = String(value ?? '');
  // A leading = + - @ makes Excel treat the cell as a formula, so we stop that.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function createApp(db, options = {}) {
  const secureCookies = options.secureCookies ?? process.env.COOKIE_SECURE === '1';
  const failedLogins = new Map();

  function loginBlocked(key) {
    const entry = failedLogins.get(key);
    if (!entry) return false;
    if (Date.now() - entry.since > LOGIN_WINDOW_MS) {
      failedLogins.delete(key);
      return false;
    }
    return entry.count >= MAX_FAILED_LOGINS;
  }

  function noteFailedLogin(key) {
    if (failedLogins.size > 5000) failedLogins.clear();
    const entry = failedLogins.get(key);
    if (entry && Date.now() - entry.since <= LOGIN_WINDOW_MS) entry.count += 1;
    else failedLogins.set(key, { count: 1, since: Date.now() });
  }

  function currentUser(req) {
    return auth.userFromToken(db, auth.readCookie(req, auth.COOKIE_NAME));
  }

  function readFilters(url) {
    const p = url.searchParams;
    const filters = {};

    const type = p.get('type');
    if (type) {
      if (type !== 'income' && type !== 'expense') throw new HttpError(400, 'Type must be income or expense.');
      filters.type = type;
    }
    for (const key of ['from', 'to']) {
      const value = p.get(key);
      if (value) {
        if (!isRealDate(value)) throw new HttpError(400, `"${key}" must be a date like 2026-03-31.`);
        filters[key] = value;
      }
    }
    const category = p.get('category');
    if (category) filters.category = category.slice(0, 60);
    const q = p.get('q');
    if (q) filters.q = q.trim().slice(0, 100);
    if (p.get('limit')) filters.limit = p.get('limit');
    return filters;
  }

  async function register(req, res) {
    const { errors, value } = validateRegister(await readJsonBody(req));
    if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);

    let userId;
    try {
      const passwordHash = await auth.hashPassword(value.password);
      const result = db
        .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(value.name, value.email, passwordHash);
      userId = Number(result.lastInsertRowid);
    } catch (err) {
      if (isDuplicateEmailError(err)) {
        throw new HttpError(409, 'That email is already registered.', { email: 'That email is already registered.' });
      }
      throw err;
    }

    const token = auth.createSession(db, userId);
    sendJson(
      res,
      201,
      { user: { id: userId, name: value.name, email: value.email } },
      { 'Set-Cookie': auth.sessionCookie(token, secureCookies) }
    );
  }

  async function login(req, res) {
    const body = await readJsonBody(req);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const key = `${req.socket.remoteAddress}|${email}`;

    if (loginBlocked(key)) {
      throw new HttpError(429, 'Too many failed attempts. Please wait a few minutes and try again.');
    }

    const row = db.prepare('SELECT id, name, email, password_hash FROM users WHERE email = ?').get(email);
    const tooLong = password.length > 200;
    const ok = row && !tooLong
      ? await auth.verifyPassword(password, row.password_hash)
      : (await auth.verifyPassword(password.slice(0, 200), await auth.dummyHash), false);

    if (!ok) {
      noteFailedLogin(key);
      throw new HttpError(401, 'Wrong email or password.');
    }

    failedLogins.delete(key);
    const token = auth.createSession(db, row.id);
    sendJson(
      res,
      200,
      { user: { id: row.id, name: row.name, email: row.email } },
      { 'Set-Cookie': auth.sessionCookie(token, secureCookies) }
    );
  }

  function logout(req, res) {
    auth.destroySession(db, auth.readCookie(req, auth.COOKIE_NAME));
    res.writeHead(204, { 'Set-Cookie': auth.clearCookie(secureCookies) });
    res.end();
  }

  function exportCsv(res, user, url) {
    const rows = transactions.list(db, user.id, { ...readFilters(url), limit: 500 });
    const lines = ['Date,Type,Category,Note,Amount'];
    for (const t of rows) {
      lines.push([t.date, t.type, csvCell(t.category), csvCell(t.note), t.amount.toFixed(2)].join(','));
    }
    const body = lines.join('\r\n') + '\r\n';
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="transactions.csv"',
      'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/api/health') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return sendJson(res, 200, { status: 'ok' });
    }

    if (pathname === '/api/categories') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return sendJson(res, 200, CATEGORIES);
    }

    if (pathname === '/api/auth/register') {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      return register(req, res);
    }
    if (pathname === '/api/auth/login') {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      return login(req, res);
    }
    if (pathname === '/api/auth/logout') {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed.');
      return logout(req, res);
    }

    // Everything below needs a signed-in user.
    const user = currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in.');

    if (pathname === '/api/auth/me') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return sendJson(res, 200, { user });
    }

    if (pathname === '/api/reports/summary') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      const month = url.searchParams.get('month') || reports.currentMonth();
      if (!isMonth(month)) throw new HttpError(400, 'Month must look like 2026-03.');
      return sendJson(res, 200, reports.summary(db, user.id, month));
    }

    if (pathname === '/api/transactions') {
      if (method === 'GET') {
        return sendJson(res, 200, { transactions: transactions.list(db, user.id, readFilters(url)) });
      }
      if (method === 'POST') {
        const { errors, value } = validateTransaction(await readJsonBody(req));
        if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
        return sendJson(res, 201, { transaction: transactions.create(db, user.id, value) });
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (pathname === '/api/transactions/export.csv') {
      if (method !== 'GET') throw new HttpError(405, 'Method not allowed.');
      return exportCsv(res, user, url);
    }

    const match = /^\/api\/transactions\/(\d+)$/.exec(pathname);
    if (match) {
      const id = Number(match[1]);

      if (method === 'GET') {
        const found = transactions.get(db, user.id, id);
        if (!found) throw new HttpError(404, 'Transaction not found.');
        return sendJson(res, 200, { transaction: found });
      }
      if (method === 'PUT') {
        const { errors, value } = validateTransaction(await readJsonBody(req));
        if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', errors);
        const updated = transactions.update(db, user.id, id, value);
        if (!updated) throw new HttpError(404, 'Transaction not found.');
        return sendJson(res, 200, { transaction: updated });
      }
      if (method === 'DELETE') {
        if (!transactions.remove(db, user.id, id)) throw new HttpError(404, 'Transaction not found.');
        res.writeHead(204);
        return res.end();
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    throw new HttpError(404, 'Not found.');
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');

    let relative;
    try {
      relative = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
    } catch {
      throw new HttpError(400, 'Bad address.');
    }

    const file = path.resolve(PUBLIC_DIR, '.' + relative);
    if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found.');

    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new HttpError(404, 'Not found.');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found.');

    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );

    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('Cache-Control', 'no-store');
        await handleApi(req, res, url);
      } else {
        serveStatic(req, res, url.pathname);
      }
    } catch (err) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (err instanceof HttpError) {
        const headers = err.status === 413 || err.status === 415 ? { Connection: 'close' } : {};
        const body = { error: err.message };
        if (err.errors) body.errors = err.errors;
        sendJson(res, err.status, body, headers);
        return;
      }
      console.error(err);
      sendJson(res, 500, { error: 'Something went wrong on the server.' });
    }
  });
}

module.exports = { createApp };
