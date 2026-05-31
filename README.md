# ai-adoption-workshop
A one-day executive workshop with your ELT to build a confident, structured plan for absorbing and scaling agentic AI across the organisation — from strategic intent to a 90-day sprint with named owners.

## Persisted Participant Workflow

The original `my-conversations-static.html` remains unchanged and browser-only.

A persisted version is available at `my-conversations.html`, backed by Postgres via `DATABASE_URL`.

### Environment Variables

- `DATABASE_URL` (required): Heroku Postgres connection string.
- `AUTH_USER` (optional, default `admin`): Basic auth user for admin endpoints/page.
- `AUTH_PASS` (optional, default `password123`): Basic auth password for admin endpoints/page.
- `ADMIN_PAGE_PASSWORD` (optional, default `workshop-admin`): second password gate shown inside `admin.html`.
- `PORT` (optional, default `3000`)

### Run

```bash
npm install
npm start
```

### Seed Dummy Participants

```bash
npm run seed:dummy
```

This creates/updates 30 dummy users with randomized per-run `+test` emails
(for example `participant001+testmbd8kq1r@gmail.com`) and writes randomized confidence/comment responses for all boxes/aspects with
timestamps distributed across the last 10 minutes.

On startup, the server bootstraps schema automatically (`users`, `responses`).

### Participant Flow

- Open `my-conversations.html`
- Enter email to create/resume a saved session
- Confidence and comment updates save continuously to Postgres

### Admin Flow

- Open `admin.html` (protected by basic auth)
- Select users to:
  - inspect individual progress (open first selected user in persisted participant page)
  - aggregate confidence distributions across selected users
- Cleanup actions are available in Admin:
  - delete selected users with `+test`
  - delete all `+test` users in bulk
  - delete selected users' responses while keeping user records

### API Endpoints

- `POST /api/session` - create/find user by email
- `GET /api/responses/:email` - fetch saved responses for email
- `POST /api/responses/:email` - upsert response for one box/aspect
- `GET /api/admin/users` - list users with response counts (admin auth)
- `GET /api/admin/user/:email` - full response snapshot for a user (admin auth)
- `POST /api/admin/aggregate` - grouped aggregate counts for selected emails (admin auth)
