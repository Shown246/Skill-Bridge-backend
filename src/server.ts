import { app } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/db.js';
import { logger } from './shared/logging/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server started on port ${env.PORT} in ${env.NODE_ENV} mode`);
});

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Shutting down server gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed.');
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
