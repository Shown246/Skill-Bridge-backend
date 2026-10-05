import { Router } from 'express';
import {
  requireActive,
  requireAuth,
  requireRole,
} from '../../middleware/auth.middleware.js';
import {
  getAdminStats,
  listAdminBookings,
  listAdminUsers,
  updateAdminUserStatus,
} from './admin.controller.js';

const router = Router();
const adminOnly = [requireAuth, requireRole('ADMIN'), requireActive] as const;

router.get('/admin/stats', ...adminOnly, getAdminStats);
router.get('/admin/users', ...adminOnly, listAdminUsers);
router.patch('/admin/users/:userId/status', ...adminOnly, updateAdminUserStatus);
router.get('/admin/bookings', ...adminOnly, listAdminBookings);

export default router;
