# Task 8: UTC Slots Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the database models for Bookings and Reviews, and write the UTC slot calculation service and public API endpoint to return bookable tutor slots.

**Architecture:** Extend the Prisma schema with the Booking, BookingStatusHistory, and Review models, run db push to update test and development databases, and build the slots query logic within the tutor module.

**Tech Stack:** Express, TypeScript, Prisma, Zod, Jest, Supertest

## Global Constraints
- All timestamps must be in UTC ISO 8601 format.
- Max date range for slot queries is 31 days.
- Hardcoded slot increment is 30 minutes.

---

### Task 1: Schema Extension and Database Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Test: Run db push targeting both development and test databases.

**Interfaces:**
- Consumes: Existing models (`User`, `TutorProfile`, `Category`).
- Produces: `Booking`, `BookingStatusHistory`, and `Review` tables in the database.

- [ ] **Step 1: Modify `prisma/schema.prisma`**
  Add the relation fields to `User`, `TutorProfile`, and `Category`, and add the new models.
  ```prisma
  // In model User:
  studentBookings   Booking[]              @relation("StudentBookings")
  cancelledBookings Booking[]              @relation("CancelledByActor")
  statusHistory     BookingStatusHistory[]
  reviews           Review[]

  // In model TutorProfile:
  bookings          Booking[]
  reviews           Review[]

  // In model Category:
  bookings          Booking[]

  // Add at the end of the file:
  enum BookingStatus {
    CONFIRMED
    COMPLETED
    CANCELLED
  }

  model Booking {
    id                 String               @id @default(uuid())
    studentId          String
    student            User                 @relation("StudentBookings", fields: [studentId], references: [id], onDelete: Cascade)
    tutorProfileId     String
    tutorProfile       TutorProfile         @relation(fields: [tutorProfileId], references: [id], onDelete: Cascade)
    categoryId         String
    category           Category             @relation(fields: [categoryId], references: [id], onDelete: Cascade)
    startAt            DateTime
    endAt              DateTime
    durationMinutes    Int
    hourlyRateSnapshot Decimal              @db.Decimal(10, 2)
    quotedPrice        Decimal              @db.Decimal(10, 2)
    currencyCode       String               @default("USD")
    note               String?
    status             BookingStatus        @default(CONFIRMED)
    cancelledAt        DateTime?
    cancelledById      String?
    cancelledBy        User?                @relation("CancelledByActor", fields: [cancelledById], references: [id])
    cancellationReason String?
    completedAt        DateTime?
    createdAt          DateTime             @default(now())
    updatedAt          DateTime             @updatedAt
    statusHistory      BookingStatusHistory[]
    review             Review?

    @@index([studentId, startAt])
    @@index([tutorProfileId, startAt])
    @@index([status, startAt])
    @@index([categoryId])
    @@map("booking")
  }

  model BookingStatusHistory {
    id          String        @id @default(uuid())
    bookingId   String
    booking     Booking       @relation(fields: [bookingId], references: [id], onDelete: Cascade)
    fromStatus  BookingStatus?
    toStatus    BookingStatus
    actorUserId String
    actorUser   User          @relation(fields: [actorUserId], references: [id], onDelete: Cascade)
    actorRole   UserRole
    reason      String?
    createdAt   DateTime      @default(now())

    @@index([bookingId, createdAt])
    @@map("booking_status_history")
  }

  model Review {
    id             String       @id @default(uuid())
    bookingId      String       @unique
    booking        Booking      @relation(fields: [bookingId], references: [id], onDelete: Cascade)
    studentId      String
    student        User         @relation(fields: [studentId], references: [id], onDelete: Cascade)
    tutorProfileId String
    tutorProfile   TutorProfile @relation(fields: [tutorProfileId], references: [id], onDelete: Cascade)
    rating         Int
    comment        String
    createdAt      DateTime     @default(now())

    @@map("review")
  }
  ```

- [ ] **Step 2: Generate Prisma client**
  Run: `npx prisma generate`
  Expected: Success without errors.

- [ ] **Step 3: Sync development database**
  Run: `npx prisma db push --accept-data-loss`
  Expected: Success.

- [ ] **Step 4: Sync test database**
  Run:
  ```powershell
  $env:DATABASE_URL="postgresql://neondb_owner:npg_i7etDd2EgHac@ep-calm-feather-adrlhfib-pooler.c-2.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
  npx prisma db push --accept-data-loss
  ```
  Expected: Success.

- [ ] **Step 5: Commit schema changes**
  ```bash
  git add prisma/schema.prisma
  git commit -m "feat: add Booking, BookingStatusHistory, and Review schemas"
  ```

---

### Task 2: Slot Service, Controller, and API Endpoints

**Files:**
- Create: `src/modules/tutors/tutor.slots.service.ts`
- Modify: `src/modules/tutors/tutor.controller.ts`
- Modify: `src/modules/tutors/tutor.routes.ts`
- Modify: `src/modules/tutors/tutor.schemas.ts`
- Test: `tests/slots.test.ts`

**Interfaces:**
- Consumes: Configured `env.BOOKING_DURATION_OPTIONS` and WeeklyAvailability database models.
- Produces: `GET /api/v1/tutors/:tutorId/slots`

- [ ] **Step 1: Write schemas for slot query validation**
  File: `src/modules/tutors/tutor.schemas.ts`
  Add the validation schema for query parameters:
  ```typescript
  export const slotQuerySchema = z.object({
    dateFrom: z.string().datetime(),
    dateTo: z.string().datetime(),
  }).refine((data) => {
    const from = new Date(data.dateFrom);
    const to = new Date(data.dateTo);
    return to > from;
  }, {
    message: "dateTo must be after dateFrom",
    path: ["dateTo"],
  }).refine((data) => {
    const from = new Date(data.dateFrom);
    const to = new Date(data.dateTo);
    const diff = to.getTime() - from.getTime();
    return diff <= 31 * 24 * 60 * 60 * 1000;
  }, {
    message: "Date range must not exceed 31 days",
    path: ["dateTo"],
  });
  ```

- [ ] **Step 2: Implement Slot Calculation Service**
  File: `src/modules/tutors/tutor.slots.service.ts`
  Implement the logic:
  ```typescript
  import { prisma } from '../../config/db.js';
  import { NotFoundError } from '../../shared/errors/app-error.js';
  import { env } from '../../config/env.js';

  export async function getTutorSlots(tutorId: string, dateFromStr: string, dateToStr: string) {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { id: tutorId },
      include: { user: true },
    });

    if (!tutor || tutor.user.status !== 'ACTIVE' || tutor.approvalStatus !== 'APPROVED') {
      throw new NotFoundError('Tutor profile not found.');
    }

    const dateFrom = new Date(dateFromStr);
    const dateTo = new Date(dateToStr);

    const weeklyAvailability = await prisma.weeklyAvailability.findMany({
      where: { tutorProfileId: tutor.id, isActive: true },
    });

    const bookings = await prisma.booking.findMany({
      where: {
        tutorProfileId: tutor.id,
        status: 'CONFIRMED',
        startAt: { lt: dateTo },
        endAt: { gt: dateFrom },
      },
    });

    const durations = env.BOOKING_DURATION_OPTIONS;
    const nowMs = Date.now();
    const alignedStartMs = Math.ceil(Math.max(dateFrom.getTime(), nowMs) / (30 * 60 * 1000)) * (30 * 60 * 1000);

    const slots: { startAt: string; endAtByDuration: Record<string, string> }[] = [];

    for (let currentMs = alignedStartMs; currentMs < dateTo.getTime(); currentMs += 30 * 60 * 1000) {
      const slotStart = new Date(currentMs);
      const endAtByDuration: Record<string, string> = {};

      for (const duration of durations) {
        const slotEnd = new Date(currentMs + duration * 60 * 1000);

        if (slotEnd > dateTo) continue;

        // Check booking overlap
        const hasBookingOverlap = bookings.some((b) => b.startAt < slotEnd && b.endAt > slotStart);
        if (hasBookingOverlap) continue;

        // Check availability
        if (slotStart.getUTCDay() !== slotEnd.getUTCDay()) continue; // cannot cross midnight

        const dayOfWeek = slotStart.getUTCDay();
        const startMinute = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
        const endMinute = startMinute + duration;

        const isAvailable = weeklyAvailability.some(
          (av) => av.dayOfWeek === dayOfWeek && av.startMinuteUtc <= startMinute && av.endMinuteUtc >= endMinute
        );

        if (isAvailable) {
          endAtByDuration[duration.toString()] = slotEnd.toISOString();
        }
      }

      if (Object.keys(endAtByDuration).length > 0) {
        slots.push({
          startAt: slotStart.toISOString(),
          endAtByDuration,
        });
      }
    }

    return {
      tutorId: tutor.id,
      timezone: 'UTC',
      hourlyRate: Number(tutor.hourlyRate),
      currencyCode: tutor.currencyCode,
      supportedDurations: durations,
      slots,
    };
  }
  ```

- [ ] **Step 3: Add controller function and register routes**
  Modify: `src/modules/tutors/tutor.controller.ts`
  Add the controller function:
  ```typescript
  import { getTutorSlots } from './tutor.slots.service.js';
  import { slotQuerySchema } from './tutor.schemas.js';

  export const getPublicTutorSlots = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { tutorId } = req.params;
      const validatedQuery = slotQuerySchema.parse(req.query);
      const result = await getTutorSlots(tutorId, validatedQuery.dateFrom, validatedQuery.dateTo);
      res.status(200).json({
        success: true,
        data: result,
      });
    } catch (error) {
      next(error);
    }
  };
  ```

  Modify: `src/modules/tutors/tutor.routes.ts`
  Add the route:
  ```typescript
  import { getPublicTutorSlots } from './tutor.controller.js';
  // under public routes:
  router.get('/tutors/:tutorId/slots', getPublicTutorSlots);
  ```

- [ ] **Step 4: Write tests in `tests/slots.test.ts`**
  ```typescript
  import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
  import request from 'supertest';
  import { prisma } from '../src/config/db.js';

  describe('Tutor Bookable Slots API', () => {
    let app: any;
    let tutorId: string;
    let tutorToken: string;
    let categoryId: string;

    beforeAll(async () => {
      const appModule = await import('../src/app.js');
      app = appModule.app;

      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
      await prisma.weeklyAvailability.deleteMany();
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();
      await prisma.category.deleteMany();
      await prisma.user.deleteMany();

      // Create tutor
      tutorToken = await getAuthToken(app, 'slots-tutor@example.com', 'TUTOR');
      const cat = await prisma.category.create({
        data: { name: 'Slots Math', slug: 'slots-math', isActive: true },
      });
      categoryId = cat.id;

      const profileRes = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Slots Tutor',
          bio: 'Tutor for slots verification',
          experienceYears: 4,
          hourlyRate: 35.00,
          categoryIds: [categoryId],
        });
      tutorId = profileRes.body.data.id;

      // Approve tutor
      const adminToken = await getAuthToken(app, 'slots-admin@example.com', 'ADMIN');
      await request(app)
        .patch(`/api/v1/admin/tutors/${tutorId}/approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });

      // Add availability: Monday 09:00 - 12:00 UTC (dayOfWeek = 1, 540 to 720)
      await prisma.weeklyAvailability.create({
        data: {
          tutorProfileId: tutorId,
          dayOfWeek: 1,
          startMinuteUtc: 540,
          endMinuteUtc: 720,
        },
      });
    });

    afterAll(async () => {
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
      await prisma.weeklyAvailability.deleteMany();
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();
      await prisma.category.deleteMany();
      await prisma.user.deleteMany();
      await prisma.$disconnect();
    });

    async function getAuthToken(appInstance: any, email: string, role: 'STUDENT' | 'TUTOR' | 'ADMIN') {
      const registerRes = await request(appInstance)
        .post('/api/auth/sign-up/email')
        .send({
          email,
          password: 'password123',
          name: `Test ${role}`,
          role: 'STUDENT',
        });
      const rawCookie = registerRes.headers['set-cookie'];
      const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

      const dbUser = await prisma.user.findUnique({ where: { email } });
      if (!dbUser) throw new Error('User not found');
      await prisma.user.update({
        where: { id: dbUser.id },
        data: { role },
      });

      const tokenRes = await request(appInstance)
        .get('/api/auth/token')
        .set('Cookie', cookieHeaders);
      return tokenRes.body.token;
    }

    it('should fail if range exceeds 31 days', async () => {
      const res = await request(app)
        .get(`/api/v1/tutors/${tutorId}/slots`)
        .query({
          dateFrom: '2026-07-01T00:00:00.000Z',
          dateTo: '2026-08-05T00:00:00.000Z',
        });
      expect(res.status).toBe(400);
    });

    it('should generate valid slots matching weekly availability', async () => {
      // 2026-07-20 is a Monday
      const res = await request(app)
        .get(`/api/v1/tutors/${tutorId}/slots`)
        .query({
          dateFrom: '2026-07-20T00:00:00.000Z',
          dateTo: '2026-07-21T00:00:00.000Z',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.slots.length).toBeGreaterThan(0);
      
      // Slot at 09:00:00.000Z should have durations 30, 60, 90, 120
      const slot09 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T09:00:00.000Z');
      expect(slot09).toBeDefined();
      expect(slot09.endAtByDuration['30']).toBe('2026-07-20T09:30:00.000Z');
      expect(slot09.endAtByDuration['120']).toBe('2026-07-20T11:00:00.000Z');
    });

    it('should exclude slots that overlap with confirmed bookings', async () => {
      // Create a confirmed booking on Monday 2026-07-20 from 10:00 to 11:00 UTC
      await prisma.booking.create({
        data: {
          studentId: (await prisma.user.findFirst({ where: { role: 'STUDENT' } }))!.id,
          tutorProfileId: tutorId,
          categoryId,
          startAt: new Date('2026-07-20T10:00:00.000Z'),
          endAt: new Date('2026-07-20T11:00:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 35.00,
          quotedPrice: 35.00,
          status: 'CONFIRMED',
        },
      });

      const res = await request(app)
        .get(`/api/v1/tutors/${tutorId}/slots`)
        .query({
          dateFrom: '2026-07-20T00:00:00.000Z',
          dateTo: '2026-07-21T00:00:00.000Z',
        });

      // The slot starting at 10:00 should not exist, and 09:30 slot should not have 60-min option (ends at 10:30 which overlaps)
      const slot10 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T10:00:00.000Z');
      expect(slot10).toBeUndefined();

      const slot0930 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T09:30:00.000Z');
      if (slot0930) {
        expect(slot0930.endAtByDuration['60']).toBeUndefined();
      }
    });
  });
  ```

- [ ] **Step 5: Run tests and verify**
  Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/slots.test.ts`
  Expected: PASS

- [ ] **Step 6: Commit and cleanup**
  ```bash
  git add src/modules/tutors/ tests/slots.test.ts
  git commit -m "feat: implement public tutor slots endpoint and calculation logic"
  ```
