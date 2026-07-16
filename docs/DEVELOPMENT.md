# SkillBridge Backend Developer Guide

This guide is for developers running, testing, or changing the SkillBridge backend locally. For a non-technical project overview, see the [main README](../README.md).

## Technology overview

SkillBridge is a standalone Node.js backend written in strict TypeScript with ECMAScript modules. It uses:

- Express for HTTP routing and middleware.
- PostgreSQL for persistent data.
- Prisma for the database client and schema workflow.
- Better Auth for email/password accounts, sessions, and JWT issuance.
- Zod for request and environment validation.
- Jest and Supertest for automated tests.

The backend is the authority for roles, account status, tutor approval, availability, booking integrity, reviews, and administrative actions.

## Prerequisites

Install these tools before starting:

- A currently supported Node.js LTS release.
- npm.
- PostgreSQL with permission to create two local databases.
- Git.

All examples assume commands are run from the repository root.

## Local setup

### Install dependencies

This repository does not commit a lockfile. Install dependencies without creating or changing a local lockfile:

```powershell
npm install --no-package-lock
```

If you already have a local `package-lock.json`, keep it uncommitted unless the repository policy is changed explicitly.

### Configure environment

Copy the example file:

```powershell
Copy-Item .env.example .env
```

On Bash-compatible shells:

```bash
cp .env.example .env
```

Replace every secret placeholder. At minimum, use a long random value for `BETTER_AUTH_SECRET` and a strong local `ADMIN_PASSWORD`.

The most important settings are:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Development PostgreSQL connection. |
| `TEST_DATABASE_URL` | Separate PostgreSQL connection used whenever `NODE_ENV=test`. |
| `BETTER_AUTH_SECRET` | Better Auth signing and security secret. |
| `BETTER_AUTH_URL` | Base URL of the local backend. |
| `FRONTEND_ORIGIN` | Exact frontend origin accepted by CORS. |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Required JWT verification claims. |
| `BOOKING_DURATION_OPTIONS` | Comma-separated allowed session lengths in minutes. |
| `ADMIN_*` | Administrator created or repaired by the seed script. |
| `*_RATE_LIMIT_*` | Windows and quotas for auth, sensitive mutations, and general API traffic. |
| `TRUST_PROXY` | Express proxy trust: `false`, `true`, or a non-negative hop count. |

`JWT_SECRET` is optional compatibility configuration. Leave it blank unless the local authentication setup specifically needs it.

### Create PostgreSQL databases

Development and tests must never share a database. Create two local databases:

```sql
CREATE DATABASE skillbridge;
CREATE DATABASE skillbridge_test;
```

The default example URLs use:

```text
postgresql://postgres:postgres@localhost:5432/skillbridge
postgresql://postgres:postgres@localhost:5432/skillbridge_test
```

Change the username, password, host, or port to match your PostgreSQL installation. Keep `skillbridge_test` isolated because the test suites delete and recreate domain data.

### Generate the Prisma client

Generate the client after installing dependencies and whenever `prisma/schema.prisma` changes:

```powershell
npm run prisma:generate
```

You can validate the schema without changing the database:

```powershell
npx prisma validate
```

### Apply schema changes locally

Use Prisma's development migration workflow:

```powershell
npm run prisma:migrate -- --name describe_your_change
```

This command compares `prisma/schema.prisma` with the development database and may create a migration directory. Review generated SQL before committing schema work. Do not point this command at the test database.

### Seed the administrator

Set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` in `.env`, then run:

```powershell
npm run seed
```

The seed is idempotent by email:

- A missing account is created through Better Auth and promoted to `ADMIN`.
- An existing non-admin account is upgraded.
- An existing administrator is left as an administrator.
- The resulting account is active and email-verified.

The seed does not intentionally print the administrator password. Never place real credentials in source control.

### Start the API

Run the development watcher:

```powershell
npm run dev
```

The default local API URL is `http://localhost:5000`.

To exercise the compiled server locally:

```powershell
npm run build
npm start
```

## Available npm scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the TypeScript development watcher. |
| `npm run build` | Compile the production TypeScript build into `dist/`. |
| `npm start` | Run the compiled server from `dist/server.js`. |
| `npm run lint` | Run ESLint across the repository. |
| `npm run typecheck` | Type-check without emitting files. |
| `npm test` | Run all Jest suites serially. |
| `npm run test:watch` | Run serial Jest in watch mode. |
| `npm run test:coverage` | Run the complete suite and generate coverage output. |
| `npm run prisma:generate` | Generate Prisma Client. |
| `npm run prisma:migrate -- --name <name>` | Apply the local development migration workflow. |
| `npm run seed` | Create or repair the configured administrator. |

## API organization

Business endpoints use JSON responses with request identifiers. Better Auth owns its own response formats under its route prefix.

### Health and readiness

- `GET /health` reports that the HTTP process is running.
- `GET /ready` verifies that the application can query PostgreSQL.

These endpoints are unversioned and are not consumed by the general business rate limit.

### Better Auth

Better Auth is mounted under:

```text
/api/auth/*
```

Common flows include email registration, email sign-in, session handling, token retrieval, and key discovery. Public registration permits only `STUDENT` and `TUTOR`; there is no public administrator registration path.

### Versioned business API

Business routes are mounted under `/api/v1`.

| Group | Main paths | Access |
|---|---|---|
| Current user | `/api/v1/me` | Authenticated account; banned users may read their current status. |
| Categories | `/api/v1/categories` | Public active-category listing; administration is under `/api/v1/admin/categories`. |
| Tutor directory | `/api/v1/tutors`, `/api/v1/tutors/:tutorId`, slots and reviews | Public for approved active tutors. |
| Tutor management | `/api/v1/tutor/*` | Active tutor profile and availability management. |
| Bookings | `/api/v1/bookings` and booking actions | Role- and ownership-scoped. |
| Administration | `/api/v1/admin/*` | Active administrators only. |

The route files under `src/modules/` are the source of truth for exact methods and paths.

## Authentication and account status

Protected business requests use a Better Auth-issued JWT:

```http
Authorization: Bearer <token>
```

JWT verification checks the configured issuer, audience, signature, and expiration. After verification, the backend loads the current user from PostgreSQL rather than trusting stale role or status claims.

When an account is banned:

- Authentication may still succeed.
- `GET /api/v1/me` may return the current account and `BANNED` status.
- Other protected business operations return `403 USER_BANNED`.
- Restoring the account to `ACTIVE` re-enables access without recreating it.

## Domain conventions

### Tutor approval

New tutors are not public by default. A tutor completes a profile with at least one active category, then an administrator may approve or reject it. Only approved tutors belonging to active users appear in the public directory or accept bookings.

### Weekly availability and UTC

Availability is recurring and stored as weekday intervals in UTC:

```text
0 = Sunday
1 = Monday
...
6 = Saturday
```

`startMinuteUtc` is between `0` and `1439`; `endMinuteUtc` is between `1` and `1440`. An interval must start before it ends, cannot cross UTC midnight, and cannot overlap another interval for the same tutor and weekday.

The public slots endpoint expands recurring availability into concrete future start times, excludes past and conflicting times, and ensures the requested duration fits completely.

### Bookings and price snapshots

Students create bookings with an approved tutor, an assigned active category, a timezone-aware start time, and a duration listed in `BOOKING_DURATION_OPTIONS`.

The backend calculates:

- The end time.
- The tutor's hourly-rate snapshot.
- The quoted session price.
- The currency snapshot.

New bookings become `CONFIRMED`. Supported booking states are `CONFIRMED`, `COMPLETED`, and `CANCELLED`. Confirmed bookings for the same tutor cannot overlap, including under concurrent requests.

Students and assigned tutors may cancel eligible sessions only before the start time. Assigned tutors may complete a confirmed session only at or after its end. Administrators can perform audited status corrections while preserving booking integrity.

Price fields describe the agreed session quote; they are not payment records.

### Reviews

A student may create one review for a completed booking they own. Ratings are integers from 1 through 5 and comments are required. Reviews cannot be edited or deleted through the API in this release.

Tutor averages and review totals are calculated from persisted reviews and update as reviews are created.

## Security and rate limiting

The Express middleware stack assigns request IDs, applies security headers, restricts CORS to `FRONTEND_ORIGIN`, writes structured redacted logs, mounts Better Auth before JSON parsing, and applies rate limiting before business routes.

Three configurable rate-limit policies exist:

- Auth limits for sign-up, sign-in, and token retrieval.
- Sensitive limits for booking creation, review creation, and administrator mutations.
- General limits for other `/api/v1` traffic.

The default local windows are 15 minutes. Auth endpoints default to 10 requests per window, sensitive mutations to 20, and general business traffic to 100. Test runs use higher defaults unless a test explicitly overrides them.

For direct local development, keep:

```dotenv
TRUST_PROXY=false
```

Only change proxy trust when you understand the local network path. Incorrect trust can cause clients to share a quota or allow forwarded-address spoofing.

Request logs omit raw query strings and redact common credential keys and credential-shaped message content. User-generated profile, booking, moderation, and review text is treated as plain text.

## Testing

### Test database safety

Tests use `TEST_DATABASE_URL` when `NODE_ENV=test`. The database must not contain development or production data.

The suite is configured with `--runInBand`. All repository worktrees still share the same test database, so **never run Jest concurrently** from multiple worktrees or terminal processes. Concurrent cleanup can produce misleading foreign-key, setup, or connection-pool failures.

### Focused tests

Run one test file:

```powershell
npm test -- tests/hardening.test.ts
```

Replace the path with the relevant suite. Keep focused runs serial.

### Full suite

Run every suite:

```powershell
npm test
```

From the main checkout while a linked worktree exists, ignore worktree copies:

```powershell
npm test -- --testPathIgnorePatterns=.worktrees
```

### Coverage

Run the complete coverage suite:

```powershell
npm run test:coverage
```

Coverage is supporting evidence, not a substitute for the required authorization, concurrency, boundary, and conflict scenarios.

## Repository structure

```text
src/
  app.ts                 Express middleware and route composition
  server.ts              HTTP startup and graceful shutdown
  auth/                  Better Auth configuration
  config/                Environment and Prisma configuration
  middleware/            Request ID, auth, errors, and rate limiting
  modules/               Users, categories, tutors, availability,
                         bookings, reviews, and administration
  shared/                Reusable errors, logging, pagination, and utilities
prisma/
  schema.prisma          PostgreSQL data model
  seed.ts                Environment-driven administrator seed
tests/                   Jest and Supertest suites
docs/                    Developer and internal design documentation
```

Routes translate HTTP requests, controllers parse input and shape responses, services enforce business rules, and repositories own database access. Booking and review mutations use transactions where integrity requires them.

## Local troubleshooting

### Environment validation fails

- Confirm `.env` exists in the repository root.
- Compare its keys with `.env.example`.
- Check that both database values are valid PostgreSQL URLs.
- Ensure rate-limit values are positive integers.
- Use `false`, `true`, or a non-negative integer for `TRUST_PROXY`.

### Prisma Client is missing or stale

Run:

```powershell
npm run prisma:generate
```

Restart the TypeScript watcher after generation.

### PostgreSQL is unavailable

- Confirm the PostgreSQL service is running.
- Verify the host, port, username, password, and database name.
- Check `/ready`; it returns an unavailable response when the database query fails.
- Confirm the development and test URLs point to different databases.

### The schema and local database differ

Review `prisma/schema.prisma`, then run a named local migration:

```powershell
npm run prisma:migrate -- --name reconcile_local_schema
```

Review generated changes before committing them.

### The administrator seed fails

- Validate `ADMIN_EMAIL`.
- Ensure `ADMIN_PASSWORD` has at least eight characters.
- Confirm the development database is reachable.
- Run `npm run prisma:generate` before retrying.

### The API port is already in use

Change `PORT` in `.env` or stop the other local process using the configured port.

### Tests fail during cleanup or setup

- Confirm no other Jest process is running.
- Stop test runs in other worktrees.
- Verify `TEST_DATABASE_URL` points to the intended isolated database.
- Rerun the affected suite alone before changing application code.
