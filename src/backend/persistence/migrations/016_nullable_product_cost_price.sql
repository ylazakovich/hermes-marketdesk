-- Migration 016: allow imported products to represent unknown seller cost explicitly.
ALTER TABLE products ALTER COLUMN cost_price DROP NOT NULL;
