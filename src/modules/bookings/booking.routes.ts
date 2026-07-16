import { Router } from 'express';
import { requireAuth, requireRole, requireActive } from '../../middleware/auth.middleware.js';
import { createBooking, getBookingDetails, listBookings } from './booking.controller.js';

const router = Router();

router.post('/bookings', requireAuth, requireRole('STUDENT'), requireActive, createBooking);
router.get('/bookings', requireAuth, requireActive, listBookings);
router.get('/bookings/:bookingId', requireAuth, requireActive, getBookingDetails);

export default router;
