import { prisma } from '../../config/db.js';
import { Prisma } from '@prisma/client';

export class TutorRepository {
  async findByUserId(userId: string) {
    return prisma.tutorProfile.findUnique({
      where: { userId },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findById(id: string) {
    return prisma.tutorProfile.findUnique({
      where: { id },
      include: {
        categories: {
          include: {
            category: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
          },
        },
        approvedBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  async findAdminTutors(options: {
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    q?: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.TutorProfileWhereInput = {};

    if (options.approvalStatus) {
      where.approvalStatus = options.approvalStatus;
    }

    if (options.q) {
      where.OR = [
        {
          headline: {
            contains: options.q,
            mode: 'insensitive',
          },
        },
        {
          bio: {
            contains: options.q,
            mode: 'insensitive',
          },
        },
        {
          user: {
            OR: [
              {
                name: {
                  contains: options.q,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: options.q,
                  mode: 'insensitive',
                },
              },
            ],
          },
        },
      ];
    }

    const [tutors, total] = await Promise.all([
      prisma.tutorProfile.findMany({
        where,
        skip: options.skip,
        take: options.take,
        orderBy: {
          createdAt: 'desc',
        },
        include: {
          categories: {
            include: {
              category: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              status: true,
            },
          },
          approvedBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      }),
      prisma.tutorProfile.count({ where }),
    ]);

    return { tutors, total };
  }

  async findPublicTutors(options: {
    q?: string;
    categorySlug?: string;
    minRate?: number;
    maxRate?: number;
    minRating?: number;
    sortBy: string;
    skip: number;
    take: number;
  }) {
    const where: Prisma.TutorProfileWhereInput = {
      approvalStatus: 'APPROVED',
      user: {
        status: 'ACTIVE',
      },
    };

    if (options.q) {
      where.OR = [
        { headline: { contains: options.q, mode: 'insensitive' } },
        { bio: { contains: options.q, mode: 'insensitive' } },
        { user: { name: { contains: options.q, mode: 'insensitive' } } },
      ];
    }

    if (options.categorySlug) {
      where.categories = {
        some: {
          category: {
            slug: options.categorySlug,
            isActive: true,
          },
        },
      };
    }

    if (options.minRate !== undefined || options.maxRate !== undefined) {
      where.hourlyRate = {};
      if (options.minRate !== undefined) {
        where.hourlyRate.gte = options.minRate;
      }
      if (options.maxRate !== undefined) {
        where.hourlyRate.lte = options.maxRate;
      }
    }

    const candidates = await prisma.tutorProfile.findMany({
      where,
      include: {
        categories: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        reviews: { select: { rating: true } },
      },
    });

    const decorated = candidates.map(({ reviews, ...tutor }) => ({
      ...tutor,
      averageRating:
        reviews.length === 0
          ? 0
          : reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length,
      reviewCount: reviews.length,
    }));
    const filtered = options.minRating === undefined
      ? decorated
      : decorated.filter((tutor) => tutor.averageRating >= options.minRating!);

    filtered.sort((left, right) => {
      if (options.sortBy === 'price_asc') {
        return Number(left.hourlyRate) - Number(right.hourlyRate);
      }
      if (options.sortBy === 'price_desc') {
        return Number(right.hourlyRate) - Number(left.hourlyRate);
      }
      if (options.sortBy === 'rating_desc') {
        return right.averageRating - left.averageRating
          || right.reviewCount - left.reviewCount
          || right.createdAt.getTime() - left.createdAt.getTime();
      }
      if (options.sortBy === 'reviews_desc') {
        return right.reviewCount - left.reviewCount
          || right.averageRating - left.averageRating
          || right.createdAt.getTime() - left.createdAt.getTime();
      }
      return right.createdAt.getTime() - left.createdAt.getTime();
    });

    return {
      tutors: filtered.slice(options.skip, options.skip + options.take),
      total: filtered.length,
    };
  }

  async findPublicById(id: string) {
    return prisma.tutorProfile.findFirst({
      where: {
        id,
        approvalStatus: 'APPROVED',
        user: {
          status: 'ACTIVE',
        },
      },
      include: {
        categories: {
          include: {
            category: {
              select: {
                id: true,
                name: true,
                slug: true,
              },
            },
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            image: true,
          },
        },
        reviews: { select: { rating: true } },
      },
    });
  }
}

export const tutorRepository = new TutorRepository();
