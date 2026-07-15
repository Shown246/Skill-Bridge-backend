import { Router } from 'express';
import { requireAuth, requireRole, requireActive } from '../../middleware/auth.middleware.js';
import { getOwnAvailability, replaceOwnAvailability } from './availability.controller.js';

const router = Router();

router.get('/tutor/availability', requireAuth, requireRole('TUTOR'), requireActive, getOwnAvailability);
router.put('/tutor/availability', requireAuth, requireRole('TUTOR'), requireActive, replaceOwnAvailability);

export default router;
