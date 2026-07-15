import { Request, Response, NextFunction } from 'express';
import {
  createCategorySchema,
  updateCategorySchema,
  updateCategoryStatusSchema,
  getCategoriesQuerySchema,
} from './category.schemas.js';
import { categoryService } from './category.service.js';

export const createCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validatedData = createCategorySchema.parse(req.body);
    const category = await categoryService.createCategory(validatedData);
    res.status(201).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCategory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryId } = req.params;
    const validatedData = updateCategorySchema.parse(req.body);
    const category = await categoryService.updateCategory(categoryId, validatedData);
    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCategoryStatus = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { categoryId } = req.params;
    const { isActive } = updateCategoryStatusSchema.parse(req.body);
    const category = await categoryService.toggleCategoryStatus(categoryId, isActive);
    res.status(200).json({
      success: true,
      data: category,
    });
  } catch (error) {
    next(error);
  }
};

export const getCategories = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, limit } = getCategoriesQuerySchema.parse(req.query);
    const categories = await categoryService.getActiveCategories({ search, limit });
    res.status(200).json({
      success: true,
      data: categories,
    });
  } catch (error) {
    next(error);
  }
};
