const path = require('path');
require('dotenv').config({
  path: path.resolve(__dirname, '..', '.env'),
  override: true,
});
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required to seed dummy participants.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  connectionTimeoutMillis: 60000,
  query_timeout: 30000,
  statement_timeout: 30000,
});

const BOX_KEYS = [
  'production',
  'ownership',
  'culture',
  'validation',
  'controls',
  'structure',
  'usecase',
  'roles',
  'strategy',
];

const ASPECTS_PER_BOX = 10;
const PARTICIPANT_COUNT = 30;
const WINDOW_MINUTES = 10;
const RUN_TAG = (process.env.DUMMY_RUN_TAG || Date.now().toString(36))
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '')
  .slice(0, 10);

function mulberry32(seed) {
  let t = seed >>> 0;
  return function next() {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function pickConfidence(rand) {
  const n = rand();
  if (n < 0.20) return 'green';
  if (n < 0.40) return 'amber';
  if (n < 0.60) return 'red';
  if (n < 0.80) return 'na';
  return null;
}

function buildComment(rand, confidence) {
  if (rand() > 0.45) return '';
  const notes = {
    green: 'Strong alignment and clear owner accountable for delivery.',
    amber: 'Partially defined approach; needs refinement and sequencing.',
    red: 'Low confidence with unresolved blockers and unclear next steps.',
    na: 'Not applicable to current scope for this participant.',
    unset: 'Pending discussion in the next workshop cycle.',
  };
  return notes[confidence || 'unset'];
}

function randomTimestampInWindow(rand) {
  const now = Date.now();
  const windowMs = WINDOW_MINUTES * 60 * 1000;
  const offset = Math.floor(rand() * windowMs);
  return new Date(now - offset);
}

function buildParticipantResponses(rand) {
  const rows = [];
  let latestUpdatedAt = new Date(0);

  for (const boxKey of BOX_KEYS) {
    for (let aspectIndex = 0; aspectIndex < ASPECTS_PER_BOX; aspectIndex += 1) {
      const confidence = pickConfidence(rand);
      const comment = buildComment(rand, confidence || 'unset');
      const updatedAt = randomTimestampInWindow(rand);
      if (updatedAt > latestUpdatedAt) latestUpdatedAt = updatedAt;
      rows.push({
        boxKey,
        aspectIndex,
        confidence,
        comment,
        updatedAt,
      });
    }
  }

  return { rows, latestUpdatedAt };
}

async function ensureSchema() {
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

async function withRetries(taskName, fn, attempts = 5, delayMs = 3000) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const attemptLabel =
        attempt === 1
          ? `${taskName}: attempt 1/${attempts}`
          : `${taskName}: retry ${attempt}/${attempts}`;
      console.log(attemptLabel);
      return await fn();
    } catch (error) {
      lastError = error;
      console.log(`${taskName}: ${error.message}`);
      const isLast = attempt === attempts;
      if (isLast) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

async function seedParticipant(email, rows, latestUpdatedAt) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `
      INSERT INTO users (email, updated_at)
      VALUES ($1, NOW())
      ON CONFLICT (email) DO UPDATE SET updated_at = EXCLUDED.updated_at
      RETURNING id;
      `,
      [email]
    );
    const userId = userResult.rows[0].id;

    const values = [];
    const placeholders = rows.map((row, idx) => {
      const base = idx * 6;
      values.push(
        userId,
        row.boxKey,
        row.aspectIndex,
        row.confidence,
        row.comment,
        row.updatedAt
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
    });

    await client.query(
      `
      INSERT INTO responses (
        user_id,
        box_key,
        aspect_index,
        confidence_level,
        comment_text,
        updated_at
      )
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (user_id, box_key, aspect_index)
      DO UPDATE SET
        confidence_level = EXCLUDED.confidence_level,
        comment_text = EXCLUDED.comment_text,
        updated_at = EXCLUDED.updated_at;
      `,
      values
    );

    await client.query(
      `
      UPDATE users
      SET updated_at = $2
      WHERE id = $1;
      `,
      [userId, latestUpdatedAt]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seed() {
  await withRetries('Schema bootstrap', () => ensureSchema());

  let writes = 0;
  let succeeded = 0;
  const failed = [];
  console.log(`Seeding ${PARTICIPANT_COUNT} participants with run tag ${RUN_TAG}...`);

  for (let i = 1; i <= PARTICIPANT_COUNT; i += 1) {
    const rand = mulberry32(i * 92821);
    const email = `participant${String(i).padStart(3, '0')}+test${RUN_TAG}@gmail.com`;
    const { rows, latestUpdatedAt } = buildParticipantResponses(rand);
    const taskName = `Participant ${i} (${email})`;
    try {
      await withRetries(
        taskName,
        () => seedParticipant(email, rows, latestUpdatedAt),
        4,
        2500
      );
      writes += rows.length;
      succeeded += 1;
      console.log(`Progress: ${i}/${PARTICIPANT_COUNT} participants`);
    } catch (error) {
      failed.push({ index: i, email, error: error.message });
      console.log(`Skipping ${email} after retries. Continuing...`);
    }
  }

  console.log(
    `Seeded ${succeeded}/${PARTICIPANT_COUNT} +test participants and ${writes} responses.`
  );
  if (failed.length > 0) {
    console.log('Failed participants:');
    for (const item of failed) {
      console.log(`- #${item.index} ${item.email}: ${item.error}`);
    }
  }
}

seed()
  .catch((error) => {
    console.error('Dummy seed failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
