import { availabilityRepository } from './availability.repository.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { prisma } from '../../config/db.js';

export class AvailabilityService {
  async getAvailability(userId: string) {
    const profile = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError('Tutor profile not found. Create a profile first.');
    }

    return availabilityRepository.findByTutorProfileId(profile.id);
  }

  async replaceAvailability(
    userId: string,
    slots: { dayOfWeek: number; startMinuteUtc: number; endMinuteUtc: number }[]
  ) {
    const profile = await prisma.tutorProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      throw new NotFoundError('Tutor profile not found. Create a profile first.');
    }

    return availabilityRepository.replaceAll(profile.id, slots);
  }
}

export const availabilityService = new AvailabilityService();
