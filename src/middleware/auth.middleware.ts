import { Request, Response, NextFunction } from 'express';
import * as jose from 'jose';
import { env } from '../config/env.js';
import { prisma } from '../config/db.js';
import { UnauthorizedError, AppError } from '../shared/errors/app-error.js';

// Construct the JWKS set
const JWKS_URL = `${env.BETTER_AUTH_URL}/api/auth/jwks`;
const JWKS = jose.createRemoteJWKSet(new URL(JWKS_URL), {
  [jose.customFetch]: (url, init) => {
    return globalThis.fetch(url, init);
  },
});

// Extend Request type to hold user information
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: 'STUDENT' | 'TUTOR' | 'ADMIN';
        status: 'ACTIVE' | 'BANNED';
      };
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedError('Authentication token is required.');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw new UnauthorizedError('Authentication token is required.');
    }

    // Verify the JWT signature, issuer, audience, and expiration
    const { payload } = await jose.jwtVerify(token, JWKS, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    });

    const userId = payload.sub; // subject contains user ID
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedError('Invalid token subject.');
    }

    // Load current user status and details from the database
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        role: true,
        status: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as 'STUDENT' | 'TUTOR' | 'ADMIN',
      status: user.status as 'ACTIVE' | 'BANNED',
    };

    // If user is banned and path is NOT GET /api/v1/me, reject access.
    const normalizedPath = req.originalUrl.split('?')[0].replace(/\/$/, '');
    const isGetMe = req.method === 'GET' && normalizedPath === '/api/v1/me';

    if (user.status === 'BANNED' && !isGetMe) {
      throw new AppError(403, 'USER_BANNED', 'User status is BANNED.');
    }

    next();
  } catch (error: any) {
    if (error instanceof AppError) {
      next(error);
    } else if (error.code?.startsWith('ERR_JWT_') || error.code?.startsWith('ERR_JWS_')) {
      const isExpired = error.code === 'ERR_JWT_EXPIRED';
      const errorCode = isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID';
      const errorMsg = isExpired ? 'Token has expired.' : 'Invalid token.';
      next(new AppError(401, errorCode, errorMsg));
    } else {
      console.error('requireAuth unexpected error:', error);
      // Pass general/database errors down directly to prevent info leak (errorHandler turns them to 500)
      next(error);
    }
  }
};
