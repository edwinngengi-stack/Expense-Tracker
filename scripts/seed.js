'use strict';

// Adds a demo account with six months of sample records.
// Sign in with demo@example.com and the password demo12345.
// It is safe to run again: the demo records are replaced each time.

const { openDb } = require('../db');
const auth = require('../auth');
const { addMonths, currentMonth } = require('../reports');

const EMAIL = 'demo@example.com';
const PASSWORD = 'demo12345';

async function main() {
  const db = openDb();

  let user = db.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL);
  if (!user) {
    const hash = await auth.hashPassword(PASSWORD);
    const result = db
      .prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
      .run('Demo User', EMAIL, hash);
    user = { id: Number(result.lastInsertRowid) };
  }
  db.prepare('DELETE FROM transactions WHERE user_id = ?').run(user.id);

  const insert = db.prepare(
    `INSERT INTO transactions (user_id, type, amount_cents, category, note, date)
     VALUES (?, ?, ?, ?, ?, ?)`
  );

  const now = new Date();
  const thisMonth = currentMonth();
  const todayDay = now.getDate();
  let added = 0;

  function add(month, day, type, amount, category, note) {
    if (month === thisMonth && day > todayDay) return;
    const date = `${month}-${String(day).padStart(2, '0')}`;
    insert.run(user.id, type, Math.round(amount * 100), category, note, date);
    added += 1;
  }

  db.exec('BEGIN');
  try {
    for (let back = 5; back >= 0; back -= 1) {
      const month = addMonths(thisMonth, -back);
      const wobble = (back * 7) % 5;

      add(month, 1, 'income', 85000, 'Salary', 'Monthly salary');
      if (back % 2 === 0) add(month, 18, 'income', 12000 + wobble * 1500, 'Business', 'Weekend side job');

      add(month, 2, 'expense', 25000, 'Rent', 'House rent');
      add(month, 4, 'expense', 3200 + wobble * 150, 'Utilities', 'Electricity and water');
      add(month, 5, 'expense', 1000, 'Airtime & Data', 'Data bundle');
      add(month, 6, 'expense', 2400 + wobble * 200, 'Food', 'Groceries');
      add(month, 9, 'expense', 800 + wobble * 50, 'Transport', 'Matatu fare');
      add(month, 12, 'expense', 1800 + wobble * 120, 'Food', 'Lunch and snacks');
      add(month, 14, 'expense', 1500, 'Entertainment', 'Movie night');
      add(month, 16, 'expense', 2600 + wobble * 100, 'Food', 'Groceries');
      add(month, 20, 'expense', 1100 + wobble * 60, 'Transport', 'Boda boda rides');
      if (back % 3 !== 1) add(month, 22, 'expense', 4500 + wobble * 300, 'Shopping', 'Clothes');
      if (back % 2 === 1) add(month, 24, 'expense', 2000, 'Health', 'Clinic visit');
      if (back === 3) add(month, 10, 'expense', 9000, 'Education', 'Course materials');
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  console.log(`Demo data ready: ${added} records.`);
  console.log(`Sign in with ${EMAIL} and the password ${PASSWORD}.`);
  db.close();
}

main();
