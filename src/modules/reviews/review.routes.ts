import { Router } from 'express';
import {
  requireActive,
  requireAuth,
  requireRole,
} from '../../middleware/auth.middleware.js';
import { createReview, listTutorReviews } from './review.controller.js';

const router = Router();

router.post(
  '/bookings/:bookingId/review',
  requireAuth,
  requireRole('STUDENT'),
  requireActive,
  createReview
);
router.get('/tutors/:tutorId/reviews', listTutorReviews);

export default router;
