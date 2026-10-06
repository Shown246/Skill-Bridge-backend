import { jest, describe, it, expect, beforeAll, beforeEach, afterAll } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

// Set a larger timeout for database and network integration operations
jest.setTimeout(60000);

// Mock jose remote JWKS fetching to load key directly from the DB
jest.unstable_mockModule('jose', () => {
  const actualJose = jest.requireActual('jose') as any;

  return {
    ...actualJose,
    createRemoteJWKSet: (url: any, options: any) => {
      return async (protectedHeader: any, token: any) => {
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

describe('Category Administration API', () => {
  let app: any;
  let adminToken: string;
  let tutorToken: string;
  let studentToken: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    // Clean db before starting to prevent collisions
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();

    // Create different role users and get tokens once for all tests
    adminToken = await getAuthToken('admin-cat@example.com', 'ADMIN');
    tutorToken = await getAuthToken('tutor-cat@example.com', 'TUTOR');
    studentToken = await getAuthToken('student-cat@example.com', 'STUDENT');
  });

  afterAll(async () => {
    // Clean up all data created in these tests
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Only clean categories before each test to maintain isolation of category records
    await prisma.category.deleteMany();
  });

  async function getAuthToken(email: string, role: 'STUDENT' | 'TUTOR' | 'ADMIN') {
    const registerRes = await request(app)
      .post('/api/auth/sign-up/email')
      .send({
        email,
        password: 'password123',
        name: 'Test User',
        role: 'STUDENT',
      });

    const cookieHeaders = registerRes.headers['set-cookie'];

    const dbUser = await prisma.user.findUnique({ where: { email } });
    if (!dbUser) throw new Error('User not found in DB');

    await prisma.user.update({
      where: { id: dbUser.id },
      data: { role },
    });

    const tokenRes = await request(app)
      .get('/api/auth/token')
      .set('Cookie', cookieHeaders);

    return tokenRes.body.token;
  }

  describe('Authorization Lock (POST /api/v1/admin/categories)', () => {
    it('should reject requests without a token with 401', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .send({ name: 'Web Development' });

      expect(res.status).toBe(401);
    });

    it('should reject requests from STUDENT with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ name: 'Web Development' });

      expect(res.status).toBe(403);
    });

    it('should reject requests from TUTOR with 403', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({ name: 'Web Development' });

      expect(res.status).toBe(403);
    });

    it('should allow requests from ADMIN', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Web Development', description: 'Web Dev' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Web Development');
    });
  });

  describe('Category Creation & Auto-slug Generation', () => {
    it('should generate lowercase URL-safe slug from name if not provided', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Web Development & Design!' });

      expect(res.status).toBe(201);
      expect(res.body.data.slug).toBe('web-development-design');
    });

    it('should use provided slug if valid', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Python Programming', slug: 'py-prog' });

      expect(res.status).toBe(201);
      expect(res.body.data.slug).toBe('py-prog');
    });

    it('should fail with validation error if name is too short', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'a' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should fail with validation error if name is too long', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'a'.repeat(81) });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should fail with validation error if slug is not URL-safe', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Software', slug: 'Soft Ware' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('Uniqueness Collision checks', () => {
    beforeEach(async () => {
      await prisma.category.create({
        data: {
          name: 'Mathematics',
          slug: 'mathematics',
          description: 'Math course',
        },
      });
    });

    it('should reject duplicate name with case-insensitivity with 409', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'mathematics' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CATEGORY_NAME_CONFLICT');
    });

    it('should reject duplicate slug with 409', async () => {
      const res = await request(app)
        .post('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Math Advanced', slug: 'mathematics' });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CATEGORY_SLUG_CONFLICT');
    });
  });

  describe('Category Update (PATCH /api/v1/admin/categories/:categoryId)', () => {
    let category: any;

    beforeEach(async () => {
      category = await prisma.category.create({
        data: {
          name: 'Science',
          slug: 'science',
          description: 'Original Description',
        },
      });

      await prisma.category.create({
        data: {
          name: 'History',
          slug: 'history',
        },
      });
    });

    it('should update name, slug and description successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'Computer Science',
          slug: 'comp-sci',
          description: 'New Description',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Computer Science');
      expect(res.body.data.slug).toBe('comp-sci');
      expect(res.body.data.description).toBe('New Description');
    });

    it('should allow updating description only without name/slug conflict', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          description: 'Just updated description',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Science');
      expect(res.body.data.description).toBe('Just updated description');
    });

    it('should reject updating to an existing category name', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'history',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CATEGORY_NAME_CONFLICT');
    });

    it('should reject updating to an existing category slug', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          slug: 'history',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CATEGORY_SLUG_CONFLICT');
    });
  });

  describe('Category Status Toggle (PATCH /api/v1/admin/categories/:categoryId/status)', () => {
    let category: any;

    beforeEach(async () => {
      category = await prisma.category.create({
        data: {
          name: 'Biology',
          slug: 'biology',
          isActive: true,
        },
      });
    });

    it('should deactivate category status successfully', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: false });

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);

      const dbCategory = await prisma.category.findUnique({
        where: { id: category.id },
      });
      expect(dbCategory?.isActive).toBe(false);
    });

    it('should reject invalid payloads', async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${category.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ isActive: 'not-a-boolean' });

      expect(res.status).toBe(400);
    });
  });

  describe('Public Category List (GET /api/v1/categories)', () => {
    beforeEach(async () => {
      await prisma.category.createMany({
        data: [
          { name: 'Algebra', slug: 'algebra', isActive: true, description: 'Basic Math Algebra' },
          { name: 'Geometry', slug: 'geometry', isActive: true, description: 'Basic Math Geometry' },
          { name: 'Chemistry', slug: 'chemistry', isActive: false, description: 'Science Chemistry' },
        ],
      });
    });

    it('should return only active categories sorted by name alphabetically', async () => {
      const res = await request(app).get('/api/v1/categories');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data[0].name).toBe('Algebra');
      expect(res.body.data[1].name).toBe('Geometry');
    });

    it('should filter categories by search keyword', async () => {
      const res = await request(app).get('/api/v1/categories?search=geometry');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].name).toBe('Geometry');
    });

    it('should support search matching description', async () => {
      const res = await request(app).get('/api/v1/categories?search=Math');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it('should respect the limit parameter', async () => {
      const res = await request(app).get('/api/v1/categories?limit=1');

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(1);
    });
  });

  describe('GET /api/v1/admin/categories', () => {
    beforeEach(async () => {
      await prisma.category.createMany({
        data: [
          { name: 'Algebra', slug: 'algebra', isActive: true, description: 'Basic Math Algebra' },
          { name: 'Geometry', slug: 'geometry', isActive: true, description: 'Basic Math Geometry' },
          { name: 'Chemistry', slug: 'chemistry', isActive: false, description: 'Science Chemistry' },
        ],
      });
    });

    it('should reject unauthenticated requests with 401', async () => {
      const res = await request(app).get('/api/v1/admin/categories');
      expect(res.status).toBe(401);
    });

    it('should reject non-admin requests with 403', async () => {
      const resStudent = await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${studentToken}`);
      expect(resStudent.status).toBe(403);

      const resTutor = await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${tutorToken}`);
      expect(resTutor.status).toBe(403);
    });

    it('should allow admin and return all categories including inactive ones', async () => {
      const res = await request(app)
        .get('/api/v1/admin/categories')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // Both active (Algebra, Geometry) and inactive (Chemistry) should be returned
      const names = res.body.data.map((c: any) => c.name);
      expect(names).toContain('Algebra');
      expect(names).toContain('Geometry');
      expect(names).toContain('Chemistry');
    });

    it('should filter by isActive status', async () => {
      const resInactive = await request(app)
        .get('/api/v1/admin/categories?isActive=false')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(resInactive.status).toBe(200);
      expect(resInactive.body.data.every((c: any) => c.isActive === false)).toBe(true);
      expect(resInactive.body.data.some((c: any) => c.name === 'Chemistry')).toBe(true);
    });

    it('should include CORS exposedHeaders in responses', async () => {
      const res = await request(app)
        .get('/api/v1/categories')
        .set('Origin', 'http://localhost:3000');

      const exposed = res.headers['access-control-expose-headers'];
      expect(exposed).toBeDefined();
      expect(exposed.toLowerCase()).toContain('x-request-id');
    });
  });
});
