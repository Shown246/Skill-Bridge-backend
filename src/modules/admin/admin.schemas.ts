import { z } from 'zod';

const strictPositiveInteger = (defaultValue: number, max?: number) =>
  z
    .preprocess(
      (value) => (value === undefined ? undefined : Number(value)),
      max
        ? z.number().int().positive().max(max)
        : z.number().int().positive()
    )
    .default(defaultValue);

export const adminUsersQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  role: z.enum(['STUDENT', 'TUTOR', 'ADMIN']).optional(),
  status: z.enum(['ACTIVE', 'BANNED']).optional(),
  page: strictPositiveInteger(1),
  pageSize: strictPositiveInteger(20, 100),
});

export const userStatusParamsSchema = z.object({
  userId: z.string().min(1, 'User ID is required.'),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BANNED'], {
    required_error: 'Status is required.',
  }),
  reason: z
    .string({ required_error: 'Reason is required.' })
    .trim()
    .min(1, 'Reason is required.')
    .max(1000, 'Reason must not exceed 1000 characters.'),
});

export const adminBookingsQuerySchema = z
  .object({
    q: z.string().trim().min(1).optional(),
    studentId: z.string().min(1).optional(),
    tutorId: z.string().uuid('Tutor ID must be a valid UUID.').optional(),
    status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    page: strictPositiveInteger(1),
    pageSize: strictPositiveInteger(20, 100),
  })
  .refine(
    (query) =>
      !query.from ||
      !query.to ||
      new Date(query.to).getTime() >= new Date(query.from).getTime(),
    {
      message: 'to must be at or after from.',
      path: ['to'],
    }
  );
