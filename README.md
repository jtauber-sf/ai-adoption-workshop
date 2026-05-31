# AI Adoption Workshop

A workshop web app for running strategic AI adoption sessions, capturing participant confidence/comment responses, and reviewing individual or aggregate outcomes through admin views.

## What’s Included

- Static workshop pages (`index.html`, `framework.html`, `sample-sprint-plan.html`, `sample-playbook.html`)
- Participant experience:
  - `my-conversations-static.html` (browser-only, no persistence)
  - `my-conversations.html` (persisted to Postgres)
- Aggregate view:
  - `my-conversations-aggregate.html`
- Admin dashboard:
  - `admin.html`

## Tech Stack

- Node.js + Express
- PostgreSQL (`pg`)
- Frontend: plain HTML/CSS/JS

## Environment Variables

Create a `.env` in project root:

```env
DATABASE_URL=postgres://...
AUTH_USER=admin
AUTH_PASS=password123
ADMIN_PAGE_PASSWORD=workshop-admin
PORT=3000
```

- `DATABASE_URL` (required): Postgres connection string
- `AUTH_USER` (optional): HTTP Basic username for admin routes/pages
- `AUTH_PASS` (optional): HTTP Basic password for admin routes/pages
- `ADMIN_PAGE_PASSWORD` (optional): second password gate inside `admin.html`
- `PORT` (optional): defaults to `3000`

## Install and Run

```bash
npm install
npm start
```

On startup, the server bootstraps the database schema (`users`, `responses`) if needed.

## Core Workflows

### Participant (Persisted)

1. Open `my-conversations.html`
2. Enter email to create/resume session
3. Confidence and comments auto-save to Postgres

### Admin

1. Open `admin.html`
2. Pass HTTP Basic auth (`AUTH_USER` / `AUTH_PASS`)
3. Enter `ADMIN_PAGE_PASSWORD` in the page overlay
4. Use controls to:
   - open selected participant
   - aggregate selected participants
   - delete selected users (dangerous; removes users and their responses)
   - delete selected `+test` users
   - delete all `+test` users

## Dummy Data Seeding

Run:

```bash
npm run seed:dummy
```

Seeder behavior:

- Creates 30 users per run
- Uses randomized, collision-resistant test emails (for example `participant001+testabc123@gmail.com`)
- Seeds all conversation/aspect responses with mixed confidence levels
- Distributes timestamps within a recent 10-minute window
- Includes retry logic for transient DB connection issues

Optional:

- Set `DUMMY_RUN_TAG` to control the run suffix for test emails

## API Endpoints

### Participant

- `POST /api/session` - create/find user by email
- `GET /api/responses/:email` - fetch saved responses
- `POST /api/responses/:email` - upsert one response

### Admin (requires HTTP Basic auth)

- `GET /api/admin/users` - list users with response counts and latest activity
- `GET /api/admin/user/:email` - fetch full response snapshot for one user
- `POST /api/admin/aggregate` - aggregate counts for selected users
- `POST /api/admin/unlock` - validate `ADMIN_PAGE_PASSWORD`
- `POST /api/admin/delete-users` - delete selected users and all their responses
- `POST /api/admin/delete-test-users` - delete selected `+test` users
- `POST /api/admin/delete-all-test-users` - delete all `+test` users
