import { NextFunction, Request, Response } from 'express';
import { reviewService } from './review.service.js';
import {
  bookingReviewParamsSchema,
  createReviewSchema,
  reviewListQuerySchema,
  tutorReviewsParamsSchema,
} from './review.schemas.js';

export const createReview = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { bookingId } = bookingReviewParamsSchema.parse(req.params);
    const body = createReviewSchema.parse(req.body);
    const review = await reviewService.create(bookingId, req.user!.id, body);
    res.status(201).json({ success: true, data: review });
  } catch (error) {
    next(error);
  }
};

export const listTutorReviews = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { tutorId } = tutorReviewsParamsSchema.parse(req.params);
    const { page, pageSize } = reviewListQuerySchema.parse(req.query);
    const result = await reviewService.listForPublicTutor(tutorId, page, pageSize);
    res.status(200).json({
      success: true,
      data: result.reviews,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};
