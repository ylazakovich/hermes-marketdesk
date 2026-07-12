import {
  SyncMarketplaceHandler,
  MarketplaceAdapterResolver,
} from '../JobHandlers/SyncMarketplaceHandler';
import { PublishListingHandler } from '../JobHandlers/PublishListingHandler';
import { HermesRunHandler, HermesEngine } from '../JobHandlers/HermesRunHandler';
import type {
  IMarketplaceAdapter,
  PublishResult,
  SyncedListing,
} from '../../../domain/services/MarketplaceAdapter';
import type { DomainEvent, IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { MarketplaceKey } from '../../../../shared/types';
import { Listing } from '../../../domain/entities/Listing';
import { Marketplace } from '../../../domain/entities/Marketplace';
import { Ok, Err } from '../../../domain/shared/Result';
import { NotFoundError } from '../../../domain/shared/DomainError';
import { unwrap, money } from '../../../domain/testkit/support';

function fakeAdapter(overrides: Partial<IMarketplaceAdapter> = {}): IMarketplaceAdapter {
  return {
    getKey: () => 'olx',
    publish: jest.fn(),
    updateListing: jest.fn(),
    delist: jest.fn(),
    sync: jest.fn(),
    fetchListing: jest.fn(),
    ...overrides,
  } as IMarketplaceAdapter;
}

function resolverFor(adapter: IMarketplaceAdapter): {
  resolver: MarketplaceAdapterResolver;
  create: jest.Mock;
} {
  const create = jest.fn((_key: MarketplaceKey) => adapter);
  return { resolver: { create }, create };
}

describe('SyncMarketplaceHandler', () => {
  it('resolves the adapter by key and returns its sync results', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'olx-1', status: 'live', views: 5, watchers: 1, messages: 0 },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver, create } = resolverFor(adapter);
    const handler = new SyncMarketplaceHandler(resolver);

    const result = await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['olx-1'],
    });

    expect(create).toHaveBeenCalledWith('olx');
    expect(adapter.sync).toHaveBeenCalledWith(['olx-1']);
    // No persistence stores injected -> nothing persisted.
    expect(result).toMatchObject({
      marketplaceKey: 'olx',
      synced,
      persisted: 0,
      marketplaceUpdated: false,
    });
  });

  it('persists fetched stats onto listings and records the marketplace sync (C5)', async () => {
    const synced: SyncedListing[] = [
      { externalListingId: 'ext-1', status: 'live', views: 42, watchers: 3, messages: 2 },
    ];
    const adapter = fakeAdapter({ sync: jest.fn(async () => synced) });
    const { resolver } = resolverFor(adapter);

    const listing = unwrap(
      Listing.create({
        id: 'l-1',
        productId: 'p-1',
        marketplaceId: 'm-1',
        price: money(50),
        status: 'live',
        marketplaceListingId: 'ext-1',
        publishedAt: new Date(),
      }),
    );
    const saved: Listing[] = [];
    const listingStore = {
      findByMarketplace: jest.fn(async () => [listing]),
      saveAll: jest.fn(async (ls: Listing[]) => {
        saved.push(...ls);
      }),
    };

    const marketplace = unwrap(
      Marketplace.create({ id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX' }),
    );
    marketplace.recordSyncError(); // errorCount = 1 so success reset is observable
    const marketplaceStore = {
      findById: jest.fn(async () => marketplace),
      save: jest.fn(async () => undefined),
    };

    const handler = new SyncMarketplaceHandler(resolver, {
      listingStore,
      marketplaceStore,
    });

    const result = await handler.handle({
      marketplaceKey: 'olx',
      marketplaceId: 'm-1',
      externalListingIds: ['ext-1'],
    });

    expect(result.persisted).toBe(1);
    expect(result.marketplaceUpdated).toBe(true);
    expect(saved[0].views).toBe(42);
    expect(saved[0].watchers).toBe(3);
    expect(saved[0].lastSyncAt).not.toBeNull();
    expect(marketplaceStore.save).toHaveBeenCalled();
    expect(marketplace.errorCount).toBe(0); // reset on success
    expect(marketplace.lastSyncAt).not.toBeNull();
  });

  it('records a marketplace sync error and rethrows when the adapter fails (C5)', async () => {
    const adapter = fakeAdapter({
      sync: jest.fn(async () => {
        throw new Error('adapter down');
      }),
    });
    const { resolver } = resolverFor(adapter);
    const marketplace = unwrap(
      Marketplace.create({ id: 'm-1', workspaceId: 'w-1', key: 'olx', name: 'OLX' }),
    );
    const marketplaceStore = {
      findById: jest.fn(async () => marketplace),
      save: jest.fn(async () => undefined),
    };
    const handler = new SyncMarketplaceHandler(resolver, { marketplaceStore });

    await expect(
      handler.handle({ marketplaceKey: 'olx', marketplaceId: 'm-1', externalListingIds: [] }),
    ).rejects.toThrow('adapter down');
    expect(marketplace.errorCount).toBe(1);
    expect(marketplaceStore.save).toHaveBeenCalled();
  });
});

describe('PublishListingHandler', () => {
  const publishResult: PublishResult = {
    externalListingId: 'olx-99',
    publishedAt: new Date('2026-07-11T00:00:00.000Z'),
  };
  const input = {
    productName: 'Widget',
    description: 'A perfectly adequate widget for testing purposes.',
    price: 49.99,
    currency: 'PLN',
    category: 'electronics',
    condition: 'new',
    imageUrls: [],
  };

  it('publishes via the adapter and emits a listing.published event', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const handler = new PublishListingHandler(resolver, events);

    const result = await handler.handle({
      marketplaceKey: 'olx',
      listingId: 'l-1',
      input,
    });

    expect(adapter.publish).toHaveBeenCalledWith(input);
    expect(result.result).toEqual(publishResult);
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('listing.published');
    expect(published[0].aggregateId).toBe('l-1');
    expect(published[0].payload).toMatchObject({ externalListingId: 'olx-99' });
  });

  it('works without an event publisher', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const handler = new PublishListingHandler(resolver);
    await expect(
      handler.handle({ marketplaceKey: 'olx', listingId: 'l-2', input }),
    ).resolves.toMatchObject({ listingId: 'l-2', finalized: false });
  });

  it('finalizes the listing via the injected finalizer and defers the event to it', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const publishListing = jest.fn(async () => Ok({} as unknown as Listing));
    const handler = new PublishListingHandler(resolver, events, { publishListing });

    const result = await handler.handle({
      marketplaceKey: 'olx',
      listingId: 'l-3',
      input,
    });

    // The listing was finalized with the adapter-returned external id + timestamp.
    expect(publishListing).toHaveBeenCalledWith(
      'l-3',
      'olx-99',
      publishResult.publishedAt,
    );
    expect(result.finalized).toBe(true);
    // The handler must NOT double-emit; the finalizer owns the canonical event.
    expect(published).toHaveLength(0);
  });

  it('falls back to emitting the event when finalization fails', async () => {
    const adapter = fakeAdapter({ publish: jest.fn(async () => publishResult) });
    const { resolver } = resolverFor(adapter);
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const publishListing = jest.fn(async () =>
      Err(new NotFoundError('Listing not found: l-4')),
    );
    const handler = new PublishListingHandler(resolver, events, { publishListing });

    const result = await handler.handle({
      marketplaceKey: 'olx',
      listingId: 'l-4',
      input,
    });

    expect(result.finalized).toBe(false);
    expect(published).toHaveLength(1);
    expect(published[0].type).toBe('listing.published');
  });
});

describe('HermesRunHandler', () => {
  it('runs the injected engine and emits a completion event', async () => {
    const engine: HermesEngine = {
      run: jest.fn(async () => ({ workspaceId: 'w-1', eventsGenerated: 3 })),
    };
    const published: DomainEvent[] = [];
    const events: IEventPublisher = {
      publish: async (e) => {
        published.push(e);
      },
    };
    const handler = new HermesRunHandler(engine, events);

    const result = await handler.handle({ workspaceId: 'w-1', trigger: 'manual' });

    expect(engine.run).toHaveBeenCalledWith({ workspaceId: 'w-1', trigger: 'manual' });
    expect(result.eventsGenerated).toBe(3);
    expect(published[0].type).toBe('hermes.run.completed');
    expect(published[0].payload).toMatchObject({ eventsGenerated: 3, trigger: 'manual' });
  });
});
