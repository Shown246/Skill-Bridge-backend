import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error.middleware.js';
import {
  authRateLimiter,
  generalRateLimiter,
  sensitiveRateLimiter,
} from './middleware/rate-limiter.js';
import { NotFoundError } from './shared/errors/app-error.js';
import { logger } from './shared/logging/logger.js';

import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.js';
import userRoutes from './modules/users/user.routes.js';
import categoryRoutes from './modules/categories/category.routes.js';
import tutorRoutes from './modules/tutors/tutor.routes.js';
import availabilityRoutes from './modules/availability/availability.routes.js';
import bookingRoutes from './modules/bookings/booking.routes.js';
import reviewRoutes from './modules/reviews/review.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';

const app = express();
app.set('trust proxy', env.TRUST_PROXY);

// 1. Request ID middleware
app.use(requestIdMiddleware);

// 2. Security headers
const helmetFn = typeof helmet === 'function' ? helmet : (helmet as any).default;
app.use((helmetFn as any)());

// 3. CORS configuration
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
  })
);

// 4. Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - start;
    logger.info(`${req.method} ${req.path} ${res.statusCode} - ${latency}ms`, {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      latencyMs: latency,
      requestId: req.requestId,
      ...(req.user?.id ? { actorId: req.user.id } : {}),
    });
  });
  next();
});

// 5. Better Auth catch-all handler
app.use(authRateLimiter);
app.all('/api/auth/*', toNodeHandler(auth));

// 6. JSON body parsing (applied after auth to not break auth raw body parsing if needed)
app.use(express.json());

// 7. Rate limiting
app.use(sensitiveRateLimiter);
app.use(generalRateLimiter);

// 8. Routes
// Health Check (Unversioned)
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      status: 'UP',
      timestamp: new Date().toISOString(),
    },
    requestId: req.requestId,
  });
});

// Readiness Check (Unversioned)
app.get('/ready', async (req, res) => {
  try {
    // Verify database connection is alive
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      success: true,
      data: {
        status: 'READY',
        database: 'CONNECTED',
        timestamp: new Date().toISOString(),
      },
      requestId: req.requestId,
    });
  } catch (error) {
    logger.error('Readiness check failed - Database unavailable', error, {
      requestId: req.requestId,
    });
    res.status(503).json({
      success: false,
      error: {
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database connection failed.',
      },
      requestId: req.requestId,
    });
  }
});

// 8.1 API Version 1 Routes
app.use('/api/v1', userRoutes);
app.use('/api/v1', categoryRoutes);
app.use('/api/v1', tutorRoutes);
app.use('/api/v1', availabilityRoutes);
app.use('/api/v1', bookingRoutes);
app.use('/api/v1', reviewRoutes);
app.use('/api/v1', adminRoutes);

// 9. Not-found handler
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
});

// 10. Central error handler
app.use(errorHandler);

export { app };
export default app;
