# Task 13 Hardening, Rate Limiting, and Security Audit Design

## Scope

Task 13 adds abuse protection and verifies existing HTTP and logging security behavior. It covers configurable rate limiting, safe reverse-proxy handling, security-header tests, and credential redaction. Deployment documentation and the broader release audit remain Task 14.

## Rate-Limit Architecture

Use `express-rate-limit` with separate limiter instances for distinct traffic policies:

- Auth: sign-up, sign-in, and token retrieval.
- Sensitive mutations: booking creation, review creation, and admin mutations.
- General API: remaining `/api/v1` business traffic.

Health and readiness endpoints remain outside the general limiter. Sensitive routes must not be counted against both the sensitive and general policies.

Each limiter uses the request IP resolved by Express. The application configures `trust proxy` explicitly before mounting limiters so forwarded client addresses are honored only when deployment configuration permits it. The initial implementation uses the library's in-memory store, which is appropriate for the current single-process deployment scope. A horizontally scaled deployment must replace it with a shared store.

Blocked requests return HTTP `429` with the existing API envelope:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again later."
  },
  "requestId": "req_example"
}
```

Enable current standard rate-limit response headers and disable legacy `X-RateLimit-*` headers.

## Configuration

Add validated environment settings with development/test-safe defaults:

```env
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_RATE_LIMIT_MAX=10
SENSITIVE_RATE_LIMIT_WINDOW_MS=900000
SENSITIVE_RATE_LIMIT_MAX=20
GENERAL_RATE_LIMIT_WINDOW_MS=900000
GENERAL_RATE_LIMIT_MAX=100
TRUST_PROXY=false
```

All window and maximum values must parse as positive integers. Invalid values fail application startup through the existing environment validation path.

`TRUST_PROXY` accepts `false`, `true`, or a non-negative integer hop count. Production deployment must set it to match the actual reverse-proxy topology; it must not be enabled indiscriminately.

## Middleware Placement

Preserve the required application order:

1. Request ID.
2. Helmet security headers.
3. CORS.
4. Structured request logging.
5. Strict auth rate limiting for selected Better Auth endpoints.
6. Better Auth handler.
7. JSON parsing.
8. General and sensitive business-route limiting.
9. Business routes.
10. Not-found handling.
11. Central error handling.

The auth limiter must run before Better Auth because its routes are mounted before JSON parsing. Business limiters run after JSON parsing. Route matching is method-aware so only the required mutations receive the sensitive policy.

## Logging Redaction

Request logs remain metadata-only. They may include method, normalized path, response status, latency, request ID, and a safe actor ID when available. They must not include raw query strings, request bodies, cookies, authorization headers, or token values.

Strengthen the shared logger's recursive redaction for sensitive keys at any nesting depth. Matching is case-insensitive and covers at least:

- password and password variants
- token, access token, refresh token, and JWT values
- authorization headers
- cookies and session values
- secrets
- API keys

Errors are converted to safe structured fields before logging. Credential-bearing custom properties must pass through the same redaction. Circular structures remain safely representable.

## Testing

Create `tests/hardening.test.ts`. Tests use deliberately small limits through test configuration or isolated limiter construction so they remain fast and deterministic.

Coverage includes:

- Helmet headers are present on normal and rate-limited responses.
- Auth endpoints return `429 RATE_LIMITED` after the configured quota.
- Booking creation and review creation use the sensitive mutation policy.
- Admin mutations use the sensitive mutation policy.
- Ordinary business traffic uses the general policy.
- Health and readiness are not consumed by the general policy.
- Standard rate-limit headers are present and legacy headers are absent.
- Each blocked response contains the current request ID.
- Captured structured logger output never contains known password, bearer token, cookie, session, secret, or API-key values, including nested values and error properties.
- Request logging does not expose raw query credentials.

Focused regression runs cover hardening, auth, booking, review, admin, and health tests. Final verification runs lint, typecheck, build, and the full serial Jest suite.

## Operational Constraints

- Do not run Jest concurrently because every worktree shares the same test PostgreSQL database.
- Do not create or commit a feature-worktree `package-lock.json`.
- Preserve the existing untracked root plan and `package-lock.json`.
- Complete implementation through witnessed RED, GREEN, and refactor cycles.
- Obtain an independent code review before final verification.
