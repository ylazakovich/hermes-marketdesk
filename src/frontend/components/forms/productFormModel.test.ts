import {
  belowCostConfirmationRequired,
  emptyProductValues,
  marginWarning,
  productToValues,
  toProductSubmissionValues,
  validateProductValues,
} from './productFormModel';

function validValues() {
  return {
    ...emptyProductValues(),
    name: 'AirPods 4',
    sku: 'AIRPODS4-PL-001',
    description: 'AirPods in good condition with all required details.',
    costPrice: 649,
    sellingPrice: 399,
    category: 'electronics',
  };
}

describe('productFormModel below-cost pricing', () => {
  it('keeps below-cost pricing as a warning instead of a validation error', () => {
    const values = validValues();

    expect(validateProductValues(values)).toEqual({});
    expect(marginWarning(values)).toContain('250');
    expect(marginWarning(values)).toContain('-62.7% margin');
  });

  it('marks below-cost submissions with the documented API flag', () => {
    expect(belowCostConfirmationRequired(validValues(), false)).toBe(true);
    expect(belowCostConfirmationRequired(validValues(), true)).toBe(false);
    expect(toProductSubmissionValues(validValues()).allowBelowCost).toBe(true);
  });

  it('does not require confirmation at or above the cost boundary', () => {
    expect(belowCostConfirmationRequired({ ...validValues(), sellingPrice: 649 }, false)).toBe(
      false
    );
    expect(
      belowCostConfirmationRequired({ ...validValues(), costPrice: 0, sellingPrice: 0 }, false)
    ).toBe(false);
  });

  it('warns and marks zero-price submissions when cost is positive', () => {
    const values = { ...validValues(), sellingPrice: 0 };

    expect(validateProductValues(values)).toEqual({});
    expect(marginWarning(values)).toContain('649');
    expect(marginWarning(values)).toContain('zero selling price');
    expect(toProductSubmissionValues(values).allowBelowCost).toBe(true);
  });

  it('preserves blank imported cost prices through edit submission', () => {
    const values = productToValues({
      id: 'product-1',
      workspaceId: 'workspace-1',
      sku: 'OLX-workspace-1-olx-1',
      name: 'Imported camera',
      description: 'Imported description with enough detail.',
      costPrice: null,
      sellingPrice: 100,
      condition: 'unknown',
      category: 'Electronics',
      status: 'active',
      tags: [],
      images: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    expect(values.costPrice).toBeNull();
    expect(validateProductValues(values)).toEqual({});
    expect(toProductSubmissionValues(values).costPrice).toBeNull();
  });
});
