import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: 'postgresql',
  }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === '/sign-up/email') {
        const body = ctx.body;
        if (body) {
          if (!body.role) {
            body.role = 'STUDENT';
          }
          const role = body.role;
          if (role !== 'STUDENT' && role !== 'TUTOR') {
            throw new APIError('BAD_REQUEST', {
              message: 'Invalid registration role. Only STUDENT or TUTOR are allowed.',
            });
          }
          body.status = 'ACTIVE';
        }
      }
      return;
    }),
  },
  plugins: [
    jwt({
      jwt: {
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE,
      },
    }),
  ],
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'STUDENT',
        input: true,
      },
      status: {
        type: 'string',
        defaultValue: 'ACTIVE',
        input: false,
      },
      phone: {
        type: 'string',
        required: false,
        input: true,
      },
    },
  },
});

export type Auth = typeof auth;
export default auth;
