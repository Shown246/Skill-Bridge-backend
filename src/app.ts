import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { errorHandler } from './middleware/error.middleware.js';
import { NotFoundError } from './shared/errors/app-error.js';
import { logger } from './shared/logging/logger.js';

import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth/auth.js';
import userRoutes from './modules/users/user.routes.js';
import categoryRoutes from './modules/categories/category.routes.js';
import tutorRoutes from './modules/tutors/tutor.routes.js';

const app = express();

// 1. Request ID middleware
app.use(requestIdMiddleware);

// 2. Security headers
app.use(helmet());

// 3. CORS configuration
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  })
);

// 4. Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} - ${latency}ms`, {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      latencyMs: latency,
      requestId: req.requestId,
    });
  });
  next();
});

// 5. Better Auth catch-all handler
app.all('/api/auth/*', toNodeHandler(auth));

// 6. JSON body parsing (applied after auth to not break auth raw body parsing if needed)
app.use(express.json());

// 7. [Future Placeholder] Rate Limiter
// app.use(rateLimiter);

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

// 9. Not-found handler
app.use((req, res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
});

// 10. Central error handler
app.use(errorHandler);

export { app };
export default app;
