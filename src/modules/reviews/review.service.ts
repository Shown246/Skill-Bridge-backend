import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from '../../shared/errors/app-error.js';
import { tutorRepository } from '../tutors/tutor.repository.js';
import { reviewRepository } from './review.repository.js';

export class ReviewService {
  async create(
    bookingId: string,
    studentId: string,
    data: { rating: number; comment: string }
  ) {
    const booking = await reviewRepository.findBookingForReview(bookingId);
    if (!booking) {
      throw new NotFoundError('Booking not found.');
    }
    if (booking.studentId !== studentId) {
      throw new ForbiddenError('Only the booking student may review this session.');
    }
    if (booking.status !== 'COMPLETED') {
      throw new ConflictError(
        'Only completed bookings may be reviewed.',
        'BOOKING_NOT_COMPLETED'
      );
    }
    if (booking.review) {
      throw new ConflictError(
        'This booking has already been reviewed.',
        'BOOKING_ALREADY_REVIEWED'
      );
    }

    try {
      return await reviewRepository.create({
        bookingId,
        studentId,
        tutorProfileId: booking.tutorProfileId,
        rating: data.rating,
        comment: data.comment,
      });
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        throw new ConflictError(
          'This booking has already been reviewed.',
          'BOOKING_ALREADY_REVIEWED'
        );
      }
      throw error;
    }
  }

  async listForPublicTutor(tutorId: string, page: number, pageSize: number) {
    const tutor = await tutorRepository.findPublicById(tutorId);
    if (!tutor) {
      throw new NotFoundError('Tutor not found.');
    }
    const { reviews, totalItems } = await reviewRepository.listForPublicTutor(
      tutorId,
      page,
      pageSize
    );
    return {
      reviews,
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.ceil(totalItems / pageSize),
      },
    };
  }
}

export const reviewService = new ReviewService();
