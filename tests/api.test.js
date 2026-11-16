'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { openDb } = require('../db');
const { createApp } = require('../app');

let db;
let server;
let base;

before(async () => {
  db = openDb(':memory:');
  server = createApp(db);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

// A small client that remembers the session cookie, like a browser would.
function client() {
  let cookie = '';
  async function call(method, url, body, extraHeaders = {}) {
    const headers = { ...extraHeaders };
    if (body !== undefined && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.startsWith('sid=;') ? '' : set.split(';')[0];
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (url) => call('GET', url),
    post: (url, body) => call('POST', url, body ?? {}),
    put: (url, body) => call('PUT', url, body),
    del: (url) => call('DELETE', url),
    raw: call,
    hasCookie: () => cookie !== '',
  };
}

let counter = 0;
async function signedInClient() {
  counter += 1;
  const c = client();
  const res = await c.post('/api/auth/register', {
    name: `Test User ${counter}`,
    email: `user${counter}@example.com`,
    password: 'correct-horse-9',
  });
  assert.equal(res.status, 201);
  return c;
}

const sample = {
  type: 'expense',
  amount: 1250.5,
  category: 'Food',
  note: 'Groceries',
  date: '2026-03-14',
};

/* ---------- accounts ---------- */

test('register creates an account and signs the user in', async () => {
  const c = client();
  const res = await c.post('/api/auth/register', {
    name: 'Amina Wanjiru',
    email: 'Amina@Example.com',
    password: 'longenough1',
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, 'amina@example.com');
  assert.equal(res.data.user.password_hash, undefined);
  assert.match(res.headers.get('set-cookie'), /HttpOnly/);
  assert.match(res.headers.get('set-cookie'), /SameSite=Lax/);

  const me = await c.get('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, 'Amina Wanjiru');
});

test('register rejects bad data with a message for each field', async () => {
  const res = await client().post('/api/auth/register', { name: 'A', email: 'nope', password: 'short' });
  assert.equal(res.status, 400);
  assert.ok(res.data.errors.name);
  assert.ok(res.data.errors.email);
  assert.ok(res.data.errors.password);
});

test('the same email cannot register twice', async () => {
  const body = { name: 'Same Person', email: 'same@example.com', password: 'longenough1' };
  assert.equal((await client().post('/api/auth/register', body)).status, 201);
  const again = await client().post('/api/auth/register', { ...body, email: 'SAME@example.com' });
  assert.equal(again.status, 409);
  assert.ok(again.data.errors.email);
});

test('passwords are stored as hashes, never as plain text', async () => {
  await client().post('/api/auth/register', {
    name: 'Hash Check',
    email: 'hash@example.com',
    password: 'plain-text-secret',
  });
  const row = db.prepare('SELECT password_hash FROM users WHERE email = ?').get('hash@example.com');
  assert.ok(row.password_hash.startsWith('scrypt$'));
  assert.ok(!row.password_hash.includes('plain-text-secret'));
});

test('login works with the right password and fails with a wrong one', async () => {
  await client().post('/api/auth/register', {
    name: 'Login Check',
    email: 'login@example.com',
    password: 'right-password-1',
  });

  const bad = await client().post('/api/auth/login', { email: 'login@example.com', password: 'wrong-password' });
  assert.equal(bad.status, 401);

  const unknown = await client().post('/api/auth/login', { email: 'nobody@example.com', password: 'whatever123' });
  assert.equal(unknown.status, 401);
  assert.equal(unknown.data.error, bad.data.error);

  const c = client();
  const good = await c.post('/api/auth/login', { email: 'LOGIN@example.com', password: 'right-password-1' });
  assert.equal(good.status, 200);
  assert.equal((await c.get('/api/auth/me')).status, 200);
});

test('logout ends the session', async () => {
  const c = await signedInClient();
  assert.equal((await c.post('/api/auth/logout')).status, 204);
  assert.equal((await c.get('/api/transactions')).status, 401);
});

test('too many wrong passwords are blocked for a while', async () => {
  await client().post('/api/auth/register', {
    name: 'Lock Check',
    email: 'lock@example.com',
    password: 'right-password-1',
  });
  let last;
  for (let i = 0; i < 9; i += 1) {
    last = await client().post('/api/auth/login', { email: 'lock@example.com', password: 'nope-nope-nope' });
  }
  assert.equal(last.status, 429);
});

test('data routes need a signed-in user', async () => {
  const c = client();
  for (const url of ['/api/transactions', '/api/reports/summary', '/api/auth/me', '/api/transactions/export.csv']) {
    assert.equal((await c.get(url)).status, 401, url);
  }
  assert.equal((await c.post('/api/transactions', sample)).status, 401);
});

test('a made-up cookie does not sign anyone in', async () => {
  const res = await client().raw('GET', '/api/auth/me', undefined, { Cookie: 'sid=not-a-real-token' });
  assert.equal(res.status, 401);
});

/* ---------- transactions ---------- */

test('create, read, update and delete a transaction', async () => {
  const c = await signedInClient();

  const created = await c.post('/api/transactions', sample);
  assert.equal(created.status, 201);
  const id = created.data.transaction.id;
  assert.equal(created.data.transaction.amount, 1250.5);
  assert.equal(created.data.transaction.category, 'Food');

  const one = await c.get(`/api/transactions/${id}`);
  assert.equal(one.status, 200);
  assert.equal(one.data.transaction.note, 'Groceries');

  const updated = await c.put(`/api/transactions/${id}`, { ...sample, amount: '900', note: 'Smaller shop' });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.transaction.amount, 900);
  assert.equal(updated.data.transaction.note, 'Smaller shop');

  assert.equal((await c.del(`/api/transactions/${id}`)).status, 204);
  assert.equal((await c.get(`/api/transactions/${id}`)).status, 404);
  assert.equal((await c.del(`/api/transactions/${id}`)).status, 404);
});

test('transaction data is checked before saving', async () => {
  const c = await signedInClient();

  const cases = [
    [{ ...sample, type: 'refund' }, 'type'],
    [{ ...sample, amount: 0 }, 'amount'],
    [{ ...sample, amount: -5 }, 'amount'],
    [{ ...sample, amount: 'abc' }, 'amount'],
    [{ ...sample, amount: '' }, 'amount'],
    [{ ...sample, amount: 10.123 }, 'amount'],
    [{ ...sample, amount: 5_000_000_000 }, 'amount'],
    [{ ...sample, category: 'Salary' }, 'category'],
    [{ ...sample, category: 'Made up' }, 'category'],
    [{ ...sample, date: '2026-02-30' }, 'date'],
    [{ ...sample, date: '14/03/2026' }, 'date'],
    [{ ...sample, note: 'x'.repeat(201) }, 'note'],
  ];

  for (const [body, field] of cases) {
    const res = await c.post('/api/transactions', body);
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.ok(res.data.errors[field], `expected an error for ${field}`);
  }
});

test('income uses its own list of categories', async () => {
  const c = await signedInClient();
  const ok = await c.post('/api/transactions', { type: 'income', amount: 50000, category: 'Salary', date: '2026-03-01' });
  assert.equal(ok.status, 201);
  const bad = await c.post('/api/transactions', { type: 'income', amount: 50, category: 'Food', date: '2026-03-01' });
  assert.equal(bad.status, 400);
});

test('lists can be filtered and searched', async () => {
  const c = await signedInClient();
  await c.post('/api/transactions', { ...sample, date: '2026-03-02', note: 'Supermarket' });
  await c.post('/api/transactions', { ...sample, category: 'Transport', date: '2026-03-20', note: 'Bus' });
  await c.post('/api/transactions', { type: 'income', amount: 70000, category: 'Salary', date: '2026-04-01', note: '' });

  const all = await c.get('/api/transactions');
  assert.equal(all.data.transactions.length, 3);
  assert.equal(all.data.transactions[0].date, '2026-04-01', 'newest first');

  const march = await c.get('/api/transactions?from=2026-03-01&to=2026-03-31');
  assert.equal(march.data.transactions.length, 2);

  const income = await c.get('/api/transactions?type=income');
  assert.equal(income.data.transactions.length, 1);

  const search = await c.get('/api/transactions?q=super');
  assert.equal(search.data.transactions.length, 1);

  const byCategory = await c.get('/api/transactions?q=transport');
  assert.equal(byCategory.data.transactions.length, 1);

  assert.equal((await c.get('/api/transactions?type=nonsense')).status, 400);
  assert.equal((await c.get('/api/transactions?from=yesterday')).status, 400);
});

test('search treats % and _ as normal characters and ignores SQL text', async () => {
  const c = await signedInClient();
  await c.post('/api/transactions', { ...sample, note: '50% off sale' });
  await c.post('/api/transactions', { ...sample, note: 'Other' });

  const percent = await c.get('/api/transactions?q=' + encodeURIComponent('%'));
  assert.equal(percent.data.transactions.length, 1);

  const sql = await c.get('/api/transactions?q=' + encodeURIComponent("'; DROP TABLE transactions; --"));
  assert.equal(sql.status, 200);
  assert.equal(sql.data.transactions.length, 0);
  assert.equal((await c.get('/api/transactions')).data.transactions.length, 2);
});

test('people cannot see or change each other\'s records', async () => {
  const owner = await signedInClient();
  const other = await signedInClient();

  const created = await owner.post('/api/transactions', sample);
  const id = created.data.transaction.id;

  assert.equal((await other.get(`/api/transactions/${id}`)).status, 404);
  assert.equal((await other.put(`/api/transactions/${id}`, sample)).status, 404);
  assert.equal((await other.del(`/api/transactions/${id}`)).status, 404);
  assert.equal((await other.get('/api/transactions')).data.transactions.length, 0);
  assert.equal((await owner.get(`/api/transactions/${id}`)).status, 200);
});

test('bad requests get clear errors', async () => {
  const c = await signedInClient();

  const broken = await c.raw('POST', '/api/transactions', '{not json');
  assert.equal(broken.status, 400);

  const array = await c.raw('POST', '/api/transactions', '[1,2]');
  assert.equal(array.status, 400);

  const plain = await c.raw('POST', '/api/transactions', 'amount=5', { 'Content-Type': 'text/plain' });
  assert.equal(plain.status, 415);

  const huge = await c.raw('POST', '/api/transactions', JSON.stringify({ note: 'x'.repeat(20000) }));
  assert.equal(huge.status, 413);

  assert.equal((await c.get('/api/transactions/9999999')).status, 404);
  assert.equal((await c.raw('PATCH', '/api/transactions/1', {})).status, 405);
  assert.equal((await c.get('/api/nothing-here')).status, 404);
});

/* ---------- reports ---------- */

test('the summary adds up income, spending and categories', async () => {
  const c = await signedInClient();
  await c.post('/api/transactions', { type: 'income', amount: 100000, category: 'Salary', date: '2026-03-01' });
  await c.post('/api/transactions', { type: 'income', amount: 5000.5, category: 'Gift', date: '2026-03-10' });
  await c.post('/api/transactions', { ...sample, amount: 30000, category: 'Rent', date: '2026-03-02' });
  await c.post('/api/transactions', { ...sample, amount: 10000, category: 'Food', date: '2026-03-31' });
  await c.post('/api/transactions', { ...sample, amount: 10000, category: 'Food', date: '2026-02-28' });
  await c.post('/api/transactions', { ...sample, amount: 999, category: 'Food', date: '2026-04-01' });

  const res = await c.get('/api/reports/summary?month=2026-03');
  assert.equal(res.status, 200);
  const s = res.data;
  assert.equal(s.income, 105000.5);
  assert.equal(s.expense, 40000);
  assert.equal(s.balance, 65000.5);
  assert.equal(s.count, 4);

  assert.deepEqual(
    s.expenseByCategory.map((x) => [x.category, x.amount, x.share]),
    [
      ['Rent', 30000, 75],
      ['Food', 10000, 25],
    ]
  );

  assert.equal(s.monthly.length, 6);
  assert.equal(s.monthly[0].month, '2025-10');
  assert.equal(s.monthly[5].month, '2026-03');
  assert.deepEqual(s.monthly[4], { month: '2026-02', income: 0, expense: 10000 });
  assert.deepEqual(s.monthly[5], { month: '2026-03', income: 105000.5, expense: 40000 });
});

test('an empty month gives zeros, and a bad month is rejected', async () => {
  const c = await signedInClient();
  const empty = await c.get('/api/reports/summary?month=2026-01');
  assert.equal(empty.status, 200);
  assert.equal(empty.data.balance, 0);
  assert.deepEqual(empty.data.expenseByCategory, []);

  assert.equal((await c.get('/api/reports/summary?month=2026-13')).status, 400);
  assert.equal((await c.get('/api/reports/summary?month=march')).status, 400);
});

test('the summary only counts the signed-in user\'s records', async () => {
  const a = await signedInClient();
  const b = await signedInClient();
  await a.post('/api/transactions', { ...sample, amount: 500 });
  const res = await b.get('/api/reports/summary?month=2026-03');
  assert.equal(res.data.expense, 0);
});

test('export gives a CSV file and protects against spreadsheet formulas', async () => {
  const c = await signedInClient();
  await c.post('/api/transactions', { ...sample, note: '=HYPERLINK("http://bad.example")' });
  await c.post('/api/transactions', { ...sample, note: 'Lunch, with a comma' });

  const res = await c.get('/api/transactions/export.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), /attachment/);
  const lines = res.data.trim().split('\r\n');
  assert.equal(lines[0], 'Date,Type,Category,Note,Amount');
  assert.equal(lines.length, 3);
  assert.ok(res.data.includes('"\'=HYPERLINK(""http://bad.example"")"'));
  assert.ok(res.data.includes('"Lunch, with a comma"'));
});

/* ---------- pages and basics ---------- */

test('health check, categories and security headers', async () => {
  const c = client();
  const health = await c.get('/api/health');
  assert.equal(health.status, 200);

  const cats = await c.get('/api/categories');
  assert.ok(cats.data.expense.includes('Food'));
  assert.ok(cats.data.income.includes('Salary'));

  assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
  assert.match(health.headers.get('content-security-policy'), /default-src 'self'/);
});

test('the web page is served and other files cannot be reached', async () => {
  const page = await fetch(base + '/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Expense Tracker/);

  const css = await fetch(base + '/styles.css');
  assert.equal(css.status, 200);
  assert.match(css.headers.get('content-type'), /text\/css/);

  for (const url of ['/../package.json', '/%2e%2e/package.json', '/..%2fdb.js', '/nothing.html']) {
    const res = await fetch(base + url);
    assert.equal(res.status, 404, url);
  }
});
