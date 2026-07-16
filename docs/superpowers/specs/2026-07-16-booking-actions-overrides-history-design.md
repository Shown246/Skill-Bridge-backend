# Task 10: Booking Actions, Overrides & History (Phase 6) Design

## Objective

Implement role-scoped booking cancellation, tutor/admin completion, administrative status overrides, transactional audit history, and accurate allowed-action calculation without weakening the concurrency guarantees established by the booking core.

## API Design

### `PATCH /api/v1/bookings/:bookingId/cancel`

- Authentication: active `STUDENT` or `TUTOR`.
- Request body:

  ```json
  {
    "reason": "Optional cancellation reason"
  }
  ```

- `reason` is optional, trimmed, and limited to 1000 characters.
- A student may cancel only a booking they own.
- A tutor may cancel only a booking assigned to their tutor profile.
- The booking must be `CONFIRMED`.
- Server time must be strictly before `startAt`.
- At exactly `startAt`, cancellation is rejected.
- A successful request returns the updated booking with history and allowed actions.

Admins cancel bookings through the administrative override endpoint so that an audit reason is always required and normal cancellation time boundaries may be deliberately bypassed.

### `PATCH /api/v1/bookings/:bookingId/complete`

- Authentication: active `TUTOR` or `ADMIN`.
- No request body is required.
- A tutor may complete only a booking assigned to their tutor profile.
- An admin may complete any booking through this standard action.
- The booking must be `CONFIRMED`.
- Server time must be at or after `endAt`.
- Early administrative completion must use the administrative override endpoint and include a reason.
- A successful request returns the updated booking with history and allowed actions.

### `PATCH /api/v1/admin/bookings/:bookingId/status`

- Authentication: active `ADMIN`.
- Request body:

  ```json
  {
    "status": "COMPLETED",
    "reason": "Administrative correction"
  }
  ```

- `status` must be `CONFIRMED`, `COMPLETED`, or `CANCELLED`.
- `reason` is required, trimmed, non-empty, and limited to 1000 characters.
- The target status must differ from the current status.
- Admin overrides may bypass normal cancellation and completion time boundaries.
- Admin overrides must preserve booking, review, and overlap integrity.
- A successful request returns the updated booking with history, allowed actions, and allowed admin transitions.

### `GET /api/v1/bookings/:bookingId`

This remains the only booking status-history retrieval endpoint. No separate history route will be added.

The response includes:

- Booking participants, category, time, quote, and status metadata.
- `statusHistory` ordered by `createdAt` ascending.
- Actor ID, actor-role snapshot, reason, source status, target status, and timestamp for each history entry.
- Actor-specific `allowedActions`.
- `allowedAdminTransitions` when the requester is an admin.

## Architecture

Controllers validate route parameters and bodies, pass the authenticated actor to the service, and translate the service result into the standard success envelope. Controllers do not contain transition, ownership, time-boundary, overlap, or metadata-cleanup logic.

The booking service exposes actor-specific public methods for cancellation, standard completion, and administrative override. These methods delegate mutation work to one focused internal transition engine. This centralizes:

- Current-state validation.
- Ownership and role checks.
- Server-time boundary checks.
- Admin override rules.
- Booking metadata cleanup.
- Status-history insertion.
- Allowed-action calculation.

The booking repository owns tutor-row locking, transactional booking reads and writes, confirmed-overlap queries, and history insertion.

## Transition Rules

| Operation | Allowed source status | Target status | Time boundary | Actor |
|---|---|---|---|---|
| Participant cancellation | `CONFIRMED` | `CANCELLED` | `now < startAt` | Owning student or assigned tutor |
| Standard completion | `CONFIRMED` | `COMPLETED` | `now >= endAt` | Assigned tutor or admin |
| Admin override | Any status different from target | Requested status | Normal time rules may be bypassed | Admin |

Same-status administrative overrides are rejected with `409 BOOKING_STATUS_CONFLICT`. They do not create history entries.

## Transaction and Concurrency Design

Each status mutation runs inside a Prisma interactive transaction configured with:

```ts
{
  maxWait: 15000,
  timeout: 15000
}
```

The mutation flow is:

1. Locate the booking sufficiently to identify its tutor profile.
2. Lock the related `TutorProfile` row using `SELECT ... FOR UPDATE`.
3. Re-read the booking, tutor state, and review state inside the transaction.
4. Re-check actor authorization, current status, and server-time boundaries.
5. When targeting `CONFIRMED`, validate tutor eligibility and confirmed-booking overlap while holding the same tutor lock used by booking creation.
6. Update the booking and append one history row in the same transaction.
7. Commit, then return a fully hydrated booking response with recalculated action fields.

Using the existing tutor-row lock serializes booking creation, cancellation, completion, and reconfirmation for the same tutor. In particular, it prevents an admin reconfirmation and a new student booking from both claiming the same time interval.

## Booking Metadata Rules

### Target `CANCELLED`

- Set `status = CANCELLED`.
- Set `cancelledAt` to server time.
- Set `cancelledById` to the authenticated actor.
- Set `cancellationReason` to the normalized participant reason or required admin reason.
- Clear `completedAt`.

### Target `COMPLETED`

- Set `status = COMPLETED`.
- Set `completedAt` to server time.
- Clear `cancelledAt`.
- Clear `cancelledById`.
- Clear `cancellationReason`.

### Target `CONFIRMED`

- Set `status = CONFIRMED`.
- Clear `completedAt`.
- Clear `cancelledAt`.
- Clear `cancelledById`.
- Clear `cancellationReason`.

All metadata changes and history insertion occur atomically.

## Admin Reconfirmation Rules

When an admin changes a `CANCELLED` or `COMPLETED` booking to `CONFIRMED`:

- The tutor user must remain `ACTIVE`.
- The tutor profile must remain `APPROVED`.
- The booking must not overlap another `CONFIRMED` booking for the same tutor. The booking being reconfirmed is excluded from the overlap query.
- Adjacent bookings remain valid under the existing half-open overlap rule.
- The original category and price snapshots are preserved.
- The category is not required to remain active or currently assigned.
- Current recurring weekly availability is not revalidated.
- A past booking may be reconfirmed as an explicit administrative correction.

Failure caused by an inactive or unapproved tutor returns `409 TUTOR_NOT_APPROVED`. An overlap returns `409 BOOKING_SLOT_CONFLICT`.

## Review Integrity

Once a `COMPLETED` booking has a review, an admin may not transition that booking to `CONFIRMED` or `CANCELLED`. Allowing that transition would leave an immutable review attached to a booking that no longer satisfies the completed-booking rule.

Such attempts return `409 BOOKING_STATUS_CONFLICT` and append no history row.

## Status History

Every successful booking creation or status mutation has exactly one corresponding `BookingStatusHistory` record.

For Task 10 mutations, each history record stores:

- `bookingId`.
- `fromStatus`.
- `toStatus`.
- `actorUserId`.
- `actorRole` as a snapshot at mutation time.
- Normalized reason when provided or required.
- `createdAt`.

The history row is inserted in the same database transaction as the booking update. If either operation fails, neither persists.

Booking detail queries return history in chronological order. Failed mutations and rejected same-status overrides never create history entries.

## Allowed Actions

`allowedActions` remains actor-specific:

- `CANCEL`: the booking is `CONFIRMED`, server time is before `startAt`, and the requester is the owning student or assigned tutor.
- `COMPLETE`: the booking is `CONFIRMED`, server time is at or after `endAt`, and the requester is the assigned tutor or an admin.
- `REVIEW`: the booking is `COMPLETED`, the requester is the owning student, and no review exists.

For admins, booking detail additionally returns `allowedAdminTransitions`, containing target booking statuses that are currently valid:

- The current status is always excluded.
- `CONFIRMED` is excluded when tutor eligibility or overlap checks would fail.
- `CONFIRMED` and `CANCELLED` are excluded when a completed booking already has a review.
- Admin transition availability is not constrained by cancellation or completion time boundaries.

The mutation service remains authoritative. Returned action fields are advisory and are recalculated from current state on every response.

## Validation and Error Handling

Route parameters use UUID validation. Request bodies use Zod schemas and the existing centralized error handler.

| Condition | HTTP status | Error code |
|---|---:|---|
| Invalid body or booking ID | 400 | `VALIDATION_ERROR` |
| Booking not found | 404 | `NOT_FOUND` |
| Actor does not own or service the booking | 403 | `FORBIDDEN` |
| Cancellation at or after start | 409 | `BOOKING_ALREADY_STARTED` |
| Cancellation from a non-confirmed status | 409 | `BOOKING_STATUS_CONFLICT` |
| Completion before end or from a non-confirmed status | 409 | `BOOKING_NOT_COMPLETABLE` |
| Same-status admin override | 409 | `BOOKING_STATUS_CONFLICT` |
| Reviewed-booking reversal | 409 | `BOOKING_STATUS_CONFLICT` |
| Reconfirmation overlaps another booking | 409 | `BOOKING_SLOT_CONFLICT` |
| Reconfirmation tutor is inactive or unapproved | 409 | `TUTOR_NOT_APPROVED` |

Prisma errors and transaction failures are sanitized by the existing centralized error handling and do not leak database details.

## Testing Strategy

Service and Supertest integration tests will cover:

- Student cancellation of an owned future confirmed booking.
- Tutor cancellation of an assigned future confirmed booking.
- Optional cancellation reason normalization and maximum length.
- Rejection of other students and unrelated tutors.
- Cancellation one millisecond before `startAt`.
- Rejection exactly at `startAt` and afterward.
- Rejection of repeated cancellation and cancellation of completed bookings.
- Tutor completion exactly at `endAt` and afterward.
- Rejection of tutor completion before `endAt`, repeated completion, and unrelated tutor completion.
- Admin standard completion at or after `endAt`.
- Required, normalized admin override reason.
- Admin overrides across all different status pairs.
- Correct metadata set/clear behavior for every target status.
- Same-status override rejection.
- Reconfirmation rejection for inactive/unapproved tutors.
- Reconfirmation overlap rejection and adjacent-booking acceptance.
- Concurrent reconfirmation and booking creation for the same time interval.
- Reviewed-completed-booking reversal rejection.
- Exactly one correct history row for every success and none for every failure.
- Chronological history in booking detail.
- Actor-specific `allowedActions`.
- Admin-only `allowedAdminTransitions`.
- Authentication, active-status, and role middleware behavior.

Boundary tests control server time deterministically.

After implementation, verification runs:

```text
npm test -- tests/booking.service.test.ts
npm test -- tests/booking.test.ts
npm run typecheck
npm run lint
npm run build
npm test
```

## Persistence Impact

No Prisma schema change or migration is required. The existing `Booking` and `BookingStatusHistory` models already contain all required status metadata, actor metadata, reason, timestamps, relations, and indexes.

## Out of Scope

- A dedicated booking-history endpoint.
- Review creation or rating aggregation.
- Automatic booking completion.
- Notifications.
- Availability exceptions.
- Changes to booking price, category, tutor, student, or time through the override endpoint.
