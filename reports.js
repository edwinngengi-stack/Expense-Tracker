'use strict';

function addMonths(month, n) {
  const [year, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function summary(db, userId, month) {
  const start = `${month}-01`;
  const end = `${addMonths(month, 1)}-01`;

  let income = 0;
  let expense = 0;
  let count = 0;
  const totals = db
    .prepare(
      `SELECT type, SUM(amount_cents) AS total, COUNT(*) AS n
       FROM transactions
       WHERE user_id = ? AND date >= ? AND date < ?
       GROUP BY type`
    )
    .all(userId, start, end);
  for (const row of totals) {
    if (row.type === 'income') income = row.total;
    else expense = row.total;
    count += row.n;
  }

  const byCategory = db
    .prepare(
      `SELECT category, SUM(amount_cents) AS total
       FROM transactions
       WHERE user_id = ? AND type = 'expense' AND date >= ? AND date < ?
       GROUP BY category
       ORDER BY total DESC, category`
    )
    .all(userId, start, end)
    .map((row) => ({
      category: row.category,
      amount: row.total / 100,
      share: expense > 0 ? Math.round((row.total / expense) * 1000) / 10 : 0,
    }));

  const firstMonth = addMonths(month, -5);
  const trendRows = db
    .prepare(
      `SELECT substr(date, 1, 7) AS month, type, SUM(amount_cents) AS total
       FROM transactions
       WHERE user_id = ? AND date >= ? AND date < ?
       GROUP BY month, type`
    )
    .all(userId, `${firstMonth}-01`, end);

  const monthly = [];
  for (let i = 0; i < 6; i += 1) {
    const m = addMonths(firstMonth, i);
    const row = { month: m, income: 0, expense: 0 };
    for (const r of trendRows) {
      if (r.month === m) row[r.type] = r.total / 100;
    }
    monthly.push(row);
  }

  return {
    month,
    income: income / 100,
    expense: expense / 100,
    balance: (income - expense) / 100,
    count,
    expenseByCategory: byCategory,
    monthly,
  };
}

module.exports = { summary, currentMonth, addMonths };
