import { z } from 'zod';

const availabilitySlotSchema = z.object({
  dayOfWeek: z
    .number({ required_error: 'Day of week is required.' })
    .int('Day of week must be an integer.')
    .min(0, 'Day of week must be between 0 (Sunday) and 6 (Saturday).')
    .max(6, 'Day of week must be between 0 (Sunday) and 6 (Saturday).'),
  startMinuteUtc: z
    .number({ required_error: 'Start minute is required.' })
    .int('Start minute must be an integer.')
    .min(0, 'Start minute must be between 0 and 1439.')
    .max(1439, 'Start minute must be between 0 and 1439.'),
  endMinuteUtc: z
    .number({ required_error: 'End minute is required.' })
    .int('End minute must be an integer.')
    .min(1, 'End minute must be between 1 and 1440.')
    .max(1440, 'End minute must be between 1 and 1440.'),
});

export const putAvailabilitySchema = z
  .object({
    slots: z
      .array(availabilitySlotSchema)
      .max(100, 'Maximum 100 availability slots allowed.'),
  })
  .refine(
    (data) => {
      // Validate that startMinuteUtc < endMinuteUtc for each slot
      for (const slot of data.slots) {
        if (slot.startMinuteUtc >= slot.endMinuteUtc) {
          return false;
        }
      }
      return true;
    },
    {
      message: 'startMinuteUtc must be less than endMinuteUtc for each slot.',
      path: ['slots'],
    }
  )
  .refine(
    (data) => {
      // Check for overlapping intervals within the same day
      const byDay = new Map<number, { start: number; end: number }[]>();
      for (const slot of data.slots) {
        if (!byDay.has(slot.dayOfWeek)) {
          byDay.set(slot.dayOfWeek, []);
        }
        byDay.get(slot.dayOfWeek)!.push({
          start: slot.startMinuteUtc,
          end: slot.endMinuteUtc,
        });
      }

      for (const [, intervals] of byDay) {
        // Sort by start time
        intervals.sort((a, b) => a.start - b.start);
        for (let i = 1; i < intervals.length; i++) {
          if (intervals[i].start < intervals[i - 1].end) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message: 'Availability slots must not overlap within the same day.',
      path: ['slots'],
    }
  );
