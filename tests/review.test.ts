import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { prisma } from '../src/config/db.js';

jest.setTimeout(60000);

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

describe('Reviews and tutor rating aggregates', () => {
  let app: any;
  let studentToken: string;
  let otherStudentToken: string;
  let tutorToken: string;
  let tutorProfileId: string;
  let secondTutorProfileId: string;
  let studentId: string;
  let otherStudentId: string;
  let categoryId: string;

  beforeAll(async () => {
    const appModule = await import('../src/app.js');
    app = appModule.app;
    await cleanDb();

    const adminToken = await getAuthToken('review-admin@example.com', 'ADMIN');
    studentToken = await getAuthToken('review-student@example.com', 'STUDENT');
    otherStudentToken = await getAuthToken('review-other@example.com', 'STUDENT');
    tutorToken = await getAuthToken('review-tutor@example.com', 'TUTOR');
    const secondTutorToken = await getAuthToken('review-tutor-two@example.com', 'TUTOR');

    studentId = (await prisma.user.findUnique({
      where: { email: 'review-student@example.com' },
    }))!.id;
    otherStudentId = (await prisma.user.findUnique({
      where: { email: 'review-other@example.com' },
    }))!.id;

    categoryId = (await prisma.category.create({
      data: { name: 'Review Mathematics', slug: 'review-mathematics' },
    })).id;

    tutorProfileId = await createApprovedTutor(tutorToken, adminToken, {
      headline: 'Highly reviewed mathematics tutor',
      hourlyRate: 40,
    });
    secondTutorProfileId = await createApprovedTutor(secondTutorToken, adminToken, {
      headline: 'Second reviewed mathematics tutor',
      hourlyRate: 30,
    });
  });

  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
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
    role: 'STUDENT' | 'TUTOR' | 'ADMIN'
  ) {
    const registerRes = await request(app)
      .post('/api/auth/sign-up/email')
      .send({ email, password: 'password123', name: `Review ${role}` });
    const rawCookie = registerRes.headers['set-cookie'];
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
    const tokenRes = await request(app).get('/api/auth/token').set('Cookie', cookies);
    return tokenRes.body.token as string;
  }

  async function createApprovedTutor(
    tutorToken: string,
    adminToken: string,
    input: { headline: string; hourlyRate: number }
  ) {
    const profileRes = await request(app)
      .put('/api/v1/tutor/profile')
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({
        headline: input.headline,
        bio: 'A complete tutor biography used to verify review aggregates and public tutor results.',
        experienceYears: 5,
        hourlyRate: input.hourlyRate,
        categoryIds: [categoryId],
      });
    const profileId = profileRes.body.data.id;
    await request(app)
      .patch(`/api/v1/admin/tutors/${profileId}/approval`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'APPROVED' });
    return profileId;
  }

  async function createBooking(input?: {
    studentId?: string;
    tutorProfileId?: string;
    status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  }) {
    const startAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    return prisma.booking.create({
      data: {
        studentId: input?.studentId ?? studentId,
        tutorProfileId: input?.tutorProfileId ?? tutorProfileId,
        categoryId,
        startAt,
        endAt: new Date(startAt.getTime() + 60 * 60 * 1000),
        durationMinutes: 60,
        hourlyRateSnapshot: 40,
        quotedPrice: 40,
        status: input?.status ?? 'COMPLETED',
        completedAt: input?.status === 'CONFIRMED' ? null : new Date(),
      },
    });
  }

  it('creates one immutable review for the completed booking owner', async () => {
    const booking = await createBooking();

    const created = await request(app)
      .post(`/api/v1/bookings/${booking.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 5, comment: '  Clear and helpful session.  ' });

    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({
      bookingId: booking.id,
      studentId,
      tutorProfileId,
      rating: 5,
      comment: 'Clear and helpful session.',
    });

    const duplicate = await request(app)
      .post(`/api/v1/bookings/${booking.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 4, comment: 'A second review is not allowed.' });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('BOOKING_ALREADY_REVIEWED');

    expect((await request(app).patch(`/api/v1/reviews/${created.body.data.id}`)).status)
      .toBe(404);
    expect((await request(app).delete(`/api/v1/reviews/${created.body.data.id}`)).status)
      .toBe(404);
  });

  it('validates rating and comment boundaries', async () => {
    for (const body of [
      { rating: 0, comment: 'A valid length comment.' },
      { rating: 6, comment: 'A valid length comment.' },
      { rating: 4.5, comment: 'A valid length comment.' },
      { rating: 5, comment: 'short' },
      { rating: 5 },
    ]) {
      const booking = await createBooking();
      const response = await request(app)
        .post(`/api/v1/bookings/${booking.id}/review`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(body);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    const lowerBoundary = await createBooking();
    const lowerResponse = await request(app)
      .post(`/api/v1/bookings/${lowerBoundary.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 1, comment: '1234567890' });
    expect(lowerResponse.status).toBe(201);

    const upperBoundary = await createBooking();
    const upperResponse = await request(app)
      .post(`/api/v1/bookings/${upperBoundary.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 5, comment: 'x'.repeat(2000) });
    expect(upperResponse.status).toBe(201);

    const overLimit = await createBooking();
    const overLimitResponse = await request(app)
      .post(`/api/v1/bookings/${overLimit.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 5, comment: 'x'.repeat(2001) });
    expect(overLimitResponse.status).toBe(400);
  });

  it('rejects non-owners and bookings that are not completed', async () => {
    const ownedBooking = await createBooking();
    const nonOwner = await request(app)
      .post(`/api/v1/bookings/${ownedBooking.id}/review`)
      .set('Authorization', `Bearer ${otherStudentToken}`)
      .send({ rating: 5, comment: 'This booking belongs to another student.' });
    expect(nonOwner.status).toBe(403);

    const confirmedBooking = await createBooking({ status: 'CONFIRMED' });
    const notCompleted = await request(app)
      .post(`/api/v1/bookings/${confirmedBooking.id}/review`)
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 5, comment: 'The session is not completed yet.' });
    expect(notCompleted.status).toBe(409);
    expect(notCompleted.body.error.code).toBe('BOOKING_NOT_COMPLETED');

    const missing = await request(app)
      .post('/api/v1/bookings/00000000-0000-0000-0000-000000000000/review')
      .set('Authorization', `Bearer ${studentToken}`)
      .send({ rating: 5, comment: 'This booking does not exist.' });
    expect(missing.status).toBe(404);

    const unauthenticated = await request(app)
      .post(`/api/v1/bookings/${ownedBooking.id}/review`)
      .send({ rating: 5, comment: 'Authentication is required here.' });
    expect(unauthenticated.status).toBe(401);

    const wrongRole = await request(app)
      .post(`/api/v1/bookings/${ownedBooking.id}/review`)
      .set('Authorization', `Bearer ${tutorToken}`)
      .send({ rating: 5, comment: 'Tutors cannot submit student reviews.' });
    expect(wrongRole.status).toBe(403);

    await prisma.user.update({
      where: { id: studentId },
      data: { status: 'BANNED' },
    });
    try {
      const banned = await request(app)
        .post(`/api/v1/bookings/${ownedBooking.id}/review`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send({ rating: 5, comment: 'Banned users cannot create reviews.' });
      expect(banned.status).toBe(403);
    } finally {
      await prisma.user.update({
        where: { id: studentId },
        data: { status: 'ACTIVE' },
      });
    }
  });

  it('lists public reviews with pagination without reviewer email', async () => {
    const first = await createBooking();
    const second = await createBooking({ studentId: otherStudentId });
    await prisma.review.createMany({
      data: [
        {
          bookingId: first.id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Excellent explanations and examples.',
        },
        {
          bookingId: second.id,
          studentId: otherStudentId,
          tutorProfileId,
          rating: 3,
          comment: 'A useful and well prepared lesson.',
        },
      ],
    });

    const response = await request(app)
      .get(`/api/v1/tutors/${tutorProfileId}/reviews?page=1&pageSize=1`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(1);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 2,
      totalPages: 2,
    });
    expect(response.body.data[0].student.name).toBeDefined();
    expect(response.body.data[0].student.email).toBeUndefined();

    const malformedPage = await request(app)
      .get(`/api/v1/tutors/${tutorProfileId}/reviews?page=1junk`);
    expect(malformedPage.status).toBe(400);
  });

  it('returns live aggregates and supports rating and review-count sorting', async () => {
    const bookings = await Promise.all([
      createBooking(),
      createBooking({ studentId: otherStudentId }),
      createBooking({ tutorProfileId: secondTutorProfileId }),
    ]);
    await prisma.review.createMany({
      data: [
        {
          bookingId: bookings[0].id,
          studentId,
          tutorProfileId,
          rating: 5,
          comment: 'Excellent explanations and examples.',
        },
        {
          bookingId: bookings[1].id,
          studentId: otherStudentId,
          tutorProfileId,
          rating: 3,
          comment: 'A useful and well prepared lesson.',
        },
        {
          bookingId: bookings[2].id,
          studentId,
          tutorProfileId: secondTutorProfileId,
          rating: 5,
          comment: 'Excellent session from the second tutor.',
        },
      ],
    });

    const detail = await request(app).get(`/api/v1/tutors/${tutorProfileId}`);
    expect(detail.body.data).toMatchObject({ averageRating: 4, reviewCount: 2 });

    const byRating = await request(app).get('/api/v1/tutors?sort=rating_desc');
    expect(byRating.body.data[0].id).toBe(secondTutorProfileId);
    expect(byRating.body.data[0]).toMatchObject({ averageRating: 5, reviewCount: 1 });

    const byReviews = await request(app).get('/api/v1/tutors?sort=reviews_desc');
    expect(byReviews.body.data[0].id).toBe(tutorProfileId);
    expect(byReviews.body.data[0]).toMatchObject({ averageRating: 4, reviewCount: 2 });

    const filtered = await request(app).get('/api/v1/tutors?minRating=4.5');
    expect(filtered.body.data.map((tutor: { id: string }) => tutor.id))
      .toEqual([secondTutorProfileId]);

    const malformedRating = await request(app)
      .get('/api/v1/tutors?minRating=4.5junk');
    expect(malformedRating.status).toBe(400);
  });
});
