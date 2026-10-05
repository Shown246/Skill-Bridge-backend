import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env
const dotenvResult = dotenv.config();
const parsedDotenv = dotenvResult.parsed || {};

const positiveInteger = (defaultValue: number, envKey?: string) =>
  z.preprocess(
    (value) => {
      if (isTestEnvironment && envKey) {
        const dotenvValue = parsedDotenv[envKey];
        if (value === undefined || (dotenvValue !== undefined && String(value) === dotenvValue)) {
          return defaultValue;
        }
      }
      return value === undefined ? defaultValue : Number(value);
    },
    z.number().int().positive()
  );

const trustProxySchema = z.preprocess((value) => {
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  return Number(value);
}, z.union([z.boolean(), z.number().int().nonnegative()]));

const testRateLimitMax = 10_000;
const isTestEnvironment = process.env.NODE_ENV === 'test';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production', 'staging']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:3000'),
  JWT_ISSUER: z.string().default('http://localhost:5000'),
  JWT_AUDIENCE: z.string().default('http://localhost:5000'),
  JWT_SECRET: z.string().optional(),
  DEFAULT_CURRENCY: z.string().length(3).default('USD'),
  BOOKING_DURATION_OPTIONS: z.string().default('30,60,90,120')
    .transform((val) => {
      const parts = val.split(',').map((p) => parseInt(p.trim(), 10));
      if (parts.some((p) => isNaN(p) || p <= 0)) {
        throw new Error('BOOKING_DURATION_OPTIONS must be a comma-separated list of positive integers');
      }
      return Array.from(new Set(parts));
    }),
  ADMIN_NAME: z.string().default('SkillBridge Admin'),
  ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  ADMIN_PASSWORD: z.string().min(8).default('replace-with-a-strong-password'),
  AUTH_RATE_LIMIT_WINDOW_MS: positiveInteger(15 * 60 * 1000, 'AUTH_RATE_LIMIT_WINDOW_MS'),
  AUTH_RATE_LIMIT_MAX: positiveInteger(isTestEnvironment ? testRateLimitMax : 10, 'AUTH_RATE_LIMIT_MAX'),
  SENSITIVE_RATE_LIMIT_WINDOW_MS: positiveInteger(15 * 60 * 1000, 'SENSITIVE_RATE_LIMIT_WINDOW_MS'),
  SENSITIVE_RATE_LIMIT_MAX: positiveInteger(isTestEnvironment ? testRateLimitMax : 20, 'SENSITIVE_RATE_LIMIT_MAX'),
  GENERAL_RATE_LIMIT_WINDOW_MS: positiveInteger(15 * 60 * 1000, 'GENERAL_RATE_LIMIT_WINDOW_MS'),
  GENERAL_RATE_LIMIT_MAX: positiveInteger(isTestEnvironment ? testRateLimitMax : 100, 'GENERAL_RATE_LIMIT_MAX'),
  TRUST_PROXY: trustProxySchema,
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production') {
    if (data.ADMIN_PASSWORD === 'replace-with-a-strong-password') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ADMIN_PASSWORD'],
        message: 'ADMIN_PASSWORD must be changed from the default in production mode',
      });
    }
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Environment validation failed:', JSON.stringify(parsed.error.format(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
