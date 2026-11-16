'use strict';

const $ = (id) => document.getElementById(id);

const money = new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', currencyDisplay: 'code' });
const compact = new Intl.NumberFormat('en-KE', { notation: 'compact', maximumFractionDigits: 1 });
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const BAR_COLORS = [
  'bg-indigo-500', 'bg-sky-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500',
  'bg-violet-500', 'bg-teal-500', 'bg-orange-500', 'bg-fuchsia-500', 'bg-slate-500',
];
const TX_FIELDS = { amount: 'tx-amount', category: 'tx-category', date: 'tx-date', note: 'tx-note' };
const AUTH_FIELDS = { name: 'auth-name', email: 'auth-email', password: 'auth-password' };

let categories = { income: [], expense: [] };
let user = null;
let month = thisMonth();
let authMode = 'login';
let editingId = null;
let deleting = null;
let searchTimer = null;
let toastTimer = null;
let listRequest = 0;
let summaryRequest = 0;

/* ---------- dates ---------- */

function pad(n) {
  return String(n).padStart(2, '0');
}

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function today() {
  return `${thisMonth()}-${pad(new Date().getDate())}`;
}

function shiftMonth(value, by) {
  const [y, m] = value.split('-').map(Number);
  const d = new Date(y, m - 1 + by, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

function monthLabel(value) {
  const [y, m] = value.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

function monthShort(value) {
  return MONTHS[Number(value.split('-')[1]) - 1].slice(0, 3);
}

function lastDayOf(value) {
  const [y, m] = value.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function niceDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1].slice(0, 3)} ${y}`;
}

/* ---------- talking to the server ---------- */

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null;

  let data = {};
  try {
    data = await res.json();
  } catch {
    // No JSON came back, so the generic message below is used.
  }
  if (!res.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = res.status;
    error.fields = data.errors || {};
    throw error;
  }
  return data;
}

/* ---------- small helpers ---------- */

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function showToast(message, isError = false) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.toggle('bg-rose-600', isError);
  toast.classList.toggle('bg-slate-900', !isError);
  toast.classList.remove('opacity-0', 'translate-y-4');
  toast.classList.add('opacity-100', 'translate-y-0');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('opacity-100', 'translate-y-0');
    toast.classList.add('opacity-0', 'translate-y-4');
  }, 2600);
}

function clearErrors(fields, formErrorId) {
  for (const [name, id] of Object.entries(fields)) {
    $(`${id}-error`).textContent = '';
    $(id).removeAttribute('aria-invalid');
  }
  $(formErrorId).textContent = '';
}

function showErrors(fields, formErrorId, errors, message) {
  let first = null;
  for (const [name, id] of Object.entries(fields)) {
    if (errors[name]) {
      $(`${id}-error`).textContent = errors[name];
      $(id).setAttribute('aria-invalid', 'true');
      if (!first) first = $(id);
    }
  }
  if (first) first.focus();
  else $(formErrorId).textContent = message;
}

/* ---------- sign in and sign up ---------- */

const TAB_ON = ['bg-white', 'text-slate-900', 'shadow-sm', 'dark:bg-slate-700', 'dark:text-white'];
const TAB_OFF = ['text-slate-600', 'dark:text-slate-400'];

function setAuthMode(mode) {
  authMode = mode;
  const registering = mode === 'register';

  $('name-field').classList.toggle('hidden', !registering);
  $('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  $('auth-password').autocomplete = registering ? 'new-password' : 'current-password';

  for (const [id, active] of [['tab-login', !registering], ['tab-register', registering]]) {
    const tab = $(id);
    tab.classList.remove(...TAB_ON, ...TAB_OFF);
    tab.classList.add(...(active ? TAB_ON : TAB_OFF));
    tab.setAttribute('aria-pressed', String(active));
  }
  clearErrors(AUTH_FIELDS, 'auth-form-error');
}

$('tab-login').addEventListener('click', () => setAuthMode('login'));
$('tab-register').addEventListener('click', () => setAuthMode('register'));

$('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(AUTH_FIELDS, 'auth-form-error');

  const payload = { email: $('auth-email').value, password: $('auth-password').value };
  if (authMode === 'register') payload.name = $('auth-name').value;

  const button = $('auth-submit');
  button.disabled = true;
  try {
    const data = await request(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify(payload) });
    user = data.user;
    showApp();
  } catch (err) {
    showErrors(AUTH_FIELDS, 'auth-form-error', err.fields || {}, err.message);
  } finally {
    button.disabled = false;
  }
});

$('logout-btn').addEventListener('click', async () => {
  try {
    await request('/api/auth/logout', { method: 'POST', body: '{}' });
  } catch {
    // Even if this fails we still return to the sign-in screen.
  }
  showAuth();
});

function showAuth() {
  user = null;
  $('app-view').classList.add('hidden');
  $('auth-view').classList.remove('hidden');
  $('auth-form').reset();
  setAuthMode('login');
  $('auth-email').focus();
}

function showApp() {
  $('auth-view').classList.add('hidden');
  $('app-view').classList.remove('hidden');
  $('user-name').textContent = user.name;
  $('auth-form').reset();
  month = thisMonth();
  $('filter-search').value = '';
  $('filter-type').value = '';
  refreshAll();
}

/* ---------- dashboard ---------- */

function filterParams() {
  const params = new URLSearchParams({
    from: `${month}-01`,
    to: `${month}-${pad(lastDayOf(month))}`,
  });
  const type = $('filter-type').value;
  const q = $('filter-search').value.trim();
  if (type) params.set('type', type);
  if (q) params.set('q', q);
  return params;
}

function handleLoadError(err) {
  if (err.status === 401) showAuth();
  else showToast(err.message, true);
}

function refreshAll() {
  $('month-label').textContent = monthLabel(month);
  loadSummary();
  loadList();
}

async function loadSummary() {
  const id = ++summaryRequest;
  try {
    const summary = await request(`/api/reports/summary?month=${month}`);
    if (id === summaryRequest) renderSummary(summary);
  } catch (err) {
    handleLoadError(err);
  }
}

async function loadList() {
  const id = ++listRequest;
  const params = filterParams();
  try {
    const data = await request(`/api/transactions?${params}`);
    if (id !== listRequest) return;
    renderList(data.transactions, params.has('q') || params.has('type'));
    $('export-link').href = `/api/transactions/export.csv?${params}`;
  } catch (err) {
    handleLoadError(err);
  }
}

function renderSummary(s) {
  $('stat-income').textContent = money.format(s.income);
  $('stat-expense').textContent = money.format(s.expense);

  const balance = $('stat-balance');
  balance.textContent = money.format(s.balance);
  balance.classList.toggle('text-rose-600', s.balance < 0);
  balance.classList.toggle('dark:text-rose-400', s.balance < 0);

  renderCategories(s.expenseByCategory);
  renderTrend(s.monthly, s.month);
}

function renderCategories(items) {
  const box = $('category-chart');
  if (items.length === 0) {
    box.replaceChildren(el('p', 'py-8 text-center text-sm text-slate-500 dark:text-slate-400', 'No spending recorded this month.'));
    return;
  }

  box.replaceChildren(
    ...items.map((item, i) => {
      const row = el('div', 'mb-3 last:mb-0');

      const top = el('div', 'mb-1 flex items-baseline justify-between gap-3 text-sm');
      top.append(
        el('span', 'font-medium', item.category),
        el('span', 'text-slate-500 dark:text-slate-400', `${money.format(item.amount)} · ${item.share}%`)
      );

      const track = el('div', 'h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700');
      const fill = el('div', `h-2 rounded-full ${BAR_COLORS[i % BAR_COLORS.length]}`);
      fill.style.width = `${Math.max(item.share, 2)}%`;
      track.append(fill);

      row.append(top, track);
      return row;
    })
  );
}

function renderTrend(months, selected) {
  const box = $('trend-chart');
  const highest = Math.max(...months.map((m) => Math.max(m.income, m.expense)));
  if (highest === 0) {
    box.replaceChildren(el('p', 'py-8 text-center text-sm text-slate-500 dark:text-slate-400', 'Nothing recorded in these months yet.'));
    return;
  }

  const columns = el('div', 'flex gap-2');
  for (const m of months) {
    const column = el('div', 'flex min-w-0 flex-1 flex-col items-center');
    column.title = `${monthLabel(m.month)}: income ${money.format(m.income)}, expenses ${money.format(m.expense)}`;

    const bars = el('div', 'flex h-36 items-end gap-1');
    for (const [value, color] of [[m.income, 'bg-emerald-500'], [m.expense, 'bg-rose-500']]) {
      const bar = el('div', `w-3.5 rounded-t sm:w-5 ${color}`);
      bar.style.height = value > 0 ? `${Math.max((value / highest) * 100, 2)}%` : '0';
      bars.append(bar);
    }

    const isSelected = m.month === selected;
    const name = el(
      'p',
      `mt-2 text-xs ${isSelected ? 'font-bold text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`,
      monthShort(m.month)
    );
    const incomeText = el('p', 'text-[11px] leading-tight text-emerald-600 dark:text-emerald-400', compact.format(m.income));
    const expenseText = el('p', 'text-[11px] leading-tight text-rose-600 dark:text-rose-400', compact.format(m.expense));

    column.append(bars, name, incomeText, expenseText);
    columns.append(column);
  }
  box.replaceChildren(columns);
}

function buildItem(t) {
  const isIncome = t.type === 'income';
  const li = el('li', 'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3');

  const icon = el(
    'span',
    isIncome
      ? 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-base font-bold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
      : 'grid h-9 w-9 shrink-0 place-items-center rounded-full bg-rose-100 text-base font-bold text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    isIncome ? '+' : '−'
  );
  icon.setAttribute('aria-hidden', 'true');

  const info = el('div', 'min-w-[10rem] flex-1');
  info.append(
    el('p', 'truncate font-medium', t.note || t.category),
    el('p', 'truncate text-sm text-slate-500 dark:text-slate-400', t.note ? `${t.category} · ${niceDate(t.date)}` : niceDate(t.date))
  );

  const amount = el(
    'span',
    isIncome
      ? 'font-semibold tabular-nums text-emerald-600 dark:text-emerald-400'
      : 'font-semibold tabular-nums text-rose-600 dark:text-rose-400',
    `${isIncome ? '+' : '−'} ${money.format(t.amount)}`
  );

  const actions = el('div', 'flex gap-2');
  const edit = el('button', 'btn btn-sm', 'Edit');
  edit.type = 'button';
  edit.setAttribute('aria-label', `Edit ${t.note || t.category} on ${niceDate(t.date)}`);
  edit.addEventListener('click', () => openForm(t));

  const del = el('button', 'btn btn-sm', 'Delete');
  del.type = 'button';
  del.setAttribute('aria-label', `Delete ${t.note || t.category} on ${niceDate(t.date)}`);
  del.addEventListener('click', () => askToDelete(t));
  actions.append(edit, del);

  li.append(icon, info, amount, actions);
  return li;
}

function renderList(items, filtered) {
  $('tx-list').replaceChildren(...items.map(buildItem));

  const empty = $('tx-empty');
  if (items.length === 0) {
    empty.classList.remove('hidden');
    empty.textContent = filtered
      ? 'No transactions match your search.'
      : `No transactions in ${monthLabel(month)} yet. Click "Add transaction" to add one.`;
  } else {
    empty.classList.add('hidden');
  }
}

$('prev-month').addEventListener('click', () => {
  month = shiftMonth(month, -1);
  refreshAll();
});
$('next-month').addEventListener('click', () => {
  month = shiftMonth(month, 1);
  refreshAll();
});
$('this-month').addEventListener('click', () => {
  month = thisMonth();
  refreshAll();
});

$('filter-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadList, 250);
});
$('filter-type').addEventListener('change', loadList);

/* ---------- add and edit ---------- */

function currentType() {
  return document.querySelector('input[name="type"]:checked').value;
}

function fillCategories(type, selected) {
  const select = $('tx-category');
  select.replaceChildren(
    ...categories[type].map((name) => {
      const option = el('option', '', name);
      option.value = name;
      return option;
    })
  );
  if (selected) select.value = selected;
}

document.querySelectorAll('input[name="type"]').forEach((radio) => {
  radio.addEventListener('change', () => fillCategories(currentType()));
});

function openForm(t) {
  editingId = t ? t.id : null;
  $('tx-title').textContent = t ? 'Edit transaction' : 'Add transaction';
  clearErrors(TX_FIELDS, 'tx-form-error');

  const type = t ? t.type : 'expense';
  document.querySelector(`input[name="type"][value="${type}"]`).checked = true;
  fillCategories(type, t ? t.category : null);

  $('tx-amount').value = t ? t.amount : '';
  $('tx-date').value = t ? t.date : month === thisMonth() ? today() : `${month}-01`;
  $('tx-note').value = t ? t.note : '';

  $('tx-dialog').showModal();
  $('tx-amount').focus();
}

$('add-btn').addEventListener('click', () => openForm(null));
$('tx-cancel').addEventListener('click', () => $('tx-dialog').close());

$('tx-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors(TX_FIELDS, 'tx-form-error');

  const payload = {
    type: currentType(),
    amount: $('tx-amount').value,
    category: $('tx-category').value,
    date: $('tx-date').value,
    note: $('tx-note').value,
  };

  const button = $('tx-save');
  button.disabled = true;
  try {
    if (editingId === null) {
      await request('/api/transactions', { method: 'POST', body: JSON.stringify(payload) });
      showToast('Transaction added.');
    } else {
      await request(`/api/transactions/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) });
      showToast('Changes saved.');
    }
    $('tx-dialog').close();

    // Jump to the month of the saved date so the person can see it.
    month = payload.date.slice(0, 7);
    refreshAll();
  } catch (err) {
    if (err.status === 401) {
      $('tx-dialog').close();
      showAuth();
    } else {
      showErrors(TX_FIELDS, 'tx-form-error', err.fields || {}, err.message);
    }
  } finally {
    button.disabled = false;
  }
});

/* ---------- delete ---------- */

function askToDelete(t) {
  deleting = t;
  $('delete-text').textContent =
    `${t.note || t.category} (${money.format(t.amount)} on ${niceDate(t.date)}) will be removed. This cannot be undone.`;
  $('delete-dialog').showModal();
}

$('delete-cancel').addEventListener('click', () => $('delete-dialog').close());

$('delete-confirm').addEventListener('click', async () => {
  if (!deleting) return;
  const button = $('delete-confirm');
  button.disabled = true;
  try {
    await request(`/api/transactions/${deleting.id}`, { method: 'DELETE' });
    showToast('Transaction deleted.');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    button.disabled = false;
    deleting = null;
    $('delete-dialog').close();
    refreshAll();
  }
});

/* ---------- start ---------- */

async function start() {
  try {
    categories = await request('/api/categories');
  } catch {
    showToast('Could not load the categories. Check that the server is running.', true);
  }

  try {
    const data = await request('/api/auth/me');
    user = data.user;
    showApp();
  } catch {
    showAuth();
  }
}

start();
