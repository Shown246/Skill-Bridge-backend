import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

jest.setTimeout(60000);

// Mock jose remote JWKS fetching to load key directly from the DB
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

describe('Public Tutor Search & Directory API', () => {
  let app: any;
  let adminToken: string;
  let tutorToken: string;
  let approvedProfileId: string;
  let pendingProfileId: string;
  let categoryMathId: string;
  let categoryScienceId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    // Clean db
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    // Create users
    adminToken = await getAuthToken(app, 'admin-search@example.com', 'ADMIN');
    tutorToken = await getAuthToken(app, 'tutor-search@example.com', 'TUTOR');
    const tutor2Token = await getAuthToken(app, 'tutor2-search@example.com', 'TUTOR');

    // Create categories
    const catMath = await prisma.category.create({
      data: { name: 'Search Mathematics', slug: 'search-mathematics', isActive: true },
    });
    categoryMathId = catMath.id;

    const catScience = await prisma.category.create({
      data: { name: 'Search Science', slug: 'search-science', isActive: true },
    });
    categoryScienceId = catScience.id;

    // Create approved tutor profile (tutor-search)
    const createRes = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: 'Expert Mathematics Instructor',
        bio: 'I have extensive experience teaching advanced mathematics at university level and beyond with great results.',
        experienceYears: 10,
        hourlyRate: 30.00,
        categoryIds: [categoryMathId],
      });
    approvedProfileId = createRes.body.data.id;

    // Approve the first tutor
    await request(app)
      .patch(`/api/v1/admin/tutors/${approvedProfileId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    // Create a second tutor profile (pending - not approved)
    const createRes2 = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutor2Token}`)
      .send({
        headline: 'Science Enthusiast Teacher',
        bio: 'I love teaching science and helping students understand the world around them through experimentation.',
        experienceYears: 3,
        hourlyRate: 20.00,
        categoryIds: [categoryScienceId],
      });
    pendingProfileId = createRes2.body.data.id;
  });

  afterAll(async () => {
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
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

  // ─── Public Search ────────────────────────────────────────────────────

  describe('GET /api/v1/tutors (Public Search)', () => {
    it('should return only APPROVED tutors with ACTIVE user status', async () => {
      const res = await request(app).get('/api/v1/tutors');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Only 1 tutor is approved
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].approvalStatus).toBe('APPROVED');
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.totalItems).toBe(1);
    });

    it('should filter by category slug', async () => {
      const res = await request(app).get('/api/v1/tutors?category=search-mathematics');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].headline).toBe('Expert Mathematics Instructor');
    });

    it('should return empty when filtering by category with no approved tutors', async () => {
      const res = await request(app).get('/api/v1/tutors?category=search-science');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should filter by keyword search in headline', async () => {
      const res = await request(app).get('/api/v1/tutors?q=Mathematics');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('should return empty for non-matching keyword', async () => {
      const res = await request(app).get('/api/v1/tutors?q=Nonexistent');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should filter by rate range', async () => {
      // The approved tutor has hourlyRate = 30
      const res = await request(app).get('/api/v1/tutors?minRate=25&maxRate=35');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('should return empty when rate range excludes all tutors', async () => {
      const res = await request(app).get('/api/v1/tutors?minRate=50&maxRate=100');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
    });

    it('should support pagination', async () => {
      const res = await request(app).get('/api/v1/tutors?page=1&pageSize=1');

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(1);
      expect(res.body.pagination.pageSize).toBe(1);
    });

    it('should support price_asc sorting', async () => {
      const res = await request(app).get('/api/v1/tutors?sort=price_asc');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  // ─── Public Detail ────────────────────────────────────────────────────

  describe('GET /api/v1/tutors/:tutorId (Public Detail)', () => {
    it('should return the approved tutor profile', async () => {
      const res = await request(app).get(`/api/v1/tutors/${approvedProfileId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.headline).toBe('Expert Mathematics Instructor');
      expect(res.body.data.categories).toBeDefined();
      expect(res.body.data.user).toBeDefined();
      expect(res.body.data.user.name).toBeDefined();
      // Should NOT expose sensitive fields
      expect(res.body.data.user.email).toBeUndefined();
    });

    it('should return 404 for a PENDING (non-approved) tutor', async () => {
      const res = await request(app).get(`/api/v1/tutors/${pendingProfileId}`);

      expect(res.status).toBe(404);
    });

    it('should return 404 for a non-existent tutor', async () => {
      const res = await request(app).get('/api/v1/tutors/00000000-0000-0000-0000-000000000000');

      expect(res.status).toBe(404);
    });

    it('should return 404 for a BANNED user tutor profile', async () => {
      // Ban the approved tutor's user
      const tutorUser = await prisma.user.findFirst({ where: { email: 'tutor-search@example.com' } });
      await prisma.user.update({
        where: { id: tutorUser!.id },
        data: { status: 'BANNED' },
      });

      const res = await request(app).get(`/api/v1/tutors/${approvedProfileId}`);
      expect(res.status).toBe(404);

      // Restore for other tests
      await prisma.user.update({
        where: { id: tutorUser!.id },
        data: { status: 'ACTIVE' },
      });
    });
  });
});
