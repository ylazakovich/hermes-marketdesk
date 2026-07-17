#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const RELEASE_TAG_PATTERN = /^hermes-marketdesk-v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;

export function resolveCheckoutReleaseTag(cwd = process.cwd()) {
  const result = spawnSync(
    'git',
    ['describe', '--tags', '--exact-match', '--match', 'hermes-marketdesk-v[0-9]*', 'HEAD'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error('Release deployment requires HEAD to be checked out at an exact MarketDesk release tag');
  }

  const tag = result.stdout.trim();
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(`Invalid MarketDesk release tag: ${tag || '(empty)'}`);
  }

  const status = spawnSync(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    { cwd, encoding: 'utf8' },
  );
  if (status.status !== 0 || status.stdout !== '') {
    throw new Error('Release deployment requires a clean checkout with no tracked or untracked changes');
  }
  return tag;
}

export function buildReleaseComposeArgs(args, cwd = process.cwd()) {
  const accepted = args.length === 1 && args[0] === 'up'
    || args.length === 2 && args[0] === 'up' && ['-d', '--detach'].includes(args[1]);
  if (!accepted) {
    throw new Error('Usage: npm run compose:release -- up [-d|--detach]');
  }
  const projectDirectory = resolve(cwd);
  return [
    'compose',
    '--project-directory', projectDirectory,
    '-f', resolve(projectDirectory, 'docker-compose.yml'),
    'up', '--build', '--detach',
  ];
}

export function buildReleaseComposeEnvironment(releaseTag, baseEnvironment = process.env) {
  const environment = { ...baseEnvironment, MARKETDESK_RELEASE_TAG: releaseTag };
  for (const name of Object.keys(environment)) {
    if (name.startsWith('COMPOSE_')) delete environment[name];
  }
  return environment;
}

export function runReleaseCompose(args, cwd = process.cwd()) {
  const composeArgs = buildReleaseComposeArgs(args, cwd);
  const releaseTag = resolveCheckoutReleaseTag(cwd);
  const result = spawnSync('docker', composeArgs, {
    cwd,
    env: buildReleaseComposeEnvironment(releaseTag),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const isEntrypoint = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isEntrypoint) {
  try {
    process.exitCode = runReleaseCompose(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
