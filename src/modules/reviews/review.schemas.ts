import { z } from 'zod';

export const bookingReviewParamsSchema = z.object({
  bookingId: z.string().uuid('Booking ID must be a valid UUID.'),
});

export const tutorReviewsParamsSchema = z.object({
  tutorId: z.string().uuid('Tutor ID must be a valid UUID.'),
});

export const createReviewSchema = z.object({
  rating: z
    .number({ required_error: 'Rating is required.' })
    .int('Rating must be an integer.')
    .min(1, 'Rating must be between 1 and 5.')
    .max(5, 'Rating must be between 1 and 5.'),
  comment: z
    .string({ required_error: 'Comment is required.' })
    .trim()
    .min(10, 'Comment must be between 10 and 2000 characters.')
    .max(2000, 'Comment must be between 10 and 2000 characters.'),
});

export const reviewListQuerySchema = z.object({
  page: z
    .preprocess(
      (value) => (value === undefined ? undefined : Number(value)),
      z.number().int().positive()
    )
    .default(1),
  pageSize: z
    .preprocess(
      (value) => (value === undefined ? undefined : Number(value)),
      z.number().int().positive().max(100)
    )
    .default(20),
});
