import { NextFunction, Request, Response } from 'express';
import { adminService } from './admin.service.js';
import {
  adminBookingsQuerySchema,
  adminUsersQuerySchema,
  updateUserStatusSchema,
  userStatusParamsSchema,
} from './admin.schemas.js';

export const getAdminStats = async (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const stats = await adminService.getStats();
    res.status(200).json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
};

export const listAdminUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query = adminUsersQuerySchema.parse(req.query);
    const result = await adminService.listUsers(query);
    res.status(200).json({
      success: true,
      data: result.users,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const updateAdminUserStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { userId } = userStatusParamsSchema.parse(req.params);
    const { status, reason } = updateUserStatusSchema.parse(req.body);
    const user = await adminService.updateUserStatus(
      req.user!.id,
      userId,
      status,
      reason
    );
    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

export const listAdminBookings = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const query = adminBookingsQuerySchema.parse(req.query);
    const result = await adminService.listBookings(query);
    res.status(200).json({
      success: true,
      data: result.bookings,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};
