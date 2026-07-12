import { OLXAdapter } from '../OLXAdapter';
import {
  MarketplaceHttpClient,
  HttpRequestConfig,
  HttpResponse,
  HttpError,
} from '../MarketplaceHttpClient';
import {
  MarketplaceAuthenticationError,
  MarketplaceNotFoundError,
  MarketplaceRateLimitError,
} from '../MarketplaceError';
import type { ListingPublishInput } from '../../../domain/services/MarketplaceAdapter';

const publishInput: ListingPublishInput = {
  productName: 'Vintage Camera',
  description: 'A well-kept vintage film camera in great condition.',
  price: 349.99,
  currency: 'PLN',
  category: 'electronics',
  condition: 'good',
  imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
};

function mockClient(
  handler: (config: HttpRequestConfig) => HttpResponse | Promise<HttpResponse>,
): MarketplaceHttpClient {
  return { request: jest.fn(handler) as MarketplaceHttpClient['request'] };
}

const fastOptions = { sleep: async () => {}, maxRetries: 2, baseRetryDelayMs: 0 };

describe('OLXAdapter', () => {
  it('maps domain input to the OLX ad payload and returns the external id', async () => {
    let captured: HttpRequestConfig | undefined;
    const http = mockClient((config) => {
      captured = config;
      return { status: 201, data: { id: 'olx-123', status: 'active' } };
    });
    const adapter = new OLXAdapter(http, fastOptions);

    const result = await adapter.publish(publishInput);

    expect(result.externalListingId).toBe('olx-123');
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(captured?.method).toBe('POST');
    expect(captured?.url).toContain('/user/ads');
    const body = captured?.body as Record<string, unknown>;
    expect(body.title).toBe('Vintage Camera');
    expect(body.category_id).toBe(2000); // electronics
    expect((body.params as Record<string, unknown>).condition).toBe('used');
    expect(body.images).toEqual(publishInput.imageUrls);
  });

  it('maps a synced OLX ad to the domain SyncedListing shape', async () => {
    const http = mockClient(() => ({
      status: 200,
      data: {
        id: 'olx-9',
        status: 'active',
        metrics: { views: 42, favorites: 7, messages: 3 },
      },
    }));
    const adapter = new OLXAdapter(http, fastOptions);

    const [synced] = await adapter.sync(['olx-9']);

    expect(synced).toEqual({
      externalListingId: 'olx-9',
      status: 'live',
      views: 42,
      watchers: 7,
      messages: 3,
    });
  });

  it('returns [] for sync with no ids without calling the transport', async () => {
    const request = jest.fn();
    const adapter = new OLXAdapter({ request } as unknown as MarketplaceHttpClient, fastOptions);
    await expect(adapter.sync([])).resolves.toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it('normalizes 401 to MarketplaceAuthenticationError', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(401, 'unauthorized');
      }),
      fastOptions,
    );
    await expect(adapter.publish(publishInput)).rejects.toBeInstanceOf(
      MarketplaceAuthenticationError,
    );
  });

  it('normalizes 404 to MarketplaceNotFoundError', async () => {
    const adapter = new OLXAdapter(
      mockClient(() => {
        throw new HttpError(404, 'missing');
      }),
      fastOptions,
    );
    await expect(adapter.fetchListing('nope')).rejects.toBeInstanceOf(
      MarketplaceNotFoundError,
    );
  });

  it('retries retryable rate-limit failures then succeeds', async () => {
    let calls = 0;
    const http = mockClient(() => {
      calls += 1;
      if (calls < 3) throw new HttpError(429, 'slow down');
      return { status: 201, data: { id: 'olx-ok', status: 'active' } };
    });
    const adapter = new OLXAdapter(http, fastOptions);

    const result = await adapter.publish(publishInput);
    expect(result.externalListingId).toBe('olx-ok');
    expect(calls).toBe(3);
  });

  it('gives up after exhausting retries and throws the rate-limit error', async () => {
    const http = mockClient(() => {
      throw new HttpError(429, 'slow down');
    });
    const adapter = new OLXAdapter(http, { ...fastOptions, maxRetries: 1 });
    await expect(adapter.publish(publishInput)).rejects.toBeInstanceOf(
      MarketplaceRateLimitError,
    );
  });

  it('works against its default stub transport with no injected client', async () => {
    const adapter = new OLXAdapter(undefined, fastOptions);
    const published = await adapter.publish(publishInput);
    expect(published.externalListingId).toMatch(/^olx-/);
    const fetched = await adapter.fetchListing('olx-abc');
    expect(fetched?.status).toBe('live');
  });
});
