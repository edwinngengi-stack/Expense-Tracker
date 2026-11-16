'use strict';

const { CATEGORIES } = require('./categories');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isRealDate(value) {
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const d = new Date(Date.UTC(year, month - 1, day));
  return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

function isMonth(value) {
  const match = MONTH.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  return year >= 2000 && year <= 2100;
}

function validateRegister(body) {
  const errors = {};
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';

  if (name.length < 2 || name.length > 80) errors.name = 'Name must be 2 to 80 characters.';
  if (!EMAIL.test(email) || email.length > 254) errors.email = 'Enter a valid email address.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 200) errors.password = 'Password is too long.';

  return { errors, value: { name, email, password } };
}

function parseAmount(raw) {
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && raw.trim() !== '') return Number(raw.trim());
  return null;
}

function validateTransaction(body) {
  const errors = {};
  const type = text(body.type);
  const category = text(body.category);
  const note = text(body.note);
  const date = text(body.date);

  if (type !== 'income' && type !== 'expense') {
    errors.type = 'Choose income or expense.';
  }

  let amountCents = 0;
  const amount = parseAmount(body.amount);
  if (amount === null) {
    errors.amount = 'Enter the amount.';
  } else if (Number.isNaN(amount)) {
    errors.amount = 'Amount must be a number.';
  } else if (!Number.isFinite(amount) || amount <= 0) {
    errors.amount = 'Amount must be more than 0.';
  } else if (amount > 1_000_000_000) {
    errors.amount = 'Amount is too large.';
  } else {
    amountCents = Math.round(amount * 100);
    if (Math.abs(amount * 100 - amountCents) > 1e-6) {
      errors.amount = 'Use at most 2 decimal places.';
    }
  }

  if (!errors.type && !CATEGORIES[type].includes(category)) {
    errors.category = 'Choose a category from the list.';
  }

  if (!isRealDate(date)) errors.date = 'Enter a valid date.';
  if (note.length > 200) errors.note = 'Note can be at most 200 characters.';

  return { errors, value: { type, amountCents, category, note, date } };
}

module.exports = { validateRegister, validateTransaction, isRealDate, isMonth };
