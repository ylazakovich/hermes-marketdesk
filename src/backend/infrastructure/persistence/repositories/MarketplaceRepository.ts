import type { PoolClient } from 'pg';
import { query } from '../../../config/database';
import type { IMarketplaceRepository } from '../../../domain/repositories/interfaces/IMarketplaceRepository';
import type { Marketplace } from '../../../domain/entities/Marketplace';
import type { MarketplaceKey } from '../../../../shared/types';
import { MarketplaceMapper } from '../mappers/MarketplaceMapper';
import type { MarketplaceRow } from '../mappers/rows';

const MARKETPLACE_SELECT = `
  SELECT id, workspace_id, key, name, connected, sync_mode, last_sync_at,
         error_count, capacity, created_at
  FROM marketplaces
`;

export class MarketplaceRepository implements IMarketplaceRepository {
  constructor(private readonly client?: PoolClient) {}

  async findById(id: string): Promise<Marketplace | null> {
    const { rows } = await query<MarketplaceRow>(
      `${MARKETPLACE_SELECT} WHERE id = $1`,
      [id],
      this.client,
    );
    const row = rows[0];
    return row ? MarketplaceMapper.toDomain(row) : null;
  }

  async findByIdForWorkspace(
    id: string,
    workspaceId: string,
  ): Promise<Marketplace | null> {
    const { rows } = await query<MarketplaceRow>(
      `${MARKETPLACE_SELECT} WHERE id = $1 AND workspace_id = $2`,
      [id, workspaceId],
      this.client,
    );
    const row = rows[0];
    return row ? MarketplaceMapper.toDomain(row) : null;
  }

  async findByWorkspace(workspaceId: string): Promise<Marketplace[]> {
    const { rows } = await query<MarketplaceRow>(
      `${MARKETPLACE_SELECT} WHERE workspace_id = $1 ORDER BY created_at ASC`,
      [workspaceId],
      this.client,
    );
    return rows.map((row) => MarketplaceMapper.toDomain(row));
  }

  async findConnected(workspaceId: string): Promise<Marketplace[]> {
    const { rows } = await query<MarketplaceRow>(
      `${MARKETPLACE_SELECT} WHERE workspace_id = $1 AND connected = TRUE ORDER BY created_at ASC`,
      [workspaceId],
      this.client,
    );
    return rows.map((row) => MarketplaceMapper.toDomain(row));
  }

  async findByKey(
    workspaceId: string,
    key: MarketplaceKey,
  ): Promise<Marketplace | null> {
    const { rows } = await query<MarketplaceRow>(
      `${MARKETPLACE_SELECT} WHERE workspace_id = $1 AND key = $2`,
      [workspaceId, key],
      this.client,
    );
    const row = rows[0];
    return row ? MarketplaceMapper.toDomain(row) : null;
  }

  async save(marketplace: Marketplace): Promise<void> {
    await query(
      `INSERT INTO marketplaces
         (id, workspace_id, key, name, connected, sync_mode, last_sync_at,
          error_count, capacity, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         connected = EXCLUDED.connected,
         sync_mode = EXCLUDED.sync_mode,
         last_sync_at = EXCLUDED.last_sync_at,
         error_count = EXCLUDED.error_count,
         capacity = EXCLUDED.capacity`,
      [
        marketplace.id,
        marketplace.workspaceId,
        marketplace.key,
        marketplace.name,
        marketplace.isConnected(),
        marketplace.syncMode,
        marketplace.lastSyncAt,
        marketplace.errorCount,
        marketplace.capacity,
        marketplace.createdAt,
      ],
      this.client,
    );
  }

  async delete(id: string): Promise<void> {
    await query(`DELETE FROM marketplaces WHERE id = $1`, [id], this.client);
  }
}
