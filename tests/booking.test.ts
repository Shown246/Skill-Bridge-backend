import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

jest.setTimeout(60000);

function futureMondayAt(hour: number, minute = 0) {
  const now = new Date();
  const futureMonday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const daysUntilNextMonday = (8 - futureMonday.getUTCDay()) % 7 || 7;
  futureMonday.setUTCDate(futureMonday.getUTCDate() + daysUntilNextMonday + 7);
  futureMonday.setUTCHours(hour, minute, 0, 0);
  return futureMonday;
}

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

describe('Booking Core API', () => {
  let app: any;
  let studentToken: string;
  let tutorToken: string;
  let otherStudentToken: string;
  let adminToken: string;
  let tutorId: string;
  let studentUserId: string;
  let categoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;

    await cleanDb();

    studentToken = await getAuthToken(app, 'student-book@example.com', 'STUDENT');
    const studentUser = await prisma.user.findUnique({ where: { email: 'student-book@example.com' } });
    studentUserId = studentUser!.id;

    tutorToken = await getAuthToken(app, 'tutor-book@example.com', 'TUTOR');

    otherStudentToken = await getAuthToken(app, 'other-student-book@example.com', 'STUDENT');

    adminToken = await getAuthToken(app, 'admin-book@example.com', 'ADMIN');

    const cat = await prisma.category.create({
      data: { name: 'Book Math', slug: 'book-math', isActive: true },
    });
    categoryId = cat.id;

    const profileRes = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: 'Booking Tutor',
        bio: 'Available tutor profile for booking core tests. Let us study math together and learn algebra!',
        experienceYears: 6,
        hourlyRate: 40.00,
        categoryIds: [categoryId],
      });
    tutorId = profileRes.body.data.id;

    await request(app)
      .patch(`/api/v1/admin/tutors/${tutorId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });

    // Availability: Monday 09:00 - 12:00 UTC (dayOfWeek = 1, 540 to 720)
    await prisma.weeklyAvailability.create({
      data: { tutorProfileId: tutorId, dayOfWeek: 1, startMinuteUtc: 540, endMinuteUtc: 720, isActive: true },
    });
  });

  afterAll(async () => {
    await cleanDb();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
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
      .send({ email, password: 'password123', name: `Test ${role}`, role: 'STUDENT' });
    const rawCookie = registerRes.headers['set-cookie'];
    const cookieHeaders = Array.isArray(rawCookie) ? rawCookie : typeof rawCookie === 'string' ? [rawCookie] : [];

    const dbUser = await prisma.user.findUnique({ where: { email } });
    await prisma.user.update({ where: { id: dbUser!.id }, data: { role, status: 'ACTIVE' } });

    const tokenRes = await request(appInstance).get('/api/auth/token').set('Cookie', cookieHeaders);
    return tokenRes.body.token;
  }

  async function createDirectBooking(input?: {
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    startAt?: Date;
    endAt?: Date;
  }) {
    const startAt = input?.startAt ?? new Date(Date.now() + 60 * 60 * 1000);
    const endAt = input?.endAt ?? new Date(startAt.getTime() + 60 * 60 * 1000);

    return prisma.booking.create({
      data: {
        studentId: studentUserId,
        tutorProfileId: tutorId,
        categoryId,
        startAt,
        endAt,
        durationMinutes: 60,
        hourlyRateSnapshot: 40,
        quotedPrice: 40,
        status: input?.status ?? 'CONFIRMED',
      },
    });
  }

  describe('POST /api/v1/bookings', () => {
    it('should create booking successfully', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: futureMondayAt(9).toISOString(),
          durationMinutes: 60,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(Number(res.body.data.quotedPrice)).toBe(40.00);
      expect(res.body.data.status).toBe('CONFIRMED');

      const history = await prisma.bookingStatusHistory.findFirst({
        where: { bookingId: res.body.data.id },
      });
      expect(history).toBeDefined();
      expect(history!.toStatus).toBe('CONFIRMED');
    });

    it('should reject booking if student is banned', async () => {
      // Temporarily ban the student
      await prisma.user.update({
        where: { id: studentUserId },
        data: { status: 'BANNED' },
      });

      try {
        const res = await request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${studentToken}`)
          .send({
            tutorId,
            categoryId,
            startAt: futureMondayAt(9).toISOString(),
            durationMinutes: 60,
          });

        expect(res.status).toBe(403);
      } finally {
        // Restore student status
        await prisma.user.update({
          where: { id: studentUserId },
          data: { status: 'ACTIVE' },
        });
      }
    });

    it('should reject overlapping booking requests with 409 conflict', async () => {
      // Create first booking
      await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ tutorId, categoryId, startAt: futureMondayAt(9).toISOString(), durationMinutes: 60 });

      // Attempt overlap booking
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ tutorId, categoryId, startAt: futureMondayAt(9, 30).toISOString(), durationMinutes: 60 });

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('BOOKING_SLOT_CONFLICT');
    });

    it('should prevent concurrency double-bookings', async () => {
      // Fire 3 overlapping requests simultaneously
      const reqs = Array.from({ length: 3 }).map(() =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${studentToken}`)
          .send({ tutorId, categoryId, startAt: futureMondayAt(9).toISOString(), durationMinutes: 60 })
      );

      const responses = await Promise.all(reqs);
      const successes = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      if (successes.length !== 1 || conflicts.length !== 2) {
        console.log('CONCURRENCY RESPONSES:', JSON.stringify(responses.map(r => ({ status: r.status, body: r.body })), null, 2));
      }

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(2);
    });

    it('should reject booking if requested time is outside availability', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: futureMondayAt(8).toISOString(), // Availability starts at 09:00
          durationMinutes: 60,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('OUT_OF_AVAILABILITY');
    });
  });

  describe('GET /api/v1/bookings/:bookingId', () => {
    let bookingId: string;

    beforeEach(async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: futureMondayAt(9).toISOString(),
          durationMinutes: 60,
        });
      bookingId = res.body.data.id;
    });

    it('should retrieve booking details for the student', async () => {
      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(bookingId);
      expect(res.body.data.allowedActions).toBeDefined();
    });

    it('should retrieve booking details for the tutor', async () => {
      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(bookingId);
    });

    it('should retrieve booking details for the admin', async () => {
      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should reject access to booking details for other students', async () => {
      const res = await request(app)
        .get(`/api/v1/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${otherStudentToken}`);

      expect(res.status).toBe(403);
    });

    it('should reject an invalid booking ID', async () => {
      const res = await request(app)
        .get('/api/v1/bookings/not-a-uuid')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PATCH booking actions', () => {
    it('lets the student cancel their future booking and returns embedded history', async () => {
      const booking = await createDirectBooking();
      await prisma.bookingStatusHistory.create({
        data: {
          id: 'history-initial-confirmation',
          bookingId: booking.id,
          fromStatus: null,
          toStatus: 'CONFIRMED',
          actorUserId: studentUserId,
          actorRole: 'STUDENT',
          createdAt: new Date(Date.now() - 60 * 1000),
        },
      });
      const res = await request(app)
        .patch(`/api/v1/bookings/${booking.id}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ reason: '  Cannot attend  ' });

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'CANCELLED',
        cancelledById: studentUserId,
        cancellationReason: 'Cannot attend',
      });
      expect(res.body.data.statusHistory[0].id).toBe('history-initial-confirmation');
      expect(res.body.data.statusHistory.at(-1)).toMatchObject({
        fromStatus: 'CONFIRMED',
        toStatus: 'CANCELLED',
        actorRole: 'STUDENT',
        reason: 'Cannot attend',
      });
    });

    it('rejects invalid booking IDs and cancellation at start or later', async () => {
      const invalid = await request(app)
        .patch('/api/v1/bookings/not-a-uuid/cancel')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({});
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

      const started = await createDirectBooking({
        startAt: new Date(Date.now() - 1000),
        endAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const boundary = await request(app)
        .patch(`/api/v1/bookings/${started.id}/cancel`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({});
      expect(boundary.status).toBe(409);
      expect(boundary.body.error.code).toBe('BOOKING_ALREADY_STARTED');
    });

    it('lets the assigned tutor complete an ended booking', async () => {
      const booking = await createDirectBooking({
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endAt: new Date(Date.now() - 60 * 60 * 1000),
      });
      const res = await request(app)
        .patch(`/api/v1/bookings/${booking.id}/complete`)
        .set('Authorization', `Bearer ${tutorToken}`)
        .send();

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.statusHistory.at(-1).actorRole).toBe('TUTOR');
    });

    it('rejects student completion and participant access to admin override', async () => {
      const booking = await createDirectBooking({
        startAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        endAt: new Date(Date.now() - 60 * 60 * 1000),
      });

      const studentComplete = await request(app)
        .patch(`/api/v1/bookings/${booking.id}/complete`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send();
      expect(studentComplete.status).toBe(403);

      const participantOverride = await request(app)
        .patch(`/api/v1/admin/bookings/${booking.id}/status`)
        .set('Authorization', `Bearer ${tutorToken}`)
        .send({ status: 'CANCELLED', reason: 'Not allowed' });
      expect(participantOverride.status).toBe(403);
    });

    it('lets admin override early with a required reason and returns admin transitions', async () => {
      const booking = await createDirectBooking();
      const res = await request(app)
        .patch(`/api/v1/admin/bookings/${booking.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'COMPLETED', reason: '  Support verified completion  ' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.statusHistory.at(-1).reason).toBe('Support verified completion');
      expect(res.body.data.allowedAdminTransitions).toEqual(
        expect.arrayContaining(['CONFIRMED', 'CANCELLED'])
      );

      const missingReason = await request(app)
        .patch(`/api/v1/admin/bookings/${booking.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CANCELLED', reason: '   ' });
      expect(missingReason.status).toBe(400);
      expect(missingReason.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('serializes admin reconfirmation against booking creation', async () => {
      const startAt = futureMondayAt(9);
      const endAt = futureMondayAt(10);
      const cancelled = await prisma.booking.create({
        data: {
          studentId: studentUserId,
          tutorProfileId: tutorId,
          categoryId,
          startAt,
          endAt,
          durationMinutes: 60,
          hourlyRateSnapshot: 40,
          quotedPrice: 40,
          status: 'CANCELLED',
        },
      });

      const [overrideRes, createRes] = await Promise.all([
        request(app)
          .patch(`/api/v1/admin/bookings/${cancelled.id}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: 'CONFIRMED', reason: 'Restore booking' }),
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', `Bearer ${studentToken}`)
          .send({ tutorId, categoryId, startAt: startAt.toISOString(), durationMinutes: 60 }),
      ]);

      expect([
        [200, 409],
        [409, 201],
      ]).toContainEqual([overrideRes.status, createRes.status]);
      const losingResponse = overrideRes.status === 409 ? overrideRes : createRes;
      expect(losingResponse.body.error.code).toBe('BOOKING_SLOT_CONFLICT');
      expect(
        await prisma.booking.count({
          where: {
            tutorProfileId: tutorId,
            status: 'CONFIRMED',
            startAt: { lt: endAt },
            endAt: { gt: startAt },
          },
        })
      ).toBe(1);
    });
  });

  describe('GET /api/v1/bookings', () => {
    beforeEach(async () => {
      // Create a booking for the main student
      const res1 = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: futureMondayAt(9).toISOString(),
          durationMinutes: 60,
        });
      expect(res1.status).toBe(201);

      // Create a second booking at a non-overlapping time
      const res2 = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .send({
          tutorId,
          categoryId,
          startAt: futureMondayAt(10, 30).toISOString(),
          durationMinutes: 60,
        });
      expect(res2.status).toBe(201);
    });

    it('should list only student\'s own bookings when logged in as STUDENT', async () => {
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination.totalItems).toBe(2);

      const otherRes = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${otherStudentToken}`);

      expect(otherRes.status).toBe(200);
      expect(otherRes.body.data).toHaveLength(0);
    });

    it('should list only tutor\'s own bookings when logged in as TUTOR', async () => {
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('should list all bookings when logged in as ADMIN', async () => {
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it('should filter bookings by date range', async () => {
      // Get only the first booking by setting a tight date range
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({
          from: futureMondayAt(8, 30).toISOString(),
          to: futureMondayAt(10).toISOString(),
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].startAt).toBe(futureMondayAt(9).toISOString());
    });

    it('should filter bookings by status', async () => {
      const res = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({
          status: 'CONFIRMED',
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);

      const resEmpty = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({
          status: 'CANCELLED',
        });

      expect(resEmpty.status).toBe(200);
      expect(resEmpty.body.data).toHaveLength(0);
    });

    it('should paginate results', async () => {
      const resPage1 = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({
          page: 1,
          pageSize: 1,
        });

      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data).toHaveLength(1);
      expect(resPage1.body.pagination.page).toBe(1);
      expect(resPage1.body.pagination.pageSize).toBe(1);
      expect(resPage1.body.pagination.totalPages).toBe(2);

      const resPage2 = await request(app)
        .get('/api/v1/bookings')
        .set('Authorization', `Bearer ${studentToken}`)
        .query({
          page: 2,
          pageSize: 1,
        });

      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data).toHaveLength(1);
      expect(resPage2.body.pagination.page).toBe(2);
    });
  });
});
