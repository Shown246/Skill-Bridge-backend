# Task 9: Concurrency-Safe Booking Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the booking module (repository, service, controller, routes) supporting row-locked concurrency protection, validations, status history logging, and role-scoped endpoints.

**Architecture:** Implement booking operations inside a transaction that locks the tutor profile row (`SELECT ... FOR UPDATE`), computes allowed actions dynamically, and logs status transitions.

**Tech Stack:** Express, TypeScript, Prisma, Zod, Jest, Supertest

## Global Constraints
- All timestamps must be in UTC ISO 8601 format.
- Price rounding: 2 decimal places.
- Concurrency protection: `SELECT ... FOR UPDATE` row-level lock on `TutorProfile`.
- Pagination: page = 1, pageSize = 10, max pageSize = 100.
- Sorting: `startAt` descending.

---

### Task 1: Repository, Services, and Validation Schemas

**Files:**
- Create: `src/modules/bookings/booking.schemas.ts`
- Create: `src/modules/bookings/booking.repository.ts`
- Create: `src/modules/bookings/booking.service.ts`

**Interfaces:**
- Consumes: Prisma database schema models (`Booking`, `BookingStatusHistory`, `TutorProfile`, etc.).
- Produces: Booking creation transaction logic and role-scoped queries.

- [ ] **Step 1: Write validation schemas**
  File: `src/modules/bookings/booking.schemas.ts`
  Add the validation schemas:
  ```typescript
  import { z } from 'zod';

  export const createBookingSchema = z.object({
    tutorId: z.string().uuid(),
    categoryId: z.string().uuid(),
    startAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().positive(),
    note: z.string().max(500).optional(),
  });

  export const getBookingsQuerySchema = z.object({
    status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(10),
  });
  ```

- [ ] **Step 2: Implement Booking Repository**
  File: `src/modules/bookings/booking.repository.ts`
  Implement transactional locking and creation, and role-scoped listing:
  ```typescript
  import { prisma } from '../../config/db.js';
  import { BookingStatus } from '@prisma/client';

  export class BookingRepository {
    async lockTutorProfile(tutorProfileId: string, tx: any) {
      await tx.$executeRawUnsafe(
        'SELECT 1 FROM tutor_profile WHERE id = $1 FOR UPDATE',
        tutorProfileId
      );
    }

    async createBooking(data: {
      studentId: string;
      tutorProfileId: string;
      categoryId: string;
      startAt: Date;
      endAt: Date;
      durationMinutes: number;
      hourlyRateSnapshot: number;
      quotedPrice: number;
      note?: string;
    }, tx: any) {
      const booking = await tx.booking.create({
        data: {
          studentId: data.studentId,
          tutorProfileId: data.tutorProfileId,
          categoryId: data.categoryId,
          startAt: data.startAt,
          endAt: data.endAt,
          durationMinutes: data.durationMinutes,
          hourlyRateSnapshot: data.hourlyRateSnapshot,
          quotedPrice: data.quotedPrice,
          note: data.note,
          status: 'CONFIRMED',
        },
      });

      await tx.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          toStatus: 'CONFIRMED',
          actorUserId: data.studentId,
          actorRole: 'STUDENT',
        },
      });

      return booking;
    }

    async checkOverlap(tutorProfileId: string, startAt: Date, endAt: Date, tx: any) {
      const count = await tx.booking.count({
        where: {
          tutorProfileId,
          status: 'CONFIRMED',
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });
      return count > 0;
    }

    async listBookings(where: any, page: number, pageSize: number) {
      const skip = (page - 1) * pageSize;
      const [items, totalItems] = await Promise.all([
        prisma.booking.findMany({
          where,
          skip,
          take: pageSize,
          orderBy: { startAt: 'desc' },
          include: {
            student: { select: { id: true, name: true, email: true } },
            tutorProfile: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            category: true,
          },
        }),
        prisma.booking.count({ where }),
      ]);
      return { items, totalItems };
    }

    async findById(id: string) {
      return prisma.booking.findUnique({
        where: { id },
        include: {
          student: { select: { id: true, name: true, email: true } },
          tutorProfile: {
            include: { user: { select: { id: true, name: true, email: true } } },
          },
          category: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
        },
      });
    }
  }

  export const bookingRepository = new BookingRepository();
  ```

- [ ] **Step 3: Implement Booking Service**
  File: `src/modules/bookings/booking.service.ts`
  Implement validations, price snapshot, and allowed actions:
  ```typescript
  import { prisma } from '../../config/db.js';
  import { bookingRepository } from './booking.repository.js';
  import { AppError, NotFoundError } from '../../shared/errors/app-error.js';
  import { env } from '../../config/env.js';

  export class BookingService {
    async create(studentId: string, data: {
      tutorId: string;
      categoryId: string;
      startAt: string;
      durationMinutes: number;
      note?: string;
    }) {
      const startAt = new Date(data.startAt);
      const endAt = new Date(startAt.getTime() + data.durationMinutes * 60 * 1000);

      // Validate duration
      if (!env.BOOKING_DURATION_OPTIONS.includes(data.durationMinutes)) {
        throw new AppError(400, 'INVALID_DURATION', 'Requested booking duration is not supported.');
      }

      // Validate alignment (must align to 30-minute block)
      if (startAt.getUTCMinutes() % 30 !== 0 || startAt.getUTCSeconds() !== 0 || startAt.getUTCMilliseconds() !== 0) {
        throw new AppError(400, 'INVALID_ALIGNMENT', 'Booking start time must align to 30-minute boundaries.');
      }

      if (startAt.getTime() <= Date.now()) {
        throw new AppError(400, 'PAST_START_TIME', 'Booking start time must be in the future.');
      }

      // Check midnight crossing
      if (startAt.getUTCDay() !== endAt.getUTCDay()) {
        throw new AppError(400, 'MIDNIGHT_CROSSING', 'Booking cannot wrap across UTC midnight.');
      }

      return prisma.$transaction(async (tx) => {
        // 1. Lock tutor row
        await bookingRepository.lockTutorProfile(data.tutorId, tx);

        // 2. Validate tutor is active and approved
        const tutor = await tx.tutorProfile.findUnique({
          where: { id: data.tutorId },
          include: { user: true },
        });
        if (!tutor || tutor.user.status !== 'ACTIVE' || tutor.approvalStatus !== 'APPROVED') {
          throw new NotFoundError('Tutor profile not found or inactive.');
        }

        // 3. Validate category is active and assigned
        const catLink = await tx.tutorCategory.findUnique({
          where: { tutorProfileId_categoryId: { tutorProfileId: tutor.id, categoryId: data.categoryId } },
          include: { category: true },
        });
        if (!catLink || !catLink.category.isActive) {
          throw new NotFoundError('Category not found or inactive for this tutor.');
        }

        // 4. Validate weekly availability
        const dayOfWeek = startAt.getUTCDay();
        const startMinute = startAt.getUTCHours() * 60 + startAt.getUTCMinutes();
        const endMinute = startMinute + data.durationMinutes;

        const availability = await tx.weeklyAvailability.findMany({
          where: { tutorProfileId: tutor.id, dayOfWeek, isActive: true },
        });
        const isAvailable = availability.some(
          (av) => av.startMinuteUtc <= startMinute && av.endMinuteUtc >= endMinute
        );
        if (!isAvailable) {
          throw new AppError(400, 'OUT_OF_AVAILABILITY', 'Requested time is outside the tutor availability.');
        }

        // 5. Overlap check
        const hasOverlap = await bookingRepository.checkOverlap(tutor.id, startAt, endAt, tx);
        if (hasOverlap) {
          throw new AppError(409, 'BOOKING_SLOT_CONFLICT', 'Requested booking slot conflicts with an existing booking.');
        }

        // 6. Calculate price
        const rate = Number(tutor.hourlyRate);
        const price = Math.round((rate * data.durationMinutes / 60) * 100) / 100;

        return bookingRepository.createBooking({
          studentId,
          tutorProfileId: tutor.id,
          categoryId: data.categoryId,
          startAt,
          endAt,
          durationMinutes: data.durationMinutes,
          hourlyRateSnapshot: rate,
          quotedPrice: price,
          note: data.note,
        }, tx);
      });
    }

    async getDetail(bookingId: string, userId: string, role: string) {
      const booking = await bookingRepository.findById(bookingId);
      if (!booking) {
        throw new NotFoundError('Booking not found.');
      }

      // Auth validation
      const isStudent = booking.studentId === userId;
      const isTutor = booking.tutorProfile.userId === userId;
      const isAdmin = role === 'ADMIN';

      if (!isStudent && !isTutor && !isAdmin) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied.');
      }

      const allowedActions = this.computeAllowedActions(booking, userId, role);

      return {
        ...booking,
        allowedActions,
      };
    }

    async list(userId: string, role: string, query: {
      status?: string;
      from?: string;
      to?: string;
      page: number;
      pageSize: number;
    }) {
      const where: any = {};

      if (role === 'STUDENT') {
        where.studentId = userId;
      } else if (role === 'TUTOR') {
        where.tutorProfile = { userId };
      }

      if (query.status) {
        where.status = query.status;
      }
      if (query.from || query.to) {
        where.startAt = {};
        if (query.from) where.startAt.gte = new Date(query.from);
        if (query.to) where.startAt.lte = new Date(query.to);
      }

      const { items, totalItems } = await bookingRepository.listBookings(where, query.page, query.pageSize);
      const itemsWithActions = items.map((b) => ({
        ...b,
        allowedActions: this.computeAllowedActions(b, userId, role),
      }));

      return {
        bookings: itemsWithActions,
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          totalItems,
          totalPages: Math.ceil(totalItems / query.pageSize),
        },
      };
    }

    private computeAllowedActions(booking: any, userId: string, role: string): string[] {
      const actions: string[] = [];
      const now = new Date();

      if (booking.status === 'CONFIRMED') {
        if (now < booking.startAt) {
          if (booking.studentId === userId || booking.tutorProfile.userId === userId || role === 'ADMIN') {
            actions.push('CANCEL');
          }
        }
        if (now >= booking.endAt && (booking.tutorProfile.userId === userId || role === 'ADMIN')) {
          actions.push('COMPLETE');
        }
      } else if (booking.status === 'COMPLETED') {
        if (booking.studentId === userId && !booking.review) {
          actions.push('REVIEW');
        }
      }

      return actions;
    }
  }

  export const bookingService = new BookingService();
  ```

---

### Task 2: Controller, Routing, and Integration Tests

**Files:**
- Create: `src/modules/bookings/booking.controller.ts`
- Create: `src/modules/bookings/booking.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/booking.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requireRole`, `requireActive` middleware, and bookingService.
- Produces: `/api/v1/bookings` HTTP endpoints.

- [ ] **Step 1: Write Express Controller**
  File: `src/modules/bookings/booking.controller.ts`
  Wire inputs to the booking service:
  ```typescript
  import { Request, Response, NextFunction } from 'express';
  import { bookingService } from './booking.service.js';
  import { createBookingSchema, getBookingsQuerySchema } from './booking.schemas.js';

  export const createBooking = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedBody = createBookingSchema.parse(req.body);
      const booking = await bookingService.create(req.user!.id, validatedBody);
      res.status(201).json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  };

  export const getBookingDetails = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { bookingId } = req.params;
      const booking = await bookingService.getDetail(bookingId, req.user!.id, req.user!.role);
      res.status(200).json({
        success: true,
        data: booking,
      });
    } catch (error) {
      next(error);
    }
  };

  export const listBookings = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const validatedQuery = getBookingsQuerySchema.parse(req.query);
      const result = await bookingService.list(req.user!.id, req.user!.role, validatedQuery);
      res.status(200).json({
        success: true,
        data: result.bookings,
        pagination: result.pagination,
      });
    } catch (error) {
      next(error);
    }
  };
  ```

- [ ] **Step 2: Setup routing and mount in app**
  File: `src/modules/bookings/booking.routes.ts`
  Add route registration:
  ```typescript
  import { Router } from 'express';
  import { requireAuth, requireRole, requireActive } from '../../middleware/auth.middleware.js';
  import { createBooking, getBookingDetails, listBookings } from './booking.controller.js';

  const router = Router();

  router.post('/bookings', requireAuth, requireRole('STUDENT'), requireActive, createBooking);
  router.get('/bookings', requireAuth, requireActive, listBookings);
  router.get('/bookings/:bookingId', requireAuth, requireActive, getBookingDetails);

  export default router;
  ```

  Modify: `src/app.ts`
  Import and mount the new routes:
  ```typescript
  // Around line 17:
  import bookingRoutes from './modules/bookings/booking.routes.js';

  // Around line 105:
  app.use('/api/v1', bookingRoutes);
  ```

- [ ] **Step 3: Write Integration Tests**
  File: `tests/booking.test.ts`
  Define test scenarios, checking slot validation, role-scoping, and concurrency locking:
  ```typescript
  import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
  import request from 'supertest';
  import { prisma } from '../src/config/db.js';

  describe('Booking Core API', () => {
    let app: any;
    let studentToken: string;
    let tutorToken: string;
    let tutorId: string;
    let categoryId: string;

    beforeAll(async () => {
      const appModule = await import('../src/app.js');
      app = appModule.app;

      await cleanDb();

      studentToken = await getAuthToken(app, 'student-book@example.com', 'STUDENT');
      tutorToken = await getAuthToken(app, 'tutor-book@example.com', 'TUTOR');
      
      const adminToken = await getAuthToken(app, 'admin-book@example.com', 'ADMIN');

      const cat = await prisma.category.create({
        data: { name: 'Book Math', slug: 'book-math', isActive: true },
      });
      categoryId = cat.id;

      const profileRes = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Booking Tutor',
          bio: 'Available tutor profile for booking core tests',
          experienceYears: 6,
          hourlyRate: 40.00,
          categoryIds: [categoryId],
        });
      tutorId = profileRes.body.data.id;

      await request(app)
        .patch(`/api/v1/admin/tutors/${tutorId}/approval`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'APPROVED' });

      // Availability: Monday 09:00 - 12:00 UTC (dayOfWeek = 1, 540 to 720)
      await prisma.weeklyAvailability.create({
        data: { tutorProfileId: tutorId, dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },
      });
    });

    afterAll(async () => {
      await cleanDb();
      await prisma.$disconnect();
    });

    beforeEach(async () => {
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
    });

    async function cleanDb() {
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
      await prisma.weeklyAvailability.deleteMany();
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();
      await prisma.category.deleteMany();
      await prisma.session.deleteMany();
      await prisma.account.deleteMany();
      await prisma.user.deleteMany();
    }

    async function getAuthToken(appInstance: any, email: string, role: 'STUDENT' | 'TUTOR' | 'ADMIN') {
      const registerRes = await request(appInstance)
        .post('/api/auth/sign-up/email')
        .send({ email, password: 'password123', name: `Test ${role}`, role: 'STUDENT' });
      const rawCookie = registerRes.headers['set-cookie'];
      const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

      const dbUser = await prisma.user.findUnique({ where: { email } });
      await prisma.user.update({ where: { id: dbUser!.id }, data: { role } });

      const tokenRes = await request(appInstance).get('/api/auth/token').set('Cookie', cookieHeaders);
      return tokenRes.body.token;
    }

    it('should create booking successfully', async () => {
      // 2026-07-20 is Monday
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: '2026-07-20T09:00:00.000Z',
          durationMinutes: 60,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.quotedPrice).toBe(40.00);
      expect(res.body.data.status).toBe('CONFIRMED');

      const history = await prisma.bookingStatusHistory.findFirst({
        where: { bookingId: res.body.data.id },
      });
      expect(history).toBeDefined();
      expect(history!.toStatus).toBe('CONFIRMED');
    });

    it('should reject overlapping booking requests with 409 conflict', async () => {
      // Create first booking
      await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ tutorId, categoryId, startAt: '2026-07-20T09:00:00.000Z', durationMinutes: 60 });

      // Attempt overlap booking
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ tutorId, categoryId, startAt: '2026-07-20T09:30:00.000Z', durationMinutes: 60 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BOOKING_SLOT_CONFLICT');
    });

    it('should prevent concurrency double-bookings', async () => {
      // Fire 3 overlapping requests simultaneously
      const reqs = Array.from({ length: 3 }).map(() =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${studentToken}`)
          .send({ tutorId, categoryId, startAt: '2026-07-20T09:00:00.000Z', durationMinutes: 60 })
      );

      const responses = await Promise.all(reqs);
      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });
  });
  ```

- [ ] **Step 4: Run tests and typecheck**
  Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand tests/booking.test.ts`
  Expected: PASS

- [ ] **Step 5: Commit changes**
  ```bash
  git add src/modules/bookings/ src/app.ts tests/booking.test.ts
  git commit -m "feat: implement concurrency-safe booking core and integration tests"
  ```
