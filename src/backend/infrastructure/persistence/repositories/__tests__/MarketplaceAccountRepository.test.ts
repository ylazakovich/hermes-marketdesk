import type { Pool } from 'pg';
import {
  MarketplaceAccountMapper,
  MarketplaceAccountRepository,
  type MarketplaceAccountRow,
} from '../MarketplaceAccountRepository';

describe('MarketplaceAccountRepository', () => {
  const row: MarketplaceAccountRow = {
    id: 'account-1',
    marketplace_id: 'marketplace-1',
    handle: 'OLX account',
    credentials: { version: 1, ciphertext: 'encrypted' },
    status: 'connected',
    scopes: ['basic'],
    created_at: '2026-07-14T12:00:00.000Z',
    updated_at: '2026-07-14T12:01:00.000Z',
  };

  it('maps persistence rows without changing the encrypted credential envelope', () => {
    const account = MarketplaceAccountMapper.toRecord(row);
    expect(account.marketplaceId).toBe('marketplace-1');
    expect(account.credentials).toEqual({ version: 1, ciphertext: 'encrypted' });
    expect(account.createdAt).toEqual(new Date('2026-07-14T12:00:00.000Z'));
  });

  it('upserts by marketplace_id so a marketplace has one active OAuth account', async () => {
    const query = jest.fn(async () => ({ rows: [row], rowCount: 1 }));
    const repo = new MarketplaceAccountRepository({ query } as unknown as Pool);

    await repo.upsert({
      id: 'account-1',
      marketplaceId: 'marketplace-1',
      handle: 'OLX account',
      credentials: { version: 1, ciphertext: 'encrypted' },
      status: 'connected',
      scopes: ['basic'],
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(String(query.mock.calls[0][0])).toContain('ON CONFLICT (marketplace_id)');
    expect(query.mock.calls[0][1]).toEqual([
      'account-1',
      'marketplace-1',
      'OLX account',
      JSON.stringify({ version: 1, ciphertext: 'encrypted' }),
      'connected',
      ['basic'],
    ]);
  });
});
