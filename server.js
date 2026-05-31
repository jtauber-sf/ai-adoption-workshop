require('dotenv').config();
const express = require('express');
const basicAuth = require('express-basic-auth');
const path = require('path');
const { Pool } = require('pg');

const app = express();

const adminUser = process.env.AUTH_USER || 'admin';
const adminPass = process.env.AUTH_PASS || 'password123';
const adminPagePassword = process.env.ADMIN_PAGE_PASSWORD || 'workshop-admin';
const port = process.env.PORT || 3000;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to run this app.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

const adminAuth = basicAuth({
  users: { [adminUser]: adminPass },
  challenge: true,
});

app.use(express.json());

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function bootstrapSchema() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE EXTENSION IF NOT EXISTS citext;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email CITEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      box_key TEXT NOT NULL,
      aspect_index INTEGER NOT NULL CHECK (aspect_index >= 0),
      confidence_level TEXT NULL CHECK (confidence_level IN ('red','amber','green','na')),
      comment_text TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, box_key, aspect_index)
    );
  `);
}

async function getOrCreateUser(email) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    throw new Error('Please provide a valid email address.');
  }

  const result = await pool.query(
    `
    INSERT INTO users (email)
    VALUES ($1)
    ON CONFLICT (email) DO UPDATE SET updated_at = NOW()
    RETURNING id, email;
    `,
    [normalized]
  );
  return result.rows[0];
}

app.post('/api/session', async (req, res) => {
  try {
    const user = await getOrCreateUser(req.body?.email);
    res.json({ email: user.email, userId: user.id });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to create session.' });
  }
});

app.get('/api/responses/:email', async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const userResult = await pool.query(
    `SELECT id, email FROM users WHERE email = $1`,
    [email]
  );
  if (!userResult.rowCount) {
    return res.json({ email, responses: [] });
  }

  const responses = await pool.query(
    `
    SELECT box_key, aspect_index, confidence_level, comment_text, updated_at
    FROM responses
    WHERE user_id = $1
    ORDER BY box_key, aspect_index;
    `,
    [userResult.rows[0].id]
  );

  return res.json({ email: userResult.rows[0].email, responses: responses.rows });
});

app.post('/api/responses/:email', async (req, res) => {
  try {
    const user = await getOrCreateUser(req.params.email);
    const { boxKey, aspectIndex, confidenceLevel, commentText } = req.body || {};

    if (!boxKey || typeof boxKey !== 'string') {
      return res.status(400).json({ error: 'boxKey is required.' });
    }
    if (!Number.isInteger(aspectIndex) || aspectIndex < 0) {
      return res.status(400).json({ error: 'aspectIndex must be a non-negative integer.' });
    }
    if (confidenceLevel != null && !['red', 'amber', 'green', 'na'].includes(confidenceLevel)) {
      return res.status(400).json({ error: 'Invalid confidence level.' });
    }

    const saved = await pool.query(
      `
      INSERT INTO responses (user_id, box_key, aspect_index, confidence_level, comment_text, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (user_id, box_key, aspect_index)
      DO UPDATE SET
        confidence_level = EXCLUDED.confidence_level,
        comment_text = EXCLUDED.comment_text,
        updated_at = NOW()
      RETURNING box_key, aspect_index, confidence_level, comment_text, updated_at;
      `,
      [user.id, boxKey, aspectIndex, confidenceLevel || null, String(commentText || '')]
    );

    return res.json({ saved: saved.rows[0] });
  } catch (error) {
    return res.status(400).json({ error: error.message || 'Unable to save response.' });
  }
});

app.get('/api/admin/users', adminAuth, async (_req, res) => {
  const result = await pool.query(`
    SELECT
      u.email,
      MAX(r.updated_at) AS last_response_at,
      COUNT(r.id) AS response_count
    FROM users u
    LEFT JOIN responses r ON r.user_id = u.id
    GROUP BY u.id
    ORDER BY last_response_at DESC NULLS LAST, u.created_at DESC;
  `);
  res.json({ users: result.rows });
});

app.get('/api/admin/user/:email', adminAuth, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const result = await pool.query(
    `
    SELECT u.email, r.box_key, r.aspect_index, r.confidence_level, r.comment_text, r.updated_at
    FROM users u
    LEFT JOIN responses r ON r.user_id = u.id
    WHERE u.email = $1
    ORDER BY r.box_key, r.aspect_index;
    `,
    [email]
  );
  if (!result.rowCount) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const rows = result.rows.filter((r) => r.box_key);
  return res.json({ email, responses: rows });
});

app.post('/api/admin/unlock', adminAuth, async (req, res) => {
  const password = String(req.body?.password || '');
  if (!password) {
    return res.status(400).json({ error: 'Password is required.' });
  }
  if (password !== adminPagePassword) {
    return res.status(401).json({ error: 'Invalid admin page password.' });
  }
  return res.json({ ok: true });
});

app.post('/api/admin/delete-test-users', adminAuth, async (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails.map(normalizeEmail) : [];
  const validEmails = emails.filter(isValidEmail);
  if (!validEmails.length) {
    return res.status(400).json({ error: 'At least one valid email is required.' });
  }

  const result = await pool.query(
    `
    WITH deleted AS (
      DELETE FROM users
      WHERE email = ANY($1::citext[])
        AND split_part(email::text, '@', 1) ILIKE '%+test%'
      RETURNING email
    )
    SELECT email FROM deleted ORDER BY email;
    `,
    [validEmails]
  );

  return res.json({
    deletedCount: result.rowCount,
    deletedEmails: result.rows.map((r) => r.email),
  });
});

app.post('/api/admin/delete-all-test-users', adminAuth, async (_req, res) => {
  const result = await pool.query(
    `
    WITH deleted AS (
      DELETE FROM users
      WHERE split_part(email::text, '@', 1) ILIKE '%+test%'
      RETURNING email
    )
    SELECT email FROM deleted ORDER BY email;
    `
  );

  return res.json({
    deletedCount: result.rowCount,
    deletedEmails: result.rows.map((r) => r.email),
  });
});

app.post('/api/admin/delete-users', adminAuth, async (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails.map(normalizeEmail) : [];
  const validEmails = emails.filter(isValidEmail);
  if (!validEmails.length) {
    return res.status(400).json({ error: 'At least one valid email is required.' });
  }

  const result = await pool.query(
    `
    WITH target AS (
      SELECT id, email
      FROM users
      WHERE email = ANY($1::citext[])
    ),
    deleted AS (
      DELETE FROM users u
      USING target t
      WHERE u.id = t.id
      RETURNING u.email
    )
    SELECT email
    FROM deleted
    ORDER BY email;
    `,
    [validEmails]
  );

  return res.json({
    deletedCount: result.rowCount,
    deletedEmails: result.rows.map((r) => r.email),
  });
});

app.post('/api/admin/aggregate', adminAuth, async (req, res) => {
  const emails = Array.isArray(req.body?.emails) ? req.body.emails.map(normalizeEmail) : [];
  const validEmails = emails.filter(isValidEmail);

  if (!validEmails.length) {
    return res.status(400).json({ error: 'At least one valid email is required.' });
  }

  const result = await pool.query(
    `
    SELECT
      r.box_key,
      r.aspect_index,
      COALESCE(r.confidence_level, 'unset') AS confidence_level,
      COUNT(*)::int AS count
    FROM responses r
    INNER JOIN users u ON u.id = r.user_id
    WHERE u.email = ANY($1::citext[])
    GROUP BY r.box_key, r.aspect_index, COALESCE(r.confidence_level, 'unset')
    ORDER BY r.box_key, r.aspect_index;
    `,
    [validEmails]
  );

  return res.json({ emails: validEmails, rows: result.rows });
});

app.get('/admin.html', adminAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Temporary compatibility redirects for renamed participant pages.
app.get('/participant.html', (_req, res) => {
  res.redirect(302, '/my-conversations-static.html');
});

app.get('/participant-persisted.html', (req, res) => {
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  res.redirect(302, `/my-conversations.html${qs}`);
});

app.use(express.static(path.join(__dirname, '.')));

bootstrapSchema()
  .then(() => {
    app.listen(port, () => console.log(`App running on port ${port}`));
  })
  .catch((error) => {
    console.error('Failed to bootstrap database schema:', error);
    process.exit(1);
  });