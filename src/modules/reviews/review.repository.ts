import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';

export class ReviewRepository {
  async findBookingForReview(bookingId: string) {
    return prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        studentId: true,
        tutorProfileId: true,
        status: true,
        review: { select: { id: true } },
      },
    });
  }

  async create(data: {
    bookingId: string;
    studentId: string;
    tutorProfileId: string;
    rating: number;
    comment: string;
  }) {
    return prisma.review.create({ data });
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
