import { categoryRepository } from './category.repository.js';
import { ConflictError, NotFoundError } from '../../shared/errors/app-error.js';

export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // remove non-word, non-space, non-hyphen chars
    .replace(/[\s_]+/g, '-')    // replace spaces/underscores with hyphens
    .replace(/-+/g, '-')       // collapse consecutive hyphens
    .replace(/^-+|-+$/g, '');  // trim leading/trailing hyphens
}

export class CategoryService {
  async createCategory(data: { name: string; slug?: string; description?: string | null }) {
    // Generate or format slug
    const slug = data.slug ? data.slug.toLowerCase().trim() : generateSlug(data.name);

    // Case-insensitive uniqueness check on name
    const existingByName = await categoryRepository.findByName(data.name);
    if (existingByName) {
      throw new ConflictError(
        `Category with name "${data.name}" already exists.`,
        'CATEGORY_NAME_CONFLICT'
      );
    }

    // Lowercase slug uniqueness check
    const existingBySlug = await categoryRepository.findBySlug(slug);
    if (existingBySlug) {
      throw new ConflictError(
        `Category with slug "${slug}" already exists.`,
        'CATEGORY_SLUG_CONFLICT'
      );
    }

    return categoryRepository.create({
      name: data.name,
      slug,
      description: data.description,
    });
  }

  async updateCategory(
    id: string,
    data: { name?: string; slug?: string; description?: string | null }
  ) {
    const existingCategory = await categoryRepository.findById(id);
    if (!existingCategory) {
      throw new NotFoundError('Category not found.');
    }

    const updateData: { name?: string; slug?: string; description?: string | null } = {};

    if (data.name !== undefined && data.name !== existingCategory.name) {
      const existingByName = await categoryRepository.findByName(data.name);
      if (existingByName && existingByName.id !== id) {
        throw new ConflictError(
          `Category with name "${data.name}" already exists.`,
          'CATEGORY_NAME_CONFLICT'
        );
      }
      updateData.name = data.name;
    }

    if (data.slug !== undefined && data.slug !== existingCategory.slug) {
      const slug = data.slug.toLowerCase().trim();
      const existingBySlug = await categoryRepository.findBySlug(slug);
      if (existingBySlug && existingBySlug.id !== id) {
        throw new ConflictError(
          `Category with slug "${slug}" already exists.`,
          'CATEGORY_SLUG_CONFLICT'
        );
      }
      updateData.slug = slug;
    }

    if (data.description !== undefined) {
      updateData.description = data.description;
    }

    // If nothing has changed, just return the existing category
    if (Object.keys(updateData).length === 0) {
      return existingCategory;
    }

    return categoryRepository.update(id, updateData);
  }

  async toggleCategoryStatus(id: string, isActive: boolean) {
    const existingCategory = await categoryRepository.findById(id);
    if (!existingCategory) {
      throw new NotFoundError('Category not found.');
    }

    return categoryRepository.updateStatus(id, isActive);
  }

  async getActiveCategories(options: { search?: string; limit?: number }) {
    return categoryRepository.findActive(options);
  }
}

export const categoryService = new CategoryService();
