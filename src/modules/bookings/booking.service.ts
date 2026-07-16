import type { BookingStatus, UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { bookingRepository } from './booking.repository.js';
import type {
  BookingAction,
  BookingActor,
  BookingTransitionCommand,
} from './booking.types.js';
import { AppError, NotFoundError, ConflictError, ForbiddenError } from '../../shared/errors/app-error.js';
import { env } from '../../config/env.js';

export class BookingService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async cancel(bookingId: string, actor: BookingActor, reason?: string) {
    return this.transition(bookingId, actor, {
      mode: 'PARTICIPANT_CANCEL',
      targetStatus: 'CANCELLED',
      reason,
    });
  }

  async complete(bookingId: string, actor: BookingActor) {
    return this.transition(bookingId, actor, {
      mode: 'STANDARD_COMPLETE',
      targetStatus: 'COMPLETED',
    });
  }

  private async transition(
    bookingId: string,
    actor: BookingActor,
    command: BookingTransitionCommand
  ) {
    const bookingRef = await bookingRepository.findTutorProfileIdByBookingId(bookingId);
    if (!bookingRef) {
      throw new NotFoundError('Booking not found.');
    }

    await prisma.$transaction(
      async (tx) => {
        await bookingRepository.lockTutorProfile(bookingRef.tutorProfileId, tx);
        const booking = await bookingRepository.findTransitionState(bookingId, tx);
        if (!booking) {
          throw new NotFoundError('Booking not found.');
        }

        const transitionNow = this.now();

        if (command.mode === 'PARTICIPANT_CANCEL') {
          const isOwner = actor.role === 'STUDENT' && booking.studentId === actor.id;
          const isAssignedTutor =
            actor.role === 'TUTOR' && booking.tutorProfile.userId === actor.id;
          if (!isOwner && !isAssignedTutor) {
            throw new ForbiddenError('Access denied.');
          }
          if (booking.status !== 'CONFIRMED') {
            throw new ConflictError(
              'Only confirmed bookings can be cancelled.',
              'BOOKING_STATUS_CONFLICT'
            );
          }
          if (transitionNow.getTime() >= booking.startAt.getTime()) {
            throw new ConflictError(
              'Booking cancellation is not allowed at or after the start time.',
              'BOOKING_ALREADY_STARTED'
            );
          }
        }

        if (command.mode === 'STANDARD_COMPLETE') {
          const isAssignedTutor =
            actor.role === 'TUTOR' && booking.tutorProfile.userId === actor.id;
          const isAdmin = actor.role === 'ADMIN';
          if (!isAssignedTutor && !isAdmin) {
            throw new ForbiddenError('Access denied.');
          }
          if (
            booking.status !== 'CONFIRMED' ||
            transitionNow.getTime() < booking.endAt.getTime()
          ) {
            throw new ConflictError(
              'Booking is not eligible for completion.',
              'BOOKING_NOT_COMPLETABLE'
            );
          }
        }

        await bookingRepository.transitionBooking(
          {
            bookingId,
            fromStatus: booking.status,
            toStatus: command.targetStatus,
            actor,
            reason: command.reason,
            now: transitionNow,
          },
          tx
        );
      },
      { maxWait: 15000, timeout: 15000 }
    );

    return this.getDetail(bookingId, actor.id, actor.role);
  }

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
    const adjustedEndAt = new Date(endAt.getTime() - 1);
    if (startAt.getUTCDay() !== adjustedEndAt.getUTCDay()) {
      throw new AppError(400, 'MIDNIGHT_CROSSING', 'Booking cannot wrap across UTC midnight.');
    }

    return prisma.$transaction(async (tx) => {
      // 1. Lock tutor row
      await bookingRepository.lockTutorProfile(data.tutorId, tx);

      // Validate student status inside the transaction
      const student = await tx.user.findUnique({
        where: { id: studentId },
      });
      if (!student || student.role !== 'STUDENT' || student.status !== 'ACTIVE') {
        throw new AppError(403, 'INACTIVE_STUDENT', 'Authenticated user must be an active student.');
      }

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
        throw new ConflictError('Requested booking slot conflicts with an existing booking.', 'BOOKING_SLOT_CONFLICT');
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
    }, {
      maxWait: 15000,
      timeout: 15000,
    });
  }

  async getDetail(bookingId: string, userId: string, role: UserRole) {
    const booking = await bookingRepository.findById(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking not found.');
    }

    // Auth validation
    const isStudent = booking.studentId === userId;
    const isTutor = booking.tutorProfile.userId === userId;
    const isAdmin = role === 'ADMIN';

    if (!isStudent && !isTutor && !isAdmin) {
      throw new ForbiddenError('Access denied.');
    }

    const allowedActions = this.computeAllowedActions(booking, userId, role);

    return {
      ...booking,
      allowedActions,
    };
  }

  async list(userId: string, role: UserRole, query: {
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

  private computeAllowedActions(
    booking: {
      status: BookingStatus;
      studentId: string;
      startAt: Date;
      endAt: Date;
      tutorProfile: { userId: string };
      review: unknown | null;
    },
    userId: string,
    role: UserRole
  ): BookingAction[] {
    const actions: BookingAction[] = [];
    const now = this.now();

    if (booking.status === 'CONFIRMED') {
      const participantCanCancel =
        booking.studentId === userId || booking.tutorProfile.userId === userId;
      if (participantCanCancel && now.getTime() < booking.startAt.getTime()) {
        actions.push('CANCEL');
      }

      const actorCanComplete =
        booking.tutorProfile.userId === userId || role === 'ADMIN';
      if (actorCanComplete && now.getTime() >= booking.endAt.getTime()) {
        actions.push('COMPLETE');
      }
    }

    if (booking.status === 'COMPLETED' && booking.studentId === userId && !booking.review) {
      actions.push('REVIEW');
    }

    return actions;
  }
}

export const bookingService = new BookingService();
