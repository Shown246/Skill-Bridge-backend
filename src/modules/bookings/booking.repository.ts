import { prisma } from '../../config/db.js';

export class BookingRepository {
  async lockTutorProfile(tutorProfileId: string, tx: any) {
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
        statusHistory: { orderBy: { createdAt: 'asc' } },
        review: true,
      },
    });
  }
}

export const bookingRepository = new BookingRepository();
