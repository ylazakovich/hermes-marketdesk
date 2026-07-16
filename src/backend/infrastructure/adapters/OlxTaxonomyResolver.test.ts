import type { MarketplaceHttpClient } from './MarketplaceHttpClient';
import { OlxTaxonomyResolver } from './OlxTaxonomyResolver';

function client(data: unknown): MarketplaceHttpClient {
  return { request: jest.fn(async () => ({ status: 200, data })) };
}

describe('OlxTaxonomyResolver', () => {
  const now = new Date('2026-07-16T12:00:00.000Z');

  it('attests an exact leaf category from the provider response', async () => {
    const http = client({
      id: 2000,
      name: 'Projectors',
      path: ['Electronics', 'TV and video', 'Projectors'],
      leaf: true,
    });
    const resolver = new OlxTaxonomyResolver(http, 'https://example.test/api', () => now);

    await expect(resolver.verify('2000')).resolves.toEqual({
      providerCategoryId: '2000',
      name: 'Projectors',
      path: ['Electronics', 'TV and video', 'Projectors'],
      source: 'provider_taxonomy',
      confidence: 1,
      isLeaf: true,
      taxonomyVerifiedAt: now.toISOString(),
      taxonomyStaleAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(http.request).toHaveBeenCalledWith({
      method: 'GET',
      url: 'https://example.test/api/categories/2000',
    });
  });

  it.each([
    ['a client-supplied non-numeric id', 'projectors', { id: 2000, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a mismatched provider id', '2000', { id: 9999, name: 'Projectors', path: ['Electronics', 'Projectors'], leaf: true }],
    ['a non-leaf category', '2000', { id: 2000, name: 'Video', path: ['Electronics', 'Video'], leaf: false }],
    ['an incomplete path', '2000', { id: 2000, name: 'Projectors', leaf: true }],
  ])('rejects %s', async (_label, id, response) => {
    const resolver = new OlxTaxonomyResolver(client(response), undefined, () => now);
    await expect(resolver.verify(id)).rejects.toThrow();
  });
});
