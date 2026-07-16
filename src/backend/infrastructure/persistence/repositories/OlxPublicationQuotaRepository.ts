import type { Pool, PoolClient } from 'pg';
import { decideOlxPublication, OlxPublicationQuota } from '../../../domain/entities/OlxPublicationQuota';
import type {
  AuthorizeOlxPublicationInput,
  IOlxPublicationQuotaRepository,
  OlxPublicationAuthorization,
  OlxQuotaLookup,
} from '../../../domain/repositories/interfaces/IOlxPublicationQuotaRepository';

interface OlxQuotaRow {
  id: string;
  workspace_id: string;
  marketplace_id: string;
  marketplace_account_id: string;
  subcategory_id: string;
  cycle_started_at: Date | string;
  cycle_ends_at: Date | string;
  publication_limit: number;
  consumed: number;
  source: 'operator' | 'provider' | 'reconciled';
  confidence: 'verified' | 'estimated';
  verified_at: Date | string;
  stale_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface OlxQuotaOperationRow {
  operation_id: string;
  decision: 'allow' | 'block' | 'override';
  quota_status: 'available' | 'exhausted' | 'stale' | 'unverified' | 'unknown';
  reason: string;
  consumed_unit: boolean;
  quota_id: string | null;
}

const QUOTA_COLUMNS = `id, workspace_id, marketplace_id, marketplace_account_id,
  subcategory_id, cycle_started_at, cycle_ends_at, publication_limit, consumed,
  source, confidence, verified_at, stale_at, created_at, updated_at`;

function toQuota(row: OlxQuotaRow): OlxPublicationQuota {
  const result = OlxPublicationQuota.create({
    id: row.id,
    workspaceId: row.workspace_id,
    marketplaceId: row.marketplace_id,
    marketplaceAccountId: row.marketplace_account_id,
    subcategoryId: row.subcategory_id,
    cycleStartedAt: new Date(row.cycle_started_at),
    cycleEndsAt: new Date(row.cycle_ends_at),
    publicationLimit: Number(row.publication_limit),
    consumed: Number(row.consumed),
    source: row.source,
    confidence: row.confidence,
    verifiedAt: new Date(row.verified_at),
    staleAt: new Date(row.stale_at),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  });
  if (result.isErr()) throw result.error;
  return result.value;
}

export class OlxPublicationQuotaRepository implements IOlxPublicationQuotaRepository {
  constructor(private readonly pool: Pool) {}

  async findCurrent(input: OlxQuotaLookup): Promise<OlxPublicationQuota | null> {
    const result = await this.pool.query<OlxQuotaRow>(
      `SELECT ${QUOTA_COLUMNS}
       FROM olx_publication_quotas
       WHERE workspace_id = $1
         AND marketplace_id = $2
         AND marketplace_account_id = $3
         AND subcategory_id = $4
         AND cycle_started_at <= $5
         AND cycle_ends_at > $5
       ORDER BY cycle_started_at DESC
       LIMIT 1`,
      [
        input.workspaceId,
        input.marketplaceId,
        input.marketplaceAccountId,
        input.subcategoryId,
        input.at,
      ],
    );
    return result.rows[0] ? toQuota(result.rows[0]) : null;
  }

  async findByAccount(input: {
    workspaceId: string;
    marketplaceId: string;
    marketplaceAccountId: string;
    limit: number;
  }): Promise<OlxPublicationQuota[]> {
    const result = await this.pool.query<OlxQuotaRow>(
      `SELECT ${QUOTA_COLUMNS}
       FROM olx_publication_quotas
       WHERE workspace_id = $1 AND marketplace_id = $2 AND marketplace_account_id = $3
       ORDER BY cycle_started_at DESC, subcategory_id ASC
       LIMIT $4`,
      [input.workspaceId, input.marketplaceId, input.marketplaceAccountId, input.limit],
    );
    return result.rows.map(toQuota);
  }

  async save(quota: OlxPublicationQuota): Promise<void> {
    await this.pool.query(
      `INSERT INTO olx_publication_quotas
         (id, workspace_id, marketplace_id, marketplace_account_id, subcategory_id,
          cycle_started_at, cycle_ends_at, publication_limit, consumed, source,
          confidence, verified_at, stale_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (workspace_id, marketplace_account_id, subcategory_id, cycle_started_at)
       DO UPDATE SET
         cycle_ends_at = EXCLUDED.cycle_ends_at,
         publication_limit = EXCLUDED.publication_limit,
         consumed = GREATEST(olx_publication_quotas.consumed, EXCLUDED.consumed),
         source = EXCLUDED.source,
         confidence = EXCLUDED.confidence,
         verified_at = EXCLUDED.verified_at,
         stale_at = EXCLUDED.stale_at,
         updated_at = NOW()`,
      [
        quota.id,
        quota.workspaceId,
        quota.marketplaceId,
        quota.marketplaceAccountId,
        quota.subcategoryId,
        quota.cycleStartedAt,
        quota.cycleEndsAt,
        quota.publicationLimit,
        quota.consumed,
        quota.source,
        quota.confidence,
        quota.verifiedAt,
        quota.staleAt,
        quota.createdAt,
        quota.updatedAt,
      ],
    );
  }

  async authorize(input: AuthorizeOlxPublicationInput): Promise<OlxPublicationAuthorization> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `olx-quota-operation:${input.operationId}`,
      ]);

      const replay = await client.query<OlxQuotaOperationRow>(
        `SELECT operation_id, decision, quota_status, reason, consumed_unit, quota_id
         FROM olx_publication_operations
         WHERE operation_id = $1`,
        [input.operationId],
      );
      if (replay.rows[0] && replay.rows[0].decision !== 'block') {
        const quota = replay.rows[0].quota_id
          ? await this.findQuotaById(client, replay.rows[0].quota_id)
          : null;
        await client.query('COMMIT');
        return {
          operationId: input.operationId,
          decision: replay.rows[0].decision,
          status: replay.rows[0].quota_status,
          reason: replay.rows[0].reason,
          quota,
          consumedUnit: replay.rows[0].consumed_unit,
          replayed: true,
        };
      }

      const quotaResult = await client.query<OlxQuotaRow>(
        `SELECT ${QUOTA_COLUMNS}
         FROM olx_publication_quotas
         WHERE workspace_id = $1
           AND marketplace_id = $2
           AND marketplace_account_id = $3
           AND subcategory_id = $4
           AND cycle_started_at <= $5
           AND cycle_ends_at > $5
         ORDER BY cycle_started_at DESC
         LIMIT 1
         FOR UPDATE`,
        [
          input.workspaceId,
          input.marketplaceId,
          input.marketplaceAccountId,
          input.subcategoryId,
          input.at,
        ],
      );

      let quota = quotaResult.rows[0] ? toQuota(quotaResult.rows[0]) : null;
      const evaluation = quota?.evaluate(input.at);
      const status = evaluation?.status ?? 'unknown';
      const reason = evaluation?.reason ?? 'quota_unknown';
      const { decision } = decideOlxPublication(
        evaluation,
        input.overrideConfirmed,
        quota !== null,
      );

      const consumedUnit = false;

      await client.query(
        `INSERT INTO olx_publication_operations
           (operation_id, workspace_id, marketplace_id, marketplace_account_id, quota_id,
            listing_id, subcategory_id, mode, decision, quota_status, reason,
            consumed_unit, override_reason, actor_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (operation_id) DO UPDATE SET
           quota_id = EXCLUDED.quota_id,
           decision = EXCLUDED.decision,
           quota_status = EXCLUDED.quota_status,
           reason = EXCLUDED.reason,
           consumed_unit = false,
           override_reason = EXCLUDED.override_reason,
           actor_id = EXCLUDED.actor_id,
           created_at = EXCLUDED.created_at
         WHERE olx_publication_operations.consumed_unit = false`,
        [
          input.operationId,
          input.workspaceId,
          input.marketplaceId,
          input.marketplaceAccountId,
          quota?.id ?? null,
          input.listingId,
          input.subcategoryId,
          input.mode,
          decision,
          status,
          reason,
          consumedUnit,
          decision === 'override' ? input.overrideReason ?? null : null,
          input.actorId ?? null,
          input.at,
        ],
      );
      await client.query('COMMIT');
      return {
        operationId: input.operationId,
        decision,
        status,
        reason,
        quota,
        consumedUnit,
        replayed: false,
      };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  async consume(operationId: string, at: Date): Promise<OlxPublicationAuthorization> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `olx-quota-operation:${operationId}`,
      ]);
      const operation = await client.query<OlxQuotaOperationRow>(
        `SELECT operation_id, decision, quota_status, reason, consumed_unit, quota_id
         FROM olx_publication_operations
         WHERE operation_id = $1
         FOR UPDATE`,
        [operationId],
      );
      const row = operation.rows[0];
      if (!row) throw new Error(`OLX quota reservation not found: ${operationId}`);

      let quota: OlxPublicationQuota | null = null;
      if (row.quota_id) {
        const quotaResult = await client.query<OlxQuotaRow>(
          `SELECT ${QUOTA_COLUMNS} FROM olx_publication_quotas WHERE id = $1 FOR UPDATE`,
          [row.quota_id],
        );
        quota = quotaResult.rows[0] ? toQuota(quotaResult.rows[0]) : null;
      }
      if (row.consumed_unit || row.decision === 'block') {
        await client.query('COMMIT');
        return {
          operationId,
          decision: row.decision,
          status: row.quota_status,
          reason: row.reason,
          quota,
          consumedUnit: row.consumed_unit,
          replayed: true,
        };
      }

      const evaluation = quota?.evaluate(at);
      let decision: OlxQuotaOperationRow['decision'] = row.decision;
      const status: OlxQuotaOperationRow['quota_status'] = evaluation?.status ?? 'unknown';
      const reason = evaluation?.reason ?? 'quota_unknown';
      if (decision === 'allow' && !evaluation?.canPublishForFree) decision = 'block';

      let consumedUnit = false;
      if (decision !== 'block' && quota) {
        const updated = await client.query<OlxQuotaRow>(
          `UPDATE olx_publication_quotas
           SET consumed = consumed + 1, updated_at = NOW()
           WHERE id = $1
           RETURNING ${QUOTA_COLUMNS}`,
          [quota.id],
        );
        quota = toQuota(updated.rows[0]);
        consumedUnit = true;
      }
      await client.query(
        `UPDATE olx_publication_operations
         SET decision = $2, quota_status = $3, reason = $4, consumed_unit = $5
         WHERE operation_id = $1`,
        [operationId, decision, status, reason, consumedUnit],
      );
      await client.query('COMMIT');
      return { operationId, decision, status, reason, quota, consumedUnit, replayed: false };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
      throw error;
    } finally {
      client.release();
    }
  }

  private async findQuotaById(client: PoolClient, id: string): Promise<OlxPublicationQuota | null> {
    const result = await client.query<OlxQuotaRow>(
      `SELECT ${QUOTA_COLUMNS} FROM olx_publication_quotas WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toQuota(result.rows[0]) : null;
  }
}
