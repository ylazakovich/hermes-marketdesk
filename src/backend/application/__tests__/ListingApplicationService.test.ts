import { ListingApplicationService } from '../services/ListingApplicationService';
import {
  InMemoryListingRepository,
  InMemoryProductRepository,
  money,
  unwrap,
} from '../../domain/testkit/support';
import { Product } from '../../domain/entities/Product';
import { Listing } from '../../domain/entities/Listing';
import type { PublishListingUseCase } from '../usecases/PublishListingUseCase';
import type { SyncMarketplaceUseCase } from '../usecases/SyncMarketplaceUseCase';

function setup() {
  const productRepo = new InMemoryProductRepository();
  const listingRepo = new InMemoryListingRepository();
  const service = new ListingApplicationService(
    listingRepo,
    {} as PublishListingUseCase,
    {} as SyncMarketplaceUseCase,
    productRepo,
  );
  return { service, productRepo, listingRepo };
}

describe('ListingApplicationService', () => {
  it('enriches workspace listing rows with product title and SKU', async () => {
    const { service, productRepo, listingRepo } = setup();
    const product = unwrap(
      Product.create({
        id: 'product-1',
        workspaceId: 'ws-1',
        sku: 'AIRPODS4-PL-001',
        name: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
        description: 'AirPods in good condition with all required details.',
        costPrice: money(250),
        sellingPrice: money(399),
        condition: 'good',
        category: 'audio',
      }),
    );
    productRepo.items.set(product.id, product);
    const listing = unwrap(
      Listing.create({
        id: 'listing-1',
        productId: product.id,
        marketplaceId: 'marketplace-olx',
        marketplaceListingId: '1085426829',
        price: money(399),
        status: 'live',
      }),
    );
    listingRepo.items.set(listing.id, listing);
    listingRepo.listingWorkspaces.set(listing.id, 'ws-1');

    const page = await service.listByWorkspace('ws-1');

    expect(page.items).toEqual([
      expect.objectContaining({
        id: 'listing-1',
        productId: 'product-1',
        productName: 'Apple AirPods 4 MXP63ZM/A bez ANC — bardzo dobry stan',
        productSku: 'AIRPODS4-PL-001',
      }),
    ]);
  });
});
