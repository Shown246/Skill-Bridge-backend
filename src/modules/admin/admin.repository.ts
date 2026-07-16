import type { Prisma, UserRole, UserStatus, BookingStatus } from '@prisma/client';
import { prisma } from '../../config/db.js';

export class AdminRepository {
  async getStats() {
    const [
      totalStudents,
      totalTutors,
      activeBookings,
      totalCategories,
      ratingAggregate,
      hourlyRateAggregate,
    ] = await Promise.all([
      prisma.user.count({ where: { role: 'STUDENT' } }),
      prisma.user.count({ where: { role: 'TUTOR' } }),
      prisma.booking.count({ where: { status: 'CONFIRMED' } }),
      prisma.category.count(),
      prisma.review.aggregate({ _avg: { rating: true } }),
      prisma.tutorProfile.aggregate({ _avg: { hourlyRate: true } }),
    ]);

    return {
      totalStudents,
      totalTutors,
      activeBookings,
      totalCategories,
      averageTutorRating: ratingAggregate._avg.rating ?? 0,
      averageHourlyRate: Number(hourlyRateAggregate._avg.hourlyRate ?? 0),
    };
  }

  async listUsers(options: {
    q?: string;
    role?: UserRole;
    status?: UserStatus;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.UserWhereInput = {};
    if (options.q) {
      where.OR = [
        { name: { contains: options.q, mode: 'insensitive' } },
        { email: { contains: options.q, mode: 'insensitive' } },
      ];
    }
    if (options.role) where.role = options.role;
    if (options.status) where.status = options.status;

    const [users, totalItems] = await Promise.all([
      prisma.user.findMany({
        where,
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          name: true,
          email: true,
          emailVerified: true,
          image: true,
          phone: true,
          role: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);
    return { users, totalItems };
  }

  async findUserById(userId: string) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, status: true },
    });
  }

  async updateUserStatus(userId: string, status: UserStatus) {
    return prisma.user.update({
      where: { id: userId },
      data: { status },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async listBookings(options: {
    q?: string;
    studentId?: string;
    tutorId?: string;
    status?: BookingStatus;
    from?: string;
    to?: string;
    page: number;
    pageSize: number;
  }) {
    const where: Prisma.BookingWhereInput = {};
    if (options.q) {
      where.OR = [
        { student: { name: { contains: options.q, mode: 'insensitive' } } },
        { student: { email: { contains: options.q, mode: 'insensitive' } } },
        {
          tutorProfile: {
            user: { name: { contains: options.q, mode: 'insensitive' } },
          },
        },
        {
          tutorProfile: {
            user: { email: { contains: options.q, mode: 'insensitive' } },
          },
        },
        { category: { name: { contains: options.q, mode: 'insensitive' } } },
      ];
    }
    if (options.studentId) where.studentId = options.studentId;
    if (options.tutorId) where.tutorProfileId = options.tutorId;
    if (options.status) where.status = options.status;
    if (options.from || options.to) {
      where.startAt = {};
      if (options.from) where.startAt.gte = new Date(options.from);
      if (options.to) where.startAt.lte = new Date(options.to);
    }

    const [bookings, totalItems] = await Promise.all([
      prisma.booking.findMany({
        where,
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
        orderBy: [{ startAt: 'desc' }, { id: 'desc' }],
        include: {
          student: {
            select: { id: true, name: true, email: true, status: true },
          },
          tutorProfile: {
            include: {
              user: {
                select: { id: true, name: true, email: true, status: true },
              },
            },
          },
          category: true,
          review: true,
        },
      }),
      prisma.booking.count({ where }),
    ]);
    return { bookings, totalItems };
  }
}

export const adminRepository = new AdminRepository();
