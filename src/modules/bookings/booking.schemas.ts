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
