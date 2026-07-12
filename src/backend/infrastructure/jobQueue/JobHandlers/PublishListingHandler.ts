// Job handler: publish a listing to a marketplace via the appropriate adapter,
// then finalize the listing in the DB (status -> live, marketplaceListingId set,
// publishedAt recorded) via the injected listing finalizer. Depends only on injected
// interfaces (adapter resolver, IEventPublisher, ListingFinalizer) — no concrete
// application services.

import type {
  ListingPublishInput,
  PublishResult,
} from '../../../domain/services/MarketplaceAdapter';
import type { MarketplaceKey } from '../../../../shared/types';
import type { IEventPublisher } from '../../../domain/ports/IEventPublisher';
import type { Result } from '../../../domain/shared/Result';
import type { Listing } from '../../../domain/entities/Listing';
import type { MarketplaceAdapterResolver } from './SyncMarketplaceHandler';

export interface PublishListingJobData {
  marketplaceKey: MarketplaceKey;
  // Internal listing id, carried for event correlation.
  listingId: string;
  input: ListingPublishInput;
}

export interface PublishListingResult {
  marketplaceKey: MarketplaceKey;
  listingId: string;
  result: PublishResult;
  // Whether the listing aggregate was finalized (persisted live) in the DB.
  finalized: boolean;
}

// Structural port for finalizing a listing after a successful marketplace publish.
// Satisfied by the domain ListingService (which persists the listing and emits the
// canonical `listing.published` event) without importing the concrete class here.
export interface ListingFinalizer {
  publishListing(
    listingId: string,
    externalListingId: string,
    publishedAt?: Date,
    expiresAt?: Date | null,
  ): Promise<Result<Listing>>;
}

export class PublishListingHandler {
  constructor(
    private readonly adapters: MarketplaceAdapterResolver,
    private readonly events?: IEventPublisher,
    private readonly listings?: ListingFinalizer,
  ) {}

  async handle(data: PublishListingJobData): Promise<PublishListingResult> {
    const adapter = this.adapters.create(data.marketplaceKey);
    const result = await adapter.publish(data.input);

    // Finalize the listing in the DB when a finalizer is wired: status -> live,
    // marketplaceListingId set, publishedAt recorded. ListingService.publishListing
    // persists the aggregate and emits the canonical `listing.published` event.
    let finalized = false;
    if (this.listings) {
      const finalizeResult = await this.listings.publishListing(
        data.listingId,
        result.externalListingId,
        result.publishedAt,
      );
      finalized = finalizeResult.isOk();
    }

    // Emit a fallback event only when the finalizer did not run or failed (the
    // finalizer emits its own richer `listing.published`), so consumers still see
    // exactly one publish signal.
    if (this.events && !finalized) {
      await this.events.publish({
        type: 'listing.published',
        aggregateType: 'listing',
        aggregateId: data.listingId,
        payload: {
          marketplaceKey: data.marketplaceKey,
          externalListingId: result.externalListingId,
        },
        occurredAt: new Date(),
      });
    }

    return {
      marketplaceKey: data.marketplaceKey,
      listingId: data.listingId,
      result,
      finalized,
    };
  }
}
