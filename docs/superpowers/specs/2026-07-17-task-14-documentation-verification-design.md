# Task 14 Documentation and Verification Design

## Scope

Task 14 completes the repository's developer and visitor documentation and verifies the finished backend. It does not deploy the application or add deployment-specific configuration, provider instructions, containers, CI workflows, production rollout steps, backup procedures, or a baseline migration solely for deployment.

The task produces three public documentation artifacts:

- `README.md` for visitors and non-technical readers.
- `docs/DEVELOPMENT.md` for developers working locally.
- `.env.example` as the complete safe configuration template.

The existing untracked `docs/superpowers/plans/2026-07-15-skillbridge-backend.md` and `package-lock.json` must remain untouched and uncommitted.

## Visitor README

`README.md` explains SkillBridge in plain language. It avoids setup instructions, implementation detail, database terminology, and long endpoint listings.

It covers:

- What SkillBridge is and the problem it solves.
- Student, tutor, and administrator roles.
- Tutor discovery and approval.
- Recurring availability and bookable sessions.
- Booking, cancellation, completion, and review flows.
- Administration and account moderation.
- Security and privacy at a high level.
- Explicit product boundaries, including the absence of payments, messaging, and video-session functionality.
- A link to `docs/DEVELOPMENT.md` for technical information.

The README must describe implemented behavior only. It must not present planned, unsupported, or deployment-specific features as available.

## Developer Documentation

`docs/DEVELOPMENT.md` is the authoritative local-development guide.

It covers:

- Runtime and service prerequisites: supported Node.js LTS, npm, and PostgreSQL.
- Repository installation without relying on a committed lockfile.
- Copying `.env.example` to `.env`.
- Creating separate development and test PostgreSQL databases.
- Prisma client generation and the local `prisma migrate dev` workflow.
- Running the idempotent environment-based admin seed without exposing the password.
- Development, production-build, lint, typecheck, test, watch, and coverage commands.
- API base paths and endpoint groups, including Better Auth, health/readiness, users, categories, tutors, availability, bookings, reviews, and administration.
- Authentication expectations for business routes.
- UTC availability convention, booking duration configuration, price snapshots, booking states, immutable reviews, and ban semantics.
- Middleware/security behavior, rate-limit configuration, and safe `TRUST_PROXY` usage for local development.
- Test-database isolation and the rule that Jest must run serially.
- Common local troubleshooting for environment validation, Prisma generation, database connectivity, migration state, seed configuration, and occupied ports.

It does not include hosting-provider instructions, HTTPS termination steps, production rollout procedures, backup operations, or other deployment guidance.

## Environment Template

`.env.example` mirrors every variable consumed by `src/config/env.ts`:

- `NODE_ENV`
- `PORT`
- `DATABASE_URL`
- `TEST_DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `FRONTEND_ORIGIN`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- optional `JWT_SECRET`
- `DEFAULT_CURRENCY`
- `BOOKING_DURATION_OPTIONS`
- `ADMIN_NAME`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `AUTH_RATE_LIMIT_WINDOW_MS`
- `AUTH_RATE_LIMIT_MAX`
- `SENSITIVE_RATE_LIMIT_WINDOW_MS`
- `SENSITIVE_RATE_LIMIT_MAX`
- `GENERAL_RATE_LIMIT_WINDOW_MS`
- `GENERAL_RATE_LIMIT_MAX`
- `TRUST_PROXY`

Values use safe local examples and unmistakable secret placeholders. The development and test database URLs must target different database names. Comments explain optional variables and configuration formats without containing real credentials.

## Verification

All commands are run from an isolated Task 14 worktree after setup. Jest processes must never overlap because worktrees share the same PostgreSQL test database.

Verification includes:

- Confirming documentation mentions only existing scripts and routes.
- Comparing `.env.example` variable names against the environment schema.
- Confirming the repository contains at least 15 meaningful commits.
- `npm run prisma:generate`
- `npx prisma validate`
- `npm run lint`
- `npm run typecheck`
- `npm run build`
- focused seed verification through `tests/seed.test.ts`
- `npm run test:coverage`
- the complete serial Jest suite
- `git diff --check`

Coverage output is recorded as verification evidence. This task does not introduce arbitrary coverage thresholds that the current project has not previously defined unless the measured baseline and requirements support a non-disruptive threshold.

## Review and Completion

An independent reviewer checks:

- Audience separation between the two Markdown documents.
- Accuracy against source code, route definitions, environment validation, scripts, and tests.
- Absence of secrets and unsupported claims.
- Completeness of local setup, migration, seed, and verification instructions.
- Explicit exclusion of deployment documentation.

After review findings are resolved, the ignored progress ledger is updated to mark Task 14 complete. The finished branch is offered for local merge, pull request, retention, or discard through the repository's standard finishing workflow.
