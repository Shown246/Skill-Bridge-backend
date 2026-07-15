import { Request, Response, NextFunction } from 'express';
import { availabilityService } from './availability.service.js';
import { putAvailabilitySchema } from './availability.schemas.js';

export const getOwnAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slots = await availabilityService.getAvailability(req.user!.id);
    res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error) {
    next(error);
  }
};

export const replaceOwnAvailability = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = putAvailabilitySchema.parse(req.body);
    const slots = await availabilityService.replaceAvailability(req.user!.id, validatedData.slots);
    res.status(200).json({
      success: true,
      data: slots,
    });
  } catch (error) {
    next(error);
  }
};
