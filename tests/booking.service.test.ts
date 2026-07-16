import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { prisma } from '../src/config/db.js';
import { bookingService } from '../src/modules/bookings/booking.service.js';
import { bookingRepository } from '../src/modules/bookings/booking.repository.js';
import { createBookingSchema, getBookingsQuerySchema } from '../src/modules/bookings/booking.schemas.js';
import { AppError, NotFoundError } from '../src/shared/errors/app-error.js';

jest.setTimeout(60000);

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
  });

  // ─── Steps 2 & 3: BookingService validations & creation ────────────────────────

  describe('BookingService.create', () => {
    it('should throw INVALID_DURATION for unsupported durations', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2026-07-20T10:00:00.000Z',
          durationMinutes: 45, // Defaults in env are 30, 60, 90, 120
        })
      ).rejects.toThrow(new AppError(400, 'INVALID_DURATION', 'Requested booking duration is not supported.'));
    });

    it('should throw INVALID_ALIGNMENT for start times not aligning to 30-min block', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2026-07-20T10:15:00.000Z',
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

    it('should throw MIDNIGHT_CROSSING if duration causes booking to wrap across UTC midnight', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2026-07-20T23:30:00.000Z', // 60 minutes wraps to 00:30 next day
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
          startAt: '2026-07-20T10:00:00.000Z',
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
          startAt: '2026-07-20T10:00:00.000Z',
          durationMinutes: 60,
        })
      ).rejects.toThrow(new NotFoundError('Category not found or inactive for this tutor.'));
    });

    it('should throw OUT_OF_AVAILABILITY if requested time is outside weekly availability minutes', async () => {
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2026-07-20T08:00:00.000Z', // 8:00 UTC is minute 480. Tutor starts at 540 (9:00 UTC)
          durationMinutes: 60,
        })
      ).rejects.toThrow(new AppError(400, 'OUT_OF_AVAILABILITY', 'Requested time is outside the tutor availability.'));
    });

    it('should successfully create a booking, calculate correct quoted price, snapshot rate and create booking history', async () => {
      const startAtStr = '2026-07-20T10:00:00.000Z'; // Monday 10:00 UTC (minute 600, duration 60 -> ends 660, inside 540-1020 availability)
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

    it('should throw BOOKING_SLOT_CONFLICT if new booking overlaps with the existing confirmed booking', async () => {
      // Trying to book during the Monday 10:00 - 11:00 slot that we just successfully booked
      await expect(
        bookingService.create(studentId, {
          tutorId: tutorProfileId,
          categoryId,
          startAt: '2026-07-20T10:30:00.000Z', // 10:30 to 11:30 overlaps with 10:00 to 11:00
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
      const listRes = await bookingService.list(studentId, 'STUDENT', {
        status: 'CONFIRMED',
        from: '2026-07-20T00:00:00.000Z',
        to: '2026-07-21T00:00:00.000Z',
        page: 1,
        pageSize: 10,
      });

      expect(listRes.bookings.length).toBe(1);
      expect(listRes.bookings[0].status).toBe('CONFIRMED');
      expect(new Date(listRes.bookings[0].startAt).getTime()).toBeGreaterThanOrEqual(new Date('2026-07-20T00:00:00.000Z').getTime());
    });
  });
});
