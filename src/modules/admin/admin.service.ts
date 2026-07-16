import type { BookingStatus, UserRole, UserStatus } from '@prisma/client';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error.js';
import { logger } from '../../shared/logging/logger.js';
import { adminRepository } from './admin.repository.js';

export class AdminService {
  getStats() {
    return adminRepository.getStats();
  }

  async listUsers(options: {
    q?: string;
    role?: UserRole;
    status?: UserStatus;
    page: number;
    pageSize: number;
  }) {
    const result = await adminRepository.listUsers(options);
    return {
      users: result.users,
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / options.pageSize),
      },
    };
  }

  async updateUserStatus(
    actorUserId: string,
    targetUserId: string,
    status: UserStatus,
    reason: string
  ) {
    if (actorUserId === targetUserId && status === 'BANNED') {
      throw new ConflictError(
        'Administrators cannot ban their own account.',
        'SELF_BAN_FORBIDDEN'
      );
    }
    const target = await adminRepository.findUserById(targetUserId);
    if (!target) {
      throw new NotFoundError('User not found.');
    }
    const user = await adminRepository.updateUserStatus(targetUserId, status);
    logger.info('Admin changed user status.', {
      actorUserId,
      targetUserId,
      fromStatus: target.status,
      toStatus: status,
      reason,
    });
    return user;
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
    const result = await adminRepository.listBookings(options);
    return {
      bookings: result.bookings,
      pagination: {
        page: options.page,
        pageSize: options.pageSize,
        totalItems: result.totalItems,
        totalPages: Math.ceil(result.totalItems / options.pageSize),
      },
    };
  }
}

export const adminService = new AdminService();
