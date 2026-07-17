#!/usr/bin/env node

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';


if (process.platform === 'win32') {
  console.log('Release process lifecycle verification skipped on Windows.');
  process.exit(0);
}

const root = mkdtempSync(join(tmpdir(), 'marketdesk-release-process-'));
const repoName = `release-probe-${process.pid}-${randomBytes(6).toString('hex')}`;
const repo = join(root, repoName);
const fakeBin = join(root, 'bin');
const runtime = join(root, 'runtime');
const alternateRuntime = join(root, 'alternate-runtime');
const childPidFile = join(root, 'compose-child.pid');
const retryPidFile = join(root, 'retry-child.pid');
let processGroupId;

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}

function processGroupIsAlive(groupId) {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

async function waitUntil(predicate, message, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(message);
}

function waitForExit(child, timeoutMs = 8000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('Child process did not exit in time')), timeoutMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ code, signal });
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function spawnWrapper(pidFile, mode = 'wait', temporaryDirectory = runtime) {
  const moduleUrl = pathToFileURL(resolve('scripts/compose-release.mjs')).href;
  const code = `import { runReleaseCompose } from ${JSON.stringify(moduleUrl)}; process.exitCode = await runReleaseCompose(['up'], process.cwd());`;
  return spawn(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: repo,
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      TMPDIR: temporaryDirectory,
      FAKE_DOCKER_PID_FILE: pidFile,
      FAKE_DOCKER_MODE: mode,
    },
    stdio: 'ignore',
  });
}

try {
  mkdirSync(repo);
  mkdirSync(fakeBin);
  mkdirSync(runtime);
  mkdirSync(alternateRuntime);
  writeFileSync(
    join(fakeBin, 'docker'),
    `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "inspect" ]]; then
  echo "Error: No such object: marketdesk-app" >&2
  exit 1
fi
exec 9>&- 2>/dev/null || true
pgid="$(ps -o pgid= -p $$ | tr -d ' ')"
printf '%s\\n%s\\n' "$$" "$pgid" > "$FAKE_DOCKER_PID_FILE"
if [[ "\${FAKE_DOCKER_MODE:-wait}" == "exit" ]]; then
  exit 0
fi
trap 'exit 0' TERM INT HUP
while :; do sleep 1; done
`,
    { mode: 0o755 },
  );
  writeFileSync(join(repo, '.gitignore'), '.env\n');
  writeFileSync(join(repo, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(repo, 'Dockerfile'), 'FROM scratch\n');
  run('git', ['init', '--quiet'], repo);
  run('git', ['config', 'user.name', 'MarketDesk CI'], repo);
  run('git', ['config', 'user.email', 'ci@example.invalid'], repo);
  run('git', ['add', '.gitignore', 'docker-compose.yml', 'Dockerfile'], repo);
  run('git', ['commit', '--quiet', '-m', 'release'], repo);
  run('git', ['tag', 'hermes-marketdesk-v1.2.3'], repo);
  writeFileSync(join(repo, '.env'), 'DB_SSL_MODE=disable\n', { mode: 0o600 });

  const releaseBase = join('/tmp', `marketdesk-release-${process.getuid()}`);
  const lockRoot = join(releaseBase, `${repoName}.lock`);
  const contextRoot = join(lockRoot, 'deployment');

  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const signalPidFile = join(root, `${signal.toLowerCase()}-child.pid`);
    const signalledWrapper = spawnWrapper(signalPidFile);
    await waitUntil(() => existsSync(signalPidFile), `${signal} fake Compose process did not start`);
    const [, signalGroupLine] = readFileSync(signalPidFile, 'utf8').trim().split(/\r?\n/);
    const signalGroupId = Number.parseInt(signalGroupLine, 10);
    signalledWrapper.kill(signal);
    const signalOutcome = await waitForExit(signalledWrapper);
    assert.equal(
      signalOutcome.code,
      { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 }[signal],
      `${signal} must not be reported as a successful deployment`,
    );
    await waitUntil(() => !processGroupIsAlive(signalGroupId), `${signal} process group did not exit`);
    assert.equal(existsSync(contextRoot), true, `${signal} must retain the fail-closed context`);
    rmSync(lockRoot, { recursive: true, force: true });
  }

  const wrapper = spawnWrapper(childPidFile);
  await waitUntil(() => existsSync(childPidFile), 'Fake Compose process did not start');
  const [, groupLine] = readFileSync(childPidFile, 'utf8').trim().split(/\r?\n/);
  processGroupId = Number.parseInt(groupLine, 10);
  assert.equal(processGroupIsAlive(processGroupId), true);
  assert.equal(existsSync(join(contextRoot, 'deployment.env')), true);

  wrapper.kill('SIGKILL');
  await waitForExit(wrapper);
  assert.equal(processGroupIsAlive(processGroupId), true, 'locked release group must outlive a killed outer supervisor');
  assert.equal(existsSync(contextRoot), true, 'active Compose must retain its immutable context');

  const retry = spawnWrapper(retryPidFile, 'wait', alternateRuntime);
  const retryOutcome = await waitForExit(retry);
  assert.equal(retryOutcome.code, 1, 'a retry must fail on the persistent lock while the first release group is active');
  assert.equal(existsSync(retryPidFile), false, 'blocked retry must not launch another Compose process');
  assert.equal(existsSync(contextRoot), true);

  process.kill(-processGroupId, 'SIGTERM');
  await waitUntil(() => !processGroupIsAlive(processGroupId), 'Fake release process group did not exit');
  processGroupId = undefined;

  const blockedAfterExit = spawnWrapper(retryPidFile, 'exit', alternateRuntime);
  const blockedAfterExitOutcome = await waitForExit(blockedAfterExit);
  assert.equal(blockedAfterExitOutcome.code, 1, 'a failed deployment lock must remain fail-closed after consumers exit');
  assert.equal(existsSync(retryPidFile), false);

  rmSync(lockRoot, { recursive: true, force: true });
  const recovery = spawnWrapper(retryPidFile, 'exit');
  const recoveryOutcome = await waitForExit(recovery);
  assert.equal(recoveryOutcome.code, 0, 'explicit recovery must permit the next successful release');
  assert.equal(existsSync(lockRoot), false, 'a successful release must clean its lock and context');

  console.log('Release process lock and interruption lifecycle verified.');
} finally {
  if (processGroupId && processGroupIsAlive(processGroupId)) {
    try {
      process.kill(-processGroupId, 'SIGKILL');
    } catch {
      // Best-effort cleanup for a failed probe.
    }
  }
  rmSync(join('/tmp', `marketdesk-release-${process.getuid()}`, `${repoName}.lock`), {
    recursive: true,
    force: true,
  });
  rmSync(root, { recursive: true, force: true });
}
