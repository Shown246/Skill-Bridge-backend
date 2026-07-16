import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';

export class ReviewRepository {
  async createForBooking(data: {
    bookingId: string;
    studentId: string;
    rating: number;
    comment: string;
  }) {
    return prisma.$transaction(async (tx) => {
      const bookingReference = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: { tutorProfileId: true },
      });
      if (!bookingReference) {
        return { outcome: 'NOT_FOUND' as const };
      }

      // Match booking transition lock order: tutor profile first, booking second.
      await tx.$executeRaw`
        SELECT 1 FROM tutor_profile
        WHERE id = ${bookingReference.tutorProfileId}
        FOR UPDATE
      `;
      await tx.$executeRaw`
        SELECT 1 FROM booking
        WHERE id = ${data.bookingId}
        FOR UPDATE
      `;

      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: {
          studentId: true,
          tutorProfileId: true,
          status: true,
          review: { select: { id: true } },
        },
      });
      if (!booking) {
        return { outcome: 'NOT_FOUND' as const };
      }
      if (booking.studentId !== data.studentId) {
        return { outcome: 'FORBIDDEN' as const };
      }
      if (booking.status !== 'COMPLETED') {
        return { outcome: 'NOT_COMPLETED' as const };
      }
      if (booking.review) {
        return { outcome: 'ALREADY_REVIEWED' as const };
      }

      const review = await tx.review.create({
        data: {
          bookingId: data.bookingId,
          studentId: data.studentId,
          tutorProfileId: booking.tutorProfileId,
          rating: data.rating,
          comment: data.comment,
        },
      });
      return { outcome: 'CREATED' as const, review };
    }, { maxWait: 15000, timeout: 15000 });
  }

  async listForPublicTutor(tutorProfileId: string, page: number, pageSize: number) {
    const where: Prisma.ReviewWhereInput = { tutorProfileId };
    const [reviews, totalItems] = await Promise.all([
      prisma.review.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          bookingId: true,
          rating: true,
          comment: true,
          createdAt: true,
          student: {
            select: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);

    return { reviews, totalItems };
  }
}

export const reviewRepository = new ReviewRepository();
