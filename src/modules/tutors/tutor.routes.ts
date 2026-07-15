import { Router } from 'express';
import { requireAuth, requireRole, requireActive } from '../../middleware/auth.middleware.js';
import {
  getOwnProfile,
  upsertOwnProfile,
  getAdminTutors,
  getAdminTutorById,
  moderateTutorApproval,
  searchPublicTutors,
  getPublicTutorById,
  getPublicTutorSlots,
} from './tutor.controller.js';

const router = Router();

// Public endpoints (no auth required)
router.get('/tutors', searchPublicTutors);
router.get('/tutors/:tutorId', getPublicTutorById);
router.get('/tutors/:tutorId/slots', getPublicTutorSlots);


// Tutor-facing endpoints
router.get('/tutor/profile', requireAuth, requireRole('TUTOR'), requireActive, getOwnProfile);
router.put('/tutor/profile', requireAuth, requireRole('TUTOR'), requireActive, upsertOwnProfile);

// Admin moderation endpoints
router.get('/admin/tutors', requireAuth, requireRole('ADMIN'), requireActive, getAdminTutors);
router.get('/admin/tutors/:tutorId', requireAuth, requireRole('ADMIN'), requireActive, getAdminTutorById);
router.patch('/admin/tutors/:tutorId/approval', requireAuth, requireRole('ADMIN'), requireActive, moderateTutorApproval);

export default router;
