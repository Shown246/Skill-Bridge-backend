import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be between 2 and 80 characters')
    .max(80, 'Name must be between 2 and 80 characters'),
  slug: z
    .string()
    .min(2, 'Slug must be between 2 and 100 characters')
    .max(100, 'Slug must be between 2 and 100 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase and URL-safe')
    .optional(),
  description: z
    .string()
    .max(1000, 'Description cannot exceed 1000 characters')
    .nullable()
    .optional(),
});

export const updateCategorySchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be between 2 and 80 characters')
    .max(80, 'Name must be between 2 and 80 characters')
    .optional(),
  slug: z
    .string()
    .min(2, 'Slug must be between 2 and 100 characters')
    .max(100, 'Slug must be between 2 and 100 characters')
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase and URL-safe')
    .optional(),
  description: z
    .string()
    .max(1000, 'Description cannot exceed 1000 characters')
    .nullable()
    .optional(),
});

export const updateCategoryStatusSchema = z.object({
  isActive: z.boolean({ required_error: 'isActive is required' }),
});

export const getCategoriesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive()
    )
    .optional(),
});

export const getAdminCategoriesQuerySchema = z.object({
  search: z.string().optional(),
  limit: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive()
    )
    .optional(),
  isActive: z
    .preprocess((val) => {
      if (val === 'true' || val === true) return true;
      if (val === 'false' || val === false) return false;
      return undefined;
    }, z.boolean().optional())
    .optional(),
});
