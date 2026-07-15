# Task 8: UTC Slots Expansion (Phase 4) Design

This document specifies the design for the UTC Slots Expansion task.

## Objective
Implement the slot calculation service, timezone boundary and UTC handling, and the public computed slots endpoint `GET /api/v1/tutors/:tutorId/slots`.

## Architecture & Data Flow

### 1. Database Schema
To calculate bookable slots and handle future booking logic, we add the `Booking` schema and its dependencies (`BookingStatus`, `BookingStatusHistory`, and `Review` models) to `prisma/schema.prisma`.

#### Models to Add:
- **`Booking`**: Tracks student bookings with tutor profiles, hourly rate snapshot, and status.
- **`BookingStatus`**: Enum with values `CONFIRMED`, `COMPLETED`, `CANCELLED`.
- **`BookingStatusHistory`**: Tracks transition logs of booking statuses.
- **`Review`**: Connects a completed booking to a rating and comment.

### 2. Slots Calculation Algorithm
The endpoint `GET /api/v1/tutors/:tutorId/slots` computes availability.
- **Inputs**: 
  - `dateFrom` (ISO 8601 UTC string)
  - `dateTo` (ISO 8601 UTC string)
  - Optional `durationMinutes`
- **Steps**:
  1. Validate date inputs:
     - Check if they are valid ISO 8601 strings.
     - Ensure `dateTo` is after `dateFrom`.
     - Enforce a maximum date range limit of 31 days.
  2. Load the tutor's active weekly availability intervals from the database.
  3. Load all confirmed bookings for the tutor within the concrete `[dateFrom, dateTo]` range.
  4. Generate potential slot start times in 30-minute intervals starting from `dateFrom` (aligned to 30-minute boundaries and in the future relative to `new Date()`) up to `dateTo`.
  5. For each start time:
     - Retrieve candidate durations from `BOOKING_DURATION_OPTIONS` (usually `[30, 60, 90, 120]`).
     - For each duration:
       - Ensure the block `[startAt, startAt + duration]` falls entirely within one of the recurring weekly availability windows.
       - Ensure the block does not overlap with any confirmed bookings.
     - Add valid durations to the map `endAtByDuration` for that start time.
  6. Return a list of slots containing `startAt` and `endAtByDuration`.

## Verification Plan
1. **Unit/Integration Tests**:
   - Write tests in `tests/slots.test.ts`.
   - Test date input validations (invalid formats, date range > 31 days).
   - Test slot tiling and recurrence expansion (verify slots map correctly to days of week).
   - Test exclusion of past slots.
   - Test exclusion of overlaps with confirmed bookings.
   - Test handling of adjacent slots (they should not overlap/conflict).
2. **Command Executions**:
   - Run tests: `npm test` and specific slots test file.
   - Verify TypeScript compilation: `npm run typecheck`.
