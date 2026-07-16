# Task 13 Hardening, Rate Limiting, and Security Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable abuse protection and verify that SkillBridge responses and structured logs do not expose credentials.

**Architecture:** Use `express-rate-limit` to create independent auth, sensitive-mutation, and general API policies from validated environment settings. Mount method-aware policies in `app.ts`, preserve Better Auth middleware ordering, and centralize safe rate-limit responses and recursive log redaction.

**Tech Stack:** Node.js, Express 4, TypeScript, Zod, express-rate-limit, Helmet, Jest, Supertest

## Global Constraints

- Preserve the existing Better Auth handler before JSON parsing.
- Use environment-configurable positive integer windows and limits with defaults of 15 minutes, 10 auth requests, 20 sensitive mutation requests, and 100 general requests.
- Keep `/health` and `/ready` outside business API rate limiting.
- Return `429` with code `RATE_LIMITED` and the current request ID.
- Enable standard rate-limit headers and disable legacy headers.
- Do not log bodies, raw query strings, cookies, authorization headers, tokens, passwords, or secrets.
- Do not create or commit `package-lock.json`.
- Run Jest serially and never concurrently with another Jest process.

---

### Task 1: Validated Hardening Configuration

**Files:**
- Modify: `src/config/env.ts`
- Test: `tests/hardening.test.ts`

**Interfaces:**
- Consumes: `process.env`
- Produces: `env.AUTH_RATE_LIMIT_WINDOW_MS`, `env.AUTH_RATE_LIMIT_MAX`, `env.SENSITIVE_RATE_LIMIT_WINDOW_MS`, `env.SENSITIVE_RATE_LIMIT_MAX`, `env.GENERAL_RATE_LIMIT_WINDOW_MS`, `env.GENERAL_RATE_LIMIT_MAX`, and `env.TRUST_PROXY`

- [ ] **Step 1: Write failing configuration tests**

Add isolated module-loading tests that set valid small values and assert the parsed output. Add child-process or isolated-import coverage proving zero, negative, and non-integer values fail validation. Assert `TRUST_PROXY` parses `false`, `true`, and a non-negative hop count.

```ts
expect(env.AUTH_RATE_LIMIT_WINDOW_MS).toBe(1_000);
expect(env.AUTH_RATE_LIMIT_MAX).toBe(2);
expect(env.TRUST_PROXY).toBe(1);
```

- [ ] **Step 2: Run the configuration tests and witness RED**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: FAIL because the hardening environment properties do not exist.

- [ ] **Step 3: Add strict parsers and defaults**

Add reusable Zod preprocessing for positive integers and trust-proxy values:

```ts
const positiveInteger = (defaultValue: number) =>
  z.preprocess(
    (value) => value === undefined ? defaultValue : Number(value),
    z.number().int().positive()
  );

const trustProxySchema = z.preprocess((value) => {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return Number(value);
}, z.union([z.boolean(), z.number().int().nonnegative()]));
```

Add the seven settings to `envSchema` with the approved defaults.

- [ ] **Step 4: Rerun hardening tests and witness GREEN**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: configuration tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/config/env.ts tests/hardening.test.ts
git commit -m "test: define configurable hardening policy"
```

### Task 2: Rate-Limiter Middleware and API Integration

**Files:**
- Create: `src/middleware/rate-limiter.ts`
- Modify: `src/app.ts`
- Modify: `package.json`
- Test: `tests/hardening.test.ts`

**Interfaces:**
- Consumes: validated `env` hardening settings and Express request IDs
- Produces: `authRateLimiter`, `sensitiveRateLimiter`, `generalRateLimiter`, and method-aware skip helpers

- [ ] **Step 1: Write failing HTTP tests**

Add Supertest coverage using the configured small quotas:

```ts
expect(blocked.status).toBe(429);
expect(blocked.body).toMatchObject({
  success: false,
  error: {
    code: 'RATE_LIMITED',
    message: 'Too many requests. Please try again later.',
  },
  requestId: expect.stringMatching(/^req_[a-f0-9]+$/),
});
expect(blocked.headers).toHaveProperty('ratelimit-policy');
expect(blocked.headers).not.toHaveProperty('x-ratelimit-limit');
```

Cover auth sign-in or token retrieval, general `/api/v1` traffic, booking creation, review creation, and an admin mutation. Verify `/health` remains available after exhausting general API traffic.

- [ ] **Step 2: Run hardening tests and witness RED**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: FAIL because requests never return `429`.

- [ ] **Step 3: Install the rate-limit dependency without a lockfile**

Run:

```powershell
npm install express-rate-limit@^8.5.2 --no-package-lock
```

Confirm `package-lock.json` does not exist.

- [ ] **Step 4: Implement focused limiter instances**

Create a shared factory in `src/middleware/rate-limiter.ts`:

```ts
const createLimiter = (
  identifier: string,
  windowMs: number,
  limit: number,
  skip?: (req: Request) => boolean
) => rateLimit({
  identifier,
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please try again later.',
      },
      requestId: req.requestId,
    });
  },
});
```

Use method-aware path predicates so sensitive business mutations skip the general limiter and are counted once by the sensitive limiter. Auth limiting covers only:

```text
POST /api/auth/sign-up/email
POST /api/auth/sign-in/email
GET  /api/auth/token
```

Sensitive limiting covers:

```text
POST  /api/v1/bookings
POST  /api/v1/bookings/:bookingId/review
POST  /api/v1/admin/*
PUT   /api/v1/admin/*
PATCH /api/v1/admin/*
DELETE /api/v1/admin/*
```

- [ ] **Step 5: Mount middleware in safe order**

In `src/app.ts`, call:

```ts
app.set('trust proxy', env.TRUST_PROXY);
```

Mount the auth limiter immediately before Better Auth. Mount the general and sensitive limiters after `express.json()` and before `/api/v1` routes.

- [ ] **Step 6: Run hardening tests and witness GREEN**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: all rate-limit and Helmet tests PASS.

- [ ] **Step 7: Run focused endpoint regressions**

Run sequentially:

```powershell
npm test -- tests/auth.test.ts
npm test -- tests/booking.test.ts
npm test -- tests/review.test.ts
npm test -- tests/admin.test.ts
npm test -- tests/health.test.ts
```

Expected: every focused suite PASS.

- [ ] **Step 8: Commit**

```powershell
git add package.json src/app.ts src/middleware/rate-limiter.ts tests/hardening.test.ts
git commit -m "feat: add configurable API rate limiting"
```

### Task 3: Structured Logging Redaction

**Files:**
- Modify: `src/shared/logging/logger.ts`
- Modify: `src/app.ts`
- Test: `tests/hardening.test.ts`

**Interfaces:**
- Consumes: logger messages, nested context values, error objects, and safe request metadata
- Produces: structured JSON logs where sensitive values are replaced with `[REDACTED]`

- [ ] **Step 1: Write failing logger-capture tests**

Enable logging for the test, spy on `console.log` and `console.error`, and emit nested credential-bearing context:

```ts
logger.info('credential audit', {
  password: 'plain-password',
  nested: {
    accessToken: 'access-token-value',
    Authorization: 'Bearer bearer-value',
    cookie: 'session=session-value',
    apiKey: 'api-key-value',
  },
});
```

Log a custom error carrying sensitive enumerable properties. Assert none of the known secret strings appears in captured output and each sensitive property is `[REDACTED]`.

Send a request such as `/api/v1/categories?token=query-secret` and assert the request log contains the pathname but not the raw query or secret.

- [ ] **Step 2: Run logger tests and witness RED**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: FAIL because custom error properties are discarded rather than safely represented, session aliases are not redacted, or request logs include `originalUrl`.

- [ ] **Step 3: Strengthen recursive redaction**

Replace broad `any` use with `unknown`-aware helpers. Match normalized sensitive key fragments including:

```ts
const SENSITIVE_KEY_PARTS = [
  'password',
  'token',
  'authorization',
  'cookie',
  'session',
  'secret',
  'jwt',
  'apikey',
];
```

Serialize errors as `name`, `message`, and `stack`, then copy enumerable custom properties through the same recursive redactor. Preserve circular detection.

- [ ] **Step 4: Remove raw query strings from request logs**

Change request logging to use `req.path` instead of `req.originalUrl`:

```ts
logger.info(`${req.method} ${req.path} ${res.statusCode} - ${latency}ms`, {
  method: req.method,
  path: req.path,
  status: res.statusCode,
  latencyMs: latency,
  requestId: req.requestId,
  ...(req.user?.id ? { actorId: req.user.id } : {}),
});
```

- [ ] **Step 5: Rerun hardening tests and witness GREEN**

Run:

```powershell
npm test -- tests/hardening.test.ts
```

Expected: all logging and rate-limit tests PASS with no known credential value in captured output.

- [ ] **Step 6: Commit**

```powershell
git add src/app.ts src/shared/logging/logger.ts tests/hardening.test.ts
git commit -m "fix: redact credentials from structured logs"
```

### Task 4: Review and Verification

**Files:**
- Modify if needed: files changed by Tasks 1-3
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: completed Task 13 implementation
- Produces: reviewed, verified Task 13 branch and updated progress ledger

- [ ] **Step 1: Run all focused regressions serially**

Run:

```powershell
npm test -- tests/hardening.test.ts tests/auth.test.ts tests/booking.test.ts tests/review.test.ts tests/admin.test.ts tests/health.test.ts
```

Expected: all selected suites PASS.

- [ ] **Step 2: Run static verification**

Run:

```powershell
npm run lint
npm run typecheck
npm run build
git diff --check
```

Expected: zero errors; only documented pre-existing lint warnings are acceptable.

- [ ] **Step 3: Request independent code review**

Provide the reviewer the task brief, approved design, implementation plan, commit range, and verification evidence. Do not run Jest concurrently with the reviewer.

- [ ] **Step 4: Address review findings test-first**

For every Important or Critical behavioral issue, add or amend a failing test, witness RED, implement the minimal correction, and rerun the relevant focused suite.

- [ ] **Step 5: Run the full suite in a hidden serial process**

Run:

```powershell
npm test
```

Poll about every 55 seconds. Expected: 13 suites, all tests PASS.

- [ ] **Step 6: Update the progress ledger**

Update the ignored shared ledger at the repository root, `E:\Codes\Skill-Bridge-backend\.superpowers\sdd\progress.md`, marking Task 13 complete with its commit range and clean review result. Do not force-add the ignored ledger.

- [ ] **Step 7: Verify final branch state**

```powershell
git status --short --branch
git log --oneline --decorate -5
```

- Expected: only intentional tracked Task 13 changes are committed; no `package-lock.json` exists in the worktree.

- [ ] **Step 8: Offer integration choices**

Use `superpowers:finishing-a-development-branch` and offer merge, PR, keep, or discard options. Do not remove the worktree until the user chooses.
