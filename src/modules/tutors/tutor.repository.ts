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

    // Determine sort order
    let orderBy: Prisma.TutorProfileOrderByWithRelationInput;
    switch (options.sortBy) {
      case 'price_asc':
        orderBy = { hourlyRate: 'asc' };
        break;
      case 'price_desc':
        orderBy = { hourlyRate: 'desc' };
        break;
      // rating_desc and reviews_desc will be implemented when Review model exists
      // For now, fall through to recommended (newest first)
      case 'rating_desc':
      case 'reviews_desc':
      case 'recommended':
      default:
        orderBy = { createdAt: 'desc' };
        break;
    }

    const [tutors, total] = await Promise.all([
      prisma.tutorProfile.findMany({
        where,
        skip: options.skip,
        take: options.take,
        orderBy,
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
        },
      }),
      prisma.tutorProfile.count({ where }),
    ]);

    return { tutors, total };
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
      },
    });
  }
}

export const tutorRepository = new TutorRepository();
