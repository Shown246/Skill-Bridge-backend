import { Request, Response, NextFunction } from 'express';
import { bookingService } from './booking.service.js';
import { createBookingSchema, getBookingsQuerySchema } from './booking.schemas.js';

export const createBooking = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedBody = createBookingSchema.parse(req.body);
    const booking = await bookingService.create(req.user!.id, validatedBody);
    res.status(201).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

export const getBookingDetails = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bookingId } = req.params;
    const booking = await bookingService.getDetail(bookingId, req.user!.id, req.user!.role);
    res.status(200).json({
      success: true,
      data: booking,
    });
  } catch (error) {
    next(error);
  }
};

export const listBookings = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedQuery = getBookingsQuerySchema.parse(req.query);
    const result = await bookingService.list(req.user!.id, req.user!.role, validatedQuery);
    res.status(200).json({
      success: true,
      data: result.bookings,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};
