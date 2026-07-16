// Input DTO for creating a product. Plain transport shape validated at the
// application boundary (ProductValidator) before being turned into a domain command.

import type { ProductCondition } from '../../../shared/types';

export interface CreateProductDTO {
  workspaceId: string;
  sku: string;
  name: string;
  description: string;
  costPrice: number;
  sellingPrice: number;
  // ISO-4217 currency. When omitted, the workspace currency is used.
  currency?: string;
  condition: ProductCondition;
  category: string;
  tags?: string[];
  images?: string[];
  // Explicit confirmation required when sellingPrice < costPrice.
  allowBelowCost?: boolean;
}
