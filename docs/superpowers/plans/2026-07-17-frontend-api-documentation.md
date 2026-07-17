# Frontend API Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `docs/API_DOCUMENTATION.md` as a complete, frontend-oriented contract for every SkillBridge HTTP endpoint.

**Architecture:** Build one Markdown handbook from the implementation outward: first establish shared transport and authentication conventions, then document each route group from its route/schema/controller/service/repository chain, and finally add cross-endpoint workflows and verify inventory completeness. Application code remains unchanged.

**Tech Stack:** Markdown, Express 4, Better Auth, Zod, Prisma, TypeScript, Jest/Supertest

## Global Constraints

- Document every exposed endpoint, including `/health`, `/ready`, `/api/auth/*`, and every `/api/v1` route.
- Treat running implementation as authoritative and label consumer-relevant inconsistencies.
- Use fictional examples and never copy secrets, credentials, tokens, or raw `.env` values.
- Distinguish optional fields from nullable fields and state exact enums, time formats, status preconditions, pagination behavior, and authentication requirements.
- Do not modify application code or generated files.
- Do not describe unsupported payments, messaging, video calls, recurring bookings, calendar synchronization, or deployment behavior as implemented.

---

### Task 1: Establish the shared frontend contract and endpoint inventory

**Files:**
- Create: `docs/API_DOCUMENTATION.md`
- Read: `src/app.ts`
- Read: `src/server.ts`
- Read: `src/config/env.ts`
- Read: `src/auth/auth.ts`
- Read: `src/middleware/auth.middleware.ts`
- Read: `src/middleware/error.middleware.ts`
- Read: `src/middleware/rate-limiter.ts`
- Read: `src/middleware/request-id.ts`
- Read: `src/shared/errors/app-error.ts`

**Interfaces:**
- Consumes: Express mount paths, Better Auth configuration, environment-derived limits, authentication middleware, and shared response/error behavior.
- Produces: The handbook introduction, shared conventions, reusable transport types, authentication guidance, and a route inventory checklist used by Tasks 2–4.

- [ ] **Step 1: Extract all mounted paths and shared middleware behavior**

Run:

```powershell
rg -n "app\.(all|get|use)|router\.(get|post|put|patch|delete)" src/app.ts src/modules -g '*.routes.ts' -g '*.ts'
```

Expected: output includes two system routes, the Better Auth catch-all, seven `/api/v1` router mounts, and every module route declaration.

- [ ] **Step 2: Write the handbook foundation**

Create `docs/API_DOCUMENTATION.md` with sections for base URLs, prefixes, JSON and CORS behavior, cookies and Bearer tokens, request IDs, response/error envelopes, rate limits, timestamps, UTC rules, money, pagination, shared enums, reusable TypeScript helpers, and a complete endpoint summary table.

- [ ] **Step 3: Check shared claims against middleware and configuration**

Run:

```powershell
rg -n "credentials|Authorization|Bearer|requestId|VALIDATION_ERROR|RATE_LIMIT|windowMs|max|success" src/auth src/config src/middleware src/shared src/app.ts
```

Expected: every shared convention in the guide has a corresponding implementation reference; values controlled by environment configuration are described as configurable rather than hard-coded.

### Task 2: Document public, authentication, account, category, and tutor APIs

**Files:**
- Modify: `docs/API_DOCUMENTATION.md`
- Read: `src/auth/auth.ts`
- Read: `src/modules/users/*`
- Read: `src/modules/categories/*`
- Read: `src/modules/tutors/*`
- Read: `tests/auth.test.ts`
- Read: `tests/category.test.ts`
- Read: `tests/tutor-profile.test.ts`
- Read: `tests/tutor-search.test.ts`
- Read: `tests/slots.test.ts`

**Interfaces:**
- Consumes: Shared conventions and inventory from Task 1.
- Produces: Complete contracts for system health, Better Auth, current-user, category, public tutor/slot, tutor-profile, and tutor-moderation endpoints.

- [ ] **Step 1: Trace request validation and response projections**

Run:

```powershell
rg -n "safeParse|parse\(|res\.status|res\.json|select:|include:|orderBy|throw new" src/modules/users src/modules/categories src/modules/tutors tests/auth.test.ts tests/category.test.ts tests/tutor-profile.test.ts tests/tutor-search.test.ts tests/slots.test.ts
```

Expected: output identifies accepted fields, status codes, returned projections, filters, sorting, pagination, and tested failures for each endpoint in scope.

- [ ] **Step 2: Write every endpoint contract in scope**

For each endpoint, add purpose, access level, headers, path/query/body field tables, exact validation and defaults, successful status and JSON example, known error statuses/codes, and a frontend request example where authentication or query construction is non-obvious.

- [ ] **Step 3: Reconcile Better Auth contracts**

Compare configured Better Auth email/password and JWT endpoints with the installed Better Auth package route definitions and `tests/auth.test.ts`. Document only enabled and reachable routes, including registration-specific `role`, optional `phone`, default role, disallowed admin registration, session cookies, sign-out, session lookup, and token retrieval.

### Task 3: Document availability, booking, review, and administration APIs

**Files:**
- Modify: `docs/API_DOCUMENTATION.md`
- Read: `src/modules/availability/*`
- Read: `src/modules/bookings/*`
- Read: `src/modules/reviews/*`
- Read: `src/modules/admin/*`
- Read: `prisma/schema.prisma`
- Read: `tests/availability.test.ts`
- Read: `tests/booking.test.ts`
- Read: `tests/booking.service.test.ts`
- Read: `tests/review.test.ts`
- Read: `tests/admin.test.ts`
- Read: `tests/hardening.test.ts`

**Interfaces:**
- Consumes: Shared conventions and inventory from Task 1.
- Produces: Complete contracts for tutor availability, bookings and transitions, reviews, user moderation, booking administration, and dashboard statistics.

- [ ] **Step 1: Trace lifecycle rules and data shapes**

Run:

```powershell
rg -n "safeParse|parse\(|res\.status|res\.json|select:|include:|throw new|status:|duration|price|overlap|review" src/modules/availability src/modules/bookings src/modules/reviews src/modules/admin tests/availability.test.ts tests/booking.test.ts tests/booking.service.test.ts tests/review.test.ts tests/admin.test.ts tests/hardening.test.ts
```

Expected: output establishes availability replacement rules, booking validation/conflicts/visibility/transitions, immutable review eligibility, admin filters/actions, and exact response projections.

- [ ] **Step 2: Write every endpoint contract in scope**

Add full request/response/error documentation and examples. Explicitly document role ownership, active-account checks, booking state preconditions, price snapshots, allowed duration configuration, overlap conflicts, review uniqueness, and admin pagination/filtering semantics.

- [ ] **Step 3: Add workflow guidance and TypeScript models**

Add concise integration flows for session establishment, tutor onboarding/approval, tutor discovery and slot selection, booking creation/cancellation/completion, review submission, and account moderation. Add reusable TypeScript interfaces/unions whose field names and nullability match the documented responses.

### Task 4: Verify completeness, consistency, and safety

**Files:**
- Modify: `docs/API_DOCUMENTATION.md`
- Verify: `src/app.ts`
- Verify: `src/modules/**/*.routes.ts`
- Verify: `src/modules/**/*.schemas.ts`
- Verify: `src/modules/**/*.controller.ts`
- Verify: `tests/*.test.ts`

**Interfaces:**
- Consumes: The complete handbook from Tasks 1–3.
- Produces: A source-checked document with no missing routes, placeholders, secrets, or inconsistent field names.

- [ ] **Step 1: Compare source routes with documented methods and paths**

Run:

```powershell
rg -o "router\.(get|post|put|patch|delete)\([^\r\n]+" src/modules -g '*.routes.ts'
rg -n "GET |POST |PUT |PATCH |DELETE " docs/API_DOCUMENTATION.md
```

Expected: every route declaration maps to one detailed endpoint heading or endpoint table entry, with no documented custom route absent from source.

- [ ] **Step 2: Scan for incomplete or unsafe content**

Run:

```powershell
rg -n "TBD|TODO|implement later|fill in|password\s*[:=]\s*[^<{]" docs/API_DOCUMENTATION.md
```

Expected: no matches.

- [ ] **Step 3: Validate documentation formatting**

Run:

```powershell
git diff --check -- docs/API_DOCUMENTATION.md
```

Expected: exit code 0 with no output.

- [ ] **Step 4: Review the final diff**

Run:

```powershell
git diff -- docs/API_DOCUMENTATION.md
git status --short
```

Expected: the API handbook is the only implementation artifact introduced by this plan; pre-existing unrelated worktree changes remain untouched.
