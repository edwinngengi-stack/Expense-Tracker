# Expense Tracker

A web app for tracking income and expenses. You create an account, add your transactions, and see totals and charts for each month.

It has three parts:

- **Frontend:** one page in HTML and JavaScript, styled with Tailwind CSS (`public/`).
- **Backend:** a REST API built with Node.js (`app.js` and the files next to it).
- **Database:** SQLite, stored in a file at `data/tracker.db`.

The server has no third-party runtime dependencies; it uses Node.js built-in modules. Tailwind CSS is a development dependency, needed only to rebuild the styles (see "Changing the design").

## What you need

Node.js version 22.13 or newer. Check yours with:

```
node --version
```

On Windows, run the app from WSL. If Node.js is missing or older than 22.13, install a current version with nvm from your WSL terminal:

```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
```

Close and reopen the WSL terminal, then run `nvm install --lts`. Confirm the version with `node --version`.

## Run it

```
npm start
```

Open http://localhost:3000 and choose "Create account".

On Windows, run these commands in WSL from the project directory. For example, if the project is in your Windows Downloads folder:

```
cd /mnt/c/Users/<your-Windows-username>/Downloads/expense-tracker/expense-tracker
npm start
```

To try the app with sample records first, run:

```
npm run seed
```

Then sign in with `demo@example.com` and the password `demo12345`.
Running the seed command again replaces the demo account's existing transactions, so do not use that account for personal records.

To use another port, set `PORT`, for example `PORT=4000 npm start`.

## Features

- Create an account, sign in and log out
- Add income and expenses with an amount, category, date and note
- Edit and delete transactions (with a confirmation before deleting)
- Totals for income, expenses and balance for each month
- Chart of spending by category
- Chart of income and expenses for the last 6 months
- Search and filter the list, and export it as a CSV file
- Each person only sees their own records
- Works on phones, and follows the light or dark setting of your device

## How login works

- Passwords are never saved as text. They are hashed with scrypt and a random salt.
- After signing in, the browser gets a random session code in a cookie that scripts cannot read (HttpOnly, SameSite=Lax). Only a hash of the code is stored in the database.
- Sessions last 7 days, and logging out ends the session straight away.
- After 8 wrong passwords for the same email from the same client address, further tries are blocked for 15 minutes.
- When the app is served over HTTPS, start it with `COOKIE_SECURE=1` so the cookie is sent only over HTTPS.

## API

API requests and most responses use JSON; the CSV export returns a CSV file. Health, categories, registration, login and logout do not require an existing session. All other routes require you to be signed in.

| Method | Address | What it does |
| --- | --- | --- |
| GET | `/api/health` | Check that the server is running |
| GET | `/api/categories` | The lists of income and expense categories |
| POST | `/api/auth/register` | Create an account and sign in |
| POST | `/api/auth/login` | Sign in |
| POST | `/api/auth/logout` | Sign out |
| GET | `/api/auth/me` | The signed-in user |
| GET | `/api/transactions` | List transactions. Optional: `type`, `from`, `to`, `q`, `category`, `limit` |
| POST | `/api/transactions` | Add a transaction |
| GET | `/api/transactions/:id` | Get one transaction |
| PUT | `/api/transactions/:id` | Replace a transaction's details |
| DELETE | `/api/transactions/:id` | Delete a transaction |
| GET | `/api/transactions/export.csv` | Download the list as a CSV file (same filters) |
| GET | `/api/reports/summary?month=2026-03` | Totals, spending by category and the last 6 months |

Example of a transaction:

```json
{
  "type": "expense",
  "amount": 1250.5,
  "category": "Food",
  "note": "Groceries",
  "date": "2026-03-14"
}
```

Replies use these status codes: `200` ok, `201` created, `204` done with nothing to return, `400` bad data (with the problem for each field), `401` not signed in or wrong password, `404` not found, `405` method not allowed, `409` that email is already registered, `413` request body over 10 KB, `415` data not sent as JSON, `429` too many wrong passwords.

### Rules for the data

- Name: 2 to 80 characters
- Email: must look like a real email, and each email can be used once
- Password: at least 8 characters
- Type: `income` or `expense`
- Amount: more than 0, with at most 2 decimal places
- Category: one from the list for that type
- Date: a real date written as `YYYY-MM-DD`
- Note: optional, up to 200 characters

## Tests

```
npm test
```

This runs 22 checks on the API. They cover creating accounts, signing in and out, wrong passwords, adding, listing, searching, updating and deleting transactions, bad data, the monthly summary, the CSV export, one person trying to reach another person's records, and attempts to access files outside the public folder. The tests use an in-memory database, so your real records are not touched.

## Changing the design

The styles are already built into `public/styles.css`, so you do not need to do anything to run the app. To change the design:

```
npm install
npm run build:css
```

Edit the classes in `public/index.html` and `public/app.js`, or the shared button and card styles in `src/input.css`. `npm run watch:css` rebuilds the file each time you save.

## Project files

```
server.js          starts the server
app.js             routes, login checks and static files
auth.js            password hashing and sessions
transactions.js    database queries for transactions
reports.js         monthly totals and charts data
validation.js      checks the data before saving
categories.js      the category lists
db.js              opens the database and creates the tables
public/            the web page (index.html, app.js, styles.css)
src/input.css      Tailwind source for the shared styles
scripts/seed.js    adds a demo account with sample records
tests/             automated tests
docs/screenshots/  pictures of the app
```

## Screenshots

See the `docs/screenshots` folder: sign in, create account errors, the dashboard, the add form with errors, the delete confirmation, an empty account, the phone view and the dark theme.
