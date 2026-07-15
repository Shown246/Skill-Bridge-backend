import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware.js';
import { getMe, updateMe } from './user.controller.js';

const router = Router();

router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, updateMe);

export default router;
