import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

jest.setTimeout(120000);

jest.unstable_mockModule('jose', () => {
  const actualJose = jest.requireActual('jose') as any;
  return {
    ...actualJose,
    createRemoteJWKSet: () => async (protectedHeader: any) => {
      const { prisma: db } = await import('../src/config/db.js');
      const jwks = await db.jwks.findFirst({ orderBy: { createdAt: 'desc' } });
      if (!jwks) throw new Error('No JWKS keys found in database.');
      return actualJose.importJWK(
        JSON.parse(jwks.publicKey),
        protectedHeader.alg || 'EdDSA'
      );
    },
  };
});

describe('Administration and dashboard stats', () => {
  let app: any;
  let adminToken: string;
  let studentToken: string;
  let tutorToken: string;
  let adminId: string;
  let studentId: string;
  let tutorProfileId: string;
  let categoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;
    await cleanDb();

    adminToken = await getAuthToken('task12-admin@example.com', 'ADMIN', 'Dashboard Admin');
    studentToken = await getAuthToken('task12-student@example.com', 'STUDENT', 'Catalog Student');
    tutorToken = await getAuthToken('task12-tutor@example.com', 'TUTOR', 'Catalog Tutor');
    await getAuthToken('task12-second-student@example.com', 'STUDENT', 'Second Student');

    adminId = (await prisma.user.findUnique({
      where: { email: 'task12-admin@example.com' },
    }))!.id;
    studentId = (await prisma.user.findUnique({
      where: { email: 'task12-student@example.com' },
    }))!.id;

    categoryId = (await prisma.category.create({
      data: { name: 'Admin Mathematics', slug: 'admin-mathematics' },
    })).id;

    const profileResponse = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: 'Administration test tutor',
        bio: 'A complete tutor biography for administration dashboard and booking catalog tests.',
        experienceYears: 7,
        hourlyRate: 50,
        categoryIds: [categoryId],
      });
    tutorProfileId = profileResponse.body.data.id;
    await request(app)
      .patch(`/api/v1/admin/tutors/${tutorProfileId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
  });

  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.user.updateMany({
      where: { email: { startsWith: 'task12-' } },
      data: { status: 'ACTIVE' },
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  async function cleanDb() {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.weeklyAvailability.deleteMany();
    await prisma.tutorCategory.deleteMany();
    await prisma.tutorProfile.deleteMany();
    await prisma.category.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
    await prisma.user.deleteMany();
  }

  async function getAuthToken(
    email: string,
    role: 'STUDENT' | 'TUTOR' | 'ADMIN',
    name: string
  ) {
    const registerResponse = await request(app)
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name });
    const rawCookie = registerResponse.headers['set-cookie'];
    const cookies = Array.isArray(rawCookie)
      ? rawCookie
      : typeof rawCookie === 'string'
        ? [rawCookie]
        : [];
    const user = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({
      where: { id: user!.id },
      data: { role, status: 'ACTIVE' },
    });
    const tokenResponse = await request(app)
      .get('/api/auth/token')
      .set('Cookie', cookies);
    return tokenResponse.body.token as string;
  }

  async function createBooking(input?: {
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    studentId?: string;
  }) {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    return prisma.booking.create({
      data: {
        studentId: input?.studentId ?? studentId,
        tutorProfileId,
        categoryId,
        startAt,
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        hourlyRateSnapshot: 50,
        quotedPrice: 50,
        status: input?.status ?? 'CONFIRMED',
        completedAt: input?.status === 'COMPLETED' ? new Date() : null,
      },
    });
  }

  it('returns dashboard counts and persisted averages to active admins only', async () => {
    const confirmed = await createBooking();
    const completed = await createBooking({ status: 'COMPLETED' });
    await prisma.review.create({
      data: {
        bookingId: completed.id,
        studentId,
        tutorProfileId,
        rating: 4,
        comment: 'A useful session for dashboard statistics.',
      },
    });

    const response = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      totalStudents: 2,
      totalTutors: 1,
      activeBookings: 1,
      totalCategories: 1,
      averageTutorRating: 4,
      averageHourlyRate: 50,
    });
    expect(confirmed.status).toBe('CONFIRMED');

    expect((await request(app).get('/api/v1/admin/stats')).status).toBe(401);
    const studentResponse = await request(app)
      .get('/api/v1/admin/stats')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(studentResponse.status).toBe(403);
  });

  it('lists safe users with strict filters and pagination', async () => {
    const response = await request(app)
      .get('/api/v1/admin/users?role=STUDENT&status=ACTIVE&q=Student&page=1&pageSize=1')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(response.body.data[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        name: expect.stringContaining('Student'),
        email: expect.any(String),
        role: 'STUDENT',
        status: 'ACTIVE',
      })
    );
    expect(response.body.data[0].accounts).toBeUndefined();
    expect(response.body.data[0].password).toBeUndefined();

    const malformed = await request(app)
      .get('/api/v1/admin/users?page=1junk')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(malformed.status).toBe(400);
  });

  it('prevents self-ban and applies ban/unban on the next protected request', async () => {
    const selfBan = await request(app)
      .patch(`/api/v1/admin/users/${adminId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'BANNED', reason: 'Unsafe self action' });
    expect(selfBan.status).toBe(409);
    expect(selfBan.body.error.code).toBe('SELF_BAN_FORBIDDEN');

    const banned = await request(app)
      .patch(`/api/v1/admin/users/${studentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'BANNED', reason: '  Policy violation  ' });
    expect(banned.status).toBe(200);
    expect(banned.body.data).toMatchObject({ id: studentId, status: 'BANNED' });

    const blocked = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('USER_BANNED');

    const me = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.status).toBe('BANNED');

    const unbanned = await request(app)
      .patch(`/api/v1/admin/users/${studentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE', reason: 'Appeal approved' });
    expect(unbanned.status).toBe(200);
    expect(unbanned.body.data.status).toBe('ACTIVE');

    const restored = await request(app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(restored.status).toBe(200);
  });

  it('validates status updates and returns not found for missing users', async () => {
    const invalidStatus = await request(app)
      .patch(`/api/v1/admin/users/${studentId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'SUSPENDED', reason: 'Invalid status' });
    expect(invalidStatus.status).toBe(400);

    const missing = await request(app)
      .patch('/api/v1/admin/users/00000000-0000-0000-0000-000000000000/status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'BANNED', reason: 'Missing user' });
    expect(missing.status).toBe(404);
  });

  it('lists all bookings with admin filters and pagination', async () => {
    const secondStudent = await prisma.user.findUnique({
      where: { email: 'task12-second-student@example.com' },
    });
    const confirmed = await createBooking();
    await createBooking({ status: 'COMPLETED', studentId: secondStudent!.id });

    const response = await request(app)
      .get(
        `/api/v1/admin/bookings?q=Catalog&studentId=${studentId}` +
        `&tutorId=${tutorProfileId}&status=CONFIRMED&page=1&pageSize=1`
      )
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toMatchObject({
      id: confirmed.id,
      studentId,
      tutorProfileId,
      status: 'CONFIRMED',
    });
    expect(response.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
    });

    const forbidden = await request(app)
      .get('/api/v1/admin/bookings')
      .set('Authorization', `Bearer ${studentToken}`);
    expect(forbidden.status).toBe(403);
  });

  it('rejects a banned admin from every admin catalog and mutation route', async () => {
    await prisma.user.update({
      where: { id: adminId },
      data: { status: 'BANNED' },
    });
    try {
      const requests = [
        request(app).get('/api/v1/admin/stats'),
        request(app).get('/api/v1/admin/users'),
        request(app)
          .patch(`/api/v1/admin/users/${studentId}/status`)
          .send({ status: 'BANNED', reason: 'Must not execute' }),
        request(app).get('/api/v1/admin/tutors'),
        request(app).get(`/api/v1/admin/tutors/${tutorProfileId}`),
        request(app)
          .patch(`/api/v1/admin/tutors/${tutorProfileId}/approval`)
          .send({ status: 'REJECTED', reason: 'Must not execute' }),
        request(app).get('/api/v1/admin/bookings'),
      ];

      for (const adminRequest of requests) {
        const response = await adminRequest.set(
          'Authorization',
          `Bearer ${adminToken}`
        );
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('USER_BANNED');
      }
    } finally {
      await prisma.user.update({
        where: { id: adminId },
        data: { status: 'ACTIVE' },
      });
    }
  });
});
