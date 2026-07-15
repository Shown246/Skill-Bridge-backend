import { Request, Response, NextFunction } from 'express';
import { tutorService } from './tutor.service.js';
import {
  upsertProfileSchema,
  approvalSchema,
  getAdminTutorsQuerySchema,
  publicTutorSearchSchema,
} from './tutor.schemas.js';

export const getOwnProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // req.user is guaranteed by requireAuth and requireRole
    const profile = await tutorService.getProfile(req.user!.id);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const upsertOwnProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = upsertProfileSchema.parse(req.body);
    const profile = await tutorService.upsertProfile(req.user!.id, validatedData);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminTutors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedQuery = getAdminTutorsQuerySchema.parse(req.query);
    const result = await tutorService.getAdminTutors(validatedQuery);
    res.status(200).json({
      success: true,
      data: result.tutors,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getAdminTutorById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tutorId } = req.params;
    const profile = await tutorService.getAdminTutorById(tutorId);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const moderateTutorApproval = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tutorId } = req.params;
    const validatedBody = approvalSchema.parse(req.body);
    const profile = await tutorService.moderateApproval(
      tutorId,
      req.user!.id,
      validatedBody
    );
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const searchPublicTutors = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedQuery = publicTutorSearchSchema.parse(req.query);
    const result = await tutorService.searchPublicTutors(validatedQuery);
    res.status(200).json({
      success: true,
      data: result.tutors,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicTutorById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tutorId } = req.params;
    const profile = await tutorService.getPublicTutorById(tutorId);
    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};
