# Task 14 Documentation and Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish accurate visitor and developer documentation, provide a complete safe environment template, and verify the finished SkillBridge backend.

**Architecture:** Keep audience concerns separate: `README.md` explains the product in plain language, `docs/DEVELOPMENT.md` is the local engineering guide, and `.env.example` mirrors the runtime schema. Validate the documents against source-controlled scripts, routes, and environment keys before running the full repository verification sequence.

**Tech Stack:** Markdown, dotenv, Node.js, Express, TypeScript, PostgreSQL, Prisma, Better Auth, Jest, Supertest

## Global Constraints

- Do not add deployment documentation, hosting-provider configuration, Docker/CI files, production rollout steps, backup procedures, or deployment-only migrations.
- Preserve the untracked root files `docs/superpowers/plans/2026-07-15-skillbridge-backend.md` and `package-lock.json`.
- Do not create or commit a worktree `package-lock.json`.
- Describe implemented behavior only.
- Keep `README.md` non-technical and visitor-focused.
- Keep all local setup, environment, database, seed, scripts, API, testing, and troubleshooting details in `docs/DEVELOPMENT.md`.
- Ensure `.env.example` contains every variable consumed by `src/config/env.ts`, with distinct development and test database names.
- Run Jest serially and never overlap Jest processes across worktrees.

---

### Task 1: Complete Environment Template

**Files:**
- Create: `.env.example`
- Reference: `src/config/env.ts`
- Reference: `src/config/db.ts`

**Interfaces:**
- Consumes: environment keys and formats validated by `src/config/env.ts`
- Produces: a safe copyable local configuration template

- [ ] **Step 1: Run the environment-template audit and witness RED**

Run:

```powershell
@'
const fs = require('node:fs');
if (!fs.existsSync('.env.example')) {
  throw new Error('.env.example does not exist');
}
'@ | node
```

Expected: FAIL with `.env.example does not exist`.

- [ ] **Step 2: Create the complete template**

Create `.env.example` with these exact keys and safe local examples:

```dotenv
# Application
NODE_ENV=development
PORT=5000

# PostgreSQL: use different databases for development and tests
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/skillbridge
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/skillbridge_test

# Better Auth and JWT
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:5000
FRONTEND_ORIGIN=http://localhost:3000
JWT_ISSUER=http://localhost:5000
JWT_AUDIENCE=http://localhost:5000
# Optional compatibility secret; leave blank unless the local auth setup requires it
JWT_SECRET=

# Business configuration
DEFAULT_CURRENCY=USD
BOOKING_DURATION_OPTIONS=30,60,90,120

# Seeded administrator
ADMIN_NAME=SkillBridge Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password

# Rate limits
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=10
SENSITIVE_RATE_LIMIT_WINDOW_MS=900000
SENSITIVE_RATE_LIMIT_MAX=20
GENERAL_RATE_LIMIT_WINDOW_MS=900000
GENERAL_RATE_LIMIT_MAX=100

# Express reverse-proxy trust: false, true, or a non-negative hop count
TRUST_PROXY=false
```

- [ ] **Step 3: Verify exact environment-key parity**

Run:

```powershell
@'
const fs = require('node:fs');
const expected = [
  'NODE_ENV', 'PORT', 'DATABASE_URL', 'TEST_DATABASE_URL',
  'BETTER_AUTH_SECRET', 'BETTER_AUTH_URL', 'FRONTEND_ORIGIN',
  'JWT_ISSUER', 'JWT_AUDIENCE', 'JWT_SECRET', 'DEFAULT_CURRENCY',
  'BOOKING_DURATION_OPTIONS', 'ADMIN_NAME', 'ADMIN_EMAIL',
  'ADMIN_PASSWORD', 'AUTH_RATE_LIMIT_WINDOW_MS', 'AUTH_RATE_LIMIT_MAX',
  'SENSITIVE_RATE_LIMIT_WINDOW_MS', 'SENSITIVE_RATE_LIMIT_MAX',
  'GENERAL_RATE_LIMIT_WINDOW_MS', 'GENERAL_RATE_LIMIT_MAX', 'TRUST_PROXY'
];
const text = fs.readFileSync('.env.example', 'utf8');
const actual = [...text.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]);
const missing = expected.filter((key) => !actual.includes(key));
const extra = actual.filter((key) => !expected.includes(key));
if (missing.length || extra.length) {
  throw new Error(JSON.stringify({ missing, extra }));
}
if (!text.includes('/skillbridge_test')) {
  throw new Error('TEST_DATABASE_URL must use the separate skillbridge_test database');
}
console.log(`Verified ${actual.length} environment variables`);
'@ | node
```

Expected: `Verified 22 environment variables`.

- [ ] **Step 4: Commit**

```powershell
git add .env.example
git commit -m "docs: add complete environment template"
```

### Task 2: Visitor-Focused Project README

**Files:**
- Create: `README.md`
- Reference: `BACKEND_REQUIREMENTS.md`
- Reference: route files under `src/modules/`

**Interfaces:**
- Consumes: implemented product capabilities and explicit out-of-scope decisions
- Produces: a plain-language project overview for visitors

- [ ] **Step 1: Run the visitor-document audit and witness RED**

Run:

```powershell
@'
const fs = require('node:fs');
if (!fs.existsSync('README.md')) {
  throw new Error('README.md does not exist');
}
'@ | node
```

Expected: FAIL with `README.md does not exist`.

- [ ] **Step 2: Write the visitor README**

Use this exact section structure:

```markdown
# SkillBridge Backend

## What is SkillBridge?
## Who is it for?
### Students
### Tutors
### Administrators
## How the platform works
## Core capabilities
## Safety and trust
## What is not included
## Project status
## For developers
```

Content requirements:

- Explain tutor discovery, approval, weekly availability, UTC-backed slots, confirmed bookings, cancellation/completion, immutable reviews, and administration without implementation jargon.
- Explain that banned accounts cannot use protected platform operations, while account status remains visible.
- State that the backend does not process payments and does not include messaging, video calls, meeting links, recurring bookings, or calendar-provider synchronization.
- Avoid environment variables, database setup, command lists, middleware names, schema names, and endpoint inventories.
- Link to `[Developer documentation](docs/DEVELOPMENT.md)`.

- [ ] **Step 3: Verify visitor/developer separation**

Run:

```powershell
@'
const fs = require('node:fs');
const text = fs.readFileSync('README.md', 'utf8');
const required = [
  '# SkillBridge Backend',
  '## What is SkillBridge?',
  '## Who is it for?',
  '## How the platform works',
  '## Core capabilities',
  '## Safety and trust',
  '## What is not included',
  '[Developer documentation](docs/DEVELOPMENT.md)'
];
for (const item of required) {
  if (!text.includes(item)) throw new Error(`Missing README content: ${item}`);
}
for (const forbidden of ['DATABASE_URL=', 'npm install', 'prisma migrate', '/api/v1/']) {
  if (text.includes(forbidden)) throw new Error(`Technical content leaked into README: ${forbidden}`);
}
console.log('Visitor README structure verified');
'@ | node
```

Expected: `Visitor README structure verified`.

- [ ] **Step 4: Commit**

```powershell
git add README.md
git commit -m "docs: add visitor project overview"
```

### Task 3: Local Developer Documentation

**Files:**
- Create: `docs/DEVELOPMENT.md`
- Reference: `package.json`
- Reference: `src/config/env.ts`
- Reference: `src/app.ts`
- Reference: `src/modules/**/**.routes.ts`
- Reference: `prisma/schema.prisma`
- Reference: `prisma/seed.ts`

**Interfaces:**
- Consumes: source-controlled commands, routes, configuration, and business conventions
- Produces: the authoritative local engineering guide

- [ ] **Step 1: Run the developer-document audit and witness RED**

Run:

```powershell
@'
const fs = require('node:fs');
if (!fs.existsSync('docs/DEVELOPMENT.md')) {
  throw new Error('docs/DEVELOPMENT.md does not exist');
}
'@ | node
```

Expected: FAIL with `docs/DEVELOPMENT.md does not exist`.

- [ ] **Step 2: Write the developer guide**

Use this exact section structure:

```markdown
# SkillBridge Backend Developer Guide

## Technology overview
## Prerequisites
## Local setup
### Install dependencies
### Configure environment
### Create PostgreSQL databases
### Generate the Prisma client
### Apply schema changes locally
### Seed the administrator
### Start the API
## Available npm scripts
## API organization
### Health and readiness
### Better Auth
### Versioned business API
## Authentication and account status
## Domain conventions
### Tutor approval
### Weekly availability and UTC
### Bookings and price snapshots
### Reviews
## Security and rate limiting
## Testing
### Test database safety
### Focused tests
### Full suite
### Coverage
## Repository structure
## Local troubleshooting
```

Document only commands that exist in `package.json`:

```text
npm run dev
npm run build
npm start
npm run lint
npm run typecheck
npm test
npm run test:watch
npm run test:coverage
npm run prisma:generate
npm run prisma:migrate
npm run seed
```

Use `npm install --no-package-lock` for this repository because no lockfile is committed. Explain that the user's local `package-lock.json`, if present, must not be committed unless the repository policy changes.

Document local database creation using separate `skillbridge` and `skillbridge_test` databases. Explain that `npm run prisma:migrate` is the local development workflow and may create migrations; do not describe production deployment.

Document these API groups accurately:

```text
GET /health
GET /ready
/api/auth/*
/api/v1/me
/api/v1/categories
/api/v1/tutors
/api/v1/tutor/*
/api/v1/bookings
/api/v1/admin/*
```

Explain bearer JWT use, immediate ban enforcement, Sunday-as-0 UTC availability, allowed configured durations, server-calculated price snapshots, booking statuses, one immutable review per completed owned booking, and the three rate-limit policies.

Include the shared-database warning: never run Jest concurrently from multiple worktrees or processes.

- [ ] **Step 3: Verify commands, sections, and non-deployment scope**

Run:

```powershell
@'
const fs = require('node:fs');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const text = fs.readFileSync('docs/DEVELOPMENT.md', 'utf8');
const documentedScripts = [
  'dev', 'build', 'start', 'lint', 'typecheck', 'test', 'test:watch',
  'test:coverage', 'prisma:generate', 'prisma:migrate', 'seed'
];
for (const script of documentedScripts) {
  if (!packageJson.scripts[script]) throw new Error(`Missing package script: ${script}`);
}
for (const required of [
  'skillbridge_test', 'npm install --no-package-lock', 'npm run prisma:generate',
  'npm run prisma:migrate', 'npm run seed', 'Authorization: Bearer',
  'never run Jest concurrently', '0 = Sunday'
]) {
  if (!text.includes(required)) throw new Error(`Missing developer guidance: ${required}`);
}
for (const forbidden of ['Render', 'Railway', 'Docker', 'production rollout', 'backup procedure']) {
  if (text.includes(forbidden)) throw new Error(`Deployment content is out of scope: ${forbidden}`);
}
console.log('Developer documentation verified');
'@ | node
```

Expected: `Developer documentation verified`.

- [ ] **Step 4: Commit**

```powershell
git add docs/DEVELOPMENT.md
git commit -m "docs: add local developer guide"
```

### Task 4: Repository Verification and Review

**Files:**
- Modify: documentation files if verification or review finds inaccuracies
- Modify outside Git: `E:\Codes\Skill-Bridge-backend\.superpowers\sdd\progress.md`

**Interfaces:**
- Consumes: completed documentation and existing backend
- Produces: verified Task 14 branch and completed progress ledger

- [ ] **Step 1: Verify Prisma configuration**

Run:

```powershell
npm run prisma:generate
npx prisma validate
```

Expected: Prisma Client generation and schema validation both succeed.

- [ ] **Step 2: Verify the seed path**

Run:

```powershell
npm test -- tests/seed.test.ts
```

Expected: seed suite PASS, including idempotency and password-redaction coverage.

- [ ] **Step 3: Run static verification**

Run:

```powershell
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: zero lint errors, typecheck/build success, and no whitespace errors. Existing lint warnings must be reported accurately.

- [ ] **Step 4: Verify commit-count acceptance**

Run:

```powershell
$count = git rev-list --count HEAD
if ($count -lt 15) { throw "Expected at least 15 commits, found $count" }
Write-Output "Meaningful commit count check passed: $count commits"
```

Expected: count is at least 15.

- [ ] **Step 5: Run coverage as the sole Jest process**

Run in a hidden process and poll about every 55 seconds:

```powershell
npm run test:coverage
```

Expected: all suites PASS and Jest prints the coverage summary. Record the measured statements, branches, functions, and lines percentages.

- [ ] **Step 6: Request independent documentation review**

Provide the reviewer:

- Task 14 brief.
- Approved design and implementation plan.
- Git range from the design base to the current branch.
- Verification evidence already collected.
- Explicit instruction not to run Jest while another Jest process is active.

The review must check audience separation, source accuracy, safe examples, route/script correctness, missing environment variables, unsupported claims, and deployment-content exclusion.

- [ ] **Step 7: Resolve Important or Critical review findings**

For documentation defects, first add or update an executable audit so it fails for the identified inaccuracy, then correct the document and rerun the audit. Re-run affected static or focused checks.

- [ ] **Step 8: Run the final full suite**

Run as the only hidden Jest process and poll about every 55 seconds:

```powershell
npm test
```

Expected: 13 suites and all tests PASS.

- [ ] **Step 9: Update the ignored progress ledger**

Update:

```text
E:\Codes\Skill-Bridge-backend\.superpowers\sdd\progress.md
```

Mark Task 14 complete with its commit range and clean review result. Do not force-add the ignored ledger.

- [ ] **Step 10: Verify final branch state**

Run:

```powershell
git status --short --branch
git log --oneline --decorate -6
Test-Path package-lock.json
```

Expected: worktree clean, intentional documentation committed, and no worktree `package-lock.json`.

- [ ] **Step 11: Offer integration choices**

Use `superpowers:finishing-a-development-branch` and offer merge, pull request, keep, or discard. Do not remove the worktree until the user chooses.
