import { prisma } from '../../config/db.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { env } from '../../config/env.js';

export async function getTutorSlots(tutorId: string, dateFromStr: string, dateToStr: string) {
  const tutor = await prisma.tutorProfile.findUnique({
    where: { id: tutorId },
    include: { user: true },
  });

  if (!tutor || tutor.user.status !== 'ACTIVE' || tutor.approvalStatus !== 'APPROVED') {
    throw new NotFoundError('Tutor profile not found.');
  }

  const dateFrom = new Date(dateFromStr);
  const dateTo = new Date(dateToStr);

  const weeklyAvailability = await prisma.weeklyAvailability.findMany({
    where: { tutorProfileId: tutor.id, isActive: true },
  });

  const bookings = await prisma.booking.findMany({
    where: {
      tutorProfileId: tutor.id,
      status: 'CONFIRMED',
      startAt: { lt: dateTo },
      endAt: { gt: dateFrom },
    },
  });

  const durations = env.BOOKING_DURATION_OPTIONS;
  const nowMs = Date.now();
  const alignedStartMs = Math.ceil(Math.max(dateFrom.getTime(), nowMs) / (30 * 60 * 1000)) * (30 * 60 * 1000);

  const slots: { startAt: string; endAtByDuration: Record<string, string> }[] = [];

  for (let currentMs = alignedStartMs; currentMs < dateTo.getTime(); currentMs += 30 * 60 * 1000) {
    const slotStart = new Date(currentMs);
    const endAtByDuration: Record<string, string> = {};

    for (const duration of durations) {
      const slotEnd = new Date(currentMs + duration * 60 * 1000);

      if (slotEnd > dateTo) continue;

      // Check booking overlap
      const hasBookingOverlap = bookings.some((b) => b.startAt < slotEnd && b.endAt > slotStart);
      if (hasBookingOverlap) continue;

      // Check availability
      if (slotStart.getUTCDay() !== slotEnd.getUTCDay()) continue; // cannot cross midnight

      const dayOfWeek = slotStart.getUTCDay();
      const startMinute = slotStart.getUTCHours() * 60 + slotStart.getUTCMinutes();
      const endMinute = startMinute + duration;

      const isAvailable = weeklyAvailability.some(
        (av) => av.dayOfWeek === dayOfWeek && av.startMinuteUtc <= startMinute && av.endMinuteUtc >= endMinute
      );

      if (isAvailable) {
        endAtByDuration[duration.toString()] = slotEnd.toISOString();
      }
    }

    if (Object.keys(endAtByDuration).length > 0) {
      slots.push({
        startAt: slotStart.toISOString(),
        endAtByDuration,
      });
    }
  }

  return {
    tutorId: tutor.id,
    timezone: 'UTC',
    hourlyRate: Number(tutor.hourlyRate),
    currencyCode: tutor.currencyCode,
    supportedDurations: durations,
    slots,
  };
}
