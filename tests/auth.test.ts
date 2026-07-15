import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

// Use Jest unstable_mockModule for ES modules
jest.unstable_mockModule('jose', () => {
  const actualJose = jest.requireActual('jose') as any;

  return {
    ...actualJose,
    createRemoteJWKSet: (url: any, options: any) => {
      // Return a function that fetches the key directly from the database
      return async (protectedHeader: any, token: any) => {
        // Query the database for the active JWKS key
        const { prisma: db } = await import('../src/config/db.js');
        const jwks = await db.jwks.findFirst({
          orderBy: { createdAt: 'desc' },
        });

        if (!jwks) {
          throw new Error('No JWKS keys found in database.');
        }

        const jwk = JSON.parse(jwks.publicKey);
        // Load the public key using jose.importJWK
        const key = await actualJose.importJWK(jwk, protectedHeader.alg || 'EdDSA');
        return key;
      };
    },
  };
});

describe('Better Auth & Identity Integration', () => {
  let app: any;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up DB before each test
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  });

  describe('User Registration (POST /api/auth/sign-up/email)', () => {
    it('should register a student successfully', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'student@example.com',
          password: 'password123',
          name: 'Jane Student',
          role: 'STUDENT',
          phone: '+1234567890',
        });

      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('student@example.com');
      expect(res.body.user.role).toBe('STUDENT');
      expect(res.body.user.status).toBe('ACTIVE');

      const dbUser = await prisma.user.findUnique({
        where: { email: 'student@example.com' },
      });
      expect(dbUser).toBeDefined();
      expect(dbUser?.role).toBe('STUDENT');
      expect(dbUser?.phone).toBe('+1234567890');
    });

    it('should register a tutor successfully', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'tutor@example.com',
          password: 'password123',
          name: 'John Tutor',
          role: 'TUTOR',
        });

      expect(res.status).toBe(200);
      expect(res.body.user.role).toBe('TUTOR');
    });

    it('should reject registering with ADMIN role', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'admin@example.com',
          password: 'password123',
          name: 'Fake Admin',
          role: 'ADMIN',
        });

      expect(res.status).toBe(400);
      expect(res.body.message || res.body.error).toContain('Only STUDENT or TUTOR are allowed');
    });

    it('should reject registering with invalid role values', async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'invalid@example.com',
          password: 'password123',
          name: 'Invalid User',
          role: 'SUPERMAN',
        });

      expect(res.status).toBe(400);
    });
  });

  describe('JWT and Profile Retrieval / Updates (/api/v1/me)', () => {
    let cookieHeaders: string[];
    let userToken: string;

    beforeEach(async () => {
      // Create user and get session cookies
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'jane@example.com',
          password: 'password123',
          name: 'Jane Doe',
          role: 'STUDENT',
        });

      const rawCookie = res.headers['set-cookie'];
      cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];
      expect(cookieHeaders.length).toBeGreaterThan(0);

      // Fetch JWT using session cookie
      const tokenRes = await request(app)
        .get('/api/auth/token')
        .set('Cookie', cookieHeaders);

      expect(tokenRes.status).toBe(200);
      expect(tokenRes.body.token).toBeDefined();
      userToken = tokenRes.body.token;
    });

    it('should return user profile using Bearer JWT', async () => {
      const res = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('jane@example.com');
      expect(res.body.data.role).toBe('STUDENT');
      expect(res.body.data.status).toBe('ACTIVE');
    });

    it('should reject access with invalid or missing token', async () => {
      const noTokenRes = await request(app).get('/api/v1/me');
      expect(noTokenRes.status).toBe(401);

      const invalidTokenRes = await request(app)
        .get('/api/v1/me')
        .set('Authorization', 'Bearer invalid-token-value');
      expect(invalidTokenRes.status).toBe(401);
    });

    it('should update name, image, and phone successfully', async () => {
      const updateRes = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          name: 'Jane Smith',
          phone: '+1999999999',
          image: 'https://example.com/image.png',
        });

      expect(updateRes.status).toBe(200);
      expect(updateRes.body.success).toBe(true);
      expect(updateRes.body.data.name).toBe('Jane Smith');
      expect(updateRes.body.data.phone).toBe('+1999999999');
      expect(updateRes.body.data.image).toBe('https://example.com/image.png');

      // Verify in DB
      const dbUser = await prisma.user.findUnique({
        where: { email: 'jane@example.com' },
      });
      expect(dbUser?.name).toBe('Jane Smith');
      expect(dbUser?.phone).toBe('+1999999999');
    });

    it('should ignore attempts to update roles or status via PATCH /me', async () => {
      const updateRes = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          role: 'ADMIN',
          status: 'BANNED',
        });

      // Role and status should remain unchanged
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.data.role).toBe('STUDENT');
      expect(updateRes.body.data.status).toBe('ACTIVE');
    });
  });

  describe('Ban Enforcement (UserStatus = BANNED)', () => {
    let userToken: string;
    let userId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/auth/sign-up/email')
        .send({
          email: 'banned-test@example.com',
          password: 'password123',
          name: 'Banned User',
          role: 'STUDENT',
        });

      userId = res.body.user.id;
      const cookieHeaders = res.headers['set-cookie'];

      const tokenRes = await request(app)
        .get('/api/auth/token')
        .set('Cookie', cookieHeaders);

      userToken = tokenRes.body.token;
    });

    it('should allow GET /me but reject other routes with 403 USER_BANNED once banned', async () => {
      // 1. Verify access works when status is ACTIVE
      const activeMeRes = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(activeMeRes.status).toBe(200);

      // 2. Ban the user in the database
      await prisma.user.update({
        where: { id: userId },
        data: { status: 'BANNED' },
      });

      // 3. Verify GET /me still succeeds (should return status: BANNED)
      const bannedMeRes = await request(app)
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`);
      expect(bannedMeRes.status).toBe(200);
      expect(bannedMeRes.body.data.status).toBe('BANNED');

      // 4. Verify PATCH /me (business operation) is rejected with 403 USER_BANNED
      const bannedPatchRes = await request(app)
        .patch('/api/v1/me')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ name: 'New Name Try' });

      expect(bannedPatchRes.status).toBe(403);
      expect(bannedPatchRes.body.success).toBe(false);
      expect(bannedPatchRes.body.error.code).toBe('USER_BANNED');
    });
  });
});
