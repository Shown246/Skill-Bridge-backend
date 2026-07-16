# Booking Actions, Overrides & History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transactional booking cancellation, completion, admin status overrides, audit-history retrieval, and accurate actor-specific action guidance.

**Architecture:** Extend the existing booking module with typed action contracts and one internal transactional transition engine. Every mutation locks the tutor profile row, re-reads booking state, applies actor-specific rules, updates status metadata, and appends history atomically; admin reconfirmation reuses the same overlap lock as booking creation.

**Tech Stack:** Node.js, Express, TypeScript strict mode, Prisma 5, PostgreSQL, Zod, Jest, Supertest

## Global Constraints

- Do not change the Prisma schema; the existing booking and history fields are sufficient.
- Use `PATCH /api/v1/bookings/:bookingId/cancel` for active student/tutor cancellation.
- Use `PATCH /api/v1/bookings/:bookingId/complete` for active tutor/admin standard completion.
- Use `PATCH /api/v1/admin/bookings/:bookingId/status` for active-admin overrides.
- Participant cancellation reason is optional, trimmed, and at most 1000 characters.
- Admin override reason is required, trimmed, non-empty, and at most 1000 characters.
- Cancellation requires `serverNow < startAt`; exactly at `startAt` is rejected.
- Standard completion requires `serverNow >= endAt`; exactly at `endAt` is accepted.
- Same-status admin overrides return `409 BOOKING_STATUS_CONFLICT`.
- Reviewed completed bookings cannot transition away from `COMPLETED`.
- Reconfirmation requires an active, approved tutor and no overlap with another confirmed booking.
- Reconfirmation preserves category and price snapshots and does not revalidate current category activity or weekly availability.
- Every successful mutation updates booking metadata and creates exactly one history row in the same transaction.
- Interactive transactions use `{ maxWait: 15000, timeout: 15000 }`.
- Existing untracked `package-lock.json` and `docs/superpowers/plans/2026-07-15-skillbridge-backend.md` are user-owned and must remain untouched.

---

## File Structure

- Create `src/modules/bookings/booking.types.ts`: actor, command, action, and transition input types shared by controller, service, and repository.
- Modify `src/modules/bookings/booking.schemas.ts`: booking ID, cancellation, and admin override validation.
- Modify `src/modules/bookings/booking.repository.ts`: typed transaction helpers, transition-state reads, overlap exclusion, atomic update/history, and hydrated detail reads.
- Modify `src/modules/bookings/booking.service.ts`: injected server clock, participant rules, standard completion, admin override engine, metadata cleanup, and action calculations.
- Modify `src/modules/bookings/booking.controller.ts`: validate action inputs and call the new service methods.
- Modify `src/modules/bookings/booking.routes.ts`: mount the three action endpoints with role middleware.
- Modify `tests/booking.service.test.ts`: schema, boundary, transition, history, metadata, review-integrity, and reconfirmation tests.
- Modify `tests/booking.test.ts`: HTTP authorization, response contract, history, and concurrency tests.
- Modify `.superpowers/sdd/progress.md`: check off Task 10 only after the full verification suite passes; this local ledger is intentionally git-ignored.

---

### Task 1: Add Typed Action Contracts and Validation Schemas

**Files:**
- Create: `src/modules/bookings/booking.types.ts`
- Modify: `src/modules/bookings/booking.schemas.ts`
- Test: `tests/booking.service.test.ts`

**Interfaces:**
- Consumes: Prisma-generated `BookingStatus` and `UserRole`.
- Produces: `BookingActor`, `BookingAction`, `BookingTransitionCommand`, `BookingTransitionWrite`, `bookingIdParamsSchema`, `cancelBookingSchema`, and `adminBookingStatusSchema`.

- [ ] **Step 1: Write failing validation tests**

Add these imports in `tests/booking.service.test.ts`:

```ts
import {
  adminBookingStatusSchema,
  bookingIdParamsSchema,
  cancelBookingSchema,
  createBookingSchema,
  getBookingsQuerySchema,
} from '../src/modules/bookings/booking.schemas.js';
```

Add these tests inside `describe('Zod Validation Schemas', ...)`:

```ts
describe('booking action schemas', () => {
  it('normalizes an omitted or blank participant cancellation reason', () => {
    expect(cancelBookingSchema.parse({})).toEqual({});
    expect(cancelBookingSchema.parse({ reason: '   ' })).toEqual({ reason: undefined });
    expect(cancelBookingSchema.parse({ reason: '  Schedule conflict  ' })).toEqual({
      reason: 'Schedule conflict',
    });
  });

  it('rejects a participant cancellation reason longer than 1000 characters', () => {
    expect(cancelBookingSchema.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('requires a normalized admin reason and a supported target status', () => {
    expect(
      adminBookingStatusSchema.parse({
        status: 'COMPLETED',
        reason: '  Session verified by support  ',
      })
    ).toEqual({
      status: 'COMPLETED',
      reason: 'Session verified by support',
    });

    expect(
      adminBookingStatusSchema.safeParse({ status: 'CANCELLED', reason: '   ' }).success
    ).toBe(false);
    expect(
      adminBookingStatusSchema.safeParse({ status: 'PENDING', reason: 'Correction' }).success
    ).toBe(false);
  });

  it('requires a UUID booking route parameter', () => {
    expect(
      bookingIdParamsSchema.safeParse({
        bookingId: 'a3bc47d0-1c39-44d5-89f4-8d9ad7c9448f',
      }).success
    ).toBe(true);
    expect(bookingIdParamsSchema.safeParse({ bookingId: 'not-a-uuid' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the schema tests and verify failure**

Run:

```text
npm test -- tests/booking.service.test.ts -t "booking action schemas"
```

Expected: FAIL because the three action schemas are not exported.

- [ ] **Step 3: Add the shared action types**

Create `src/modules/bookings/booking.types.ts`:

```ts
import type { BookingStatus, UserRole } from '@prisma/client';

export type BookingActor = {
  id: string;
  role: UserRole;
};

export type BookingAction = 'CANCEL' | 'COMPLETE' | 'REVIEW';

export type BookingTransitionMode = 'PARTICIPANT_CANCEL' | 'STANDARD_COMPLETE' | 'ADMIN_OVERRIDE';

export type BookingTransitionCommand = {
  mode: BookingTransitionMode;
  targetStatus: BookingStatus;
  reason?: string;
};

export type BookingTransitionWrite = {
  bookingId: string;
  fromStatus: BookingStatus;
  toStatus: BookingStatus;
  actor: BookingActor;
  reason?: string;
  now: Date;
};
```

- [ ] **Step 4: Add the Zod schemas**

Append to `src/modules/bookings/booking.schemas.ts`:

```ts
const optionalNormalizedReason = z
  .string()
  .trim()
  .max(1000, 'Reason must be at most 1000 characters.')
  .optional()
  .transform((reason) => (reason && reason.length > 0 ? reason : undefined));

export const bookingIdParamsSchema = z.object({
  bookingId: z.string().uuid(),
});

export const cancelBookingSchema = z.object({
  reason: optionalNormalizedReason,
});

export const adminBookingStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'COMPLETED', 'CANCELLED']),
  reason: z
    .string({ required_error: 'Reason is required.' })
    .trim()
    .min(1, 'Reason is required.')
    .max(1000, 'Reason must be at most 1000 characters.'),
});
```

- [ ] **Step 5: Run the schema tests and typecheck**

Run:

```text
npm test -- tests/booking.service.test.ts -t "booking action schemas"
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the validation slice**

```text
git add src/modules/bookings/booking.types.ts src/modules/bookings/booking.schemas.ts tests/booking.service.test.ts
git commit -m "feat(bookings): add action contracts and validation"
```

---

### Task 2: Implement Transactional Participant Cancellation

**Files:**
- Modify: `src/modules/bookings/booking.repository.ts`
- Modify: `src/modules/bookings/booking.service.ts`
- Test: `tests/booking.service.test.ts`

**Interfaces:**
- Consumes: `BookingActor`, `BookingTransitionCommand`, and `BookingTransitionWrite` from Task 1.
- Produces:
  - `bookingRepository.findTutorProfileIdByBookingId(bookingId)`
  - `bookingRepository.findTransitionState(bookingId, tx)`
  - `bookingRepository.transitionBooking(write, tx)`
  - `bookingService.cancel(bookingId, actor, reason?)`
  - An internal `transition(bookingId, actor, command)` engine.

- [ ] **Step 1: Add deterministic cancellation service tests**

Update the Jest import to include `beforeEach` if it is not already present, then import:

```ts
import { BookingService } from '../src/modules/bookings/booking.service.js';
```

Add a helper near the service test fixtures:

```ts
async function createActionBooking(input?: {
  status?: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  startAt?: Date;
  endAt?: Date;
  studentId?: string;
}) {
  const startAt = input?.startAt ?? new Date('2026-07-20T10:00:00.000Z');
  const endAt = input?.endAt ?? new Date('2026-07-20T11:00:00.000Z');

  return prisma.booking.create({
    data: {
      studentId: input?.studentId ?? studentId,
      tutorProfileId,
      categoryId,
      startAt,
      endAt,
      durationMinutes: 60,
      hourlyRateSnapshot: 50,
      quotedPrice: 50,
      status: input?.status ?? 'CONFIRMED',
    },
  });
}
```

Add:

```ts
describe('BookingService.cancel', () => {
  const beforeStart = new Date('2026-07-20T09:59:59.999Z');
  const atStart = new Date('2026-07-20T10:00:00.000Z');

  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
  });

  it('lets the owning student cancel one millisecond before start and writes history', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => beforeStart);

    const result = await service.cancel(
      booking.id,
      { id: studentId, role: 'STUDENT' },
      'Schedule conflict'
    );

    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledAt).toEqual(beforeStart);
    expect(result.cancelledById).toBe(studentId);
    expect(result.cancellationReason).toBe('Schedule conflict');
    expect(result.completedAt).toBeNull();
    expect(result.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'CONFIRMED',
      toStatus: 'CANCELLED',
      actorUserId: studentId,
      actorRole: 'STUDENT',
      reason: 'Schedule conflict',
    });

    await expect(
      service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(1);
  });

  it('lets the assigned tutor cancel without a reason', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => beforeStart);

    const result = await service.cancel(booking.id, { id: tutorId, role: 'TUTOR' });

    expect(result.status).toBe('CANCELLED');
    expect(result.cancelledById).toBe(tutorId);
    expect(result.cancellationReason).toBeNull();
  });

  it('rejects unrelated actors before changing state', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => beforeStart);

    await expect(
      service.cancel(booking.id, { id: otherUserId, role: 'STUDENT' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('rejects cancellation exactly at start', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => atStart);

    await expect(
      service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_ALREADY_STARTED' });
    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('rejects cancellation from a non-confirmed status', async () => {
    const booking = await createActionBooking({ status: 'COMPLETED' });
    const service = new BookingService(() => beforeStart);

    await expect(
      service.cancel(booking.id, { id: studentId, role: 'STUDENT' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
  });
});
```

- [ ] **Step 2: Run the cancellation tests and verify failure**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.cancel"
```

Expected: FAIL because the clock constructor and `cancel` method do not exist.

- [ ] **Step 3: Add typed repository transition primitives**

At the top of `src/modules/bookings/booking.repository.ts`, use:

```ts
import type { Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import type { BookingTransitionWrite } from './booking.types.js';

type TransactionClient = Prisma.TransactionClient;
```

Add these methods to `BookingRepository`:

```ts
async findTutorProfileIdByBookingId(bookingId: string) {
  return prisma.booking.findUnique({
    where: { id: bookingId },
    select: { tutorProfileId: true },
  });
}

async findTransitionState(bookingId: string, tx: TransactionClient) {
  return tx.booking.findUnique({
    where: { id: bookingId },
    include: {
      review: true,
      tutorProfile: {
        include: {
          user: {
            select: { id: true, status: true },
          },
        },
      },
    },
  });
}

async transitionBooking(write: BookingTransitionWrite, tx: TransactionClient) {
  const cancellationData =
    write.toStatus === 'CANCELLED'
      ? {
          cancelledAt: write.now,
          cancelledById: write.actor.id,
          cancellationReason: write.reason ?? null,
          completedAt: null,
        }
      : {
          cancelledAt: null,
          cancelledById: null,
          cancellationReason: null,
        };

  const booking = await tx.booking.update({
    where: { id: write.bookingId },
    data: {
      status: write.toStatus,
      ...cancellationData,
      completedAt: write.toStatus === 'COMPLETED' ? write.now : null,
    },
  });

  await tx.bookingStatusHistory.create({
    data: {
      bookingId: write.bookingId,
      fromStatus: write.fromStatus,
      toStatus: write.toStatus,
      actorUserId: write.actor.id,
      actorRole: write.actor.role as UserRole,
      reason: write.reason ?? null,
      createdAt: write.now,
    },
  });

  return booking;
}
```

Change the existing transaction arguments from `any` to `TransactionClient` in `lockTutorProfile`, `createBooking`, and `checkOverlap`.

- [ ] **Step 4: Add the clock and central transition engine**

Update the imports in `src/modules/bookings/booking.service.ts`:

```ts
import type { BookingStatus, UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { bookingRepository } from './booking.repository.js';
import type { BookingActor, BookingTransitionCommand } from './booking.types.js';
import { AppError, NotFoundError, ConflictError, ForbiddenError } from '../../shared/errors/app-error.js';
import { env } from '../../config/env.js';
```

Change the class declaration and add `cancel` plus the transition engine:

```ts
export class BookingService {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async cancel(bookingId: string, actor: BookingActor, reason?: string) {
    return this.transition(bookingId, actor, {
      mode: 'PARTICIPANT_CANCEL',
      targetStatus: 'CANCELLED',
      reason,
    });
  }

  private async transition(
    bookingId: string,
    actor: BookingActor,
    command: BookingTransitionCommand
  ) {
    const bookingRef = await bookingRepository.findTutorProfileIdByBookingId(bookingId);
    if (!bookingRef) {
      throw new NotFoundError('Booking not found.');
    }

    await prisma.$transaction(
      async (tx) => {
        await bookingRepository.lockTutorProfile(bookingRef.tutorProfileId, tx);
        const booking = await bookingRepository.findTransitionState(bookingId, tx);
        if (!booking) {
          throw new NotFoundError('Booking not found.');
        }

        const transitionNow = this.now();

        if (command.mode === 'PARTICIPANT_CANCEL') {
          const isOwner = actor.role === 'STUDENT' && booking.studentId === actor.id;
          const isAssignedTutor =
            actor.role === 'TUTOR' && booking.tutorProfile.userId === actor.id;
          if (!isOwner && !isAssignedTutor) {
            throw new ForbiddenError('Access denied.');
          }
          if (booking.status !== 'CONFIRMED') {
            throw new ConflictError(
              'Only confirmed bookings can be cancelled.',
              'BOOKING_STATUS_CONFLICT'
            );
          }
          if (transitionNow.getTime() >= booking.startAt.getTime()) {
            throw new ConflictError(
              'Booking cancellation is not allowed at or after the start time.',
              'BOOKING_ALREADY_STARTED'
            );
          }
        }

        await bookingRepository.transitionBooking(
          {
            bookingId,
            fromStatus: booking.status,
            toStatus: command.targetStatus,
            actor,
            reason: command.reason,
            now: transitionNow,
          },
          tx
        );
      },
      { maxWait: 15000, timeout: 15000 }
    );

    return this.getDetail(bookingId, actor.id, actor.role);
  }
```

Keep the existing `create`, `getDetail`, `list`, and action-calculation methods below these additions.

- [ ] **Step 5: Run cancellation tests and the existing booking service suite**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.cancel"
npm test -- tests/booking.service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit participant cancellation**

```text
git add src/modules/bookings/booking.repository.ts src/modules/bookings/booking.service.ts tests/booking.service.test.ts
git commit -m "feat(bookings): add transactional participant cancellation"
```

---

### Task 3: Add Standard Completion and Correct Allowed Actions

**Files:**
- Modify: `src/modules/bookings/booking.service.ts`
- Test: `tests/booking.service.test.ts`

**Interfaces:**
- Consumes: the Task 2 transition engine.
- Produces:
  - `bookingService.complete(bookingId, actor)`
  - Actor-specific `allowedActions`
  - Chronological history on post-transition detail responses.

- [ ] **Step 1: Write completion boundary and action tests**

Add:

```ts
describe('BookingService.complete', () => {
  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
  });

  it('lets the assigned tutor complete exactly at endAt', async () => {
    const endAt = new Date('2026-07-20T11:00:00.000Z');
    const booking = await createActionBooking({ endAt });
    const service = new BookingService(() => endAt);

    const result = await service.complete(booking.id, { id: tutorId, role: 'TUTOR' });

    expect(result.status).toBe('COMPLETED');
    expect(result.completedAt).toEqual(endAt);
    expect(result.cancelledAt).toBeNull();
    expect(result.cancelledById).toBeNull();
    expect(result.cancellationReason).toBeNull();
    expect(result.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'CONFIRMED',
      toStatus: 'COMPLETED',
      actorUserId: tutorId,
      actorRole: 'TUTOR',
      reason: null,
    });

    const secondBooking = await createActionBooking();
    const afterEnd = new BookingService(() => new Date('2026-07-20T11:00:00.001Z'));
    await expect(
      afterEnd.complete(secondBooking.id, { id: tutorId, role: 'TUTOR' })
    ).resolves.toMatchObject({ status: 'COMPLETED' });
  });

  it('rejects completion one millisecond before endAt', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => new Date('2026-07-20T10:59:59.999Z'));

    await expect(
      service.complete(booking.id, { id: tutorId, role: 'TUTOR' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });
  });

  it('rejects an unrelated tutor and a repeated completion', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

    await expect(
      service.complete(booking.id, { id: otherUserId, role: 'TUTOR' })
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    await service.complete(booking.id, { id: tutorId, role: 'TUTOR' });
    await expect(
      service.complete(booking.id, { id: tutorId, role: 'TUTOR' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });
  });

  it('allows admin standard completion only at or after endAt', async () => {
    const booking = await createActionBooking();
    const early = new BookingService(() => new Date('2026-07-20T10:59:59.999Z'));
    const onTime = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

    await expect(
      early.complete(booking.id, { id: adminId, role: 'ADMIN' })
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_NOT_COMPLETABLE' });

    const result = await onTime.complete(booking.id, { id: adminId, role: 'ADMIN' });
    expect(result.status).toBe('COMPLETED');
  });

  it('returns actions only to actors that can invoke them', async () => {
    const booking = await createActionBooking();
    const beforeStart = new BookingService(() => new Date('2026-07-20T09:00:00.000Z'));
    const afterEnd = new BookingService(() => new Date('2026-07-20T11:00:00.000Z'));

    expect(
      (await beforeStart.getDetail(booking.id, studentId, 'STUDENT')).allowedActions
    ).toEqual(['CANCEL']);
    expect(
      (await beforeStart.getDetail(booking.id, adminId, 'ADMIN')).allowedActions
    ).toEqual([]);
    expect(
      (await afterEnd.getDetail(booking.id, tutorId, 'TUTOR')).allowedActions
    ).toEqual(['COMPLETE']);
    expect(
      (await afterEnd.getDetail(booking.id, adminId, 'ADMIN')).allowedActions
    ).toEqual(['COMPLETE']);
  });
});
```

- [ ] **Step 2: Run completion tests and verify failure**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.complete"
```

Expected: FAIL because `complete` does not exist and admin currently receives `CANCEL`.

- [ ] **Step 3: Add standard completion validation**

Add to `BookingService`:

```ts
async complete(bookingId: string, actor: BookingActor) {
  return this.transition(bookingId, actor, {
    mode: 'STANDARD_COMPLETE',
    targetStatus: 'COMPLETED',
  });
}
```

Add this branch inside the transaction engine before `transitionBooking`:

```ts
if (command.mode === 'STANDARD_COMPLETE') {
  const isAssignedTutor =
    actor.role === 'TUTOR' && booking.tutorProfile.userId === actor.id;
  const isAdmin = actor.role === 'ADMIN';
  if (!isAssignedTutor && !isAdmin) {
    throw new ForbiddenError('Access denied.');
  }
  if (
    booking.status !== 'CONFIRMED' ||
    transitionNow.getTime() < booking.endAt.getTime()
  ) {
    throw new ConflictError(
      'Booking is not eligible for completion.',
      'BOOKING_NOT_COMPLETABLE'
    );
  }
}
```

- [ ] **Step 4: Correct actor-specific action calculation**

Replace `computeAllowedActions` with:

```ts
private computeAllowedActions(
  booking: {
    status: BookingStatus;
    studentId: string;
    startAt: Date;
    endAt: Date;
    tutorProfile: { userId: string };
    review: unknown | null;
  },
  userId: string,
  role: UserRole
): BookingAction[] {
  const actions: BookingAction[] = [];
  const now = this.now();

  if (booking.status === 'CONFIRMED') {
    const participantCanCancel =
      booking.studentId === userId || booking.tutorProfile.userId === userId;
    if (participantCanCancel && now.getTime() < booking.startAt.getTime()) {
      actions.push('CANCEL');
    }

    const actorCanComplete =
      booking.tutorProfile.userId === userId || role === 'ADMIN';
    if (actorCanComplete && now.getTime() >= booking.endAt.getTime()) {
      actions.push('COMPLETE');
    }
  }

  if (booking.status === 'COMPLETED' && booking.studentId === userId && !booking.review) {
    actions.push('REVIEW');
  }

  return actions;
}
```

Import `BookingAction` from `booking.types.ts`, and type `role` parameters as `UserRole` in `getDetail` and `list`.

- [ ] **Step 5: Run the completion and booking-core suites**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.complete"
npm test -- tests/booking.service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit completion and actions**

```text
git add src/modules/bookings/booking.service.ts tests/booking.service.test.ts
git commit -m "feat(bookings): add completion boundaries and allowed actions"
```

---

### Task 4: Implement Admin Overrides, Reconfirmation, and Admin Transitions

**Files:**
- Modify: `src/modules/bookings/booking.repository.ts`
- Modify: `src/modules/bookings/booking.service.ts`
- Test: `tests/booking.service.test.ts`

**Interfaces:**
- Consumes: the central transition engine and typed overlap repository method.
- Produces:
  - `bookingService.overrideStatus(bookingId, actor, status, reason)`
  - `allowedAdminTransitions` on admin booking detail
  - Race-safe reconfirmation excluding the target booking itself.

- [ ] **Step 1: Write admin override tests**

Add:

```ts
describe('BookingService.overrideStatus', () => {
  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.user.update({ where: { id: tutorId }, data: { status: 'ACTIVE' } });
    await prisma.tutorProfile.update({
      where: { id: tutorProfileId },
      data: { approvalStatus: 'APPROVED' },
    });
  });

  it('allows early admin completion with a required audit reason', async () => {
    const booking = await createActionBooking();
    const now = new Date('2026-07-20T10:30:00.000Z');
    const service = new BookingService(() => now);

    const result = await service.overrideStatus(
      booking.id,
      { id: adminId, role: 'ADMIN' },
      'COMPLETED',
      'Administrative verification'
    );

    expect(result.status).toBe('COMPLETED');
    expect(result.completedAt).toEqual(now);
    expect(result.statusHistory.at(-1)).toMatchObject({
      fromStatus: 'CONFIRMED',
      toStatus: 'COMPLETED',
      actorUserId: adminId,
      actorRole: 'ADMIN',
      reason: 'Administrative verification',
    });
  });

  it('supports every different-status admin transition pair', async () => {
    const cases: Array<{
      from: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
      to: 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
    }> = [
      { from: 'CONFIRMED', to: 'COMPLETED' },
      { from: 'CONFIRMED', to: 'CANCELLED' },
      { from: 'COMPLETED', to: 'CONFIRMED' },
      { from: 'COMPLETED', to: 'CANCELLED' },
      { from: 'CANCELLED', to: 'CONFIRMED' },
      { from: 'CANCELLED', to: 'COMPLETED' },
    ];
    const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

    for (const transition of cases) {
      const booking = await createActionBooking({ status: transition.from });
      const result = await service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        transition.to,
        `${transition.from} to ${transition.to}`
      );
      expect(result.status).toBe(transition.to);
      await prisma.bookingStatusHistory.deleteMany({ where: { bookingId: booking.id } });
      await prisma.booking.delete({ where: { id: booking.id } });
    }
  });

  it('rejects non-admin and same-status overrides without history', async () => {
    const booking = await createActionBooking();
    const service = new BookingService(() => new Date('2026-07-20T09:00:00.000Z'));

    await expect(
      service.overrideStatus(
        booking.id,
        { id: tutorId, role: 'TUTOR' },
        'CANCELLED',
        'Not authorized'
      )
    ).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });

    await expect(
      service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CONFIRMED',
        'Reaffirm'
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });

    expect(await prisma.bookingStatusHistory.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it('clears incompatible metadata for every admin target status', async () => {
    const booking = await prisma.booking.create({
      data: {
        studentId,
        tutorProfileId,
        categoryId,
        startAt: new Date('2026-07-20T10:00:00.000Z'),
        endAt: new Date('2026-07-20T11:00:00.000Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: 50,
        quotedPrice: 50,
        status: 'CANCELLED',
        cancelledAt: new Date('2026-07-19T10:00:00.000Z'),
        cancelledById: studentId,
        cancellationReason: 'Old reason',
      },
    });
    const service = new BookingService(() => new Date('2026-07-21T12:00:00.000Z'));

    const confirmed = await service.overrideStatus(
      booking.id,
      { id: adminId, role: 'ADMIN' },
      'CONFIRMED',
      'Restore booking'
    );
    expect(confirmed).toMatchObject({
      status: 'CONFIRMED',
      cancelledAt: null,
      cancelledById: null,
      cancellationReason: null,
      completedAt: null,
    });

    const cancelled = await service.overrideStatus(
      booking.id,
      { id: adminId, role: 'ADMIN' },
      'CANCELLED',
      'Cancel correction'
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.completedAt).toBeNull();
    expect(
      cancelled.statusHistory.slice(-2).map((entry) => [entry.fromStatus, entry.toStatus])
    ).toEqual([
      ['CANCELLED', 'CONFIRMED'],
      ['CONFIRMED', 'CANCELLED'],
    ]);
  });

  it('rejects reconfirmation for an inactive or unapproved tutor', async () => {
    const booking = await createActionBooking({ status: 'CANCELLED' });
    const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

    await prisma.user.update({ where: { id: tutorId }, data: { status: 'BANNED' } });
    await expect(
      service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CONFIRMED',
        'Restore'
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'TUTOR_NOT_APPROVED' });
  });

  it('rejects overlapping reconfirmation but accepts adjacency', async () => {
    const cancelled = await createActionBooking({ status: 'CANCELLED' });
    await prisma.booking.create({
      data: {
        studentId,
        tutorProfileId,
        categoryId,
        startAt: new Date('2026-07-20T10:30:00.000Z'),
        endAt: new Date('2026-07-20T11:30:00.000Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: 50,
        quotedPrice: 50,
        status: 'CONFIRMED',
      },
    });
    const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

    await expect(
      service.overrideStatus(
        cancelled.id,
        { id: adminId, role: 'ADMIN' },
        'CONFIRMED',
        'Restore'
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_SLOT_CONFLICT' });

    await prisma.booking.deleteMany({ where: { id: { not: cancelled.id } } });
    await prisma.booking.create({
      data: {
        studentId,
        tutorProfileId,
        categoryId,
        startAt: new Date('2026-07-20T11:00:00.000Z'),
        endAt: new Date('2026-07-20T12:00:00.000Z'),
        durationMinutes: 60,
        hourlyRateSnapshot: 50,
        quotedPrice: 50,
        status: 'CONFIRMED',
      },
    });

    await expect(
      service.overrideStatus(
        cancelled.id,
        { id: adminId, role: 'ADMIN' },
        'CONFIRMED',
        'Restore adjacent booking'
      )
    ).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('blocks transition away from a reviewed completed booking', async () => {
    const booking = await createActionBooking({ status: 'COMPLETED' });
    await prisma.review.create({
      data: {
        bookingId: booking.id,
        studentId,
        tutorProfileId,
        rating: 5,
        comment: 'Excellent session',
      },
    });
    const service = new BookingService(() => new Date('2026-07-21T12:00:00.000Z'));

    await expect(
      service.overrideStatus(
        booking.id,
        { id: adminId, role: 'ADMIN' },
        'CANCELLED',
        'Correction'
      )
    ).rejects.toMatchObject({ statusCode: 409, code: 'BOOKING_STATUS_CONFLICT' });
  });

  it('returns valid admin transitions in booking detail', async () => {
    const booking = await createActionBooking({ status: 'CANCELLED' });
    const service = new BookingService(() => new Date('2026-07-19T10:00:00.000Z'));

    const detail = await service.getDetail(booking.id, adminId, 'ADMIN');
    expect(detail.allowedAdminTransitions).toEqual(
      expect.arrayContaining(['CONFIRMED', 'COMPLETED'])
    );
    expect(detail.allowedAdminTransitions).not.toContain('CANCELLED');
  });
});
```

- [ ] **Step 2: Run admin override tests and verify failure**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.overrideStatus"
```

Expected: FAIL because override behavior and admin transition calculation do not exist.

- [ ] **Step 3: Support overlap exclusion in the repository**

Replace `checkOverlap` with:

```ts
async checkOverlap(
  tutorProfileId: string,
  startAt: Date,
  endAt: Date,
  tx: TransactionClient,
  excludeBookingId?: string
) {
  const count = await tx.booking.count({
    where: {
      tutorProfileId,
      status: 'CONFIRMED',
      ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  return count > 0;
}

async checkOverlapOutsideTransaction(
  tutorProfileId: string,
  startAt: Date,
  endAt: Date,
  excludeBookingId: string
) {
  const count = await prisma.booking.count({
    where: {
      tutorProfileId,
      status: 'CONFIRMED',
      id: { not: excludeBookingId },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
  });
  return count > 0;
}

async isTutorEligibleForReconfirmation(tutorProfileId: string) {
  const tutor = await prisma.tutorProfile.findUnique({
    where: { id: tutorProfileId },
    select: {
      approvalStatus: true,
      user: { select: { status: true } },
    },
  });
  return Boolean(
    tutor &&
      tutor.approvalStatus === 'APPROVED' &&
      tutor.user.status === 'ACTIVE'
  );
}
```

The existing create call remains valid because `excludeBookingId` is optional.

- [ ] **Step 4: Add admin override validation to the transition engine**

Add the public method:

```ts
async overrideStatus(
  bookingId: string,
  actor: BookingActor,
  targetStatus: BookingStatus,
  reason: string
) {
  return this.transition(bookingId, actor, {
    mode: 'ADMIN_OVERRIDE',
    targetStatus,
    reason,
  });
}
```

Add this branch before the repository write:

```ts
if (command.mode === 'ADMIN_OVERRIDE') {
  if (actor.role !== 'ADMIN') {
    throw new ForbiddenError('Access denied.');
  }
  if (booking.status === command.targetStatus) {
    throw new ConflictError(
      'Booking already has the requested status.',
      'BOOKING_STATUS_CONFLICT'
    );
  }
  if (booking.review && booking.status === 'COMPLETED' && command.targetStatus !== 'COMPLETED') {
    throw new ConflictError(
      'A reviewed completed booking cannot change status.',
      'BOOKING_STATUS_CONFLICT'
    );
  }
  if (command.targetStatus === 'CONFIRMED') {
    const tutorEligible =
      booking.tutorProfile.user.status === 'ACTIVE' &&
      booking.tutorProfile.approvalStatus === 'APPROVED';
    if (!tutorEligible) {
      throw new ConflictError(
        'Tutor must be active and approved before reconfirmation.',
        'TUTOR_NOT_APPROVED'
      );
    }

    const hasOverlap = await bookingRepository.checkOverlap(
      booking.tutorProfileId,
      booking.startAt,
      booking.endAt,
      tx,
      booking.id
    );
    if (hasOverlap) {
      throw new ConflictError(
        'Reconfirmed booking conflicts with another confirmed booking.',
        'BOOKING_SLOT_CONFLICT'
      );
    }
  }
}
```

- [ ] **Step 5: Add admin transition calculation**

Add:

```ts
private async computeAllowedAdminTransitions(
  booking: Awaited<ReturnType<typeof bookingRepository.findById>>
): Promise<BookingStatus[]> {
  if (!booking) return [];
  if (booking.status === 'COMPLETED' && booking.review) return [];

  const transitions: BookingStatus[] = ['CONFIRMED', 'COMPLETED', 'CANCELLED'].filter(
    (status): status is BookingStatus => status !== booking.status
  );

  if (transitions.includes('CONFIRMED')) {
    const tutorEligible = await bookingRepository.isTutorEligibleForReconfirmation(
      booking.tutorProfileId
    );
    const hasOverlap = tutorEligible
      ? await bookingRepository.checkOverlapOutsideTransaction(
          booking.tutorProfileId,
          booking.startAt,
          booking.endAt,
          booking.id
        )
      : true;

    if (hasOverlap) {
      return transitions.filter((status) => status !== 'CONFIRMED');
    }
  }

  return transitions;
}
```

Update `getDetail`:

```ts
const allowedActions = this.computeAllowedActions(booking, userId, role);
const allowedAdminTransitions =
  role === 'ADMIN' ? await this.computeAllowedAdminTransitions(booking) : undefined;

return {
  ...booking,
  allowedActions,
  ...(allowedAdminTransitions ? { allowedAdminTransitions } : {}),
};
```

- [ ] **Step 6: Run admin tests and the full service suite**

Run:

```text
npm test -- tests/booking.service.test.ts -t "BookingService.overrideStatus"
npm test -- tests/booking.service.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit admin overrides**

```text
git add src/modules/bookings/booking.repository.ts src/modules/bookings/booking.service.ts tests/booking.service.test.ts
git commit -m "feat(bookings): add admin status overrides and reconfirmation"
```

---

### Task 5: Expose HTTP Actions and Verify Transactional History

**Files:**
- Modify: `src/modules/bookings/booking.controller.ts`
- Modify: `src/modules/bookings/booking.routes.ts`
- Modify: `tests/booking.test.ts`

**Interfaces:**
- Consumes:
  - `bookingService.cancel(bookingId, actor, reason?)`
  - `bookingService.complete(bookingId, actor)`
  - `bookingService.overrideStatus(bookingId, actor, status, reason)`
- Produces the three approved PATCH endpoints and their stable HTTP contracts.

- [ ] **Step 1: Add HTTP validation, authorization, boundary, and history tests**

Add helpers in `tests/booking.test.ts`:

```ts
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
```

Add endpoint tests:

```ts
describe('PATCH booking actions', () => {
  beforeEach(async () => {
    await prisma.review.deleteMany();
    await prisma.bookingStatusHistory.deleteMany();
    await prisma.booking.deleteMany();
  });

  it('lets the student cancel their future booking and returns embedded history', async () => {
    const booking = await createDirectBooking();
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
});
```

- [ ] **Step 2: Run endpoint tests and verify failure**

Run:

```text
npm test -- tests/booking.test.ts -t "PATCH booking actions"
```

Expected: FAIL with `404 NOT_FOUND` because the PATCH routes are not mounted.

- [ ] **Step 3: Add action controllers**

Update schema imports in `src/modules/bookings/booking.controller.ts`, then add:

```ts
import {
  adminBookingStatusSchema,
  bookingIdParamsSchema,
  cancelBookingSchema,
  createBookingSchema,
  getBookingsQuerySchema,
} from './booking.schemas.js';

export const cancelBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = bookingIdParamsSchema.parse(req.params);
    const { reason } = cancelBookingSchema.parse(req.body);
    const booking = await bookingService.cancel(
      bookingId,
      { id: req.user!.id, role: req.user!.role },
      reason
    );
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};

export const completeBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = bookingIdParamsSchema.parse(req.params);
    const booking = await bookingService.complete(bookingId, {
      id: req.user!.id,
      role: req.user!.role,
    });
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};

export const overrideBookingStatus = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { bookingId } = bookingIdParamsSchema.parse(req.params);
    const { status, reason } = adminBookingStatusSchema.parse(req.body);
    const booking = await bookingService.overrideStatus(
      bookingId,
      { id: req.user!.id, role: req.user!.role },
      status,
      reason
    );
    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    next(error);
  }
};
```

Also validate `bookingId` with `bookingIdParamsSchema` in the existing `getBookingDetails` controller.

- [ ] **Step 4: Mount the action routes**

Update controller imports in `src/modules/bookings/booking.routes.ts`, then add:

```ts
router.patch(
  '/bookings/:bookingId/cancel',
  requireAuth,
  requireRole(['STUDENT', 'TUTOR']),
  requireActive,
  cancelBooking
);
router.patch(
  '/bookings/:bookingId/complete',
  requireAuth,
  requireRole(['TUTOR', 'ADMIN']),
  requireActive,
  completeBooking
);
router.patch(
  '/admin/bookings/:bookingId/status',
  requireAuth,
  requireRole('ADMIN'),
  requireActive,
  overrideBookingStatus
);
```

Place these PATCH routes before `router.get('/bookings/:bookingId', ...)` for readability.

- [ ] **Step 5: Add reconfirmation-versus-creation concurrency coverage**

Add this integration test inside `PATCH booking actions`:

```ts
it('serializes admin reconfirmation against booking creation', async () => {
  const startAt = '2026-07-20T09:00:00.000Z';
  const cancelled = await prisma.booking.create({
    data: {
      studentId: studentUserId,
      tutorProfileId: tutorId,
      categoryId,
      startAt: new Date(startAt),
      endAt: new Date('2026-07-20T10:00:00.000Z'),
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
      .send({ tutorId, categoryId, startAt, durationMinutes: 60 }),
  ]);

  expect([overrideRes.status, createRes.status].sort()).toEqual([200, 409]);
  expect(
    await prisma.booking.count({
      where: {
        tutorProfileId: tutorId,
        status: 'CONFIRMED',
        startAt: { lt: new Date('2026-07-20T10:00:00.000Z') },
        endAt: { gt: new Date(startAt) },
      },
    })
  ).toBe(1);
});
```

- [ ] **Step 6: Run focused HTTP and full booking tests**

Run:

```text
npm test -- tests/booking.test.ts -t "PATCH booking actions"
npm test -- tests/booking.test.ts
npm test -- tests/booking.service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the HTTP slice**

```text
git add src/modules/bookings/booking.controller.ts src/modules/bookings/booking.routes.ts tests/booking.test.ts
git commit -m "feat(bookings): expose cancellation completion and overrides"
```

---

### Task 6: Full Verification and Progress Ledger

**Files:**
- Modify: `.superpowers/sdd/progress.md` after verification succeeds
- Verify: all application and test files changed in Tasks 1–5

**Interfaces:**
- Consumes: all Task 10 endpoints and service behavior.
- Produces: a verified Phase 6 implementation and an updated local progress ledger.

- [ ] **Step 1: Run formatting and static verification**

Run:

```text
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit with code 0.

- [ ] **Step 2: Run focused booking tests**

Run:

```text
npm test -- tests/booking.service.test.ts
npm test -- tests/booking.test.ts
```

Expected: both suites pass.

- [ ] **Step 3: Run the complete sequential test suite**

Run:

```text
npm test
```

Expected: every Jest suite and test passes with no open-handle warning.

- [ ] **Step 4: Inspect the final diff**

Run:

```text
git status --short
git diff --check
git log -6 --oneline
```

Expected:

- No whitespace errors.
- Only Task 10 files are modified or committed.
- The pre-existing untracked `package-lock.json` and `docs/superpowers/plans/2026-07-15-skillbridge-backend.md` remain untouched.

- [ ] **Step 5: Check off Task 10 in the local ledger**

Run `git log --reverse --oneline --grep="bookings"` and identify the first Task 10 implementation commit from Task 1, then run `git log -1 --oneline` to identify the final Task 10 implementation commit.

Use `apply_patch` to change:

```text
- [ ] Task 10: Booking Actions, Overrides & History (Phase 6)
```

to the checked form containing the actual abbreviated first and final hashes separated by two periods, followed by `review clean`. For example, if the real hashes printed by Git are `1234abc` and `7890def`, the exact ledger line is:

```text
- [x] Task 10: Booking Actions, Overrides & History (Phase 6) (commits 1234abc..7890def, review clean)
```

Do not copy the example hashes. The ledger is git-ignored, so do not force-add it.

- [ ] **Step 6: Record a verification-only fix commit if verification required code changes**

If Steps 1–3 exposed an implementation defect, apply the smallest focused correction, rerun the failed command and `npm test`, then commit only that correction:

```text
git add src/modules/bookings/booking.types.ts src/modules/bookings/booking.schemas.ts src/modules/bookings/booking.repository.ts src/modules/bookings/booking.service.ts src/modules/bookings/booking.controller.ts src/modules/bookings/booking.routes.ts tests/booking.service.test.ts tests/booking.test.ts
git commit -m "fix(bookings): complete booking action verification"
```

If no correction was required, do not create an empty commit.
