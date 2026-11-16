'use strict';

const COLUMNS = 'id, type, amount_cents, category, note, date';

function toApi(row) {
  return {
    id: row.id,
    type: row.type,
    amount: row.amount_cents / 100,
    category: row.category,
    note: row.note,
    date: row.date,
  };
}

function list(db, userId, filters = {}) {
  const where = ['user_id = ?'];
  const params = [userId];

  if (filters.type) {
    where.push('type = ?');
    params.push(filters.type);
  }
  if (filters.category) {
    where.push('category = ?');
    params.push(filters.category);
  }
  if (filters.from) {
    where.push('date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('date <= ?');
    params.push(filters.to);
  }
  if (filters.q) {
    const like = `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`;
    where.push("(note LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\')");
    params.push(like, like);
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 200, 1), 500);
  const rows = db
    .prepare(
      `SELECT ${COLUMNS} FROM transactions
       WHERE ${where.join(' AND ')}
       ORDER BY date DESC, id DESC
       LIMIT ?`
    )
    .all(...params, limit);

  return rows.map(toApi);
}

function get(db, userId, id) {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM transactions WHERE id = ? AND user_id = ?`)
    .get(id, userId);
  return row ? toApi(row) : null;
}

function create(db, userId, v) {
  const result = db
    .prepare(
      `INSERT INTO transactions (user_id, type, amount_cents, category, note, date)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(userId, v.type, v.amountCents, v.category, v.note, v.date);
  return get(db, userId, Number(result.lastInsertRowid));
}

function update(db, userId, id, v) {
  const result = db
    .prepare(
      `UPDATE transactions
       SET type = ?, amount_cents = ?, category = ?, note = ?, date = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    )
    .run(v.type, v.amountCents, v.category, v.note, v.date, id, userId);
  return result.changes > 0 ? get(db, userId, id) : null;
}

function remove(db, userId, id) {
  const result = db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(id, userId);
  return result.changes > 0;
}

module.exports = { list, get, create, update, remove };
