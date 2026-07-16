import { prisma } from '../../config/db.js';

export class AvailabilityRepository {
  async findByTutorProfileId(tutorProfileId: string) {
    return prisma.weeklyAvailability.findMany({
      where: { tutorProfileId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startMinuteUtc: 'asc' }],
    });
  }

  async replaceAll(
    tutorProfileId: string,
    slots: { dayOfWeek: number; startMinuteUtc: number; endMinuteUtc: number }[]
  ) {
    return prisma.$transaction(async (tx) => {
      // Soft-delete existing availability by setting isActive = false
      await tx.weeklyAvailability.updateMany({
        where: { tutorProfileId, isActive: true },
        data: { isActive: false },
      });

      // Create new active slots
      if (slots.length > 0) {
        await tx.weeklyAvailability.createMany({
          data: slots.map((slot) => ({
            tutorProfileId,
            dayOfWeek: slot.dayOfWeek,
            startMinuteUtc: slot.startMinuteUtc,
            endMinuteUtc: slot.endMinuteUtc,
            isActive: true,
          })),
        });
      }

      // Return newly created active slots
      return tx.weeklyAvailability.findMany({
        where: { tutorProfileId, isActive: true },
        orderBy: [{ dayOfWeek: 'asc' }, { startMinuteUtc: 'asc' }],
      });
    }, { maxWait: 15000, timeout: 15000 });
  }
}

export const availabilityRepository = new AvailabilityRepository();
