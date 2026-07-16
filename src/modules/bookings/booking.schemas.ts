import { z } from 'zod';

export const createBookingSchema = z.object({
  tutorId: z.string().uuid(),
  categoryId: z.string().uuid(),
  startAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().positive(),
  note: z.string().max(500).optional(),
});

export const getBookingsQuerySchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED']).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
});

const optionalNormalizedReason = z
  .string()
  .trim()
  .max(1000, 'Reason must be at most 1000 characters.')
  .optional()
  .transform((reason) => (reason && reason.length > 0 ? reason : undefined));

export const bookingIdParamsSchema = z.object({
  bookingId: z.string().uuid(),
});

export const cancelBookingSchema = z.object({
  reason: optionalNormalizedReason,
});

export const adminBookingStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED']),
  reason: z
    .string({ required_error: 'Reason is required.' })
    .trim()
    .min(1, 'Reason is required.')
    .max(1000, 'Reason must be at most 1000 characters.'),
});
