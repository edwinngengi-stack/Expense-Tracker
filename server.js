'use strict';

const { openDb } = require('./db');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const db = openDb();
const server = createApp(db);

server.listen(port, host, () => {
  console.log(`Expense Tracker is running at http://${host === '127.0.0.1' ? 'localhost' : host}:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
