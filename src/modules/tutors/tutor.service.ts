import { prisma } from '../../config/db.js';
import { tutorRepository } from './tutor.repository.js';
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from '../../shared/errors/app-error.js';

export class TutorService {
  async getProfile(userId: string) {
    const profile = await tutorRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundError('Tutor profile not found.');
    }
    return profile;
  }

  async upsertProfile(
    userId: string,
    data: {
      headline: string;
      bio: string;
      experienceYears: number;
      hourlyRate: number;
      categoryIds: string[];
    }
  ) {
    return prisma.$transaction(async (tx) => {
      // 1. Validate that all categoryIds are active in the database
      const activeCategories = await tx.category.findMany({
        where: {
          id: { in: data.categoryIds },
          isActive: true,
        },
      });

      if (activeCategories.length !== data.categoryIds.length) {
        throw new ValidationError('One or more selected categories are invalid or inactive.');
      }

      // 2. Check if the profile already exists
      const existingProfile = await tx.tutorProfile.findUnique({
        where: { userId },
      });

      let profile;
      if (!existingProfile) {
        // First-time completed profile becomes PENDING
        profile = await tx.tutorProfile.create({
          data: {
            userId,
            headline: data.headline,
            bio: data.bio,
            experienceYears: data.experienceYears,
            hourlyRate: data.hourlyRate,
            approvalStatus: 'PENDING',
          },
        });
      } else {
        // Updates are made without resetting approval metadata, unless specified
        profile = await tx.tutorProfile.update({
          where: { userId },
          data: {
            headline: data.headline,
            bio: data.bio,
            experienceYears: data.experienceYears,
            hourlyRate: data.hourlyRate,
          },
        });
      }

      // 3. Replace category associations
      await tx.tutorCategory.deleteMany({
        where: { tutorProfileId: profile.id },
      });

      const uniqueCategoryIds = Array.from(new Set(data.categoryIds));
      await tx.tutorCategory.createMany({
        data: uniqueCategoryIds.map((catId) => ({
          tutorProfileId: profile.id,
          categoryId: catId,
        })),
      });

      // 4. Return complete profile
      return tx.tutorProfile.findUnique({
        where: { id: profile.id },
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
        },
      });
    }, { maxWait: 15000, timeout: 15000 });
  }

  async getAdminTutors(options: {
    approvalStatus?: 'PENDING' | 'APPROVED' | 'REJECTED';
    q?: string;
    page: number;
    pageSize: number;
  }) {
    const skip = (options.page - 1) * options.pageSize;
    const take = options.pageSize;

    const { tutors, total } = await tutorRepository.findAdminTutors({
      approvalStatus: options.approvalStatus,
      q: options.q,
      skip,
      take,
    });

    return {
      tutors,
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  async getAdminTutorById(id: string) {
    const profile = await tutorRepository.findById(id);
    if (!profile) {
      throw new NotFoundError('Tutor profile not found.');
    }
    return profile;
  }

  async moderateApproval(
    tutorId: string,
    adminUserId: string,
    data: {
      status: 'APPROVED' | 'REJECTED';
      reason?: string | null;
    }
  ) {
    const profile = await tutorRepository.findById(tutorId);
    if (!profile) {
      throw new NotFoundError('Tutor profile not found.');
    }

    // Role checks: Target user must have the TUTOR role.
    if (profile.user.role !== 'TUTOR') {
      throw new ConflictError('Target user must have the TUTOR role.', 'ROLE_CHECK_FAILED');
    }

    if (data.status === 'APPROVED') {
      // Approval requires complete profile (headline, bio, etc. are already validated via upsert)
      // and at least one active category.
      const hasActiveCategory = profile.categories.some((c) => c.category.isActive);
      if (!hasActiveCategory) {
        throw new ValidationError('Approval requires at least one active category.');
      }
    } else if (data.status === 'REJECTED') {
      if (!data.reason || data.reason.trim() === '') {
        throw new ValidationError('Rejection requires a non-empty reason.');
      }
    }

    return prisma.tutorProfile.update({
      where: { id: tutorId },
      data: {
        approvalStatus: data.status,
        rejectionReason: data.status === 'REJECTED' ? data.reason : null,
        approvedAt: data.status === 'APPROVED' ? new Date() : null,
        approvedById: data.status === 'APPROVED' ? adminUserId : null,
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
    });
  }
  async searchPublicTutors(options: {
    q?: string;
    category?: string;
    minRate?: number;
    maxRate?: number;
    sort: string;
    page: number;
    pageSize: number;
  }) {
    const skip = (options.page - 1) * options.pageSize;
    const take = options.pageSize;

    const { tutors, total } = await tutorRepository.findPublicTutors({
      q: options.q,
      categorySlug: options.category,
      minRate: options.minRate,
      maxRate: options.maxRate,
      sortBy: options.sort,
      skip,
      take,
    });

    return {
      tutors,
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: total,
        totalPages: Math.ceil(total / options.pageSize),
      },
    };
  }

  async getPublicTutorById(id: string) {
    const profile = await tutorRepository.findPublicById(id);
    if (!profile) {
      throw new NotFoundError('Tutor not found.');
    }
    return profile;
  }
}

export const tutorService = new TutorService();
