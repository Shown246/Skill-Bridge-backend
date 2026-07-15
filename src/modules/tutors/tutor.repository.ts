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
}

export const tutorRepository = new TutorRepository();
