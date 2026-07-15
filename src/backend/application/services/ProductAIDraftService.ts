import type {
  ProductAIDraft,
  ProductAIDraftRequest,
  ProductCondition,
  ProductStatus,
} from '../../../shared/types';
import { ValidationError } from '../../domain/shared/DomainError';
import { Err, Ok, type Result } from '../../domain/shared/Result';

const DESCRIPTION_FALLBACK =
  'AI draft placeholder. Review details, add exact dimensions, defects, accessories, and final marketplace-specific wording before publishing.';

function normalizeText(value: string | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ');
}

function slugSku(title: string): string {
  const slug = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  return slug ? `AI-${slug}` : 'AI-DRAFT';
}

function uniqueStrings(values: string[] | undefined): string[] {
  return Array.from(
    new Set((values ?? []).map((value) => value.trim()).filter((value) => value.length > 0)),
  );
}

function safeCondition(value: ProductCondition | undefined): ProductCondition {
  return value ?? 'unknown';
}

function safeStatus(value: ProductStatus | undefined): ProductStatus {
  return value ?? 'draft';
}

export class ProductAIDraftService {
  async generateDraft(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    if (!input.workspaceId) {
      return Err(new ValidationError('Workspace is required for AI draft generation'));
    }

    if (input.mode === 'title') return this.fromTitle(input);
    if (input.mode === 'photos') return this.fromPhotos(input);

    return Err(new ValidationError('Unsupported AI product draft mode'));
  }

  private async fromTitle(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    const title = normalizeText(input.title ?? input.existingFields?.name);
    if (!title) return Err(new ValidationError('Title is required to generate a product draft'));

    const existing = input.existingFields ?? {};
    const tags = uniqueStrings([...(existing.tags ?? []), ...title.toLowerCase().split(' ').slice(0, 4)]);
    const fields = {
      name: title,
      sku: existing.sku?.trim() || slugSku(title),
      description:
        normalizeText(existing.description) ||
        `${title}. ${DESCRIPTION_FALLBACK}`,
      costPrice: existing.costPrice ?? 0,
      sellingPrice: existing.sellingPrice ?? 0,
      condition: safeCondition(existing.condition),
      category: normalizeText(existing.category) || 'uncategorised',
      status: safeStatus(existing.status),
      tags,
      images: uniqueStrings(existing.images),
    };

    return Ok({
      mode: 'title',
      fields,
      confidence: 0.54,
      uncertainFields: ['category', 'condition', 'sellingPrice'],
      missingInfoQuestions: [
        'What is the real condition and are there visible defects?',
        'What selling price and category should be used for the target marketplace?',
        'Are accessories, dimensions, warranty, or pickup/shipping details relevant?',
      ],
      notes: [
        'Title was preserved and used as the anchor for the generated copy.',
        'This is a review draft only; publishing still requires the normal confirmation flow.',
      ],
    });
  }

  private async fromPhotos(
    input: ProductAIDraftRequest & { workspaceId: string },
  ): Promise<Result<ProductAIDraft>> {
    const imageUrls = uniqueStrings(input.imageUrls ?? input.existingFields?.images);
    if (imageUrls.length === 0) {
      return Err(new ValidationError('At least one product photo URL is required'));
    }

    const existing = input.existingFields ?? {};
    const title = normalizeText(input.title ?? existing.name) || 'Product from photos';
    const fields = {
      name: title,
      sku: existing.sku?.trim() || slugSku(title),
      description:
        normalizeText(existing.description) ||
        `${title}. ${DESCRIPTION_FALLBACK}`,
      costPrice: existing.costPrice ?? 0,
      sellingPrice: existing.sellingPrice ?? 0,
      condition: safeCondition(existing.condition),
      category: normalizeText(existing.category) || 'needs-review',
      status: safeStatus(existing.status),
      tags: uniqueStrings([...(existing.tags ?? []), 'photo-draft', 'needs-review']),
      images: imageUrls,
    };

    return Ok({
      mode: 'photos',
      fields,
      confidence: 0.46,
      uncertainFields: ['name', 'category', 'condition', 'sellingPrice'],
      missingInfoQuestions: [
        'What exact brand/model is shown in the photos?',
        'Are there defects, missing parts, dimensions, or accessories not visible in the photos?',
        'What target price should be used before creating marketplace listings?',
      ],
      notes: [
        'Photo-first draft keeps uploaded image URLs and marks inferred fields as uncertain.',
        'The draft is not saved or published until the user applies it and creates the product.',
      ],
    });
  }
}
