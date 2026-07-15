# SkillBridge Backend Requirements

**Document type:** Backend product, API, data, security, and implementation requirements  
**Repository:** Standalone backend repository  
**Primary stack:** Node.js, Express, TypeScript, PostgreSQL, Prisma  
**Authentication:** Better Auth with Better Auth-issued JWTs  
**Testing:** Jest and Supertest  
**Status:** Implementation-ready

---

## 1. Purpose

This document defines the complete backend requirements for SkillBridge. The backend is the authoritative source for authentication integration, authorization, tutor approval, availability, slot calculation, booking integrity, reviews, administration, validation, and data persistence.

The requirements are organized for incremental agentic development. Business rules must be implemented server-side even when the frontend also performs convenience validation.

---

## 2. Product Scope

SkillBridge connects students with approved tutors.

The backend must support:

- Public approved-tutor discovery.
- Better Auth email/password registration and sign-in.
- Fixed roles: student, tutor, and admin.
- Tutor profile creation and admin approval.
- Multiple tutor subject categories.
- Recurring weekly availability.
- UTC-based slot calculation.
- Student-selected session duration.
- Instant confirmed booking.
- Double-booking prevention.
- Role-scoped booking cancellation.
- Tutor completion and admin status override.
- Immutable reviews for completed bookings.
- User banning without disabling sign-in.
- Category and user administration.
- Environment-seeded admin credentials.
- No payment data or payment workflow.

---

## 3. Binding Product Decisions

1. Backend and frontend are separate repositories and deployments.
2. The API is built with Node.js, Express, and TypeScript.
3. PostgreSQL is the database.
4. Prisma is the ORM and migration system.
5. Better Auth manages user authentication.
6. Better Auth-issued JWTs authenticate protected business API calls.
7. Users may self-register only as `STUDENT` or `TUTOR`.
8. Admin accounts are created only through environment-driven seed logic.
9. Tutors begin in `PENDING` approval state and are not public/bookable until approved.
10. Banned users may sign in but are denied all protected business operations except reading their own account status.
11. All persisted timestamps are UTC.
12. Tutor availability is recurring weekly availability.
13. Students choose a start time and an allowed duration.
14. Tutor pricing is hourly.
15. Quoted session price is calculated from the effective hourly rate and duration.
16. Price data is not payment data. No payment method, transaction, status, or checkout fields may exist.
17. Bookings become `CONFIRMED` immediately on successful creation.
18. Confirmed bookings for one tutor must never overlap.
19. Students may cancel only their own confirmed bookings before start.
20. Tutors may cancel only assigned confirmed bookings before start.
21. Admins may cancel or override status for any booking.
22. Cancellation is prohibited at or after `startAt`.
23. Tutors may complete only their own eligible confirmed bookings.
24. Admins may apply any supported status transition, with audit metadata.
25. Reviews require a completed booking and ownership by the reviewing student.
26. One review is allowed per booking.
27. Rating is an integer from 1 through 5.
28. Review comment is required.
29. Reviews cannot be updated or deleted in this release.
30. Backend tests use Jest and Supertest.
31. Swagger/OpenAPI documentation is not required.
32. The backend repository must contain at least 15 meaningful commits.

---

## 4. Out of Scope

Do not implement:

- Payment processing, payment status, refunds, invoices, checkout, or tutor payouts.
- Messaging, chat, video sessions, or meeting-link generation.
- Calendar-provider synchronization.
- Review editing or deletion.
- Tutor availability exceptions/holiday overrides in this release.
- Recurring bookings.
- Coupon or discount systems.
- Admin registration endpoint.
- Social login unless separately approved.
- OpenAPI/Swagger UI.
- GraphQL.
- WebSockets.
- File upload storage unless separately selected; image URLs may be stored.
- Hard deletion of users with existing domain records.

---

## 5. Technical Requirements

### 5.1 Runtime

- Use a currently supported Node.js LTS release.
- Use TypeScript in strict mode.
- Use ECMAScript modules.
- Use Express.
- Use PostgreSQL.
- Use Prisma migrations for schema changes.
- Use Better Auth with the Prisma adapter.
- Use Better Auth JWT capability for bearer tokens used by the business API.
- Use Jest and Supertest for automated tests.

### 5.2 Required Scripts

The repository must expose equivalent scripts:

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "seed": "tsx prisma/seed.ts"
  }
}
```

### 5.3 Environment Variables

Provide `.env.example` containing at least:

```env
NODE_ENV=development
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/skillbridge
BETTER_AUTH_SECRET=replace-with-a-long-random-secret
BETTER_AUTH_URL=http://localhost:5000
FRONTEND_ORIGIN=http://localhost:3000
JWT_ISSUER=http://localhost:5000
JWT_AUDIENCE=http://localhost:5000
DEFAULT_CURRENCY=USD
BOOKING_DURATION_OPTIONS=30,60,90,120
ADMIN_NAME=SkillBridge Admin
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=replace-with-a-strong-password
```

Rules:

- Production must fail fast when required values are missing.
- Secrets must never be committed.
- `ADMIN_PASSWORD` must meet the normal password policy.
- `FRONTEND_ORIGIN` must be an explicit allowlisted origin.
- Duration options must parse to unique positive integers.
- Currency must be a valid supported ISO-style currency code.
- Production admin credentials must be set by deployment configuration.
- The seed process must not print the admin password.

---

## 6. Architecture

### 6.1 Required Layering

Use a structure equivalent to:

```text
src/
  app.ts
  server.ts
  config/
  auth/
  middleware/
  modules/
    users/
    tutors/
    categories/
    availability/
    bookings/
    reviews/
    admin/
  shared/
    errors/
    validation/
    pagination/
    date/
    money/
    logging/
    security/
  prisma/
tests/
prisma/
  schema.prisma
  migrations/
  seed.ts
```

Within a feature module, use clear boundaries:

```text
bookings/
  booking.routes.ts
  booking.controller.ts
  booking.service.ts
  booking.repository.ts
  booking.schemas.ts
  booking.types.ts
```

Equivalent naming is acceptable.

### 6.2 Responsibility Rules

- Routes define HTTP mapping and middleware.
- Controllers translate HTTP input/output.
- Services own business rules and transactions.
- Repositories or Prisma access modules own database queries.
- Zod or equivalent schemas validate request input.
- Prisma schema owns persistence constraints.
- Authorization middleware provides baseline role/status checks.
- Services must re-check record ownership for resource-specific actions.
- Controllers must not contain booking conflict logic.
- Prisma errors must not leak directly to clients.

### 6.3 API Versioning

- Mount Better Auth under `/api/auth/*`.
- Mount business endpoints under `/api/v1`.
- Health endpoints may remain unversioned.
- Breaking business API changes require a new version or coordinated frontend change.

---

## 7. Express Middleware Order

The application must apply middleware in a safe order:

1. Request ID.
2. Security headers.
3. CORS with explicit frontend origin and credentials.
4. Request logging with sensitive-value redaction.
5. Better Auth catch-all handler under `/api/auth/*`.
6. JSON/body parsing for non-Better-Auth routes.
7. Rate limiting.
8. Business routes.
9. Not-found handler.
10. Central error handler.

Do not apply body parsing in a way that breaks Better Auth request handling.

---

## 8. Authentication Design

### 8.1 Better Auth Responsibilities

Better Auth is responsible for:

- Email/password registration.
- Credential verification.
- Session creation and termination.
- Password hashing.
- Auth-related account/session tables.
- JWT issuance for authenticated clients.
- JWKS/key handling required by Better Auth's JWT implementation.

The application must not implement a parallel password or session system.

### 8.2 Registration Roles

Public registration accepts only:

```ts
type SelfRegisterableRole = "STUDENT" | "TUTOR";
```

Rules:

- Reject `ADMIN` or unknown role values.
- Ignore or reject client attempts to set status, approval status, permissions, or IDs.
- Student registration creates an active student.
- Tutor registration creates an active user plus a tutor approval state of `PENDING`.
- A tutor profile may be created during onboarding after registration.
- Duplicate email handling must not leak sensitive account details beyond a normal conflict response.

### 8.3 JWT Use

Protected business routes require:

```http
Authorization: Bearer <better-auth-issued-jwt>
```

Requirements:

- Verify signature using Better Auth-supported keys/JWKS.
- Verify issuer.
- Verify audience.
- Verify expiration.
- Use user ID as the stable subject or a dedicated claim.
- Include only necessary claims such as user ID, email, and role.
- Never trust client-submitted role/status fields.
- After token verification, load the current user status from the database for protected business operations.
- Reject deleted/missing users.
- A stale token must not bypass a newly applied ban or role change.

### 8.4 Session and Status Endpoint

Provide:

```text
GET /api/v1/me
```

This endpoint may be called by an authenticated banned user and returns a safe current-user view including `status`. All other protected domain endpoints must apply the active-account guard unless explicitly documented.

### 8.5 Ban Semantics

When `User.status = BANNED`:

- Better Auth sign-in may succeed.
- Session retrieval may succeed.
- JWT retrieval may succeed if Better Auth requires it for the account-status UI.
- `GET /api/v1/me` may succeed.
- Public endpoints remain publicly accessible.
- All other authenticated business endpoints return `403 USER_BANNED`.
- Banning does not delete sessions or domain data by default.
- Unbanning restores access without recreating the user.

### 8.6 Admin Seed

`prisma/seed.ts` must:

1. Read `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`.
2. Validate all three.
3. Create the Better Auth identity using a supported server-side Better Auth mechanism.
4. Set or update the user's application role to `ADMIN`.
5. Set status to `ACTIVE`.
6. Be idempotent by email.
7. Never downgrade an existing admin.
8. Never print the password.
9. Exit non-zero on invalid production configuration.
10. Document how to run the seed locally and in deployment.

No public admin creation endpoint may exist.

---

## 9. Authorization Model

### 9.1 Roles

```ts
enum UserRole {
  STUDENT
  TUTOR
  ADMIN
}
```

### 9.2 User Status

```ts
enum UserStatus {
  ACTIVE
  BANNED
}
```

### 9.3 Tutor Approval

```ts
enum TutorApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}
```

### 9.4 Authorization Matrix

| Capability | Public | Student | Tutor | Admin |
|---|---:|---:|---:|---:|
| Browse approved tutors | Yes | Yes | Yes | Yes |
| View public reviews | Yes | Yes | Yes | Yes |
| Update own general profile | No | Yes | Yes | Yes |
| Create booking | No | Own | No | No |
| View own/assigned bookings | No | Own | Assigned | All |
| Cancel booking before start | No | Own | Assigned | Any |
| Complete booking | No | No | Assigned | Any via override |
| Create review | No | Completed own booking | No | No |
| Manage own tutor profile | No | No | Own | Review/moderate |
| Manage own availability | No | No | Own | No |
| Approve tutor | No | No | No | Yes |
| Ban/unban user | No | No | No | Yes |
| Manage categories | No | No | No | Yes |
| Override booking status | No | No | No | Yes |

All non-public capabilities require `ACTIVE` status.

---

## 10. Data Model

Use Prisma models with UUID/CUID-style string identifiers. Exact Better Auth-managed model names may follow the adapter's generated schema. Domain models must satisfy the following logical schema.

### 10.1 User Extensions

Better Auth's user record must be extended or associated with:

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary identity shared with Better Auth |
| `name` | string | Required |
| `email` | string | Unique, normalized |
| `image` | string nullable | Optional URL |
| `phone` | string nullable | Optional |
| `role` | `UserRole` | Required |
| `status` | `UserStatus` | Default `ACTIVE` |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

Do not duplicate password hashes outside Better Auth.

### 10.2 TutorProfile

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `userId` | string | Unique FK to tutor user |
| `headline` | string | Required before approval |
| `bio` | text | Required before approval |
| `experienceYears` | integer | `>= 0` |
| `hourlyRate` | decimal | Positive, fixed precision |
| `currencyCode` | string | Defaults from environment |
| `approvalStatus` | enum | Default `PENDING` |
| `rejectionReason` | text nullable | Set on rejection |
| `approvedAt` | datetime nullable | UTC |
| `approvedById` | string nullable | Admin FK |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

Rules:

- `userId` must reference a user with role `TUTOR`; enforce in service logic.
- Only `APPROVED` profiles belonging to active users are public/bookable.
- Updating an approved profile does not automatically revoke approval in this release.
- Admin may explicitly return a profile to pending/rejected if the moderation endpoint supports it.

### 10.3 Category

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `name` | string | Unique, case-insensitive policy |
| `slug` | string | Unique |
| `description` | string nullable | Optional |
| `isActive` | boolean | Default true |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

Referenced categories should normally be deactivated rather than hard-deleted.

### 10.4 TutorCategory

Many-to-many join:

| Field | Type | Rules |
|---|---|---|
| `tutorProfileId` | string | FK |
| `categoryId` | string | FK |
| `createdAt` | datetime | UTC |

Composite unique constraint:

```text
(tutorProfileId, categoryId)
```

### 10.5 WeeklyAvailability

Represent recurring weekly intervals in a timezone-stable form.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `tutorProfileId` | string | FK |
| `dayOfWeek` | integer | 0–6 using one documented convention |
| `startMinuteUtc` | integer | 0–1439 |
| `endMinuteUtc` | integer | 1–1440 |
| `isActive` | boolean | Default true |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

Rules:

- Document whether `0` means Sunday or Monday; use one convention everywhere.
- `startMinuteUtc < endMinuteUtc`.
- Intervals for the same tutor/day must not overlap.
- Multiple intervals per weekday are allowed.
- An interval may not wrap across UTC midnight. Split cross-midnight availability into two intervals.
- The client is responsible for showing local-time editing context, but the backend contract must be explicit.
- Updating recurring availability does not alter existing bookings.

### 10.6 Booking

```ts
enum BookingStatus {
  CONFIRMED
  COMPLETED
  CANCELLED
}
```

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `studentId` | string | FK to student user |
| `tutorProfileId` | string | FK |
| `categoryId` | string | FK; tutor must teach it |
| `startAt` | datetime | UTC |
| `endAt` | datetime | UTC |
| `durationMinutes` | integer | Positive allowed option |
| `hourlyRateSnapshot` | decimal | Tutor rate at booking time |
| `quotedPrice` | decimal | Calculated snapshot |
| `currencyCode` | string | Snapshot |
| `note` | string nullable | Optional |
| `status` | enum | Default `CONFIRMED` |
| `cancelledAt` | datetime nullable | UTC |
| `cancelledById` | string nullable | Actor FK |
| `cancellationReason` | text nullable | Optional/required by policy |
| `completedAt` | datetime nullable | UTC |
| `createdAt` | datetime | UTC |
| `updatedAt` | datetime | UTC |

Rules:

- `endAt > startAt`.
- `durationMinutes = difference(endAt, startAt)` in whole minutes.
- `quotedPrice = hourlyRateSnapshot × durationMinutes / 60`, rounded using a documented decimal rule.
- These price fields describe the agreed session quote; they are not payment records.
- No payment method/status/transaction fields are allowed.
- Only confirmed bookings block availability.
- Preserve category and pricing snapshots even if tutor/category data later changes.

### 10.7 Review

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `bookingId` | string | Unique FK |
| `studentId` | string | FK |
| `tutorProfileId` | string | FK |
| `rating` | integer | 1–5 |
| `comment` | text | Required |
| `createdAt` | datetime | UTC |

Rules:

- `bookingId` unique enforces one review per booking.
- Booking must be `COMPLETED`.
- `studentId` must match booking student.
- `tutorProfileId` must match booking tutor.
- No update or delete business endpoint exists.
- Rating aggregates are calculated from persisted reviews.

### 10.8 BookingStatusHistory

Required for status traceability:

| Field | Type | Rules |
|---|---|---|
| `id` | string | Primary key |
| `bookingId` | string | FK |
| `fromStatus` | enum nullable | Null for creation |
| `toStatus` | enum | Required |
| `actorUserId` | string | FK |
| `actorRole` | enum | Snapshot |
| `reason` | text nullable | Required for admin override when configured |
| `createdAt` | datetime | UTC |

Every booking creation and status mutation must append a history row in the same transaction.

---

## 11. Database Constraints and Indexes

At minimum, add indexes for:

- `User.email` unique.
- `User.role`.
- `User.status`.
- `TutorProfile.userId` unique.
- `TutorProfile.approvalStatus`.
- `TutorProfile.hourlyRate`.
- `Category.slug` unique.
- `Category.isActive`.
- `TutorCategory(categoryId, tutorProfileId)`.
- `WeeklyAvailability(tutorProfileId, dayOfWeek)`.
- `Booking.studentId, startAt`.
- `Booking.tutorProfileId, startAt`.
- `Booking.status, startAt`.
- `Booking.categoryId`.
- `Review.bookingId` unique.
- `Review.tutorProfileId, createdAt`.
- `BookingStatusHistory.bookingId, createdAt`.

Case-insensitive uniqueness for category names must be handled with normalized storage, a database index strategy, or transaction-safe service validation.

---

## 12. Date, Time, and Duration Rules

### 12.1 UTC

- Accept ISO 8601 date-time strings with timezone information.
- Convert and persist as UTC.
- Return ISO 8601 UTC strings ending in `Z`.
- Reject ambiguous local timestamps without an offset.
- Use the database/server current time for authorization cutoffs, not client time.

### 12.2 Duration Options

Allowed durations come from `BOOKING_DURATION_OPTIONS`.

Rules:

- Values are whole minutes.
- Values must be positive.
- Deduplicate and sort at startup.
- Return supported durations from the slot endpoint.
- Reject any booking duration not in the configured set.

### 12.3 Weekly Availability Expansion

The slot service must:

1. Load the tutor's active weekly intervals.
2. Expand them into concrete UTC intervals for the requested date range.
3. Exclude times in the past.
4. Exclude overlaps with confirmed bookings.
5. Respect requested/allowed duration.
6. Return only starts where the complete duration fits inside one availability interval.
7. Use a documented slot increment, recommended 30 minutes and configurable if implemented.
8. Limit the date range to prevent expensive queries, recommended maximum 31 days.

### 12.4 Cancellation Boundary

Cancellation is allowed only when:

```text
serverNow < booking.startAt
```

At exactly `startAt`, cancellation must be rejected.

### 12.5 Completion Boundary

Tutor completion is allowed only when:

- Booking is `CONFIRMED`.
- Tutor owns the booking.
- `serverNow >= booking.endAt`.

Admin override may complete earlier, but must include an audit reason.

---

## 13. Booking Integrity and Concurrency

Double-booking prevention is a critical requirement.

### 13.1 Conflict Definition

Two confirmed bookings conflict when:

```text
existing.startAt < requested.endAt
AND
existing.endAt > requested.startAt
```

Adjacent bookings where one ends exactly when another starts do not conflict.

### 13.2 Transaction Requirements

Booking creation must occur in a database transaction that:

1. Validates the authenticated user is an active student.
2. Validates tutor is active and approved.
3. Validates category is active and assigned to tutor.
4. Validates duration.
5. Validates start time and availability.
6. Checks confirmed booking overlap.
7. Calculates price from the current tutor hourly rate.
8. Creates the confirmed booking.
9. Creates status history.
10. Commits atomically.

### 13.3 Race-Condition Protection

An application-level pre-check alone is insufficient.

Use a PostgreSQL-safe strategy such as:

- Serializable transaction with retry on serialization failure, or
- Advisory lock keyed by tutor and relevant time range/date, or
- A database exclusion constraint using an appropriate range representation.

The selected strategy must have automated concurrency-oriented coverage where practical and must return `409 BOOKING_SLOT_CONFLICT` rather than creating overlapping records.

---

## 14. Booking State Machine

### 14.1 Normal Role Transitions

| Actor | From | To | Conditions |
|---|---|---|---|
| System/student create | none | `CONFIRMED` | Valid available slot |
| Student | `CONFIRMED` | `CANCELLED` | Own booking and before start |
| Tutor | `CONFIRMED` | `CANCELLED` | Assigned booking and before start |
| Tutor | `CONFIRMED` | `COMPLETED` | Assigned booking and at/after end |
| Admin | any | supported target | Valid integrity checks and audit reason as required |

### 14.2 Admin Override Rules

Admin has ultimate business authority, but the API must maintain data integrity:

- Admin can set `CONFIRMED`, `COMPLETED`, or `CANCELLED`.
- Reconfirming a cancelled booking requires the tutor to remain approved/active and the time range to remain conflict-free.
- Admin cannot create overlapping confirmed bookings.
- Setting `CANCELLED` populates cancellation metadata.
- Setting `COMPLETED` populates completion metadata and clears incompatible cancellation metadata.
- Setting `CONFIRMED` clears incompatible completion/cancellation metadata.
- Every override records actor, from/to status, reason, and timestamp.
- The response returns current allowed admin transitions.

---

## 15. API Conventions

### 15.1 Success Envelope

Use a consistent shape:

```json
{
  "success": true,
  "data": {},
  "meta": {},
  "requestId": "req_..."
}
```

`meta` may be omitted when not needed.

### 15.2 Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "BOOKING_SLOT_CONFLICT",
    "message": "The selected time is no longer available.",
    "fieldErrors": {
      "startAt": ["Choose another start time."]
    }
  },
  "requestId": "req_..."
}
```

Rules:

- Use stable machine-readable codes.
- Do not expose stack traces, SQL, Prisma internals, JWT details, or existence-sensitive auth information.
- Validation errors use `400` or `422` consistently; choose one policy and document it.
- Authentication failure: `401`.
- Authorization/banned: `403`.
- Missing resource: `404`.
- Uniqueness/state/conflict: `409`.
- Rate limit: `429`.
- Unexpected error: `500`.

### 15.3 Pagination

Request:

```text
?page=1&pageSize=20
```

Response metadata:

```json
{
  "page": 1,
  "pageSize": 20,
  "totalItems": 125,
  "totalPages": 7
}
```

Rules:

- Default page size: 20.
- Maximum page size: 100.
- Reject invalid negative/zero values or normalize according to one documented policy.
- Use stable sorting.

### 15.4 Identifiers

- Treat IDs as opaque strings.
- Return `404` for inaccessible resource IDs when revealing existence would be inappropriate.
- Do not expose database sequence assumptions.

---

## 16. Endpoint Requirements

### 16.1 Health

#### `GET /health`

Returns service process health.

#### `GET /ready`

Verifies critical readiness, including database connectivity.

Health responses must not expose secrets.

---

## 17. Authentication Endpoints

Better Auth is mounted under:

```text
/api/auth/*
```

Required capabilities:

- Email/password sign-up.
- Email/password sign-in.
- Sign-out.
- Session retrieval.
- Better Auth JWT retrieval.
- JWKS/key endpoint required by the chosen Better Auth JWT integration.

Registration must accept controlled role metadata and enforce student/tutor-only registration through server hooks or post-registration logic.

The backend may expose a thin application registration endpoint only if Better Auth's normal endpoint cannot safely enforce role creation. It must still delegate credential creation to Better Auth and must not create parallel auth logic.

---

## 18. Current User Endpoints

### `GET /api/v1/me`

Auth: any authenticated account, including banned.

Returns:

```json
{
  "id": "user_id",
  "name": "User Name",
  "email": "user@example.com",
  "image": null,
  "phone": null,
  "role": "TUTOR",
  "status": "ACTIVE",
  "tutorApprovalStatus": "PENDING"
}
```

### `PATCH /api/v1/me`

Auth: active authenticated user.

Allowed fields:

- `name`
- `image`
- `phone`

Rules:

- Reject role/status/email/approval changes.
- Trim and validate fields.
- Return updated safe user view.

---

## 19. Public Category Endpoints

### `GET /api/v1/categories`

Returns active categories only.

Query:

- Optional keyword search.
- Optional limit for homepage use.

Response fields:

- `id`
- `name`
- `slug`
- `description`

Inactive categories must not appear publicly.

---

## 20. Public Tutor Endpoints

### `GET /api/v1/tutors`

Returns only tutors satisfying all conditions:

- User role is tutor.
- User status is active.
- Tutor approval is approved.

Supported query parameters:

- `q`
- `categoryId`
- `minRating`
- `maxHourlyRate`
- `sort`
- `page`
- `pageSize`
- optional `featured=true`

Supported sort values:

- `recommended`
- `rating_desc`
- `price_asc`
- `price_desc`
- `reviews_desc`

Response summary fields:

- Tutor profile ID.
- User ID only if safe/needed.
- Name.
- Image.
- Headline.
- Categories.
- Experience years.
- Hourly rate.
- Currency code.
- Average rating.
- Review count.

### `GET /api/v1/tutors/:tutorId`

Returns public details only for an approved active tutor.

Must not reveal whether a non-public tutor is pending, rejected, or banned. Return public `404`.

### `GET /api/v1/tutors/:tutorId/reviews`

Returns immutable review summaries with pagination.

Do not expose reviewer email.

### `GET /api/v1/tutors/:tutorId/slots`

Query:

- `dateFrom`: UTC date/time or documented date format.
- `dateTo`: UTC date/time or documented date format.
- Optional `durationMinutes`.

Returns:

```json
{
  "tutorId": "tutor_profile_id",
  "timezone": "UTC",
  "hourlyRate": "40.00",
  "currencyCode": "USD",
  "supportedDurations": [30, 60, 90, 120],
  "slots": [
    {
      "startAt": "2026-07-20T09:00:00.000Z",
      "endAtByDuration": {
        "60": "2026-07-20T10:00:00.000Z"
      }
    }
  ]
}
```

The exact response may be simplified, but it must let the frontend display only backend-validated combinations.

---

## 21. Booking Endpoints

### `POST /api/v1/bookings`

Auth: active student.

Request:

```json
{
  "tutorId": "tutor_profile_id",
  "categoryId": "category_id",
  "startAt": "2026-07-20T09:00:00.000Z",
  "durationMinutes": 60,
  "note": "Optional context for the tutor"
}
```

Behavior:

- Derive `studentId` from JWT identity.
- Do not accept client price, end time, status, or student ID as authoritative.
- Compute end time.
- Validate availability and conflict.
- Compute rate and quoted price.
- Create `CONFIRMED`.
- Return `201`.

Conflicting slot returns:

```text
409 BOOKING_SLOT_CONFLICT
```

### `GET /api/v1/bookings`

Auth: active student, tutor, or admin.

Role scoping:

- Student: own bookings.
- Tutor: assigned bookings.
- Admin: all bookings, though admin list may also use the admin endpoint.

Filters:

- `status`
- `from`
- `to`
- `page`
- `pageSize`

### `GET /api/v1/bookings/:bookingId`

Auth: active authorized participant or admin.

Response must include:

- Student safe summary.
- Tutor safe summary.
- Category.
- Time/duration.
- Price quote.
- Status metadata.
- Review when present.
- `allowedActions` calculated by the backend.

### `PATCH /api/v1/bookings/:bookingId/cancel`

Auth: active student or tutor.

Request:

```json
{
  "reason": "Optional reason"
}
```

Rules:

- Student must own booking.
- Tutor must be assigned.
- Booking must be confirmed.
- Current server time must be before start.
- Set status and cancellation metadata atomically.
- Create status history.

### `POST /api/v1/bookings/:bookingId/review`

Auth: active student.

Request:

```json
{
  "rating": 5,
  "comment": "Clear and helpful session."
}
```

Rules:

- Student must own booking.
- Booking must be completed.
- No review may already exist.
- Rating integer 1–5.
- Comment required and validated.
- Return `201`.
- No update/delete endpoint.

---

## 22. Tutor Endpoints

### `GET /api/v1/tutor/profile`

Auth: active tutor.

Returns own profile, categories, and approval metadata.

### `PUT /api/v1/tutor/profile`

Auth: active tutor.

Request fields:

- `headline`
- `bio`
- `experienceYears`
- `hourlyRate`
- `categoryIds`
- optional supported credentials fields

Rules:

- Upsert profile.
- Category IDs must be active.
- At least one category.
- Use transaction for profile and category replacement.
- Do not allow tutor to set approval fields.
- A first complete profile remains pending until admin approval.

### `GET /api/v1/tutor/availability`

Auth: active tutor.

Returns all own recurring weekly intervals.

### `PUT /api/v1/tutor/availability`

Auth: active tutor.

Replace semantics are recommended.

Request:

```json
{
  "intervals": [
    {
      "dayOfWeek": 1,
      "startMinuteUtc": 540,
      "endMinuteUtc": 720
    }
  ]
}
```

Rules:

- Validate day/minute ranges.
- Validate start before end.
- Validate no overlap.
- Deduplicate.
- Replace within one transaction.
- Existing bookings remain unchanged.

### `GET /api/v1/tutor/bookings`

Auth: active tutor.

Returns assigned bookings with filters and pagination.

### `PATCH /api/v1/tutor/bookings/:bookingId/complete`

Auth: active tutor.

Rules:

- Tutor owns booking.
- Booking confirmed.
- Server time at/after end.
- Set completed metadata.
- Append history.
- Return updated booking.

Tutor cancellation uses the common booking cancellation endpoint.

---

## 23. Admin Endpoints

All admin endpoints require active admin role.

### `GET /api/v1/admin/stats`

Returns counts required by the admin dashboard.

### `GET /api/v1/admin/users`

Filters:

- `q`
- `role`
- `status`
- `page`
- `pageSize`

Never return password/account secrets.

### `PATCH /api/v1/admin/users/:userId/status`

Request:

```json
{
  "status": "BANNED",
  "reason": "Policy violation"
}
```

Rules:

- Support active/banned.
- Prevent unsafe self-ban unless explicitly allowed.
- Preserve data.
- Change takes effect on next protected business request because status is loaded from DB.
- Audit logging is strongly recommended.

### `GET /api/v1/admin/tutors`

Filters:

- `approvalStatus`
- `q`
- `page`
- `pageSize`

### `GET /api/v1/admin/tutors/:tutorId`

Returns full moderation-safe tutor profile, categories, approval state, and rejection reason.

### `PATCH /api/v1/admin/tutors/:tutorId/approval`

Request:

```json
{
  "status": "APPROVED",
  "reason": null
}
```

Rules:

- Target user must be tutor.
- Approval requires complete profile and at least one active category.
- Rejection requires a non-empty reason.
- Update approval actor/timestamp.
- Approved active tutor becomes public.
- Rejected/pending tutor is not public.

### `GET /api/v1/admin/bookings`

Supports filters:

- `q`
- `studentId`
- `tutorId`
- `status`
- `from`
- `to`
- `page`
- `pageSize`

### `PATCH /api/v1/admin/bookings/:bookingId/status`

Request:

```json
{
  "status": "COMPLETED",
  "reason": "Administrative correction"
}
```

Rules:

- Reason required for override.
- Apply state cleanup/integrity rules.
- Reconfirmation must pass conflict and tutor-eligibility checks.
- Append history.

### `GET /api/v1/admin/categories`

Returns active and inactive categories.

### `POST /api/v1/admin/categories`

Request:

```json
{
  "name": "Mathematics",
  "slug": "mathematics",
  "description": "Optional description"
}
```

### `PATCH /api/v1/admin/categories/:categoryId`

Supports name, slug, and description updates with uniqueness validation.

### `PATCH /api/v1/admin/categories/:categoryId/status`

Request:

```json
{
  "isActive": false
}
```

Deactivation must not remove historical booking/category relations.

---

## 24. Validation Rules

Use Zod or an equivalent schema library.

### 24.1 Common Text

Recommended initial constraints; keep constants centralized:

- Name: 2–100 characters.
- Headline: 5–160 characters.
- Bio: 50–5000 characters.
- Phone: 5–30 characters after normalization.
- Booking note: maximum 1000 characters.
- Cancellation reason: maximum 1000 characters.
- Review comment: 10–2000 characters.
- Category name: 2–80 characters.
- Category slug: lowercase URL-safe, 2–100 characters.
- Category description: maximum 1000 characters.

### 24.2 Numbers

- Experience years: integer, 0–80.
- Hourly rate: decimal greater than 0 with at most two fractional digits.
- Rating: integer 1–5.
- Day of week: integer 0–6.
- Minute values: documented valid range.
- Duration: one configured allowed value.

### 24.3 IDs

- Required IDs must be non-empty strings matching the chosen ID format when validation is reliable.
- Never accept actor/user ownership IDs from the client when derivable from auth.

### 24.4 Query Input

- Whitelist sort values.
- Clamp or reject excessive page sizes.
- Validate date ranges and enforce maximum span.
- Normalize search strings.
- Avoid constructing raw SQL from user-provided sort/filter strings.

---

## 25. Error Codes

At minimum define stable codes:

```text
AUTHENTICATION_REQUIRED
INVALID_CREDENTIALS
TOKEN_EXPIRED
TOKEN_INVALID
FORBIDDEN
USER_BANNED
ROLE_NOT_ALLOWED
VALIDATION_ERROR
RESOURCE_NOT_FOUND
EMAIL_ALREADY_EXISTS
TUTOR_PROFILE_INCOMPLETE
TUTOR_NOT_APPROVED
TUTOR_UNAVAILABLE
CATEGORY_NOT_ASSIGNED
CATEGORY_INACTIVE
AVAILABILITY_OVERLAP
INVALID_DURATION
BOOKING_SLOT_CONFLICT
BOOKING_ALREADY_STARTED
BOOKING_NOT_COMPLETABLE
BOOKING_STATUS_CONFLICT
REVIEW_NOT_ALLOWED
REVIEW_ALREADY_EXISTS
CATEGORY_NAME_CONFLICT
CATEGORY_SLUG_CONFLICT
RATE_LIMITED
INTERNAL_ERROR
```

Errors must be mapped consistently to HTTP status and tested.

---

## 26. Security Requirements

### 26.1 HTTP Security

- Use secure headers.
- Restrict CORS to configured frontend origin(s).
- Enable credentials only where required.
- Set appropriate body-size limits.
- Reject unsupported content types on JSON endpoints.
- Use HTTPS in production.

### 26.2 Authentication Security

- Better Auth secrets must be strong and environment-provided.
- JWT issuer, audience, signature, and expiration must be verified.
- Do not log tokens, passwords, cookies, auth headers, or secret values.
- Keep JWT lifetime reasonably short.
- Use key rotation supported by the selected Better Auth configuration when operationally appropriate.
- Store no plaintext passwords.

### 26.3 Authorization Security

- Require authentication middleware.
- Require active-status middleware.
- Require role middleware.
- Re-check resource ownership in services.
- Never derive privilege from request body.
- Load current status from DB to enforce bans immediately.

### 26.4 Abuse Protection

Apply rate limits at least to:

- Sign-up.
- Sign-in.
- JWT/token retrieval.
- Booking creation.
- Review creation.
- Admin mutations.

Use stricter limits for auth endpoints. Rate-limit keys must account for reverse-proxy configuration safely.

### 26.5 User-Generated Content

- Treat profile bios, booking notes, rejection reasons, and reviews as plain text.
- Do not return rendered HTML.
- Normalize and trim.
- Prevent log injection through structured logging.

### 26.6 Database Security

- Use parameterized Prisma queries.
- Use least-privilege database credentials in production.
- Run migrations in a controlled deployment step.
- Backups are an operational deployment responsibility and must be documented.

---

## 27. Logging and Observability

- Assign a request ID to every request.
- Return request ID in success/error envelopes.
- Use structured logs.
- Log method, path, status, latency, and actor ID where safe.
- Redact secrets and personal data.
- Log booking state changes and admin actions.
- Log unexpected errors with stack traces server-side only.
- Health and readiness endpoints must support deployment monitoring.
- Do not require an external observability vendor.

---

## 28. Testing Requirements

### 28.1 Tools

- Jest.
- Supertest.
- Test database isolated from development/production.
- Prisma migrations applied to the test database.
- Deterministic factories/fixtures.
- Mock external dependencies only when unavoidable; domain behavior should use a real test database.

### 28.2 Test Categories

#### Authentication and Authorization

Test:

- Student registration.
- Tutor registration starts pending.
- Admin registration attempt rejected.
- Protected endpoint without token.
- Invalid/expired token.
- Wrong role.
- Banned user can read `/me`.
- Banned user cannot access protected domain endpoint.
- Seeded admin can authenticate.

#### Tutors and Categories

Test:

- Only approved active tutors are public.
- Pending/rejected/banned tutor returns public not found.
- Category filtering.
- Rating/price sorting.
- Tutor profile validation.
- Multi-category assignment.
- Approval requires profile completeness.
- Rejection requires reason.

#### Availability

Test:

- Valid weekly intervals.
- Multiple intervals per day.
- Overlap rejection.
- Duplicate interval rejection.
- Invalid minute/day rejection.
- Availability replacement.
- Existing bookings survive availability changes.
- Slot expansion in UTC.
- Past slot exclusion.
- Duration-fit logic.

#### Bookings

Test:

- Student booking success.
- Non-student booking rejection.
- Unapproved tutor rejection.
- Inactive category rejection.
- Category not taught rejection.
- Unsupported duration.
- Outside-availability rejection.
- Overlap conflict.
- Adjacent bookings accepted.
- Rate/price snapshot correctness.
- Student can cancel own before start.
- Student cannot cancel another's.
- Tutor can cancel assigned before start.
- Tutor cannot cancel another tutor's.
- Cancellation at/after start rejected.
- Tutor completion before end rejected.
- Tutor completion after end succeeds.
- Admin override succeeds with audit reason.
- Admin reconfirm conflict rejected.
- Status history created atomically.

#### Reviews

Test:

- Completed owned booking review success.
- Rating boundaries.
- Required comment.
- Non-owner rejected.
- Non-completed booking rejected.
- Duplicate review conflict.
- No review update/delete routes.

#### Administration

Test:

- Admin user pagination/filter.
- Ban/unban.
- Banned status applies immediately to business requests.
- Tutor approval/rejection.
- Booking status override.
- Category uniqueness.
- Category deactivation preserves relations.

#### Error Handling

Test:

- Consistent error envelope.
- Validation field errors.
- Not-found behavior.
- Request ID presence.
- Prisma uniqueness/conflict mapping.
- Unexpected error is sanitized.

### 28.3 Coverage

- Set meaningful coverage thresholds for services and critical middleware.
- Booking, authorization, availability, and review services require high branch coverage.
- Coverage percentage alone is not acceptance; critical scenarios listed above must exist.

### 28.4 Test Commands

At minimum:

```bash
npm test
npm run test:coverage
```

Tests must run in CI or an equivalent clean environment.

---

## 29. Implementation Phases and Dependency Order

### Phase 1: Foundation

Depends on: nothing.

Deliver:

- TypeScript/Express setup.
- Environment validation.
- Prisma/PostgreSQL connection.
- Request IDs, logging, CORS, security headers.
- Error envelope.
- Health/readiness.
- Test database and Jest/Supertest harness.

Exit criteria:

- Server starts.
- Health/readiness tested.
- Lint/typecheck/build/test pass.

### Phase 2: Better Auth and Identity

Depends on: Phase 1.

Deliver:

- Better Auth Prisma integration.
- Auth route mounting.
- Email/password auth.
- User role/status extensions.
- JWT issue/verification path.
- `/api/v1/me`.
- Active/role middleware.
- Environment-driven admin seed.

Exit criteria:

- Student/tutor registration works.
- Admin self-registration fails.
- Seeded admin works.
- Banned semantics are tested.

### Phase 3: Categories and Tutor Profiles

Depends on: Phase 2.

Deliver:

- Category model/admin CRUD.
- Tutor profile.
- Tutor-category join.
- Public approved tutor list/detail.
- Approval workflow.
- Rating aggregate query shape.

Exit criteria:

- Pending tutor remains private.
- Approved active tutor is public.
- Admin moderation tested.

### Phase 4: Weekly Availability and Slots

Depends on: Phase 3.

Deliver:

- Weekly availability persistence.
- Overlap validation.
- Replace endpoint.
- UTC expansion.
- Public computed slot endpoint.
- Duration option handling.

Exit criteria:

- Slot endpoint returns valid bookable starts.
- Overlap and timezone boundary tests pass.

### Phase 5: Booking Core

Depends on: Phase 4.

Deliver:

- Booking schema.
- Price snapshot calculation.
- Status history.
- Transactional creation.
- Database-safe conflict prevention.
- Role-scoped list/detail.

Exit criteria:

- Concurrent overlap cannot create two confirmed bookings.
- Booking starts confirmed.
- Ownership and filtering tested.

### Phase 6: Booking Actions

Depends on: Phase 5.

Deliver:

- Student/tutor cancellation.
- Tutor completion.
- Admin status override.
- Allowed-action calculation.
- Audit metadata.

Exit criteria:

- Boundary rules and admin correction rules tested.

### Phase 7: Reviews and Aggregates

Depends on: completed booking behavior from Phase 6.

Deliver:

- Immutable review creation.
- Tutor rating/review aggregates.
- Public review list.
- Dashboard counts.

Exit criteria:

- One review per completed owned booking.
- No update/delete routes.
- Aggregate results tested.

### Phase 8: Hardening and Deployment

Depends on: all phases.

Deliver:

- Rate limiting.
- Security/log redaction audit.
- Query/index review.
- Production migration and seed instructions.
- Deployment configuration.
- Full Jest/Supertest suite.
- README and environment documentation.
- Verify 15 meaningful commits.

Exit criteria:

- Build, tests, migrations, and seed pass in a clean environment.
- Frontend origin integration verified.
- Mandatory requirements satisfied.

---

## 30. Acceptance Criteria

### 30.1 Mandatory Assessment Criteria

- Backend repository contains at least 15 meaningful commits.
- Validation, structured errors, and authorization exist for all mutations.
- Admin credentials are created from environment variables through an idempotent seed.
- Working admin email/password can be supplied through deployment instructions without committing secrets.
- API supports all frontend loading/error flows with stable responses.

### 30.2 Auth

- Better Auth handles credentials and sessions.
- Business API accepts valid Better Auth-issued JWTs.
- Student/tutor self-registration works.
- Admin self-registration is impossible.
- Bans take effect on protected business requests.
- Banned users can still authenticate and read account status.

### 30.3 Tutors

- Tutor can own one profile and multiple categories.
- New tutor is pending.
- Admin can approve/reject.
- Only approved active tutors are public/bookable.
- Public search supports subject/category, rating, and price.

### 30.4 Availability

- Tutor can store multiple recurring intervals per weekday.
- Same-day overlap is rejected.
- All times are persisted/returned with documented UTC semantics.
- Slots exclude past and conflicting times.
- Student-selected duration must fit completely.

### 30.5 Booking

- Valid booking is instantly confirmed.
- Backend calculates end time and price.
- No payment fields exist.
- Double booking is prevented under concurrency.
- Student/tutor cancellation ownership is enforced.
- Cancellation at/after start is rejected.
- Tutor completion requires ownership and session end.
- Admin may override status while preserving integrity and audit history.

### 30.6 Reviews

- Completed booking owner can submit one review.
- Rating is 1–5.
- Comment is required.
- Review is immutable through the API.
- Tutor aggregates update from reviews.

### 30.7 Admin

- Admin can view statistics, users, tutors, bookings, and categories.
- Admin can ban/unban.
- Admin can approve/reject tutors.
- Admin can override booking status.
- Admin can create/update/activate/deactivate categories.

### 30.8 Quality

- All required test scenarios pass.
- Production build succeeds.
- Prisma migrations deploy cleanly.
- Seed is idempotent.
- Error responses never expose internal details.
- README documents setup, environment, migration, seed, testing, and deployment.

---

## 31. Definition of Done

A backend feature is done only when:

1. Request validation exists.
2. Authentication and role/status authorization exist.
3. Resource ownership is enforced.
4. Business rules live in the service layer.
5. Database operations are transaction-safe where needed.
6. Stable success/error contracts exist.
7. Sensitive details are not logged or returned.
8. Jest/Supertest tests cover success, validation, authorization, and conflict cases.
9. Prisma schema/migration is included when persistence changes.
10. Relevant indexes are included.
11. Typecheck, lint, build, and tests pass.
12. README/environment documentation is updated.

The backend is done only when:

- Every required endpoint exists.
- Better Auth and JWT integration is production-configurable.
- Admin seeding is verified.
- Booking concurrency protection is verified.
- Banned-user behavior is verified.
- No payment schema or endpoint exists.
- Full test suite passes.
- Deployment instructions work.
- At least 15 meaningful commits exist.

---

## 32. Suggested 15-Commit Backend Sequence

1. `chore: initialize Express TypeScript Prisma backend`
2. `feat: add environment validation logging and error handling`
3. `test: add Jest Supertest and isolated database harness`
4. `feat: integrate Better Auth with Prisma`
5. `feat: add JWT authentication role and status middleware`
6. `feat: add idempotent environment-based admin seed`
7. `feat: implement category administration`
8. `feat: implement tutor profiles subjects and approval workflow`
9. `feat: implement public tutor search and detail endpoints`
10. `feat: implement recurring weekly availability validation`
11. `feat: implement UTC slot generation and duration options`
12. `feat: implement transactional booking and conflict prevention`
13. `feat: implement cancellation completion and admin overrides`
14. `feat: implement immutable reviews and rating aggregates`
15. `fix: complete security indexing deployment and API test audit`

Additional focused commits are encouraged. Do not use formatting-only or trivial commits to satisfy the count.

---

## 33. Agentic Development Rules

An implementation agent must:

- Follow phases in dependency order.
- Implement one vertical slice at a time.
- Add schema, migration, service, route, tests, and documentation together.
- Never bypass Better Auth with a parallel credential system.
- Never accept user role, status, price, ownership, or booking state from the client as authoritative.
- Never rely only on application-level overlap checks.
- Use server time for cancellation/completion boundaries.
- Preserve UTC at all persistence/API boundaries.
- Keep price calculations decimal-safe.
- Keep status changes transactional with history.
- Run focused tests after each slice.
- Run lint, typecheck, build, and full tests at each phase boundary.
- Report contract ambiguity rather than silently inventing incompatible behavior.
- Keep the frontend API contract synchronized whenever request/response shapes change.
