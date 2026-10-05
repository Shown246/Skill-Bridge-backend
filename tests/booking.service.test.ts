import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { prisma } from '../src/config/db.js';
import { BookingService, bookingService } from '../src/modules/bookings/booking.service.js';
import {
  adminBookingStatusSchema,
  bookingIdParamsSchema,
  cancelBookingSchema,
  createBookingSchema,
  getBookingsQuerySchema,
} from '../src/modules/bookings/booking.schemas.js';
import { AppError, NotFoundError } from '../src/shared/errors/app-error.js';

jest.setTimeout(60000);

function futureMondayAt(hour: number, minute = 0) {
  const now = new Date();
  const futureMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const daysUntilNextMonday = (8 - futureMonday.getUTCDay()) % 7 || 7;
  futureMonday.setUTCDate(futureMonday.getUTCDate() + daysUntilNextMonday + 7);
  futureMonday.setUTCHours(hour, minute, 0, 0);
  return futureMonday;
}

describe('Booking Core Service & Repository Tests', () => {
  let studentId: string;
  let tutorId: string;
  let tutorProfileId: string;
  let adminId: string;
  let categoryId: string;
  let otherUserId: string;

  beforeAll(async () => {
    await cleanDb();

    // 1. Create student, tutor, admin, and other user
    const studentUser = await prisma.user.create({
      data: {
        id: 'user-student-1',
        name: 'Test Student',
        email: 'student@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    studentId = studentUser.id;

    const tutorUser = await prisma.user.create({
      data: {
        id: 'user-tutor-1',
        name: 'Test Tutor',
        email: 'tutor@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'TUTOR',
        status: 'ACTIVE',
      },
    });
    tutorId = tutorUser.id;

    const adminUser = await prisma.user.create({
      data: {
        id: 'user-admin-1',
        name: 'Test Admin',
        email: 'admin@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    adminId = adminUser.id;

    const otherUser = await prisma.user.create({
      data: {
        id: 'user-other-1',
        name: 'Other Student',
        email: 'other@example.com',
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        role: 'STUDENT',
        status: 'ACTIVE',
      },
    });
    otherUserId = otherUser.id;

    // 2. Create Tutor Profile
    const tutorProfile = await prisma.tutorProfile.create({
      data: {
        userId: tutorId,
        headline: 'Experienced Math Tutor',
        bio: 'Teaching calculus and algebra for high schoolers. Certified tutor with 5+ years of experience.',
        experienceYears: 5,
        hourlyRate: 50.00,
        currencyCode: 'USD',
        approvalStatus: 'APPROVED',
      },
    });
    tutorProfileId = tutorProfile.id;

    // 3. Create active Category and link it to Tutor
    const category = await prisma.category.create({
      data: {
        name: 'Algebra',
        slug: 'algebra',
        isActive: true,
      },
    });
    categoryId = category.id;

    await prisma.tutorCategory.create({
      data: {
        tutorProfileId,
        categoryId,
      },
    });

    // 4. Set weekly availability: Monday 09:00 - 17:00 UTC (dayOfWeek = 1, 540 to 1020 minutes)
    await prisma.weeklyAvailability.create({
      data: {
        tutorProfileId,
        dayOfWeek: 1,
        startMinuteUtc: 540,
        endMinuteUtc: 1020,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await prisma.review.deleteMany();
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

  async function createActionBooking(input?: {
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    startAt?: Date;
    endAt?: Date;
    studentId?: string;
  }) {
    const startAt = input?.startAt ?? new Date('2026-07-20T10:00:00.000Z');
    const endAt = input?.endAt ?? new Date('2026-07-20T11:00:00.000Z');

    return prisma.booking.create({
      data: {
        studentId: input?.studentId ?? studentId,
        tutorProfileId,
        categoryId,
        startAt,
        endAt,
        durationMinutes: 60,
        hourlyRateSnapshot: 50,
        quotedPrice: 50,
        status: input?.status ?? 'CONFIRMED',
      },
    });
  }

  // ─── Step 1: Validation Schemas ────────────────────────────────────────

  describe('Zod Validation Schemas', () => {
    describe('createBookingSchema', () => {
      it('should validate a valid payload successfully', () => {
        const payload = {
          tutorId: 'a3bc47d0-1c39-44d5-89f4-8d9ad7c9448f',
          categoryId: 'd9b04870-8bda-4f18-a6d1-419b662d5f30',
          startAt: '2026-07-20T10:00:00.000Z',
          durationMinutes: 60,
          note: 'Help with linear equations',
        };
        const res = createBookingSchema.safeParse(payload);
        expect(res.success).toBe(true);
      });

      it('should reject invalid tutorId (non-uuid)', () => {
        const payload = {
          tutorId: 'invalid-uuid',
          categoryId: 'd9b04870-8bda-4f18-a6d1-419b662d5f30',
          startAt: '2026-07-20T10:00:00.000Z',
          durationMinutes: 60,
        };
        const res = createBookingSchema.safeParse(payload);
        expect(res.success).toBe(false);
      });

      it('should reject invalid startAt (non-iso)', () => {
        const payload = {
          tutorId: 'a3bc47d0-1c39-44d5-89f4-8d9ad7c9448f',
          categoryId: 'd9b04870-8bda-4f18-a6d1-419b662d5f30',
          startAt: '2026-07-20 10:00:00',
          durationMinutes: 60,
        };
        const res = createBookingSchema.safeParse(payload);
        expect(res.success).toBe(false);
      });
    });

    describe('getBookingsQuerySchema', () => {
      it('should supply default pagination options and validate query schema', () => {
        const query = {};
        const res = getBookingsQuerySchema.safeParse(query);
        expect(res.success).toBe(true);
        if (res.success) {
          expect(res.data.page).toBe(1);
          expect(res.data.pageSize).toBe(10);
        }
      });

      it('should reject invalid status', () => {
        const query = { status: 'PENDING' }; // Only CONFIRMED, COMPLETED, CANCELLED allowed
        const res = getBookingsQuerySchema.safeParse(query);
        expect(res.success).toBe(false);
      });

      it('should reject page size larger than 100', () => {
        const query = { pageSize: 150 };
        const res = getBookingsQuerySchema.safeParse(query);
        expect(res.success).toBe(false);
      });
    });

    describe('booking action schemas', () => {
      it('normalizes an omitted or blank participant cancellation reason', () => {
        expect(cancelBookingSchema.parse({})).toEqual({});
        expect(cancelBookingSchema.parse({ reason: '   ' })).toEqual({ reason: undefined });
        expect(cancelBookingSchema.parse({ reason: '  Schedule conflict  ' })).toEqual({
          reason: 'Schedule conflict',
        });
      });

      it('rejects a participant cancellation reason longer than 1000 characters', () => {
        expect(cancelBookingSchema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
      });

      it('requires a normalized admin reason and a supported target status', () => {
        expect(
          adminBookingStatusSchema.parse({
            status: 'COMPLETED',
            reason: '  Session verified by support  ',
          })
        ).toEqual({
          status: 'COMPLETED',
          reason: 'Session verified by support',
        });

        expect(
          adminBookingStatusSchema.safeParse({ status: 'CANCELLED', reason: '   ' }).success
        ).toBe(false);
        expect(
          adminBookingStatusSchema.safeParse({ status: 'PENDING', reason: 'Correction' }).success
        ).toBe(false);
      });

      it('requires a UUID booking route parameter', () => {
        expect(
          bookingIdParamsSchema.safeParse({
            bookingId: 'a3bc47d0-1c39-44d5-89f4-8d9ad7c9448f',
          }).success
        ).toBe(true);
        expect(bookingIdParamsSchema.safeParse({ bookingId: 'not-a-uuid' }).success).toBe(false);
      });
    });
  });

  // ─── Steps 2 & 3: BookingService validations & creation ────────────────────────

  describe('BookingService.create', () => {
    it('should throw INVALID_DURATION for unsupported durations', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(10).toISOString(),
          durationMinutes: 45, // Defaults in env are 30, 60, 90, 120
        })
      ).rejects.toThrow(new AppError(400, 'INVALID_DURATION', 'Requested booking duration is not supported.'));
    });

    it('should throw INVALID_ALIGNMENT for start times not aligning to 30-min block', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(10, 15).toISOString(),
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'INVALID_ALIGNMENT', 'Booking start time must align to 30-minute boundaries.'));
    });

    it('should throw PAST_START_TIME for bookings in the past', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2020-07-20T10:00:00.000Z',
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'PAST_START_TIME', 'Booking start time must be in the future.'));
    });

    it('uses injected clock when validating future start times', async () => {
      // Mock clock to 2030-01-01T00:00:00Z
      const simulatedNow = new Date('2030-01-01T00:00:00.000Z');
      const timeAwareService = new BookingService(() => simulatedNow);

      // 2029-06-04 is in the future relative to real time, but in the past relative to simulatedNow
      const startAt2029 = '2029-06-04T10:00:00.000Z';
      await expect(
        timeAwareService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: startAt2029,
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'PAST_START_TIME', 'Booking start time must be in the future.'));
    });

    it('should throw MIDNIGHT_CROSSING if duration causes booking to wrap across UTC midnight', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(23, 30).toISOString(), // 60 minutes wraps to 00:30 next day
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'MIDNIGHT_CROSSING', 'Booking cannot wrap across UTC midnight.'));
    });

    it('should throw NotFoundError if tutor profile does not exist', async () => {
      const nonExistentUuid = '99999999-9999-9999-9999-999999999999';
      await expect(
        bookingService.create(studentId, {
          tutorId: nonExistentUuid,
          categoryId,
          startAt: futureMondayAt(10).toISOString(),
          durationMinutes: 60,
        })
      ).rejects.toThrow(new NotFoundError('Tutor profile not found or inactive.'));
    });

    it('should throw NotFoundError if category is not assigned to the tutor', async () => {
      // Create new category but do not assign it
      const unassignedCategory = await prisma.category.create({
        data: {
          name: 'History',
          slug: 'history',
          isActive: true,
        },
      });

      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId: unassignedCategory.id,
          startAt: futureMondayAt(10).toISOString(),
          durationMinutes: 60,
        })
      ).rejects.toThrow(new NotFoundError('Category not found or inactive for this tutor.'));
    });

    it('should throw OUT_OF_AVAILABILITY if requested time is outside weekly availability minutes', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(8).toISOString(), // 8:00 UTC is minute 480. Tutor starts at 540 (9:00 UTC)
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'OUT_OF_AVAILABILITY', 'Requested time is outside the tutor availability.'));
    });

    it('should throw INACTIVE_STUDENT if the student is not active or has an incorrect role', async () => {
      const inactiveStudent = await prisma.user.create({
        data: {
          id: 'user-inactive-student',
          name: 'Inactive Student',
          email: 'inactive-student@example.com',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          role: 'STUDENT',
          status: 'BANNED',
        },
      });

      await expect(
        bookingService.create(inactiveStudent.id, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(10).toISOString(),
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(403, 'INACTIVE_STUDENT', 'Authenticated user must be an active student.'));
    });


    it('should successfully create a booking, calculate correct quoted price, snapshot rate and create booking history', async () => {
      const startAtStr = futureMondayAt(10).toISOString();
      const booking = await bookingService.create(studentId, {
        tutorId: tutorProfileId,
        categoryId,
        startAt: startAtStr,
        durationMinutes: 60,
        note: 'Calculus review',
      });

      expect(booking).toBeDefined();
      expect(booking.id).toBeDefined();
      expect(booking.studentId).toBe(studentId);
      expect(booking.tutorProfileId).toBe(tutorProfileId);
      expect(booking.categoryId).toBe(categoryId);
      expect(booking.status).toBe('CONFIRMED');
      expect(Number(booking.hourlyRateSnapshot)).toBe(50.00);
      expect(Number(booking.quotedPrice)).toBe(50.00); // 50 * 60 / 60
      expect(booking.currencyCode).toBe('USD');
      expect(booking.note).toBe('Calculus review');

      // Check status history
      const history = await prisma.bookingStatusHistory.findFirst({
        where: { bookingId: booking.id },
      });
      expect(history).toBeDefined();
      expect(history?.toStatus).toBe('CONFIRMED');
      expect(history?.actorUserId).toBe(studentId);
      expect(history?.actorRole).toBe('STUDENT');
    });

    it('snapshots the tutor custom currencyCode when creating a booking', async () => {
      const eurTutorUser = await prisma.user.create({
        data: {
          id: 'user-tutor-eur-custom',
          name: 'EUR Tutor',
          email: 'eur-tutor-custom@example.com',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          role: 'TUTOR',
          status: 'ACTIVE',
        },
      });
      const eurProfile = await prisma.tutorProfile.create({
        data: {
          userId: eurTutorUser.id,
          headline: 'European Physics Tutor',
          bio: 'Physics tutoring across Europe for higher secondary students.',
          experienceYears: 4,
          hourlyRate: 60.00,
          currencyCode: 'EUR',
          approvalStatus: 'APPROVED',
        },
      });
      await prisma.tutorCategory.create({
        data: {
          tutorProfileId: eurProfile.id,
          categoryId,
        },
      });
      const avail = await prisma.weeklyAvailability.create({
        data: {
          tutorProfileId: eurProfile.id,
          dayOfWeek: 1,
          startMinuteUtc: 540,
          endMinuteUtc: 1020,
          isActive: true,
        },
      });

      let createdBookingId: string | undefined;
      try {
        const booking = await bookingService.create(studentId, {
          tutorId: eurProfile.id,
          categoryId,
          startAt: futureMondayAt(14).toISOString(),
          durationMinutes: 60,
        });

        createdBookingId = booking.id;
        expect(booking.currencyCode).toBe('EUR');
      } finally {
        if (createdBookingId) {
          await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: createdBookingId } });
          await prisma.booking.delete({ where: { id: createdBookingId } });
        }
        await prisma.weeklyAvailability.delete({ where: { id: avail.id } });
        await prisma.tutorCategory.delete({
          where: { tutorProfileId_categoryId: { tutorProfileId: eurProfile.id, categoryId } },
        });
        await prisma.tutorProfile.delete({ where: { id: eurProfile.id } });
        await prisma.user.delete({ where: { id: eurTutorUser.id } });
      }
    });

    it('should throw BOOKING_SLOT_CONFLICT if new booking overlaps with the existing confirmed booking', async () => {
      // Trying to book during the Monday 10:00 - 11:00 slot that we just successfully booked
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: futureMondayAt(10, 30).toISOString(), // 10:30 to 11:30 overlaps with 10:00 to 11:00
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(409, 'BOOKING_SLOT_CONFLICT', 'Requested booking slot conflicts with an existing booking.'));
    });
  });

  // ─── BookingService.getDetail ──────────────────────────────────────────

  describe('BookingService.getDetail', () => {
    let testBookingId: string;

    beforeAll(async () => {
      // Find the booking we created in the success test
      const booking = await prisma.booking.findFirst({
        where: { tutorProfileId },
      });
      if (!booking) throw new Error('Test booking not found in DB');
      testBookingId = booking.id;
    });

    it('should throw NotFoundError for non-existent booking ID', async () => {
      const nonExistentUuid = '99999999-9999-9999-9999-999999999999';
      await expect(
        bookingService.getDetail(nonExistentUuid, studentId, 'STUDENT')
      ).rejects.toThrow(new NotFoundError('Booking not found.'));
    });

    it('should allow student, tutor, or admin to retrieve detail', async () => {
      const forStudent = await bookingService.getDetail(testBookingId, studentId, 'STUDENT');
      expect(forStudent).toBeDefined();
      expect(forStudent.id).toBe(testBookingId);

      const forTutor = await bookingService.getDetail(testBookingId, tutorId, 'TUTOR');
      expect(forTutor).toBeDefined();
      expect(forTutor.id).toBe(testBookingId);

      const forAdmin = await bookingService.getDetail(testBookingId, adminId, 'ADMIN');
      expect(forAdmin).toBeDefined();
      expect(forAdmin.id).toBe(testBookingId);
    });

    it('should throw ForbiddenError/AppError(403) for unrelated users', async () => {
      await expect(
        bookingService.getDetail(testBookingId, otherUserId, 'STUDENT')
      ).rejects.toThrow(new AppError(403, 'FORBIDDEN', 'Access denied.'));
    });

    it('should correctly compute allowedActions', async () => {
      // For future CONFIRMED booking, CANCEL should be allowed
      const details = await bookingService.getDetail(testBookingId, studentId, 'STUDENT');
      expect(details.allowedActions).toContain('CANCEL');

      // Create a completed booking to check COMPLETE / REVIEW actions
      const pastStart = new Date('2026-07-20T12:00:00.000Z');
      const pastEnd = new Date('2026-07-20T13:00:00.000Z');

      const pastBooking = await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: pastStart,
          endAt: pastEnd,
          durationMinutes: 60,
          hourlyRateSnapshot: 50.00,
          quotedPrice: 50.00,
          status: 'COMPLETED',
        },
      });

      // COMPLETED with no review: student can REVIEW
      const completedDetails = await bookingService.getDetail(pastBooking.id, studentId, 'STUDENT');
      expect(completedDetails.allowedActions).toContain('REVIEW');

      // Now leave a review
      await prisma.review.create({
        data: {
          bookingId: pastBooking.id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Great session!',
        },
      });

      // Now REVIEW should no longer be allowed
      const reviewedDetails = await bookingService.getDetail(pastBooking.id, studentId, 'STUDENT');
      expect(reviewedDetails.allowedActions).not.toContain('REVIEW');
    });
  });

  // ─── BookingService.list ────────────────────────────────────────────────

  describe('BookingService.list', () => {
    it('should scope list to student when logged in as STUDENT', async () => {
      const listRes = await bookingService.list(studentId, 'STUDENT', {
        page: 1,
        pageSize: 10,
      });

      expect(listRes.bookings.length).toBeGreaterThan(0);
      listRes.bookings.forEach((b) => {
        expect(b.studentId).toBe(studentId);
      });
    });

    it('should scope list to tutor when logged in as TUTOR', async () => {
      const listRes = await bookingService.list(tutorId, 'TUTOR', {
        page: 1,
        pageSize: 10,
      });

      expect(listRes.bookings.length).toBeGreaterThan(0);
      listRes.bookings.forEach((b) => {
        expect(b.tutorProfile.userId).toBe(tutorId);
      });
    });

    it('should return bookings filtered by status and dates', async () => {
      const rangeStart = futureMondayAt(0);
      const rangeEnd = new Date(rangeStart.getTime() + 24 * 60 * 60 * 1000);
      const listRes = await bookingService.list(studentId, 'STUDENT', {
        status: 'CONFIRMED',
        from: rangeStart.toISOString(),
        to: rangeEnd.toISOString(),
        page: 1,
        pageSize: 10,
      });

      expect(listRes.bookings.length).toBe(1);
      expect(listRes.bookings[0].status).toBe('CONFIRMED');
      expect(new Date(listRes.bookings[0].startAt).getTime()).toBeGreaterThanOrEqual(
        rangeStart.getTime()
      );
    });
  });

  describe('BookingService.cancel', () => {
    const beforeStart = new Date('2026-07-20T09:59:59.999Z');
    const atStart = new Date('2026-07-20T10:00:00.000Z');

    beforeEach(async () => {
      await prisma.review.deleteMany();
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
    });

    it('lets the owning student cancel one millisecond before start and writes history', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => beforeStart);

      const result = await service.cancel(
        booking.id,
        { id: studentId, role: 'STUDENT' },
        'Schedule conflict'
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.cancelledAt).toEqual(beforeStart);
      expect(result.cancelledById).toBe(studentId);
      expect(result.cancellationReason).toBe('Schedule conflict');
      expect(result.completedAt).toBeNull();
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CONFIRMED',
        toStatus: 'CANCELLED',
        actorUserId: studentId,
        actorRole: 'STUDENT',
        reason: 'Schedule conflict',
      });

      await expect(
        service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
      expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(1);
    });

    it('lets the assigned tutor cancel without a reason', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => beforeStart);

      const result = await service.cancel(booking.id, { id: tutorId, role: 'TUTOR' });

      expect(result.status).toBe('CANCELLED');
      expect(result.cancelledById).toBe(tutorId);
      expect(result.cancellationReason).toBeNull();
    });

    it('rejects unrelated actors before changing state', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => beforeStart);

      await expect(
        service.cancel(booking.id, { id: otherUserId, role: 'STUDENT' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('rejects cancellation exactly at start', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => atStart);

      await expect(
        service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_ALREADY_STARTED' });
      expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('rejects cancellation from a non-confirmed status', async () => {
      const booking = await createActionBooking({ status: 'COMPLETED' });
      const service = new BookingService(() => beforeStart);

      await expect(
        service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
    });
  });

  describe('BookingService.complete', () => {
    beforeEach(async () => {
      await prisma.review.deleteMany();
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
    });

    it('lets the assigned tutor complete exactly at endAt', async () => {
      const endAt = new Date('2026-07-20T11:00:00.000Z');
      const booking = await createActionBooking({ endAt });
      const service = new BookingService(() => endAt);

      const result = await service.complete(booking.id, { id: tutorId, role: 'TUTOR' });

      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toEqual(endAt);
      expect(result.cancelledAt).toBeNull();
      expect(result.cancelledById).toBeNull();
      expect(result.cancellationReason).toBeNull();
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        actorUserId: tutorId,
        actorRole: 'TUTOR',
        reason: null,
      });

      const secondBooking = await createActionBooking();
      const afterEnd = new BookingService(() => new Date('2026-07-20T11:00:00.001Z'));
      await expect(
        afterEnd.complete(secondBooking.id, { id: tutorId, role: 'TUTOR' })
      ).resolves.toMatchObject({ status: 'COMPLETED' });
    });

    it('rejects completion one millisecond before endAt', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => new Date('2026-07-20T10:59:59.999Z'));

      await expect(
        service.complete(booking.id, { id: tutorId, role: 'TUTOR' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });
    });

    it('rejects an unrelated tutor and a repeated completion', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

      await expect(
        service.complete(booking.id, { id: otherUserId, role: 'TUTOR' })
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

      await service.complete(booking.id, { id: tutorId, role: 'TUTOR' });
      await expect(
        service.complete(booking.id, { id: tutorId, role: 'TUTOR' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });
    });

    it('allows admin standard completion only at or after endAt', async () => {
      const booking = await createActionBooking();
      const early = new BookingService(() => new Date('2026-07-20T10:59:59.999Z'));
      const onTime = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

      await expect(
        early.complete(booking.id, { id: adminId, role: 'ADMIN' })
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });

      const result = await onTime.complete(booking.id, { id: adminId, role: 'ADMIN' });
      expect(result.status).toBe('COMPLETED');
    });

    it('returns actions only to actors that can invoke them', async () => {
      const booking = await createActionBooking();
      const beforeStart = new BookingService(() => new Date('2026-07-20T09:00:00.000Z'));
      const afterEnd = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

      expect(
        (await beforeStart.getDetail(booking.id, studentId, 'STUDENT')).allowedActions
      ).toEqual(['CANCEL']);
      expect(
        (await beforeStart.getDetail(booking.id, adminId, 'ADMIN')).allowedActions
      ).toEqual([]);
      expect(
        (await afterEnd.getDetail(booking.id, tutorId, 'TUTOR')).allowedActions
      ).toEqual(['COMPLETE']);
      expect(
        (await afterEnd.getDetail(booking.id, adminId, 'ADMIN')).allowedActions
      ).toEqual(['COMPLETE']);
    });

    it('does not expose participant actions when an actor ID is paired with the wrong role', async () => {
      const booking = await createActionBooking();
      const beforeStart = new BookingService(() => new Date('2026-07-20T09:00:00.000Z'));
      const afterEnd = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

      expect(
        (await beforeStart.getDetail(booking.id, studentId, 'TUTOR')).allowedActions
      ).toEqual([]);
      expect(
        (await beforeStart.getDetail(booking.id, tutorId, 'STUDENT')).allowedActions
      ).toEqual([]);
      expect(
        (await afterEnd.getDetail(booking.id, tutorId, 'STUDENT')).allowedActions
      ).toEqual([]);
    });

    it('exposes review only to the owning student while the completed booking is unreviewed', async () => {
      const booking = await createActionBooking({ status: 'COMPLETED' });
      const service = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

      expect(
        (await service.getDetail(booking.id, studentId, 'STUDENT')).allowedActions
      ).toEqual(['REVIEW']);
      expect(
        (await service.getDetail(booking.id, studentId, 'TUTOR')).allowedActions
      ).toEqual([]);
      expect(
        (await service.getDetail(booking.id, studentId, 'ADMIN')).allowedActions
      ).toEqual([]);

      await prisma.review.create({
        data: {
          bookingId: booking.id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Great session!',
        },
      });

      expect(
        (await service.getDetail(booking.id, studentId, 'STUDENT')).allowedActions
      ).toEqual([]);
    });
  });

  describe('BookingService.overrideStatus', () => {
    beforeEach(async () => {
      await prisma.review.deleteMany();
      await prisma.bookingStatusHistory.deleteMany();
      await prisma.booking.deleteMany();
      await prisma.user.update({ where: { id: tutorId }, data: { status: 'ACTIVE' } });
      await prisma.tutorProfile.update({
        where: { id: tutorProfileId },
        data: { approvalStatus: 'APPROVED' },
      });
    });

    it('allows early admin completion with a required audit reason', async () => {
      const booking = await createActionBooking();
      const now = new Date('2026-07-20T10:30:00.000Z');
      const service = new BookingService(() => now);

      const result = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'COMPLETED',
        'Administrative verification'
      );

      expect(result.status).toBe('COMPLETED');
      expect(result.completedAt).toEqual(now);
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CONFIRMED',
        toStatus: 'COMPLETED',
        actorUserId: adminId,
        actorRole: 'ADMIN',
        reason: 'Administrative verification',
      });
    });

    it('supports every different-status admin transition pair', async () => {
      const cases: Array<{
        from: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
        to: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
      }> = [
        { from: 'CONFIRMED', to: 'COMPLETED' },
        { from: 'CONFIRMED', to: 'CANCELLED' },
        { from: 'COMPLETED', to: 'CONFIRMED' },
        { from: 'COMPLETED', to: 'CANCELLED' },
        { from: 'CANCELLED', to: 'CONFIRMED' },
        { from: 'CANCELLED', to: 'COMPLETED' },
      ];
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      for (const transition of cases) {
        const booking = await createActionBooking({ status: transition.from });
        const result = await service.overrideStatus(
          booking.id,
          { id: adminId, role: 'ADMIN' },
          transition.to,
          `${transition.from} to ${transition.to}`
        );
        expect(result.status).toBe(transition.to);
        await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: booking.id } });
        await prisma.booking.delete({ where: { id: booking.id } });
      }
    });

    it('rejects non-admin and same-status overrides without history', async () => {
      const booking = await createActionBooking();
      const service = new BookingService(() => new Date('2026-07-20T09:00:00.000Z'));

      await expect(
        service.overrideStatus(
          booking.id,
          { id: tutorId, role: 'TUTOR' },
          'CANCELLED',
          'Not authorized'
        )
      ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

      await expect(
        service.overrideStatus(
          booking.id,
          { id: adminId, role: 'ADMIN' },
          'CONFIRMED',
          'Reaffirm'
        )
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });

      expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('clears cancellation metadata when an admin reconfirms a cancelled booking', async () => {
      const cancelledAt = new Date('2026-07-19T10:00:00.000Z');
      const now = new Date('2026-07-21T12:00:00.000Z');
      const reason = 'Restore booking';
      const booking = await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T10:00:00.000Z'),
          endAt: new Date('2026-07-20T11:00:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'CANCELLED',
          cancelledAt,
          cancelledById: studentId,
          cancellationReason: 'Old reason',
          completedAt: null,
        },
      });
      const service = new BookingService(() => now);

      const result = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CONFIRMED',
        reason
      );

      expect(result).toMatchObject({
        status: 'CONFIRMED',
        cancelledAt: null,
        cancelledById: null,
        cancellationReason: null,
        completedAt: null,
      });
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CANCELLED',
        toStatus: 'CONFIRMED',
        actorUserId: adminId,
        actorRole: 'ADMIN',
        reason,
      });
    });

    it('sets completion metadata and clears cancellation metadata for admin completion', async () => {
      const now = new Date('2026-07-21T12:01:00.000Z');
      const reason = 'Verified completed session';
      const booking = await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T10:00:00.000Z'),
          endAt: new Date('2026-07-20T11:00:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'CANCELLED',
          cancelledAt: new Date('2026-07-19T10:00:00.000Z'),
          cancelledById: studentId,
          cancellationReason: 'Old reason',
          completedAt: null,
        },
      });
      const service = new BookingService(() => now);

      const result = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'COMPLETED',
        reason
      );

      expect(result).toMatchObject({
        status: 'COMPLETED',
        cancelledAt: null,
        cancelledById: null,
        cancellationReason: null,
        completedAt: now,
      });
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CANCELLED',
        toStatus: 'COMPLETED',
        actorUserId: adminId,
        actorRole: 'ADMIN',
        reason,
      });
    });

    it('sets cancellation metadata and clears completion metadata for admin cancellation', async () => {
      const now = new Date('2026-07-21T12:02:00.000Z');
      const reason = 'Administrative cancellation';
      const booking = await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T10:00:00.000Z'),
          endAt: new Date('2026-07-20T11:00:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'COMPLETED',
          cancelledAt: null,
          cancelledById: null,
          cancellationReason: null,
          completedAt: new Date('2026-07-20T11:00:00.000Z'),
        },
      });
      const service = new BookingService(() => now);

      const result = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CANCELLED',
        reason
      );

      expect(result).toMatchObject({
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledById: adminId,
        cancellationReason: reason,
        completedAt: null,
      });
      expect(result.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'COMPLETED',
        toStatus: 'CANCELLED',
        actorUserId: adminId,
        actorRole: 'ADMIN',
        reason,
      });
    });

    it('rejects reconfirmation for an inactive tutor', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      await prisma.user.update({ where: { id: tutorId }, data: { status: 'BANNED' } });
      await expect(
        service.overrideStatus(
          booking.id,
          { id: adminId, role: 'ADMIN' },
          'CONFIRMED',
          'Restore'
        )
      ).rejects.toMatchObject({ statusCode: 409, code: 'TUTOR_NOT_APPROVED' });
    });

    it('rejects reconfirmation for an unapproved tutor', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      await prisma.tutorProfile.update({
        where: { id: tutorProfileId },
        data: { approvalStatus: 'REJECTED' },
      });
      await expect(
        service.overrideStatus(
          booking.id,
          { id: adminId, role: 'ADMIN' },
          'CONFIRMED',
          'Restore'
        )
      ).rejects.toMatchObject({ statusCode: 409, code: 'TUTOR_NOT_APPROVED' });
    });

    it('rejects overlapping reconfirmation but accepts adjacency', async () => {
      const cancelled = await createActionBooking({ status: 'CANCELLED' });
      await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T10:30:00.000Z'),
          endAt: new Date('2026-07-20T11:30:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'CONFIRMED',
        },
      });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      await expect(
        service.overrideStatus(
          cancelled.id,
          { id: adminId, role: 'ADMIN' },
          'CONFIRMED',
          'Restore'
        )
      ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_SLOT_CONFLICT' });

      await prisma.booking.deleteMany({ where: { id: { not: cancelled.id } } });
      await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T11:00:00.000Z'),
          endAt: new Date('2026-07-20T12:00:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'CONFIRMED',
        },
      });

      await expect(
        service.overrideStatus(
          cancelled.id,
          { id: adminId, role: 'ADMIN' },
          'CONFIRMED',
          'Restore adjacent booking'
        )
      ).resolves.toMatchObject({ status: 'CONFIRMED' });
    });

    it('blocks both transitions away from a reviewed completed booking without history', async () => {
      const booking = await createActionBooking({ status: 'COMPLETED' });
      await prisma.review.create({
        data: {
          bookingId: booking.id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Excellent session',
        },
      });
      const service = new BookingService(() => new Date('2026-07-21T12:00:00.000Z'));

      for (const targetStatus of ['CONFIRMED', 'CANCELLED'] as const) {
        await expect(
          service.overrideStatus(
            booking.id,
            { id: adminId, role: 'ADMIN' },
            targetStatus,
            `Correction to ${targetStatus}`
          )
        ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
      }

      expect(await prisma.booking.findUnique({ where: { id: booking.id } })).toMatchObject({
        status: 'COMPLETED',
      });
      expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
    });

    it('returns valid admin transitions in booking detail', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      const detail = await service.getDetail(booking.id, adminId, 'ADMIN');
      expect(detail.allowedAdminTransitions).toEqual(
        expect.arrayContaining(['CONFIRMED', 'COMPLETED'])
      );
      expect(detail.allowedAdminTransitions).not.toContain('CANCELLED');
    });

    it('omits reconfirmation from admin transitions for inactive and unapproved tutors', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      await prisma.user.update({ where: { id: tutorId }, data: { status: 'BANNED' } });
      const inactiveDetail = await service.getDetail(booking.id, adminId, 'ADMIN');
      expect(inactiveDetail.allowedAdminTransitions).not.toContain('CONFIRMED');

      await prisma.user.update({ where: { id: tutorId }, data: { status: 'ACTIVE' } });
      await prisma.tutorProfile.update({
        where: { id: tutorProfileId },
        data: { approvalStatus: 'REJECTED' },
      });
      const unapprovedDetail = await service.getDetail(booking.id, adminId, 'ADMIN');
      expect(unapprovedDetail.allowedAdminTransitions).not.toContain('CONFIRMED');
    });

    it('omits reconfirmation from admin transitions when another confirmed booking overlaps', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      await prisma.booking.create({
        data: {
          studentId,
          tutorProfileId,
          categoryId,
          startAt: new Date('2026-07-20T10:30:00.000Z'),
          endAt: new Date('2026-07-20T11:30:00.000Z'),
          durationMinutes: 60,
          hourlyRateSnapshot: 50,
          quotedPrice: 50,
          status: 'CONFIRMED',
        },
      });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      const detail = await service.getDetail(booking.id, adminId, 'ADMIN');

      expect(detail.allowedAdminTransitions).not.toContain('CONFIRMED');
      expect(detail.allowedAdminTransitions).toContain('COMPLETED');
    });

    it('returns no admin transitions for a reviewed completed booking', async () => {
      const booking = await createActionBooking({ status: 'COMPLETED' });
      await prisma.review.create({
        data: {
          bookingId: booking.id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Excellent session',
        },
      });
      const service = new BookingService(() => new Date('2026-07-21T12:00:00.000Z'));

      const detail = await service.getDetail(booking.id, adminId, 'ADMIN');

      expect(detail.allowedAdminTransitions).toEqual([]);
    });

    it('omits admin transitions from non-admin booking detail', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

      const detail = await service.getDetail(booking.id, studentId, 'STUDENT');

      expect(detail).not.toHaveProperty('allowedAdminTransitions');
    });

    it('keeps creation and sequential same-clock transitions in strict semantic order', async () => {
      const now = new Date('2026-07-19T10:00:00.000Z');
      const booking = await createActionBooking();
      await prisma.bookingStatusHistory.create({
        data: {
          bookingId: booking.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          actorUserId: studentId,
          actorRole: 'STUDENT',
          createdAt: now,
        },
      });
      const service = new BookingService(() => now);

      await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'COMPLETED',
        'Mark complete'
      );
      const detail = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CANCELLED',
        'Correct to cancelled'
      );

      expect(detail.statusHistory.map((entry) => entry.toStatus)).toEqual([
        'CONFIRMED',
        'COMPLETED',
        'CANCELLED',
      ]);
      const timestamps = detail.statusHistory.map((entry) => entry.createdAt.getTime());
      expect(timestamps[0]).toBeLessThan(timestamps[1]);
      expect(timestamps[1]).toBeLessThan(timestamps[2]);
    });

    it('orders status history deterministically when timestamps are equal', async () => {
      const booking = await createActionBooking({ status: 'CANCELLED' });
      const createdAt = new Date('2026-07-19T10:00:00.000Z');
      await prisma.bookingStatusHistory.createMany({
        data: [
          {
            id: 'history-z',
            bookingId: booking.id,
            fromStatus: 'COMPLETED',
            toStatus: 'CANCELLED',
            actorUserId: adminId,
            actorRole: 'ADMIN',
            reason: 'Second by stable ID',
            createdAt,
          },
          {
            id: 'history-a',
            bookingId: booking.id,
            fromStatus: 'CONFIRMED',
            toStatus: 'COMPLETED',
            actorUserId: adminId,
            actorRole: 'ADMIN',
            reason: 'First by stable ID',
            createdAt,
          },
        ],
      });
      const service = new BookingService(() => new Date('2026-07-21T12:00:00.000Z'));

      const detail = await service.getDetail(booking.id, adminId, 'ADMIN');

      expect(detail.statusHistory.map((entry) => entry.id)).toEqual([
        'history-a',
        'history-z',
      ]);
    });
  });
});
