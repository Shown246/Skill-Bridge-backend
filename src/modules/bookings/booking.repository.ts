import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import type { BookingTransitionWrite } from './booking.types.js';

type TransactionClient = Prisma.TransactionClient;

export class BookingRepository {
  async lockTutorProfile(tutorProfileId: string, tx: TransactionClient) {
    await tx.$executeRaw`SELECT 1 FROM tutor_profile WHERE id = ${tutorProfileId} FOR UPDATE`;
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
    currencyCode?: string;
    note?: string;
  }, tx: TransactionClient) {
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
        currencyCode: data.currencyCode,
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

  async checkOverlap(
    tutorProfileId: string,
    startAt: Date,
    endAt: Date,
    tx: TransactionClient,
    excludeBookingId?: string
  ) {
    const count = await tx.booking.count({
      where: {
        tutorProfileId,
        status: 'CONFIRMED',
        ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    return count > 0;
  }

  async checkOverlapOutsideTransaction(
    tutorProfileId: string,
    startAt: Date,
    endAt: Date,
    excludeBookingId: string
  ) {
    const count = await prisma.booking.count({
      where: {
        tutorProfileId,
        status: 'CONFIRMED',
        id: { not: excludeBookingId },
        startAt: { lt: endAt },
        endAt: { gt: startAt },
      },
    });
    return count > 0;
  }

  async isTutorEligibleForReconfirmation(tutorProfileId: string) {
    const tutor = await prisma.tutorProfile.findUnique({
      where: { id: tutorProfileId },
      select: {
        approvalStatus: true,
        user: { select: { status: true } },
      },
    });
    return Boolean(
      tutor &&
        tutor.approvalStatus === 'APPROVED' &&
        tutor.user.status === 'ACTIVE'
    );
  }

  async findTutorProfileIdByBookingId(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: { tutorProfileId: true },
    });
  }

  async findTransitionState(bookingId: string, tx: TransactionClient) {
    return tx.booking.findUnique({
      where: { id: bookingId },
      include: {
        review: true,
        tutorProfile: {
          include: {
            user: {
              select: { id: true, status: true },
            },
          },
        },
      },
    });
  }

  async findLatestHistoryTimestamp(bookingId: string, tx: TransactionClient) {
    const latestHistory = await tx.bookingStatusHistory.findFirst({
      where: { bookingId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { createdAt: true },
    });
    return latestHistory?.createdAt ?? null;
  }

  async transitionBooking(write: BookingTransitionWrite, tx: TransactionClient) {
    const cancellationData =
      write.toStatus === 'CANCELLED'
        ? {
            cancelledAt: write.now,
            cancelledById: write.actor.id,
            cancellationReason: write.reason ?? null,
            completedAt: null,
          }
        : {
            cancelledAt: null,
            cancelledById: null,
            cancellationReason: null,
          };

    const booking = await tx.booking.update({
      where: { id: write.bookingId },
      data: {
        status: write.toStatus,
        ...cancellationData,
        completedAt: write.toStatus === 'COMPLETED' ? write.now : null,
      },
    });

    await tx.bookingStatusHistory.create({
      data: {
        bookingId: write.bookingId,
        fromStatus: write.fromStatus,
        toStatus: write.toStatus,
        actorUserId: write.actor.id,
        actorRole: write.actor.role as UserRole,
        reason: write.reason ?? null,
        createdAt: write.historyCreatedAt,
      },
    });

    return booking;
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
          review: true,
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
        statusHistory: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        review: true,
      },
    });
  }
}

export const bookingRepository = new BookingRepository();
