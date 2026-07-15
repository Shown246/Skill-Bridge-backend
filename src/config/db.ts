import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

const databaseUrl = env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL;

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: databaseUrl,
    },
  },
});
export default prisma;
