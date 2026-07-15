import { Router } from 'express';
import { requireAuth, requireRole } from '../../middleware/auth.middleware.js';
import {
  createCategory,
  updateCategory,
  updateCategoryStatus,
  getCategories,
} from './category.controller.js';

const router = Router();

// Public route to get active categories
router.get('/categories', getCategories);

// Admin-only CRUD routes
router.post('/admin/categories', requireAuth, requireRole('ADMIN'), createCategory);
router.patch('/admin/categories/:categoryId', requireAuth, requireRole('ADMIN'), updateCategory);
router.patch('/admin/categories/:categoryId/status', requireAuth, requireRole('ADMIN'), updateCategoryStatus);

export default router;
