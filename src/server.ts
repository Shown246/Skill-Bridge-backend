import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { logger } from './shared/logging/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server started on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down server gracefully...`);
  
  // Fallback timeout to prevent hangs
  const forceShutdownTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out. Forcing exit...');
    process.exit(1);
  }, 10000);

  server.close(async () => {
    logger.info('HTTP server closed.');
    clearTimeout(forceShutdownTimeout);
    try {
      await prisma.$disconnect();
      logger.info('Database client disconnected.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during database disconnection', error);
      process.exit(1);
    }
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception occurred', error);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Rejection occurred', reason instanceof Error ? reason : new Error(String(reason)));
  shutdown('UNHANDLED_REJECTION');
});
