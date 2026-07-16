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
