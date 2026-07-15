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

describe('Tutor Bookable Slots API', () => {
  let app: any;
  let tutorId: string;
  let tutorToken: string;
  let categoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    await cleanDb();

    // Create tutor and student
    tutorToken = await getAuthToken(app, 'slots-tutor@example.com', 'TUTOR');
    await getAuthToken(app, 'slots-student@example.com', 'STUDENT');
    const cat = await prisma.category.create({
      data: { name: 'Slots Math', slug: 'slots-math', isActive: true },
    });
    categoryId = cat.id;

    const profileRes = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: 'Slots Tutor',
        bio: 'Tutor for slots verification. I have a lot of experience and this bio needs to be at least fifty characters long.',
        experienceYears: 4,
        hourlyRate: 35.00,
        categoryIds: [categoryId],
      });
    tutorId = profileRes.body.data.id;

    // Approve tutor
    const adminToken = await getAuthToken(app, 'slots-admin@example.com', 'ADMIN');
    await request(app)
      .patch(`/api/v1/admin/tutors/${tutorId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    // Add availability: Monday 09:00 - 12:00 UTC (dayOfWeek = 1, 540 to 720)
    await prisma.weeklyAvailability.create({
      data: {
        tutorProfileId: tutorId,
        dayOfWeek: 1,
        startMinuteUtc: 540,
        endMinuteUtc: 720,
      },
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
    if (!dbUser) throw new Error('User not found');
    await prisma.user.update({
      where: { id: dbUser.id },
      data: { role },
    });

    const tokenRes = await request(appInstance)
      .get('/api/auth/token')
      .set('Cookie', cookieHeaders);
    return tokenRes.body.token;
  }

  it('should fail if range exceeds 31 days', async () => {
    const res = await request(app)
      .get(`/api/v1/tutors/${tutorId}/slots`)
      .query({
        dateFrom: '2026-07-01T00:00:00.000Z',
        dateTo: '2026-08-05T00:00:00.000Z',
      });
    expect(res.status).toBe(400);
  });

  it('should generate valid slots matching weekly availability', async () => {
    // 2026-07-20 is a Monday
    const res = await request(app)
      .get(`/api/v1/tutors/${tutorId}/slots`)
      .query({
        dateFrom: '2026-07-20T00:00:00.000Z',
        dateTo: '2026-07-21T00:00:00.000Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slots.length).toBeGreaterThan(0);
    
    // Slot at 09:00:00.000Z should have durations 30, 60, 90, 120
    const slot09 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T09:00:00.000Z');
    expect(slot09).toBeDefined();
    expect(slot09.endAtByDuration['30']).toBe('2026-07-20T09:30:00.000Z');
    expect(slot09.endAtByDuration['120']).toBe('2026-07-20T11:00:00.000Z');
  });

  it('should exclude slots that overlap with confirmed bookings', async () => {
    // Create a confirmed booking on Monday 2026-07-20 from 10:00 to 11:00 UTC
    const student = await prisma.user.findFirst({ where: { role: 'STUDENT' } });
    if (!student) throw new Error('Student user not found');

    await prisma.booking.create({
      data: {
        studentId: student.id,
        tutorProfileId: tutorId,
        categoryId,
        startAt: new Date('2026-07-20T10:00:00.000Z'),
        endAt: new Date('2026-07-20T11:00:00.000Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: 35.00,
        quotedPrice: 35.00,
        status: 'CONFIRMED',
      },
    });

    const res = await request(app)
      .get(`/api/v1/tutors/${tutorId}/slots`)
      .query({
        dateFrom: '2026-07-20T00:00:00.000Z',
        dateTo: '2026-07-21T00:00:00.000Z',
      });

    // The slot starting at 10:00 should not exist, and 09:30 slot should not have 60-min option (ends at 10:30 which overlaps)
    const slot10 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T10:00:00.000Z');
    expect(slot10).toBeUndefined();

    const slot0930 = res.body.data.slots.find((s: any) => s.startAt === '2026-07-20T09:30:00.000Z');
    if (slot0930) {
      expect(slot0930.endAtByDuration['60']).toBeUndefined();
    }
  });
});
