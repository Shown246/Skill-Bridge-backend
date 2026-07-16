import { z } from 'zod';

export const upsertProfileSchema = z.object({
  headline: z
    .string({ required_error: 'Headline is required.' })
    .min(5, 'Headline must be between 5 and 160 characters.')
    .max(160, 'Headline must be between 5 and 160 characters.'),
  bio: z
    .string({ required_error: 'Bio is required.' })
    .min(50, 'Bio must be between 50 and 5000 characters.')
    .max(5000, 'Bio must be between 50 and 5000 characters.'),
  experienceYears: z
    .number({ required_error: 'Experience years is required.' })
    .int('Experience years must be an integer.')
    .min(0, 'Experience years must be between 0 and 80.')
    .max(80, 'Experience years must be between 0 and 80.'),
  hourlyRate: z
    .number({ required_error: 'Hourly rate is required.' })
    .positive('Hourly rate must be greater than 0.')
    .refine(
      (val) => {
        const str = val.toString();
        const decimalPart = str.split('.')[1];
        return !decimalPart || decimalPart.length <= 2;
      },
      { message: 'Hourly rate must have at most 2 fractional digits.' }
    ),
  categoryIds: z
    .array(z.string().min(1), { required_error: 'Category IDs are required.' })
    .min(1, 'At least one category must be selected.'),
});

export const approvalSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED'], { required_error: 'Status is required.' }),
    reason: z.string().optional().nullable(),
  })
  .refine(
    (data) => {
      if (data.status === 'REJECTED') {
        return typeof data.reason === 'string' && data.reason.trim().length > 0;
      }
      return true;
    },
    {
      message: 'Rejection requires a non-empty reason.',
      path: ['reason'],
    }
  );

export const getAdminTutorsQuerySchema = z.object({
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  q: z.string().optional(),
  page: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive()
    )
    .default(1),
  pageSize: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive().max(100)
    )
    .default(20),
});

export const publicTutorSearchSchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  minRate: z
    .preprocess(
      (val) => (val ? parseFloat(val as string) : undefined),
      z.number().nonnegative().optional()
    )
    .optional(),
  maxRate: z
    .preprocess(
      (val) => (val ? parseFloat(val as string) : undefined),
      z.number().positive().optional()
    )
    .optional(),
  minRating: z
    .preprocess(
      (val) => (val === undefined ? undefined : Number(val)),
      z.number().min(1).max(5).optional()
    )
    .optional(),
  sort: z
    .enum(['recommended', 'rating_desc', 'price_asc', 'price_desc', 'reviews_desc'])
    .default('recommended'),
  page: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive()
    )
    .default(1),
  pageSize: z
    .preprocess(
      (val) => (val ? parseInt(val as string, 10) : undefined),
      z.number().int().positive().max(100)
    )
    .default(20),
});

export const slotQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }),
  dateTo: z.string().datetime({ offset: true }),
}).refine((data) => {
  const from = new Date(data.dateFrom);
  const to = new Date(data.dateTo);
  return to > from;
}, {
  message: "dateTo must be after dateFrom",
  path: ["dateTo"],
}).refine((data) => {
  const from = new Date(data.dateFrom);
  const to = new Date(data.dateTo);
  const diff = to.getTime() - from.getTime();
  return diff <= 31 * 24 * 60 * 60 * 1000;
}, {
  message: "Date range must not exceed 31 days",
  path: ["dateTo"],
});

