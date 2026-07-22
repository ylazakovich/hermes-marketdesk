import { AUTONOMY_LEVEL_LIST } from '../../../shared/constants';
import type { HermesGuardrails } from '../../../shared/types';
import type { WorkspacePartialPatch } from '../repositories/interfaces/IWorkspaceRepository';
import { ValidationError } from '../shared/DomainError';

const GUARDRAIL_KEYS: ReadonlyArray<keyof HermesGuardrails> = [
  'maxAutoPriceChangePct',
  'minMarginFloor',
  'autoCreateListings',
  'autoAdjustPricing',
  'autoRelist',
  'smartTitleAndSEO',
];

/** Validates and normalizes repository-level workspace patches before persistence. */
export function normalizeWorkspacePatch<T extends WorkspacePartialPatch>(patch: T): T {
  const normalized: WorkspacePartialPatch = { ...patch };

  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new ValidationError('Workspace name is required');
    normalized.name = name;
  }
  if (patch.currency !== undefined && !/^[A-Z]{3}$/.test(patch.currency)) {
    throw new ValidationError(`Invalid currency code: ${patch.currency}`);
  }
  if (patch.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: patch.timezone }).format();
    } catch {
      throw new ValidationError(`Invalid timezone: ${patch.timezone}`);
    }
  }
  if (patch.language !== undefined && patch.language !== 'en' && patch.language !== 'pl') {
    throw new ValidationError(`Invalid workspace language: ${patch.language}`);
  }
  if (patch.autonomyLevel !== undefined && !AUTONOMY_LEVEL_LIST.includes(patch.autonomyLevel)) {
    throw new ValidationError(`Invalid autonomy level: ${patch.autonomyLevel}`);
  }
  if (patch.creativityPreset !== undefined && !['precise', 'balanced', 'creative'].includes(patch.creativityPreset)) {
    throw new ValidationError(`Invalid Hermes creativity preset: ${patch.creativityPreset}`);
  }
  if (patch.listingSeoEnabled !== undefined && typeof patch.listingSeoEnabled !== 'boolean') {
    throw new ValidationError('listingSeoEnabled must be a boolean');
  }

  if (patch.guardrails !== undefined) {
    const unknown = Object.keys(patch.guardrails).filter(
      (key) => !GUARDRAIL_KEYS.includes(key as keyof HermesGuardrails)
    );
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown Hermes guardrail: ${unknown[0]}`);
    }

    for (const key of ['maxAutoPriceChangePct', 'minMarginFloor'] as const) {
      const value = patch.guardrails[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100)) {
        throw new ValidationError(`${key} must be within [0, 100]`);
      }
    }
    for (const key of [
      'autoCreateListings',
      'autoAdjustPricing',
      'autoRelist',
      'smartTitleAndSEO',
    ] as const) {
      const value = patch.guardrails[key];
      if (value !== undefined && typeof value !== 'boolean') {
        throw new ValidationError(`${key} must be a boolean`);
      }
    }
    normalized.guardrails = { ...patch.guardrails };
  }

  return normalized as T;
}
