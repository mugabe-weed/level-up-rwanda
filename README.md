# LEVELUP RWANDA

**Play. Learn. Create. Connect. Grow.**

LEVELUP RWANDA is a full-stack community growth platform built for Rwanda, bringing together daily timed challenges, structured practical learning courses, creative project showcases, moderated community groups, and verified opportunities (scholarships, internships, jobs, remote roles, grants, and volunteering) with multilingual support in **Kinyarwanda**, **English**, and **French**.

Essential access is free. No payment processing, subscriptions, or cash rewards are included in this release.

---

## Architecture Overview

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, React Hook Form, Zod, Lucide React
- **Backend**: Node.js 22, Express, TypeScript, REST APIs (`/api/v1/*`), Helmet, CORS, Rate Limiting, Multer (magic-byte verified uploads), `crypto.scrypt` password hashing, DB-backed HttpOnly session cookies, double-submit CSRF protection
- **Database**: MySQL 8 (Aiven-compatible TLS connection pooling via `mysql2/promise`), versioned reversible migrations, foreign keys, indexes, parameterized queries
- **Deployment**: Google Cloud Run (`Dockerfile`), Cloud Secret Manager compatible, `/api/v1/health` & `/api/v1/ready`

---

## 1. Installation & Local Development

### Prerequisites
- Node.js `>= 22.0.0`
- npm `>= 10.0.0`
- A MySQL 8 instance (local MySQL 8 or Aiven MySQL 8 service)

### Install Dependencies
```bash
npm install
```

### Configure Environment
Copy `.env.example` to `.env` and fill in your real MySQL 8 credentials and secrets:
```bash
cp .env.example .env
```

Generate cryptographically strong secrets for sessions, CSRF, and first-admin provisioning:
```bash
openssl rand -hex 32
```

### Run Development Server
```bash
npm run dev
```
The full-stack server mounts Vite middleware in development on port `3000` (`http://localhost:3000`).

---

## 2. Database Setup, Migrations & Seeding (MySQL 8 / Aiven)

1. Provision a MySQL 8 database named `levelup_rwanda` (or your chosen database name).
2. For Aiven MySQL 8, download the Aiven CA certificate (`ca.pem`) and supply either:
   - `MYSQL_CA_CERT_PATH="/path/to/ca.pem"`
   - OR `MYSQL_CA_CERT_BASE64` (recommended for Google Cloud Run Secret Manager)
3. Ensure `MYSQL_SSL_ENABLED="true"` and `MYSQL_SSL_REJECT_UNAUTHORIZED="true"` in production.

### Run Versioned Migrations (33 Application Tables + `schema_migrations`)
Inspect schema compatibility without modifying the database:
```bash
npm run migrate:status
npm run migrate:dry-run
```
Apply pending migrations:
```bash
npm run migrate
```
**DESTRUCTIVE Rollback (non-production / recovery only):** drops all 33 application tables and deletes all data. Requires explicit confirmation flag:
```bash
npx tsx server/db/migrate-cli.ts down --confirm-destructive-down
```

### Run Idempotent Seed Data
Seeds categories, achievement definitions, default platform settings, and clearly labeled `[Sample]` challenges, courses, groups, and verified opportunities (zero fake users or fabricated statistics):
```bash
npm run seed
```

---

## 3. Secure First-Administrator Provisioning

No insecure default administrator password is ever seeded. Provision the first `super_admin` using either:

### Option A: CLI Provisioning
```bash
npm run bootstrap-admin -- \
  --email="admin@yourdomain.rw" \
  --name="Platform Administrator" \
  --username="rw_superadmin" \
  --password="ReplaceWith12PlusCharPassword!" \
  --token="$ADMIN_BOOTSTRAP_TOKEN"
```

### Option B: One-Time Bootstrap UI / API
1. Set `ADMIN_BOOTSTRAP_TOKEN` in your server environment.
2. Visit `/auth/bootstrap-admin` (or `POST /api/v1/auth/bootstrap-admin`).
3. Once a `super_admin` exists, this endpoint permanently rejects further bootstrap calls. Remove or rotate `ADMIN_BOOTSTRAP_TOKEN` afterward.

---

## 4. Environment Variable Reference

| Variable | Description | Required |
|---|---|---|
| `NODE_ENV` | `development` or `production` | Yes |
| `PORT` | HTTP port (`3000` local, `8080` Cloud Run) | Yes |
| `APP_URL` | Public URL of the app | Yes |
| `CORS_ORIGIN` | Allowed origins (comma-separated) | Yes |
| `MYSQL_URL` | Full MySQL 8 connection URI | Option A |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | Discrete MySQL 8 connection fields | Option B |
| `MYSQL_CONNECT_TIMEOUT_MS` | Explicit MySQL connection timeout in ms (default `10000`) | Recommended |
| `MYSQL_SSL_ENABLED` | Enable TLS (`true`, mandatory in production) | Prod: Yes |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | Enforce strict TLS certificate verification (`true`, mandatory in production) | Prod: Yes |
| `MYSQL_CA_CERT_PATH` / `MYSQL_CA_CERT` / `MYSQL_CA_CERT_BASE64` | Aiven / MySQL CA PEM certificate | Prod: Yes |
| `SESSION_SECRET` | High-entropy secret (32+ chars) for session handling | Prod: Yes |
| `CSRF_SECRET` | High-entropy secret (32+ chars, distinct from `SESSION_SECRET`) | Prod: Yes |
| `ADMIN_BOOTSTRAP_TOKEN` | One-time token to provision first `super_admin` | Initial setup |
| `UPLOAD_STORAGE_DRIVER` | `local` (dev only) or `gcs` (mandatory on Cloud Run production) | Prod: `gcs` |
| `UPLOAD_DIR` | Local directory for dev uploads (`./uploads`, unused when `gcs`) | Dev only |
| `MAX_UPLOAD_BYTES` | Maximum upload bytes (default `5242880` = 5 MB) | Yes |
| `GCS_BUCKET_NAME` | Google Cloud Storage bucket for persistent uploads | Prod: Yes |
| `GCS_DELIVERY_MODE` | `proxy` (permission-checked stream) or `signed_url` (V4 signed redirect) | Prod: Optional |

---

## 5. REST API Documentation (`/api/v1`)

All endpoints return consistent JSON envelopes:
- Success: `{ "ok": true, "data": ... }`
- Error: `{ "ok": false, "error": { "code": "...", "message": "..." } }`

State-changing requests with an active browser session cookie require the `X-CSRF-Token` header matching the `levelup_csrf` cookie.

- **Health & Readiness**: `GET /api/v1/health`, `GET /api/v1/ready`
- **Authentication**: `GET /api/v1/auth/me`, `POST /api/v1/auth/register`, `POST /api/v1/auth/login`, `POST /api/v1/auth/logout`, `POST /api/v1/auth/verify-contact`, `POST /api/v1/auth/password-reset/request`, `POST /api/v1/auth/password-reset/confirm`, `POST /api/v1/auth/bootstrap-admin`
- **Dashboard**: `GET /api/v1/dashboard`
- **Play**: `GET /api/v1/challenges/categories`, `GET /api/v1/challenges`, `GET /api/v1/challenges/leaderboard?period=daily|weekly|monthly|all`, `GET /api/v1/challenges/:slug`, `POST /api/v1/challenges/:slug/submit`
- **Learn**: `GET /api/v1/courses/categories`, `GET /api/v1/courses`, `GET /api/v1/courses/:slug`, `POST /api/v1/courses/:slug/enroll`, `POST /api/v1/courses/:slug/lessons/:lessonId/complete`
- **Create & Connect**: `GET /api/v1/community/posts`, `POST /api/v1/community/posts` (`multipart/form-data`), `POST /api/v1/community/posts/:postId/react`, `GET/POST /api/v1/community/posts/:postId/comments`, `GET/POST /api/v1/community/groups`, `POST /api/v1/community/groups/:groupId/toggle-join`, `POST /api/v1/community/users/:userId/follow`, `POST/DELETE /api/v1/community/users/:userId/block`, `POST /api/v1/community/reports`
- **Opportunities**: `GET /api/v1/opportunities/categories`, `GET /api/v1/opportunities`, `POST /api/v1/opportunities`, `POST /api/v1/opportunities/:id/save`
- **Profiles & Notifications**: `GET /api/v1/profile/:username`, `PUT /api/v1/profile/me`, `POST /api/v1/profile/me/avatar`, `PATCH /api/v1/profile/me/language`, `GET /api/v1/notifications`, `POST /api/v1/notifications/:id/read`, `POST /api/v1/notifications/read-all`, `GET/PUT /api/v1/notifications/preferences`
- **Administration** (RBAC-protected): `/api/v1/admin/overview`, `/api/v1/admin/users`, `/api/v1/admin/challenges`, `/api/v1/admin/challenges/questions`, `/api/v1/admin/courses`, `/api/v1/admin/moderation`, `/api/v1/admin/opportunities`, `/api/v1/admin/organizations`, `/api/v1/admin/announcements`, `/api/v1/admin/audit-logs`, `/api/v1/admin/settings`

---

## 6. Testing & Verification

Run TypeScript type-checking, automated unit/API tests, and production build:
```bash
npm run lint
npm test
npm run build
```
When `MYSQL_URL` or `MYSQL_HOST` credentials are supplied in the environment, `npm test` also runs the live MySQL 8 migration & seed integration test suite.

---

## 7. Google Cloud Run Deployment

1. Store secrets in **Google Cloud Secret Manager**:
   - `MYSQL_URL` (or discrete `MYSQL_HOST`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`)
   - `MYSQL_CA_CERT_BASE64` (base64 of Aiven CA PEM: `base64 -w 0 ca.pem`)
   - `SESSION_SECRET`
   - `CSRF_SECRET`
2. Build and deploy container using `Dockerfile`:
```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/levelup-rwanda
gcloud run deploy levelup-rwanda \
  --image gcr.io/YOUR_PROJECT_ID/levelup-rwanda \
  --platform managed \
  --region europe-west1 \
  --port 8080 \
  --allow-unauthenticated \
   --set-env-vars="NODE_ENV=production,UPLOAD_STORAGE_DRIVER=gcs,GCS_BUCKET_NAME=YOUR_MEDIA_BUCKET,MYSQL_SSL_ENABLED=true,MYSQL_SSL_REJECT_UNAUTHORIZED=true" \
   --set-secrets="MYSQL_URL=levelup-mysql-url:latest,MYSQL_CA_CERT_BASE64=levelup-mysql-ca:latest,SESSION_SECRET=levelup-session-secret:latest,CSRF_SECRET=levelup-csrf-secret:latest"
```
3. Run pre-flight schema inspection, migrations, seed data, and first-admin provisioning via the bundled production Node CLIs (no `tsx` devDependency required):
```bash
node dist-server/migrate-cli.js status
node dist-server/migrate-cli.js dry-run
node dist-server/migrate-cli.js up
node dist-server/seed-cli.js
node dist-server/bootstrap-admin-cli.js --email="..." --name="..." --username="..." --password="..." --token="..."
```

---

## 8. Backup & Recovery

- **Automated Backups**: Enable Aiven MySQL 8 automated daily snapshots and point-in-time recovery (PITR).
- **Logical Backups**:
```bash
mysqldump --host="$MYSQL_HOST" --port="$MYSQL_PORT" --user="$MYSQL_USER" --password \
  --ssl-mode=VERIFY_CA --ssl-ca=/path/to/ca.pem \
  --single-transaction --routines --triggers "$MYSQL_DATABASE" > levelup_backup_$(date +%F).sql
```
- **Recovery Test**: Restore snapshots into an isolated staging database before running `npm run migrate` against production.
