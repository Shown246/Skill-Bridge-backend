# Task 9: Concurrency-Safe Booking Core (Phase 5) Design

This document specifies the design for the Concurrency-Safe Booking Core.

## Objective
Implement transactional booking creation, concurrency protection using row-level locking, price calculation, status history tracking, and role-scoped booking list/detail API endpoints.

## Architecture & API Design

### 1. Concurrency Protection
To prevent double-bookings, booking creation transactions will execute a row-level lock on the `TutorProfile` table:
```sql
SELECT 1 FROM tutor_profile WHERE id = $1 FOR UPDATE;
```
This forces all concurrent booking requests for the same tutor to execute sequentially, preventing any race condition during availability and overlap checks.

### 2. API Endpoints

#### POST `/api/v1/bookings`
- **Auth**: Active student.
- **Payload**:
  ```json
  {
    "tutorId": "string (UUID)",
    "categoryId": "string (UUID)",
    "startAt": "string (ISO 8601 UTC)",
    "durationMinutes": 60,
    "note": "string (optional)"
  }
  ```
- **Transaction Steps**:
  1. Acquire a `FOR UPDATE` lock on the `tutor_profile` row.
  2. Verify that the tutor user status is `ACTIVE` and their tutor profile has `approvalStatus === APPROVED`.
  3. Verify that the category exists, is `isActive === true`, and is linked to the tutor via `TutorCategory`.
  4. Verify that `durationMinutes` is valid (contained in `env.BOOKING_DURATION_OPTIONS`).
  5. Verify that `startAt` is aligned to 30-minute intervals and is in the future.
  6. Compute `endAt = startAt + durationMinutes` and ensure it does not cross UTC midnight.
  7. Validate tutor availability: ensure `[startAt, endAt]` fits entirely within one of the tutor's active `WeeklyAvailability` slots.
  8. Validate no overlap: query for existing bookings with `status === CONFIRMED` where `startAt < endAt` and `endAt > startAt`. If any overlap is found, throw a `409 BOOKING_SLOT_CONFLICT` error.
  9. Calculate price: `quotedPrice = tutor.hourlyRate * durationMinutes / 60`, rounded to 2 decimal places.
  10. Insert `Booking` with status `CONFIRMED`.
  11. Insert `BookingStatusHistory` with `fromStatus = null` and `toStatus = CONFIRMED`.

#### GET `/api/v1/bookings`
- **Auth**: Active student, tutor, or admin.
- **Scoping**:
  - Student: only bookings where `studentId === req.user.id`.
  - Tutor: only bookings where `tutorProfile.userId === req.user.id`.
  - Admin: all bookings.
- **Filters**: `status`, `from`, `to`.
- **Pagination**: Default page = 1, pageSize = 10, max pageSize = 100.
- **Sorting**: Sorted by `startAt` descending.

#### GET `/api/v1/bookings/:bookingId`
- **Auth**: Participant of the booking (student or tutor) or admin.
- **Response**: Details of the booking, including student and tutor names/emails, category details, status history, and `allowedActions` array:
  - `CANCEL`: status is `CONFIRMED` and current time is before `startAt`.
  - `COMPLETE`: status is `CONFIRMED`, user is tutor, and current time is at or after `endAt`.
  - `REVIEW`: status is `COMPLETED`, user is student, and no review has been submitted yet.

## Verification Plan
1. **Concurrency Tests**:
   - Write integration tests in `tests/booking.test.ts`.
   - Test that concurrent requests to book overlapping slots result in exactly one successful booking (status 201) and one conflict (status 409).
2. **API Tests**:
   - Test role-scoping and authorization locks.
   - Test price calculation, status history logging, and allowed actions computation.
   - Test pagination, sorting, and filtering on the list endpoint.
