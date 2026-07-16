import { Router } from 'express';
import { requireAuth, requireRole, requireActive } from '../../middleware/auth.middleware.js';
import {
  cancelBooking,
  completeBooking,
  createBooking,
  getBookingDetails,
  listBookings,
  overrideBookingStatus,
} from './booking.controller.js';

const router = Router();

router.post('/bookings', requireAuth, requireRole('STUDENT'), requireActive, createBooking);
router.get('/bookings', requireAuth, requireActive, listBookings);
router.patch(
  '/bookings/:bookingId/cancel',
  requireAuth,
  requireRole(['STUDENT', 'TUTOR']),
  requireActive,
  cancelBooking
);
router.patch(
  '/bookings/:bookingId/complete',
  requireAuth,
  requireRole(['TUTOR', 'ADMIN']),
  requireActive,
  completeBooking
);
router.patch(
  '/admin/bookings/:bookingId/status',
  requireAuth,
  requireRole('ADMIN'),
  requireActive,
  overrideBookingStatus
);
router.get('/bookings/:bookingId', requireAuth, requireActive, getBookingDetails);

export default router;
