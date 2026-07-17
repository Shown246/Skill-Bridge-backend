# SkillBridge API Documentation

Frontend integration reference for the SkillBridge backend. This document is derived from the current `src` implementation.

## 1. Quick start

The default local backend origin is `http://localhost:5000`.

| API area | Base path |
|---|---|
| Health checks | `/health`, `/ready` |
| Better Auth | `/api/auth` |
| SkillBridge business API | `/api/v1` |

Browser requests may originate only from the configured `FRONTEND_ORIGIN`. CORS credentials are enabled. Send JSON bodies with `Content-Type: application/json`.

```ts
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "http://localhost:5000";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  const body = await response.json();
  if (!response.ok) throw body;
  return body;
}
```

## 2. Authentication

SkillBridge uses Better Auth for registration, sign-in, sessions, sign-out, and JWT issuance.

There are two credentials with different purposes:

- Better Auth endpoints use the session cookie. Browser calls should use `credentials: "include"`.
- Protected `/api/v1` routes require `Authorization: Bearer <jwt>`. The custom authorization middleware does not authenticate business routes from the session cookie.

Recommended browser flow:

1. Register or sign in through `/api/auth/sign-up/email` or `/api/auth/sign-in/email`.
2. Let the browser retain the Better Auth session cookie.
3. Request `/api/auth/token` with that cookie.
4. Put the returned JWT in the `Authorization` header of protected `/api/v1` requests.
5. Refresh the JWT through `/api/auth/token` when it expires. Do not persist it longer than necessary.

```ts
type TokenResponse = { token: string };

const { token } = await apiFetch<TokenResponse>("/api/auth/token");

const me = await apiFetch<Success<User>>("/api/v1/me", {
  headers: { Authorization: `Bearer ${token}` },
});
```

The JWT is verified against `/api/auth/jwks`, including issuer, audience, signature, expiration, and subject. The backend reloads the user from the database on every protected request, so bans and role/status changes take effect without waiting for token expiration.

### Roles and account states

```ts
type UserRole = "STUDENT" | "TUTOR" | "ADMIN";
type UserStatus = "ACTIVE" | "BANNED";
```

Public registration accepts only `STUDENT` or `TUTOR`. If `role` is omitted, it defaults to `STUDENT`. Public registration cannot create an administrator. New accounts are forced to `ACTIVE`.

A banned user may call only `GET /api/v1/me` among protected business endpoints. All other protected `/api/v1` calls return `403 USER_BANNED`.

## 3. Shared conventions

### Success envelopes

Most single-resource and collection responses use:

```ts
type Success<T> = {
  success: true;
  data: T;
};

type PaginatedSuccess<T> = {
  success: true;
  data: T[];
  pagination: Pagination;
};

type Pagination = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
```

Unlike error responses and health responses, custom `/api/v1` success responses do not contain `requestId`.

### Error envelope

Custom API errors have this shape:

```ts
type ApiError = {
  success: false;
  error: {
    code: string;
    message: string;
    fieldErrors?: Record<string, string[] | undefined>;
  };
  requestId: string;
};
```

Common errors:

| HTTP | Code | Meaning |
|---:|---|---|
| 400 | `VALIDATION_ERROR` | Zod validation failed; inspect `fieldErrors` when present. |
| 401 | `UNAUTHORIZED` | Bearer token is missing or the user no longer exists. |
| 401 | `TOKEN_INVALID` | JWT signature, issuer, audience, or format is invalid. |
| 401 | `TOKEN_EXPIRED` | JWT has expired. |
| 403 | `FORBIDDEN` | Authenticated user lacks the required role or ownership. |
| 403 | `USER_BANNED` | Current database status is `BANNED`. |
| 404 | `NOT_FOUND` | Route or resource was not found. |
| 409 | `CONFLICT` | Database uniqueness conflict. |
| 429 | `RATE_LIMITED` | Request limit exceeded. |
| 500 | `INTERNAL_SERVER_ERROR` | Unexpected server error. |

Better Auth owns its own error response format for `/api/auth/*`; do not assume it uses the custom SkillBridge envelope.

### Request IDs and rate limits

Every request receives an `X-Request-Id` response header. Send the value to backend developers when reporting an error.

Limits are configured per deployment. Separate limits apply to:

- `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, and `GET /api/auth/token`;
- booking creation, review creation, and admin mutations;
- all other `/api/v1` calls.

Rate-limit metadata is returned using standard rate-limit headers. A `429` response may include `RateLimit` and `Retry-After` headers.

### Dates, time zones, money, and IDs

- Date-time inputs must be ISO 8601 strings with an offset, for example `2026-07-20T10:00:00Z` or `2026-07-20T16:00:00+06:00`.
- JSON date-time outputs are ISO 8601 UTC strings.
- Weekly availability uses UTC weekday/minute values. `dayOfWeek` is `0` Sunday through `6` Saturday.
- Booking and slot calculations use UTC and bookings cannot cross UTC midnight.
- Tutor slots begin on 30-minute boundaries.
- UUID validation is explicit for booking IDs in actions, tutor/category IDs during booking, review paths, and several admin filters. Some other ID paths accept any non-empty string and return `404` if not found.
- Prisma decimal values normally serialize as strings (for example `"45.00"`). The slots endpoint explicitly converts `hourlyRate` to a number. Frontends should normalize monetary values deliberately and avoid binary floating-point arithmetic for financial display/calculation.

### Core enums

```ts
type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";
type BookingStatus = "CONFIRMED" | "COMPLETED" | "CANCELLED";
type BookingAction = "CANCEL" | "COMPLETE" | "REVIEW";
type TutorSort =
  | "recommended"
  | "rating_desc"
  | "price_asc"
  | "price_desc"
  | "reviews_desc";
```

## 4. Endpoint inventory

| Method | Path | Access |
|---|---|---|
| GET | `/health` | Public |
| GET | `/ready` | Public |
| POST | `/api/auth/sign-up/email` | Public |
| POST | `/api/auth/sign-in/email` | Public |
| GET | `/api/auth/get-session` | Session cookie |
| POST | `/api/auth/sign-out` | Session cookie |
| GET | `/api/auth/token` | Session cookie |
| GET | `/api/auth/jwks` | Public/internal |
| GET | `/api/v1/me` | Any authenticated user, including banned |
| PATCH | `/api/v1/me` | Active authenticated user in practice; banned users are rejected |
| GET | `/api/v1/categories` | Public |
| POST | `/api/v1/admin/categories` | Admin |
| PATCH | `/api/v1/admin/categories/:categoryId` | Admin |
| PATCH | `/api/v1/admin/categories/:categoryId/status` | Admin |
| GET | `/api/v1/tutors` | Public |
| GET | `/api/v1/tutors/:tutorId` | Public |
| GET | `/api/v1/tutors/:tutorId/slots` | Public |
| GET | `/api/v1/tutors/:tutorId/reviews` | Public |
| GET | `/api/v1/tutor/profile` | Tutor |
| PUT | `/api/v1/tutor/profile` | Tutor |
| GET | `/api/v1/tutor/availability` | Tutor |
| PUT | `/api/v1/tutor/availability` | Tutor |
| POST | `/api/v1/bookings` | Student |
| GET | `/api/v1/bookings` | Active authenticated user |
| GET | `/api/v1/bookings/:bookingId` | Booking participant or admin |
| PATCH | `/api/v1/bookings/:bookingId/cancel` | Owning student or assigned tutor |
| PATCH | `/api/v1/bookings/:bookingId/complete` | Assigned tutor or admin |
| POST | `/api/v1/bookings/:bookingId/review` | Owning student |
| GET | `/api/v1/admin/stats` | Admin |
| GET | `/api/v1/admin/users` | Admin |
| PATCH | `/api/v1/admin/users/:userId/status` | Admin |
| GET | `/api/v1/admin/tutors` | Admin |
| GET | `/api/v1/admin/tutors/:tutorId` | Admin |
| PATCH | `/api/v1/admin/tutors/:tutorId/approval` | Admin |
| GET | `/api/v1/admin/bookings` | Admin |
| PATCH | `/api/v1/admin/bookings/:bookingId/status` | Admin |

The Express app delegates the entire `/api/auth/*` namespace to Better Auth. The table lists the auth endpoints directly required by this backend's configured email/password and JWT flow. Other Better Auth routes, if introduced or enabled by upgrading/configuring the library, are library-managed rather than custom SkillBridge contracts.

## 5. System endpoints

### `GET /health`

Liveness check. Does not query the database.

**Response — `200`**

```json
{
  "success": true,
  "data": { "status": "UP", "timestamp": "2026-07-17T10:00:00.000Z" },
  "requestId": "04ce3a45-2fdc-4ba3-a80b-7d47264d8f89"
}
```

### `GET /ready`

Readiness check that runs `SELECT 1` against PostgreSQL.

**Response — `200`:** `data.status` is `READY` and `data.database` is `CONNECTED`.

**Response — `503`:** code `DATABASE_UNAVAILABLE` when the database query fails.

## 6. Better Auth endpoints

Better Auth may add cookie headers and has library-managed response/error details. The request additions below are defined by `src/auth/auth.ts`.

### `POST /api/auth/sign-up/email`

Creates a student or tutor and automatically signs the user in.

```ts
type SignUpBody = {
  name: string;
  email: string;
  password: string;
  role?: "STUDENT" | "TUTOR"; // default STUDENT
  phone?: string;
  image?: string;
};
```

```json
{
  "name": "Ayesha Rahman",
  "email": "ayesha@example.com",
  "password": "example-password",
  "role": "STUDENT",
  "phone": "+8801700000000"
}
```

Success returns Better Auth's sign-up result and establishes a session cookie. The user object also includes SkillBridge's `role`, `status`, and optional `phone`. `status` input is ignored and forced to `ACTIVE`. `role: "ADMIN"` or any other value returns `400` with message `Invalid registration role. Only STUDENT or TUTOR are allowed.`

### `POST /api/auth/sign-in/email`

Signs in with an email and password and establishes a session cookie.

```json
{ "email": "ayesha@example.com", "password": "example-password" }
```

Use Better Auth's returned user/session data for initial UI state, then call `/api/auth/token` before using protected business routes.

### `GET /api/auth/get-session`

Returns the current Better Auth session and user when the request includes the session cookie. An unauthenticated request returns the Better Auth unauthenticated result (commonly `null`).

### `POST /api/auth/sign-out`

Invalidates the current session cookie. Include `credentials: "include"`. Clear any in-memory JWT after success.

### `GET /api/auth/token`

Uses the session cookie to issue the JWT required by protected `/api/v1` endpoints.

```json
{ "token": "eyJ..." }
```

### `GET /api/auth/jwks`

Public JSON Web Key Set used by the backend to verify JWTs. Frontends normally do not call it.

## 7. Current user

### User shape

```ts
type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phone: string | null;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
};
```

### `GET /api/v1/me`

Returns the current database user. Requires Bearer JWT. This is the one protected business endpoint available to a banned user, allowing the frontend to display the ban state.

**Response — `200`:** `Success<User>`.

### `PATCH /api/v1/me`

Updates the current user's editable profile fields. Requires Bearer JWT.

| Body field | Type | Rules |
|---|---|---|
| `name` | string, optional | At least 1 character. |
| `image` | string or null, optional | Must be a valid URL when non-null. |
| `phone` | string or null, optional | No format/length validation in the current implementation. |

```json
{ "name": "Ayesha R.", "image": null, "phone": "+8801700000000" }
```

**Response — `200`:** `Success<User>`.

## 8. Categories

### Category shape

```ts
type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
```

### `GET /api/v1/categories`

Returns active categories sorted by `name` ascending.

| Query | Type | Rules |
|---|---|---|
| `search` | string | Case-insensitive substring search over name and description. |
| `limit` | positive integer | Optional result limit; no explicit maximum. |

**Response — `200`:** `Success<Category[]>`. This endpoint is not paginated.

### `POST /api/v1/admin/categories`

Creates a category. Requires Admin Bearer JWT.

| Body field | Type | Rules |
|---|---|---|
| `name` | string | Required, 2–80 characters; case-insensitively unique. |
| `slug` | string | Optional, 2–100 characters, lowercase URL-safe pattern `^[a-z0-9]+(?:-[a-z0-9]+)*$`; unique. |
| `description` | string or null | Optional, maximum 1000 characters. |

When omitted, `slug` is generated from `name`. Success is `201 Success<Category>`. Conflicts use `CATEGORY_NAME_CONFLICT` or `CATEGORY_SLUG_CONFLICT`.

### `PATCH /api/v1/admin/categories/:categoryId`

Partially updates `name`, `slug`, and/or `description` using the same limits as creation. Success is `200 Success<Category>`. Returns `404 NOT_FOUND` when absent and the category conflict codes on duplicates.

### `PATCH /api/v1/admin/categories/:categoryId/status`

```json
{ "isActive": false }
```

`isActive` is required and boolean. Success is `200 Success<Category>`. Deactivating a category removes it from public category results and prevents it from being selected for new tutor profiles/bookings; it does not delete existing relations.

## 9. Tutors and discovery

### Tutor data notes

Tutor profile records include fields such as `id`, `userId`, `headline`, `bio`, `experienceYears`, `hourlyRate`, `currencyCode`, `approvalStatus`, `rejectionReason`, `approvedAt`, `approvedById`, `createdAt`, and `updatedAt`. Expanded responses add `user`, `categories`, and sometimes `approvedBy`.

Category links use this nested shape:

```ts
type TutorCategoryLink = {
  tutorProfileId: string;
  categoryId: string;
  category: Category;
};
```

### `GET /api/v1/tutors`

Searches only approved tutors whose user account is active.

| Query | Type | Default/rules |
|---|---|---|
| `q` | string | Searches tutor headline, bio, and user name. |
| `category` | string | Exact active category slug. |
| `minRate` | number | Minimum `0`. |
| `maxRate` | number | Must be greater than `0`. |
| `minRating` | number | `1`–`5`; unrated tutors have rating `0`. |
| `sort` | `TutorSort` | `recommended`. |
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `20`, maximum `100`. |

Sort behavior:

- `recommended`: newest profiles first.
- `rating_desc`: average rating, then review count, then newest.
- `reviews_desc`: review count, then average rating, then newest.
- `price_asc` / `price_desc`: hourly rate, then newest.

**Response — `200`:** paginated tutor profiles. Each item contains nested public user `{ id, name, image }`, category links whose category is `{ id, name, slug }`, plus numeric `averageRating` and `reviewCount`.

### `GET /api/v1/tutors/:tutorId`

Returns one active, approved public tutor with the same public nested fields plus `averageRating` and `reviewCount`. Returns `404 NOT_FOUND` with `Tutor not found.` for missing, inactive, pending, or rejected tutors.

### `GET /api/v1/tutors/:tutorId/slots`

Returns currently bookable slot starts for an active, approved tutor.

| Query | Type | Rules |
|---|---|---|
| `dateFrom` | ISO date-time | Required, offset required. |
| `dateTo` | ISO date-time | Required, after `dateFrom`; range at most 31 days. |

```ts
type TutorSlots = {
  tutorId: string;
  timezone: "UTC";
  hourlyRate: number;
  currencyCode: string;
  supportedDurations: number[];
  slots: Array<{
    startAt: string;
    endAtByDuration: Record<string, string>;
  }>;
};
```

```json
{
  "success": true,
  "data": {
    "tutorId": "4cc5c8d6-2145-4b34-a7a2-3ddf826f683b",
    "timezone": "UTC",
    "hourlyRate": 30,
    "currencyCode": "USD",
    "supportedDurations": [30, 60, 90, 120],
    "slots": [
      {
        "startAt": "2026-07-20T10:00:00.000Z",
        "endAtByDuration": {
          "30": "2026-07-20T10:30:00.000Z",
          "60": "2026-07-20T11:00:00.000Z"
        }
      }
    ]
  }
}
```

The frontend selects a `startAt` and one key from `endAtByDuration`. Starts are aligned to the next future 30-minute boundary. Confirmed bookings are excluded. A slot duration must fit wholly inside one weekly availability interval and cannot cross UTC midnight.

### `GET /api/v1/tutor/profile`

Tutor-only. Returns the current tutor's complete profile with nested categories, safe user fields, and approver details. Returns `404` until the tutor creates a profile.

### `PUT /api/v1/tutor/profile`

Creates or replaces the tutor's editable profile and category selection.

| Body field | Type | Rules |
|---|---|---|
| `headline` | string | Required, 5–160 characters. |
| `bio` | string | Required, 50–5000 characters. |
| `experienceYears` | integer | Required, 0–80. |
| `hourlyRate` | number | Required, greater than 0, maximum 2 fractional digits. |
| `categoryIds` | string[] | Required, at least one; every ID must identify an active category. |

First creation sets approval to `PENDING`. Later edits preserve the existing approval state and approval metadata. The category associations are fully replaced. Duplicate category IDs should be avoided: validation compares the number of supplied IDs against active database rows before deduplication, so duplicates can cause `400 VALIDATION_ERROR`.

**Response — `200`:** complete tutor profile.

## 10. Tutor availability

```ts
type WeeklyAvailability = {
  id: string;
  tutorProfileId: string;
  dayOfWeek: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};
```

Convert a UTC time to minutes with `hours * 60 + minutes`. For example, 09:30 UTC is `570`; `1440` is allowed only as an end and means midnight at the end of that UTC day.

### `GET /api/v1/tutor/availability`

Tutor-only. Returns active weekly intervals sorted by weekday then start minute. Returns `404` if no tutor profile exists.

### `PUT /api/v1/tutor/availability`

Replaces all active weekly availability atomically.

```json
{
  "slots": [
    { "dayOfWeek": 1, "startMinuteUtc": 540, "endMinuteUtc": 720 },
    { "dayOfWeek": 3, "startMinuteUtc": 840, "endMinuteUtc": 1080 }
  ]
}
```

Rules:

- `slots` is required and may contain 0–100 entries; an empty array clears availability.
- `dayOfWeek` is an integer `0`–`6`.
- `startMinuteUtc` is an integer `0`–`1439`.
- `endMinuteUtc` is an integer `1`–`1440` and must be greater than the start.
- Entries on the same weekday must not overlap. Adjacent intervals are allowed.

**Response — `200`:** `Success<WeeklyAvailability[]>` containing the new active entries.

## 11. Bookings

### Booking response model

```ts
type Booking = {
  id: string;
  studentId: string;
  tutorProfileId: string;
  categoryId: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  hourlyRateSnapshot: string;
  quotedPrice: string;
  currencyCode: string;
  note: string | null;
  status: BookingStatus;
  cancelledAt: string | null;
  cancelledById: string | null;
  cancellationReason: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
```

List/detail responses expand student, tutor profile/user, category, and review. Detail also contains chronological `statusHistory`, `allowedActions`, and—only for admins—`allowedAdminTransitions`.

Treat `allowedActions` and `allowedAdminTransitions` as the authoritative UI action hints, but still handle conflicts because eligibility can change between rendering and mutation.

### `POST /api/v1/bookings`

Student-only. Creates an immediately `CONFIRMED` booking.

| Body field | Type | Rules |
|---|---|---|
| `tutorId` | UUID | Tutor profile ID, not user ID. |
| `categoryId` | UUID | Active category assigned to this tutor. |
| `startAt` | ISO date-time | Offset required, future, exact 30-minute boundary. |
| `durationMinutes` | positive integer | Must be in deployment `BOOKING_DURATION_OPTIONS`; defaults are 30, 60, 90, 120. |
| `note` | string | Optional, maximum 500 characters. |

```json
{
  "tutorId": "4cc5c8d6-2145-4b34-a7a2-3ddf826f683b",
  "categoryId": "f49bb09f-8c18-4393-b938-f0170bf60ef8",
  "startAt": "2026-07-20T10:00:00Z",
  "durationMinutes": 60,
  "note": "Please focus on calculus fundamentals."
}
```

**Response — `201`:** `Success<Booking>` (base booking fields only).

Specific creation errors:

| HTTP/code | Condition |
|---|---|
| `400 INVALID_DURATION` | Duration is not configured. |
| `400 INVALID_ALIGNMENT` | Start is not exactly on a 30-minute boundary. |
| `400 PAST_START_TIME` | Start is now or earlier. |
| `400 MIDNIGHT_CROSSING` | Session crosses UTC midnight. |
| `400 OUT_OF_AVAILABILITY` | Session does not fit a weekly interval. |
| `403 INACTIVE_STUDENT` | Current database account is not an active student. |
| `404 NOT_FOUND` | Tutor is unavailable/inactive/unapproved or category is invalid for the tutor. |
| `409 BOOKING_SLOT_CONFLICT` | Another confirmed booking overlaps. |

`hourlyRateSnapshot` and `quotedPrice` are fixed when the booking is created. Quoted price is rounded to two decimals: `hourlyRate * durationMinutes / 60`.

### `GET /api/v1/bookings`

Lists bookings visible to the current user:

- Student: own bookings.
- Tutor: bookings assigned to their tutor profile.
- Admin: all bookings.

| Query | Type | Default/rules |
|---|---|---|
| `status` | `BookingStatus` | Optional. |
| `from` | ISO date-time | Inclusive lower bound on `startAt`. |
| `to` | ISO date-time | Inclusive upper bound on `startAt`; this endpoint does not validate `to >= from`. |
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `10`, maximum `100`. |

**Response — `200`:** paginated expanded bookings ordered by `startAt` descending, each with `allowedActions`.

### `GET /api/v1/bookings/:bookingId`

Accessible only to the owning student, assigned tutor, or an admin. `bookingId` must be a UUID.

**Response — `200`:** fully expanded booking with `statusHistory`, `allowedActions`, and optional `allowedAdminTransitions`.

### `PATCH /api/v1/bookings/:bookingId/cancel`

Owning student or assigned tutor only. The booking must be `CONFIRMED` and the request must occur before `startAt`.

```json
{ "reason": "Schedule conflict" }
```

`reason` is optional, trimmed, and at most 1000 characters; empty text becomes absent. Success is `200` with the expanded booking detail. Errors include `BOOKING_STATUS_CONFLICT` and `BOOKING_ALREADY_STARTED`.

### `PATCH /api/v1/bookings/:bookingId/complete`

Assigned tutor or admin only. Send an empty JSON body or no body. The booking must still be `CONFIRMED`, and current time must be at or after `endAt`.

Success is `200` with expanded booking detail. An ineligible booking returns `409 BOOKING_NOT_COMPLETABLE`.

### Booking status behavior

- `CONFIRMED → CANCELLED`: participant cancellation before start, or admin override.
- `CONFIRMED → COMPLETED`: assigned tutor/admin after end, or admin override.
- Admin may override to any different booking status with a reason.
- A completed booking with a review cannot be changed away from `COMPLETED`.
- Reconfirmation requires an active, approved tutor and no overlap with another confirmed booking.
- Every transition adds an immutable status-history entry with actor, role, reason, and timestamp.

## 12. Reviews

### `POST /api/v1/bookings/:bookingId/review`

Student-only. The caller must own the booking, the booking must be `COMPLETED`, and it must not already have a review.

| Body field | Type | Rules |
|---|---|---|
| `rating` | integer | Required, 1–5. |
| `comment` | string | Required, trimmed, 10–2000 characters. |

```json
{ "rating": 5, "comment": "Clear explanations and excellent examples." }
```

**Response — `201`:** base review record with `id`, booking/student/tutor IDs, rating, comment, and timestamps.

Errors include `403 FORBIDDEN`, `409 BOOKING_NOT_COMPLETED`, and `409 BOOKING_ALREADY_REVIEWED`. Reviews have no edit or delete endpoint.

### `GET /api/v1/tutors/:tutorId/reviews`

Public. The tutor ID must identify an active, approved tutor and must be a UUID.

| Query | Type | Default/rules |
|---|---|---|
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `20`, maximum `100`. |

**Response — `200`:** paginated reviews newest first. Each item is:

```ts
type PublicReview = {
  id: string;
  bookingId: string;
  rating: number;
  comment: string;
  createdAt: string;
  student: { id: string; name: string; image: string | null };
};
```

## 13. Administration

All endpoints in this section require an active Admin Bearer JWT.

### `GET /api/v1/admin/stats`

Returns:

```ts
type AdminStats = {
  totalStudents: number;
  totalTutors: number;
  activeBookings: number; // CONFIRMED bookings
  totalCategories: number; // includes inactive categories
  averageTutorRating: number;
  averageHourlyRate: number;
};
```

### `GET /api/v1/admin/users`

| Query | Type | Default/rules |
|---|---|---|
| `q` | non-empty string | Searches name/email case-insensitively. |
| `role` | `UserRole` | Optional. |
| `status` | `UserStatus` | Optional. |
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `20`, maximum `100`. |

Returns paginated `User[]`, ordered newest first.

### `PATCH /api/v1/admin/users/:userId/status`

```json
{ "status": "BANNED", "reason": "Repeated policy violations" }
```

`status` is `ACTIVE` or `BANNED`. `reason` is required, trimmed, and 1–1000 characters. The reason is written to server logs but is not stored on the returned user record. An admin cannot ban their own account (`409 SELF_BAN_FORBIDDEN`). Success returns a reduced user object without `emailVerified`, `image`, or `phone`.

### `GET /api/v1/admin/tutors`

| Query | Type | Default/rules |
|---|---|---|
| `approvalStatus` | `ApprovalStatus` | Optional. |
| `q` | string | Searches headline, bio, user name, and email. |
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `20`, maximum `100`. |

Returns paginated complete tutor profiles newest first, including categories, safe user fields, and approver details.

### `GET /api/v1/admin/tutors/:tutorId`

Returns a complete tutor profile regardless of approval/account state. Returns `404` if absent.

### `PATCH /api/v1/admin/tutors/:tutorId/approval`

```ts
type TutorApprovalBody =
  | { status: "APPROVED"; reason?: string | null }
  | { status: "REJECTED"; reason: string };
```

Approval requires at least one currently active category. Rejection requires a non-empty reason. Approval records the approving admin and timestamp and clears rejection reason. Rejection stores the reason and clears approval metadata. Success returns the complete profile.

### `GET /api/v1/admin/bookings`

| Query | Type | Default/rules |
|---|---|---|
| `q` | non-empty string | Searches student/tutor name or email and category name. |
| `studentId` | non-empty string | Exact student ID. |
| `tutorId` | UUID | Exact tutor profile ID. |
| `status` | `BookingStatus` | Optional. |
| `from` | ISO date-time | Inclusive lower `startAt` bound. |
| `to` | ISO date-time | Inclusive upper `startAt` bound; must be at/after `from`. |
| `page` | positive integer | `1`. |
| `pageSize` | positive integer | `20`, maximum `100`. |

Returns paginated bookings ordered by start time descending. Each result includes reduced student, tutor/user, category, and review projections.

### `PATCH /api/v1/admin/bookings/:bookingId/status`

```json
{ "status": "CANCELLED", "reason": "Administrative correction" }
```

`bookingId` must be a UUID. `status` is any `BookingStatus`; `reason` is required, trimmed, and 1–1000 characters. Target status must differ from current status.

Success returns the fully expanded booking detail. Possible conflicts include:

- `BOOKING_STATUS_CONFLICT` for identical status or changing a reviewed completed booking;
- `TUTOR_NOT_APPROVED` when reconfirming with an ineligible tutor;
- `BOOKING_SLOT_CONFLICT` when reconfirmation overlaps another confirmed booking.

## 14. Frontend workflows

### Student booking flow

1. Sign in and obtain a JWT.
2. Load `/api/v1/categories` and `/api/v1/tutors`.
3. Load one tutor and `/slots?dateFrom=...&dateTo=...`.
4. Pick `startAt` and a duration key actually present in `endAtByDuration`.
5. Create the booking and handle `BOOKING_SLOT_CONFLICT` because another student may book first.
6. Render `allowedActions` from booking list/detail.
7. After completion, show review UI only when `allowedActions` includes `REVIEW`.

### Tutor onboarding flow

1. Register with `role: "TUTOR"`, sign in, and obtain a JWT.
2. Load active categories.
3. `PUT /api/v1/tutor/profile`; first creation becomes `PENDING`.
4. `PUT /api/v1/tutor/availability` using UTC values.
5. Poll or refresh `GET /api/v1/tutor/profile` to observe approval state/reason.
6. After approval, the tutor becomes public; only an active account is discoverable/bookable.

### Authentication recovery behavior

- On `401 TOKEN_EXPIRED`, use the Better Auth session cookie to request a new `/api/auth/token`, then retry once.
- On `401 TOKEN_INVALID`, discard the JWT and re-establish authentication.
- On `403 USER_BANNED`, clear protected app state, call `/api/v1/me` if needed, and show the banned-account UI.
- On `429 RATE_LIMITED`, respect `Retry-After` and avoid immediate retries.

## 15. Current implementation caveats

- `/api/v1` authentication is Bearer-only even though Better Auth also establishes a cookie session.
- Public registration is limited to students and tutors; administrators are seeded/configured outside public APIs.
- `PATCH /api/v1/me` declares only `requireAuth`, but the global banned-user rule still blocks banned users from updating.
- Category admin routes do not explicitly include `requireActive`; the global banned-user check still blocks banned admins.
- Tutor profile updates do not reset an already approved profile to `PENDING`.
- `PUT /api/v1/tutor/profile` is a full editable-profile replacement, not a partial update.
- `GET /api/v1/bookings` does not validate that `to` is after `from`; the admin booking list does.
- Slot availability is a snapshot. Booking creation repeats all eligibility/overlap checks and may reject a displayed slot.
- Default duration values are documented as examples; the slots response is the runtime source of truth.
- There are no APIs for payments, refunds, messaging, video calls, recurring bookings, calendar sync, or review editing/deletion.
