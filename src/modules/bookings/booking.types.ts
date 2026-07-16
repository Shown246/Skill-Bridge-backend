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
  historyCreatedAt: Date;
};
