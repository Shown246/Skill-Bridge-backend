import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

jest.setTimeout(60000);

jest.unstable_mockModule('jose', () => {
  const actualJose = jest.requireActual('jose') as any;

  return {
    ...actualJose,
    createRemoteJWKSet: (_url: any, _options?: any) => {
      return async (protectedHeader: any, _token: any) => {
        const { prisma: db } = await import('../src/config/db.js');
        const jwks = await db.jwks.findFirst({
          orderBy: { createdAt: 'desc' },
        });

        if (!jwks) {
          throw new Error('No JWKS keys found in database.');
        }

        const jwk = JSON.parse(jwks.publicKey);
        const key = await actualJose.importJWK(jwk, protectedHeader.alg || 'EdDSA');
        return key;
      };
    },
  };
});

describe('Weekly Availability API', () => {
  let app: any;
  let tutorToken: string;
  let studentToken: string;
  let categoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    // Clean db
    await prisma.weeklyAvailability.deleteMany();
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    // Create users
    tutorToken = await getAuthToken(app, 'tutor-avail@example.com', 'TUTOR');
    studentToken = await getAuthToken(app, 'student-avail@example.com', 'STUDENT');

    // Create a category
    const cat = await prisma.category.create({
      data: { name: 'Avail Math', slug: 'avail-math', isActive: true },
    });
    categoryId = cat.id;

    // Create tutor profile
    await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: 'Availability Test Tutor',
        bio: 'I have extensive experience teaching and want to set my availability for weekly sessions.',
        experienceYears: 5,
        hourlyRate: 25.00,
        categoryIds: [categoryId],
      });
  });

  afterAll(async () => {
    await prisma.weeklyAvailability.deleteMany();
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.weeklyAvailability.deleteMany();
  });

  async function getAuthToken(appInstance: any, email: string, role: 'STUDENT' | 'TUTOR' | 'ADMIN') {
    const registerRes = await request(appInstance)
      .post('/api/auth/sign-up/email')
      .send({
        email,
        password: 'password123',
        name: `Test ${role}`,
        role: 'STUDENT',
      });

    const rawCookie = registerRes.headers['set-cookie'];
    const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

    const dbUser = await prisma.user.findUnique({ where: { email } });
    if (!dbUser) throw new Error('User not found in DB');

    await prisma.user.update({
      where: { id: dbUser.id },
      data: { role },
    });

    const tokenRes = await request(appInstance)
      .get('/api/auth/token')
      .set('Cookie', cookieHeaders);

    return tokenRes.body.token;
  }

  // ─── Authorization ────────────────────────────────────────────────────

  describe('Authorization', () => {
    it('should reject unauthenticated PUT request with 401', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .send({ slots: [] });

      expect(res.status).toBe(401);
    });

    it('should reject STUDENT from PUT with 403', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ slots: [] });

      expect(res.status).toBe(403);
    });

    it('should reject STUDENT from GET with 403', async () => {
      const res = await request(app)
        .get('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  // ─── GET availability ─────────────────────────────────────────────────

  describe('GET /api/v1/tutor/availability', () => {
    it('should return empty array when no availability is set', async () => {
      const res = await request(app)
        .get('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  // ─── PUT availability ─────────────────────────────────────────────────

  describe('PUT /api/v1/tutor/availability', () => {
    it('should set availability slots successfully', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },  // Mon 9:00-12:00
            { dayOfWeek: 1, startMinuteUtc: 780, endMinuteUtc: 1020 }, // Mon 13:00-17:00
            { dayOfWeek: 3, startMinuteUtc: 600, endMinuteUtc: 900 },  // Wed 10:00-15:00
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(3);
    });

    it('should replace existing availability on re-submission', async () => {
      // Set initial availability
      await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },
          ],
        });

      // Replace with new availability
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 2, startMinuteUtc: 600, endMinuteUtc: 900 },
            { dayOfWeek: 4, startMinuteUtc: 480, endMinuteUtc: 720 },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      // Only the new slots should be active
      expect(res.body.data[0].dayOfWeek).toBe(2);
      expect(res.body.data[1].dayOfWeek).toBe(4);

      // Verify GET returns only new slots
      const getRes = await request(app)
        .get('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(getRes.body.data).toHaveLength(2);
    });

    it('should allow clearing all availability with empty slots', async () => {
      // Set some availability first
      await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },
          ],
        });

      // Clear all
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({ slots: [] });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should reject when startMinuteUtc >= endMinuteUtc', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 720, endMinuteUtc: 540 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should reject overlapping slots on the same day', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },  // 9:00-12:00
            { dayOfWeek: 1, startMinuteUtc: 660, endMinuteUtc: 900 },  // 11:00-15:00 (overlaps)
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should allow adjacent (non-overlapping) slots on the same day', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720 },  // 9:00-12:00
            { dayOfWeek: 1, startMinuteUtc: 720, endMinuteUtc: 900 },  // 12:00-15:00 (adjacent, ok)
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
    });

    it('should reject invalid dayOfWeek', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 7, startMinuteUtc: 540, endMinuteUtc: 720 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should reject startMinuteUtc out of range', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: -1, endMinuteUtc: 720 },
          ],
        });

      expect(res.status).toBe(400);
    });

    it('should reject endMinuteUtc out of range', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/availability')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          slots: [
            { dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 1441 },
          ],
        });

      expect(res.status).toBe(400);
    });
  });
});
