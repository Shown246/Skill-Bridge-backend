import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

// Set a larger timeout for database and network integration operations
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

describe('Tutor Profiles & Approval Workflow API', () => {
  let app: any;
  let adminToken: string;
  let adminUserId: string;
  let tutorToken: string;
  let tutorUserId: string;
  let studentToken: string;
  let categoryId1: string;
  let categoryId2: string;
  let inactiveCategoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    // Clean db to prevent collisions
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    // Create users and tokens
    adminToken = await getAuthToken(app, 'admin-tutor-test@example.com', 'ADMIN');
    const adminUser = await prisma.user.findUnique({ where: { email: 'admin-tutor-test@example.com' } });
    adminUserId = adminUser!.id;

    tutorToken = await getAuthToken(app, 'tutor-test@example.com', 'TUTOR');
    const tutorUser = await prisma.user.findUnique({ where: { email: 'tutor-test@example.com' } });
    tutorUserId = tutorUser!.id;

    studentToken = await getAuthToken(app, 'student-tutor-test@example.com', 'STUDENT');

    // Create active categories for tests
    const cat1 = await prisma.category.create({
      data: { name: 'Mathematics', slug: 'mathematics', isActive: true },
    });
    categoryId1 = cat1.id;

    const cat2 = await prisma.category.create({
      data: { name: 'Physics', slug: 'physics', isActive: true },
    });
    categoryId2 = cat2.id;

    // Create an inactive category
    const inactiveCat = await prisma.category.create({
      data: { name: 'Archived Subject', slug: 'archived-subject', isActive: false },
    });
    inactiveCategoryId = inactiveCat.id;
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

  // ─── Authorization Tests ──────────────────────────────────────────────

  describe('Authorization', () => {
    it('should reject unauthenticated requests to PUT /api/v1/tutor/profile with 401', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.00,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(401);
    });

    it('should reject STUDENT role from PUT /api/v1/tutor/profile with 403', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.00,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(403);
    });

    it('should reject STUDENT role from GET /api/v1/tutor/profile with 403', async () => {
      const res = await request(app)
        .get('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject TUTOR role from admin endpoints with 403', async () => {
      const res = await request(app)
        .get('/api/v1/admin/tutors')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject STUDENT role from admin approval endpoint with 403', async () => {
      const res = await request(app)
        .patch('/api/v1/admin/tutors/some-id/approval')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ status: 'APPROVED' });

      expect(res.status).toBe(403);
    });
  });

  // ─── Tutor Profile Upsert ─────────────────────────────────────────────

  describe('PUT /api/v1/tutor/profile (Upsert)', () => {
    beforeEach(async () => {
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();
    });

    it('should create a new tutor profile with PENDING status', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.50,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.headline).toBe('Expert Math Tutor');
      expect(res.body.data.approvalStatus).toBe('PENDING');
      expect(res.body.data.categories).toHaveLength(1);
      expect(res.body.data.categories[0].category.name).toBe('Mathematics');
    });

    it('should update an existing profile and replace categories', async () => {
      // First create
      await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.50,
          categoryIds: [categoryId1],
        });

      // Then update with different categories
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math & Physics Tutor',
          bio: 'I have extensive experience teaching advanced mathematics and physics at university level and beyond.',
          experienceYears: 7,
          hourlyRate: 35.00,
          categoryIds: [categoryId1, categoryId2],
        });

      expect(res.status).toBe(200);
      expect(res.body.data.headline).toBe('Expert Math & Physics Tutor');
      expect(res.body.data.experienceYears).toBe(7);
      expect(res.body.data.categories).toHaveLength(2);
    });

    it('should reject inactive category IDs with validation error', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Tutor',
          bio: 'I have extensive experience teaching archived subjects at university level and beyond forever.',
          experienceYears: 3,
          hourlyRate: 20.00,
          categoryIds: [inactiveCategoryId],
        });

      expect(res.status).toBe(400);
    });

    it('should reject non-existent category IDs with validation error', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Tutor',
          bio: 'I have extensive experience teaching various subjects at university level and beyond forever.',
          experienceYears: 3,
          hourlyRate: 20.00,
          categoryIds: ['00000000-0000-0000-0000-000000000000'],
        });

      expect(res.status).toBe(400);
    });

    it('should reject invalid headline (too short)', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Hi',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.00,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(400);
    });

    it('should reject invalid bio (too short)', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'Too short bio.',
          experienceYears: 5,
          hourlyRate: 25.00,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(400);
    });

    it('should reject negative hourly rate', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: -10,
          categoryIds: [categoryId1],
        });

      expect(res.status).toBe(400);
    });

    it('should reject empty categoryIds array', async () => {
      const res = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.00,
          categoryIds: [],
        });

      expect(res.status).toBe(400);
    });
  });

  // ─── Tutor Profile Retrieval ──────────────────────────────────────────

  describe('GET /api/v1/tutor/profile', () => {
    beforeEach(async () => {
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();
    });

    it('should return 404 when no profile exists', async () => {
      const res = await request(app)
        .get('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(404);
    });

    it('should return own profile after creation', async () => {
      // Create profile first
      await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.50,
          categoryIds: [categoryId1],
        });

      const res = await request(app)
        .get('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.headline).toBe('Expert Math Tutor');
      expect(res.body.data.approvalStatus).toBe('PENDING');
      expect(res.body.data.categories).toHaveLength(1);
    });
  });

  // ─── Admin Moderation ─────────────────────────────────────────────────

  describe('Admin Tutor Moderation', () => {
    let tutorProfileId: string;

    beforeEach(async () => {
      await prisma.tutorCategory.deleteMany();
      await prisma.tutorProfile.deleteMany();

      // Create a tutor profile for moderation tests
      const createRes = await request(app)
        .put('/api/v1/tutor/profile')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({
          headline: 'Expert Math Tutor',
          bio: 'I have extensive experience teaching advanced mathematics at university level and beyond.',
          experienceYears: 5,
          hourlyRate: 25.50,
          categoryIds: [categoryId1],
        });

      tutorProfileId = createRes.body.data.id;
    });

    describe('GET /api/v1/admin/tutors', () => {
      it('should list all tutor profiles for admin', async () => {
        const res = await request(app)
          .get('/api/v1/admin/tutors')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.totalItems).toBe(1);
      });

      it('should filter by approvalStatus', async () => {
        const resApproved = await request(app)
          .get('/api/v1/admin/tutors?approvalStatus=APPROVED')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(resApproved.status).toBe(200);
        expect(resApproved.body.data).toHaveLength(0);

        const resPending = await request(app)
          .get('/api/v1/admin/tutors?approvalStatus=PENDING')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(resPending.status).toBe(200);
        expect(resPending.body.data).toHaveLength(1);
      });
    });

    describe('GET /api/v1/admin/tutors/:tutorId', () => {
      it('should return full tutor profile details', async () => {
        const res = await request(app)
          .get(`/api/v1/admin/tutors/${tutorProfileId}`)
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.headline).toBe('Expert Math Tutor');
        expect(res.body.data.categories).toHaveLength(1);
      });

      it('should return 404 for non-existent tutor', async () => {
        const res = await request(app)
          .get('/api/v1/admin/tutors/00000000-0000-0000-0000-000000000000')
          .set('Authorization', `Bearer ${adminToken}`);

        expect(res.status).toBe(404);
      });
    });

    describe('PATCH /api/v1/admin/tutors/:tutorId/approval', () => {
      it('should approve a tutor profile', async () => {
        const res = await request(app)
          .patch(`/api/v1/admin/tutors/${tutorProfileId}/approval`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'APPROVED' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.approvalStatus).toBe('APPROVED');
        expect(res.body.data.approvedAt).toBeDefined();
        expect(res.body.data.approvedBy).toBeDefined();
      });

      it('should reject a tutor with a reason', async () => {
        const res = await request(app)
          .patch(`/api/v1/admin/tutors/${tutorProfileId}/approval`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'REJECTED', reason: 'Insufficient qualifications provided.' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.approvalStatus).toBe('REJECTED');
        expect(res.body.data.rejectionReason).toBe('Insufficient qualifications provided.');
      });

      it('should require a reason when rejecting', async () => {
        const res = await request(app)
          .patch(`/api/v1/admin/tutors/${tutorProfileId}/approval`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'REJECTED' });

        expect(res.status).toBe(400);
      });

      it('should return 404 for non-existent tutor approval', async () => {
        const res = await request(app)
          .patch('/api/v1/admin/tutors/00000000-0000-0000-0000-000000000000/approval')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'APPROVED' });

        expect(res.status).toBe(404);
      });
    });
  });
});
