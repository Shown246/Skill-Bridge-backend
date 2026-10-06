import { prisma } from '../../config/db.js';
import { Prisma } from '@prisma/client';

export class CategoryRepository {
  async findById(id: string) {
    return prisma.category.findUnique({
      where: { id },
    });
  }

  async findByName(name: string) {
    return prisma.category.findFirst({
      where: {
        name: {
          equals: name,
          mode: 'insensitive',
        },
      },
    });
  }

  async findBySlug(slug: string) {
    return prisma.category.findFirst({
      where: {
        slug: {
          equals: slug,
          mode: 'insensitive',
        },
      },
    });
  }

  async create(data: { name: string; slug: string; description?: string | null }) {
    return prisma.category.create({
      data,
    });
  }

  async update(id: string, data: { name?: string; slug?: string; description?: string | null }) {
    return prisma.category.update({
      where: { id },
      data,
    });
  }

  async updateStatus(id: string, isActive: boolean) {
    return prisma.category.update({
      where: { id },
      data: { isActive },
    });
  }

  async findActive(options: { search?: string; limit?: number }) {
    const where: Prisma.CategoryWhereInput = {
      isActive: true,
    };

    if (options.search) {
      where.OR = [
        {
          name: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return prisma.category.findMany({
      where,
      take: options.limit,
      orderBy: {
        name: 'asc',
      },
    });
  }

  async findAll(options: { search?: string; limit?: number; isActive?: boolean }) {
    const where: Prisma.CategoryWhereInput = {};

    if (options.isActive !== undefined) {
      where.isActive = options.isActive;
    }

    if (options.search) {
      where.OR = [
        {
          name: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: options.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return prisma.category.findMany({
      where,
      take: options.limit,
      orderBy: {
        name: 'asc',
      },
    });
  }
}

export const categoryRepository = new CategoryRepository();
