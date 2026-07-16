import type { Request } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { env } from '../config/env.js';

const RATE_LIMIT_MESSAGE = 'Too many requests. Please try again later.';
const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function isAuthLimitedRequest(req: Request): boolean {
  return (
    (req.method === 'POST' &&
      (req.path === '/api/auth/sign-up/email' ||
        req.path === '/api/auth/sign-in/email')) ||
    (req.method === 'GET' && req.path === '/api/auth/token')
  );
}

function isSensitiveRequest(req: Request): boolean {
  if (req.method === 'POST' && req.path === '/api/v1/bookings') {
    return true;
  }

  if (
    req.method === 'POST' &&
    /^\/api\/v1\/bookings\/[^/]+\/review$/.test(req.path)
  ) {
    return true;
  }

  return (
    MUTATION_METHODS.has(req.method) &&
    (req.path === '/api/v1/admin' || req.path.startsWith('/api/v1/admin/'))
  );
}

function createLimiter(
  identifier: string,
  windowMs: number,
  limit: number,
  skip: (req: Request) => boolean,
  keyGenerator?: (req: Request) => string
) {
  return rateLimit({
    identifier,
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: RATE_LIMIT_MESSAGE,
        },
        requestId: req.requestId,
      });
    },
  });
}

export const authRateLimiter = createLimiter(
  'auth',
  env.AUTH_RATE_LIMIT_WINDOW_MS,
  env.AUTH_RATE_LIMIT_MAX,
  (req) => !isAuthLimitedRequest(req),
  (req) =>
    `${req.path}:${ipKeyGenerator(req.ip ?? req.socket.remoteAddress ?? 'unknown')}`
);

export const sensitiveRateLimiter = createLimiter(
  'sensitive',
  env.SENSITIVE_RATE_LIMIT_WINDOW_MS,
  env.SENSITIVE_RATE_LIMIT_MAX,
  (req) => !isSensitiveRequest(req)
);

export const generalRateLimiter = createLimiter(
  'general',
  env.GENERAL_RATE_LIMIT_WINDOW_MS,
  env.GENERAL_RATE_LIMIT_MAX,
  (req) => !req.path.startsWith('/api/v1') || isSensitiveRequest(req)
);
