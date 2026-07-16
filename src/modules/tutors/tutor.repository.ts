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
    const params: unknown[] = [];
    const parameter = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const conditions = [
      `tp."approvalStatus" = 'APPROVED'`,
      `u.status = 'ACTIVE'`,
    ];

    if (options.q) {
      const search = `%${options.q}%`;
      const headlineParam = parameter(search);
      const bioParam = parameter(search);
      const nameParam = parameter(search);
      conditions.push(
        `(tp.headline ILIKE ${headlineParam} OR tp.bio ILIKE ${bioParam} OR u.name ILIKE ${nameParam})`
      );
    }
    if (options.categorySlug) {
      const categoryParam = parameter(options.categorySlug);
      conditions.push(`EXISTS (
        SELECT 1
        FROM tutor_category tc
        JOIN category c ON c.id = tc."categoryId"
        WHERE tc."tutorProfileId" = tp.id
          AND c.slug = ${categoryParam}
          AND c."isActive" = true
      )`);
    }
    if (options.minRate !== undefined) {
      conditions.push(`tp."hourlyRate" >= ${parameter(options.minRate)}`);
    }
    if (options.maxRate !== undefined) {
      conditions.push(`tp."hourlyRate" <= ${parameter(options.maxRate)}`);
    }

    const having = options.minRating === undefined
      ? ''
      : `HAVING COALESCE(AVG(r.rating), 0) >= ${parameter(options.minRating)}`;
    const groupedSql = `
      SELECT
        tp.id,
        COALESCE(AVG(r.rating), 0)::double precision AS "averageRating",
        COUNT(r.id)::integer AS "reviewCount",
        tp."createdAt",
        tp."hourlyRate"
      FROM tutor_profile tp
      JOIN "user" u ON u.id = tp."userId"
      LEFT JOIN review r ON r."tutorProfileId" = tp.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY tp.id
      ${having}
    `;
    const orderBy = options.sortBy === 'price_asc'
      ? `"hourlyRate" ASC, "createdAt" DESC`
      : options.sortBy === 'price_desc'
        ? `"hourlyRate" DESC, "createdAt" DESC`
        : options.sortBy === 'rating_desc'
          ? `"averageRating" DESC, "reviewCount" DESC, "createdAt" DESC`
          : options.sortBy === 'reviews_desc'
            ? `"reviewCount" DESC, "averageRating" DESC, "createdAt" DESC`
            : `"createdAt" DESC`;
    const countRows = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::integer AS total FROM (${groupedSql}) ranked`,
      ...params
    );
    const pageParams = [...params, options.skip, options.take];
    const aggregateRows = await prisma.$queryRawUnsafe<Array<{
      id: string;
      averageRating: number;
      reviewCount: number;
    }>>(
      `${groupedSql}
       ORDER BY ${orderBy}
       OFFSET $${params.length + 1}
       LIMIT $${params.length + 2}`,
      ...pageParams
    );
    const ids = aggregateRows.map((row) => row.id);
    if (ids.length === 0) {
      return { tutors: [], total: countRows[0]?.total ?? 0 };
    }

    const profiles = await prisma.tutorProfile.findMany({
      where: { id: { in: ids } },
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
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

    return {
      tutors: aggregateRows.map((aggregate) => ({
        ...profileById.get(aggregate.id)!,
        averageRating: aggregate.averageRating,
        reviewCount: aggregate.reviewCount,
      })),
      total: countRows[0]?.total ?? 0,
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
      },
    });
  }

  async getReviewAggregate(tutorProfileId: string) {
    const aggregate = await prisma.review.aggregate({
      where: { tutorProfileId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    return {
      averageRating: aggregate._avg.rating ?? 0,
      reviewCount: aggregate._count.rating,
    };
  }
}

export const tutorRepository = new TutorRepository();
