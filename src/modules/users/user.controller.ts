import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/db.js';
import { UnauthorizedError } from '../../shared/errors/app-error.js';
import { z } from 'zod';

const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name cannot be empty').optional(),
  image: z.string().url('Image must be a valid URL').nullable().optional(),
  phone: z.string().nullable().optional(),
});

export const getMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedError('User not found.');
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

export const updateMe = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError();
    }

    // Validate body
    const validatedData = updateProfileSchema.parse(req.body);

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: validatedData,
      select: {
        id: true,
        name: true,
        email: true,
        emailVerified: true,
        image: true,
        phone: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.status(200).json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
};
