# SkillBridge Backend Design Specification

**Date:** 2026-07-15  
**Topic:** SkillBridge Backend Architecture and Specifications  
**Status:** Approved

---

## 1. Purpose & Product Scope

This document details the complete design for the SkillBridge backend. The backend acts as the authoritative source for user authentication, roles, tutor profile management, tutor approvals, slots calculation, concurrency-safe booking, reviews, and administration.

### Key Capabilities
- **Discovery**: Public discovery of approved active tutors.
- **Identity & Auth**: Handled securely by Better Auth using email/credentials.
- **Roles**: Structured roles (`STUDENT`, `TUTOR`, `ADMIN`).
- **Tutor Profiles**: Creation, multi-category assignment, availability management, and admin approval flow.
- **Slots**: UTC-based slots calculated from weekly recurring availability minus confirmed bookings.
- **Bookings**: Instant confirmed bookings with duration choice and hourly rate snapshotting.
- **Concurrency**: Double-booking prevention via PostgreSQL transactional advisory locks per tutor.
- **Reviews**: Immutable ratings and comments for completed sessions, dynamically updated aggregates.
- **Administration**: Ban/unban, tutor approval, category management, status overrides.

---

## 2. System Architecture & Directory Structure

The application will be built using **Node.js, Express, TypeScript, and Prisma ORM**. We follow a clean layered modular architecture.

### Directory Structure
```text
src/
  app.ts                 # Express application setup
  server.ts              # Server entry point
  config/
    env.ts               # Environment variable validation via Zod
    db.ts                # Prisma Client initialization
  auth/
    auth.ts              # Better Auth config and instance export
  middleware/
    auth.middleware.ts   # JWT extraction, database user check, role/status guards
    error.middleware.ts  # Standardized error mapping and serialization
    logging.middleware.ts # Request logger redacting sensitive data
    request-id.ts        # Fast, unique request IDs
    rate-limiter.ts      # Rate limit rules for endpoints
  modules/
    users/               # User account endpoints (/api/v1/me, status view)
    tutors/              # Profiles, moderation details, public searches
    categories/          # Category catalog and admin CRUD
    availability/        # Weekly schedules and slot calculations
    bookings/            # Booking lifecycle, transactional creation, history
    reviews/             # Review submissions and aggregate calculations
    admin/               # Administrative stats, ban actions, booking overrides
  shared/
    errors/              # Custom application-level exception classes
    validation/          # Standard Zod schemas (UUIDs, pagination, strings)
    pagination/          # Pagination metadata formatter
    date/                # UTC timezone and date math utilities
    money/               # Safe Decimal calculations
    logging/             # Structured console logging
```

---

## 3. Database Schema

The schema is defined in `prisma/schema.prisma` using PostgreSQL.

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum UserRole {
  STUDENT
  TUTOR
  ADMIN
}

enum UserStatus {
  ACTIVE
  BANNED
}

enum TutorApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}

enum BookingStatus {
  CONFIRMED
  COMPLETED
  CANCELLED
}

model User {
  id            String      @id
  name          String
  email         String      @unique
  emailVerified Boolean
  image         String?
  phone         String?
  role          UserRole    @default(STUDENT)
  status        UserStatus  @default(ACTIVE)
  createdAt     DateTime
  updatedAt     DateTime

  // Relations
  sessions             Session[]
  accounts             Account[]
  tutorProfile         TutorProfile?
  approvedTutors       TutorProfile[]         @relation("ApprovedByAdmin")
  bookingsAsStudent    Booking[]            @relation("StudentBookings")
  cancelledBookings    Booking[]            @relation("CancelledByActor")
  bookingStatusHistory BookingStatusHistory[]
  reviews              Review[]

  @@index([role])
  @@index([status])
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  password              String?
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  createdAt             DateTime
  updatedAt             DateTime
}

model Verification {
  id         String   @id
  identifier String
  token      String
  expiresAt  DateTime
  createdAt  DateTime?
  updatedAt  DateTime?
}

model TutorProfile {
  id              String              @id @default(uuid())
  userId          String              @unique
  user            User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  headline        String
  bio             String
  experienceYears Int                 @default(0)
  hourlyRate      Decimal             @db.Decimal(10, 2)
  currencyCode    String              @default("USD")
  approvalStatus  TutorApprovalStatus @default(PENDING)
  rejectionReason String?
  approvedAt      DateTime?
  approvedById    String?
  approvedBy      User?               @relation("ApprovedByAdmin", fields: [approvedById], references: [id])
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  // Relations
  categories     TutorCategory[]
  availability   WeeklyAvailability[]
  bookings       Booking[]
  reviews        Review[]

  @@index([approvalStatus])
  @@index([hourlyRate])
}

model Category {
  id          String   @id @default(uuid())
  name        String   @unique
  slug        String   @unique
  description String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  // Relations
  tutors   TutorCategory[]
  bookings Booking[]

  @@index([isActive])
}

model TutorCategory {
  tutorProfileId String
  tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [id], onDelete: Cascade)
  categoryId     String
  category       Category     @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())

  @@id([tutorProfileId, categoryId])
}

model WeeklyAvailability {
  id             String       @id @default(uuid())
  tutorProfileId String
  tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [id], onDelete: Cascade)
  dayOfWeek      Int          // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  startMinuteUtc Int          // 0 to 1439
  endMinuteUtc   Int          // 1 to 1440
  isActive       Boolean      @default(true)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  @@index([tutorProfileId, dayOfWeek])
}

model Booking {
  id                 String        @id @default(uuid())
  studentId          String
  student            User          @relation("StudentBookings", fields: [studentId], references: [id], onDelete: Restrict)
  tutorProfileId     String
  tutorProfile       TutorProfile  @relation(fields: [tutorProfileId], references: [id], onDelete: Restrict)
  categoryId         String
  category           Category      @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  startAt            DateTime
  endAt              DateTime
  durationMinutes    Int
  hourlyRateSnapshot Decimal       @db.Decimal(10, 2)
  quotedPrice        Decimal       @db.Decimal(10, 2)
  currencyCode       String
  note               String?
  status             BookingStatus @default(CONFIRMED)
  cancelledAt        DateTime?
  cancelledById      String?
  cancelledBy        User?         @relation("CancelledByActor", fields: [cancelledById], references: [id])
  cancellationReason String?
  completedAt        DateTime?
  createdAt          DateTime      @default(now())
  updatedAt          DateTime      @updatedAt

  // Relations
  review        Review?
  statusHistory BookingStatusHistory[]

  @@index([studentId, startAt])
  @@index([tutorProfileId, startAt])
  @@index([status, startAt])
  @@index([categoryId])
}

model Review {
  id             String       @id @default(uuid())
  bookingId      String       @unique
  booking        Booking      @relation(fields: [bookingId], references: [id], onDelete: Restrict)
  studentId      String
  student        User         @relation(fields: [studentId], references: [id], onDelete: Restrict)
  tutorProfileId String
  tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [id], onDelete: Restrict)
  rating         Int          // 1 to 5
  comment        String
  createdAt      DateTime     @default(now())

  @@index([tutorProfileId, createdAt])
}

model BookingStatusHistory {
  id          String        @id @default(uuid())
  bookingId   String
  booking     Booking       @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  fromStatus  BookingStatus?
  toStatus    BookingStatus
  actorUserId String
  actorUser   User          @relation(fields: [actorUserId], references: [id], onDelete: Restrict)
  actorRole   UserRole
  reason      String?
  createdAt   DateTime      @default(now())

  @@index([bookingId, createdAt])
}
```

---

## 4. Authentication & Authorization

Better Auth manages credentials and session states. We authenticate requests using JWT tokens issued by Better Auth.

### Token Verification Flow
1. Middleware extracts bearer token from `Authorization: Bearer <token>`.
2. Validates JWT signature using Better Auth public keys (via JWKS endpoint `/api/auth/jwks`).
3. Validates issuer (`JWT_ISSUER`), audience (`JWT_AUDIENCE`), and expiration.
4. Loads the user's latest status (`ACTIVE` / `BANNED`) and role (`STUDENT`, `TUTOR`, `ADMIN`) directly from the database.
   - If the user is `BANNED`, reject all requests with `403 USER_BANNED` immediately, except `GET /api/v1/me`.
   - If user is missing/deleted, reject with `401 AUTHENTICATION_REQUIRED`.

### Roles & Registration Constraints
- **Public Register**: Only role `STUDENT` or `TUTOR` can be passed.
- **Admin Seeding**: Seeded strictly from environment variables (`ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`). No registration route can create an `ADMIN`.

---

## 5. Availability & computed Slots

Tutors maintain weekly availability blocks. Students query available slots for booking.

### Slot Generation Rules
1. Get tutor's `WeeklyAvailability` where `isActive = true`.
2. Get tutor's `Booking` list in the range `[dateFrom, dateTo]` (max 31 days) where `status = CONFIRMED`.
3. Expand weekly recurring blocks into concrete UTC calendar intervals for the dates in `[dateFrom, dateTo]`.
4. Generate starting slots within availability intervals in **30-minute steps**.
5. For each start time, evaluate each duration option (e.g., 30, 60, 90, 120 minutes):
   - Ensure the slot falls entirely within the availability block.
   - Ensure the slot does not overlap with any confirmed booking:
     `existing.startAt < slotEnd AND existing.endAt > slotStart`.
   - If it survives, map the duration to the end time: `endAtByDuration[duration] = slotEnd`.

---

## 6. Booking Flow & Concurrency

Double-booking is prevented using **PostgreSQL Transactional Advisory Locks**.

### Creation Transaction (`POST /api/v1/bookings`)
All steps run atomically inside a database transaction:
1. Deterministically hash `tutorProfileId` (string UUID) into a signed 64-bit integer.
2. Execute `SELECT pg_advisory_xact_lock($1)` to lock the tutor for this transaction.
3. Validate:
   - Student is active.
   - Tutor is active and approved.
   - Category is active and taught by tutor.
   - Duration is supported and fits availability.
4. Query overlapping bookings:
   - Check if any `CONFIRMED` booking overlaps the requested time range.
   - If an overlap exists, abort the transaction and return `409 BOOKING_SLOT_CONFLICT`.
5. Snapshot current hourly rate, compute quoted price decimal-safely, and create the `Booking`.
6. Write to `BookingStatusHistory` (`fromStatus = null`, `toStatus = CONFIRMED`).

---

## 7. Administrative Overrides & Operations

- **Banning**: Admins can set `status = BANNED` for users. Admins are blocked from banning their own logged-in user ID.
- **Tutor Approval**: Admins review profile inputs. Approvals require complete bio and headlines, plus at least one active category assignment. Rejections require a reason.
- **Booking Overrides**: Admins can force-update any booking's status.
  - Re-confirming a booking requires locking the tutor and running overlap checks.
  - Overrides require a `reason` which is appended to `BookingStatusHistory`.
- **Category Management**: Admin creates and updates category catalogs. Deactivating a category marks `isActive = false`, leaving existing bookings associated with it untouched.

---

## 8. Error Codes Specification

Consistent Error Envelope:
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
  "requestId": "req_12345"
}
```

### Required Codes:
- `AUTHENTICATION_REQUIRED` (401)
- `INVALID_CREDENTIALS` (401)
- `TOKEN_EXPIRED` (401)
- `TOKEN_INVALID` (401)
- `FORBIDDEN` (403)
- `USER_BANNED` (403)
- `ROLE_NOT_ALLOWED` (403)
- `VALIDATION_ERROR` (400 or 422)
- `RESOURCE_NOT_FOUND` (404)
- `EMAIL_ALREADY_EXISTS` (409)
- `TUTOR_PROFILE_INCOMPLETE` (400)
- `TUTOR_NOT_APPROVED` (400)
- `TUTOR_UNAVAILABLE` (400)
- `CATEGORY_NOT_ASSIGNED` (400)
- `CATEGORY_INACTIVE` (400)
- `AVAILABILITY_OVERLAP` (409)
- `INVALID_DURATION` (400)
- `BOOKING_SLOT_CONFLICT` (409)
- `BOOKING_ALREADY_STARTED` (400)
- `BOOKING_NOT_COMPLETABLE` (400)
- `BOOKING_STATUS_CONFLICT` (409)
- `REVIEW_NOT_ALLOWED` (400)
- `REVIEW_ALREADY_EXISTS` (409)
- `CATEGORY_NAME_CONFLICT` (409)
- `CATEGORY_SLUG_CONFLICT` (409)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)
