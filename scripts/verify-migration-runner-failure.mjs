#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const runner = resolve('dist/backend/migrate.js');
const sentinel = 'migration-url-secret-sentinel';
const malformedUrl = `postgresql://marketdesk:${sentinel}@[invalid-host/marketdesk`;
const probeEnvironment = {
  ...process.env,
  NODE_ENV: 'production',
  DB_SSL_MODE: 'verify-full',
  DATABASE_URL: malformedUrl,
  DB_PASSWORD: sentinel,
};

const failure = spawnSync(process.execPath, [runner], {
  env: probeEnvironment,
  encoding: 'utf8',
});
const failureOutput = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`;
assert.equal(failure.status, 1, 'malformed migration configuration must exit non-zero');
assert.match(failureOutput, /Migration failed/);
assert.doesNotMatch(failureOutput, new RegExp(sentinel));
assert.doesNotMatch(failureOutput, /postgresql:\/\/marketdesk:/);

const moduleUrl = pathToFileURL(runner).href;
const imported = spawnSync(
  process.execPath,
  ['--input-type=module', '--eval', `await import(${JSON.stringify(moduleUrl)}); console.log('IMPORT_ONLY_OK');`],
  { env: probeEnvironment, encoding: 'utf8' },
);
const importOutput = `${imported.stdout ?? ''}\n${imported.stderr ?? ''}`;
assert.equal(imported.status, 0, importOutput);
assert.match(importOutput, /IMPORT_ONLY_OK/);
assert.doesNotMatch(importOutput, /Starting database migrations/);
assert.doesNotMatch(importOutput, new RegExp(sentinel));

console.log('Migration runner failure redaction and import guard verified.');
