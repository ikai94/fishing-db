import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const displayHashLength = 12;

function run(command, args) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function compareNames(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => compareNames(left.name, right.name))
    .flatMap((entry) => {
      const entryPath = resolve(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    });
}

function shortContentHash(contents) {
  return createHash('sha256').update(contents).digest('hex').slice(0, displayHashLength);
}

function shortFileSetHash(files, baseDirectory = repositoryRoot) {
  const hash = createHash('sha256');

  for (const file of [...files].sort(compareNames)) {
    const relativePath = relative(baseDirectory, file).split('\\').join('/');
    hash.update(relativePath);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, displayHashLength);
}

function readText(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8').trim();
}

function normalizeVersion(version) {
  return version.trim().replace(/^v/u, '');
}

function detectPnpmVersion() {
  const userAgentVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/([^\s]+)/u)?.[1];
  if (userAgentVersion) return normalizeVersion(userAgentVersion);

  const commandVersion = normalizeVersion(run('pnpm', ['--version']));
  if (commandVersion.length === 0) throw new Error('Could not determine the pnpm version.');
  return commandVersion;
}

function main() {
  const packageJson = JSON.parse(readText('package.json'));
  const expectedNode = normalizeVersion(readText('.node-version'));
  const expectedPnpm = packageJson.packageManager?.match(/^pnpm@(.+)$/u)?.[1] ?? null;
  const nodeVersion = normalizeVersion(process.version);
  const pnpmVersion = detectPnpmVersion();

  const branch = run('git', ['branch', '--show-current']) || '(detached HEAD)';
  const head = run('git', ['rev-parse', 'HEAD']);
  const headShort = run('git', ['rev-parse', '--short=12', 'HEAD']);
  const headSubject = run('git', ['log', '-1', '--format=%s', 'HEAD']);
  const originMain = run('git', ['rev-parse', 'origin/main']);
  const originMainShort = run('git', ['rev-parse', '--short=12', 'origin/main']);
  const originMainSubject = run('git', ['log', '-1', '--format=%s', 'origin/main']);
  const [behind, ahead] = run('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'])
    .split(/\s+/u)
    .map(Number);
  const worktreeDirty = run('git', ['status', '--porcelain']).length > 0;

  const prismaDirectory = resolve(repositoryRoot, 'apps/api/prisma');
  const schemaFiles = listFiles(prismaDirectory).filter((file) => file.endsWith('.prisma'));
  const migrationsDirectory = resolve(prismaDirectory, 'migrations');
  const migrationFiles = listFiles(migrationsDirectory);

  const hashes = {
    prisma: shortFileSetHash(schemaFiles, prismaDirectory),
    migrations: shortFileSetHash(migrationFiles, migrationsDirectory),
    lockfile: shortContentHash(readFileSync(resolve(repositoryRoot, 'pnpm-lock.yaml'))),
    agents: shortContentHash(readFileSync(resolve(repositoryRoot, 'AGENTS.md'))),
    projectState: shortContentHash(readFileSync(resolve(repositoryRoot, 'docs/PROJECT_STATE.md'))),
  };

  const warnings = [];
  if (worktreeDirty) warnings.push('Worktree is dirty.');
  if (head !== originMain) warnings.push('HEAD differs from origin/main.');
  if (nodeVersion !== expectedNode) {
    warnings.push(`Node ${nodeVersion} differs from expected ${expectedNode}.`);
  }
  if (expectedPnpm !== null && pnpmVersion !== expectedPnpm) {
    warnings.push(`pnpm ${pnpmVersion} differs from expected ${expectedPnpm}.`);
  }

  console.log('Fishing DB state');
  console.log('----------------');
  console.log(`Node: v${nodeVersion}`);
  console.log(`pnpm: ${pnpmVersion}`);
  console.log(`Branch: ${branch}`);
  console.log(`HEAD: ${headShort} ${headSubject}`);
  console.log(`origin/main: ${originMainShort} ${originMainSubject}`);
  console.log(`Ahead/behind: ${ahead} ahead, ${behind} behind`);
  console.log(`Worktree: ${worktreeDirty ? 'dirty' : 'clean'}`);
  console.log('');
  console.log(`Prisma schema hash: ${hashes.prisma}`);
  console.log(`Migrations hash: ${hashes.migrations}`);
  console.log(`pnpm-lock hash: ${hashes.lockfile}`);
  console.log(`AGENTS.md hash: ${hashes.agents}`);
  console.log(`PROJECT_STATE.md hash: ${hashes.projectState}`);

  if (warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of warnings) console.log(`- ${warning}`);
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify:state failed: ${message}`);
  process.exitCode = 1;
}
