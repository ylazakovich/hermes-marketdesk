-- Product-scoped MarketDesk agent settings and durable recommendation provenance.
ALTER TABLE workspaces
  ADD COLUMN IF NOT EXISTS hermes_creativity_preset VARCHAR(20) NOT NULL DEFAULT 'balanced',
  ADD COLUMN IF NOT EXISTS listing_seo_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_hermes_creativity_preset_valid') THEN
    ALTER TABLE workspaces ADD CONSTRAINT workspaces_hermes_creativity_preset_valid
      CHECK (hermes_creativity_preset IN ('precise', 'balanced', 'creative'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hermes_agent_recommendations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  event_id UUID REFERENCES hermes_events(id) ON DELETE SET NULL,
  agent_id VARCHAR(80) NOT NULL,
  agent_version VARCHAR(40) NOT NULL,
  creativity_preset VARCHAR(20) NOT NULL,
  source_fingerprint CHAR(64) NOT NULL,
  recommendation_fingerprint CHAR(64) NOT NULL,
  outcome VARCHAR(20) NOT NULL,
  suggested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,
  applied_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  metrics JSONB,
  metrics_provider VARCHAR(40),
  metrics_observed_at TIMESTAMPTZ,
  metrics_fresh_through TIMESTAMPTZ,
  CONSTRAINT hermes_agent_recommendations_creativity_valid CHECK (creativity_preset IN ('precise', 'balanced', 'creative')),
  CONSTRAINT hermes_agent_recommendations_agent_valid CHECK (agent_id = 'listing-seo'),
  CONSTRAINT hermes_agent_recommendations_outcome_valid CHECK (outcome IN ('suggested', 'suppressed', 'failed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_hermes_agent_recommendations_event
  ON hermes_agent_recommendations(workspace_id, event_id) WHERE event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_hermes_agent_recommendation_dedup
  ON hermes_agent_recommendations(workspace_id, product_id, agent_id, agent_version, source_fingerprint, recommendation_fingerprint, suggested_at DESC);
