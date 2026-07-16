import type { HermesEvent } from '../../entities/HermesEvent';
import type { HermesEventStatus } from '../../../../shared/types';

export interface IEventRepository {
  findById(id: string): Promise<HermesEvent | null>;
  // Tenant-scoped read. Null when the event belongs to another workspace (S2).
  findByIdForWorkspace(id: string, workspaceId: string): Promise<HermesEvent | null>;
  findByWorkspace(workspaceId: string): Promise<HermesEvent[]>;
  findByStatus(workspaceId: string, status: HermesEventStatus): Promise<HermesEvent[]>;
  findPendingReview(workspaceId: string): Promise<HermesEvent[]>;
  save(event: HermesEvent): Promise<void>;
  /** Atomically inserts a semantic recommendation once. */
  saveRecommendationIfAbsent(event: HermesEvent, idempotencyKey: string): Promise<boolean>;
  saveAll(events: HermesEvent[]): Promise<void>;
  deleteOlderThan(cutoff: Date): Promise<void>;
}
