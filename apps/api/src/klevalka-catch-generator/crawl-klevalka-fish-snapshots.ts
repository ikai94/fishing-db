import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  KLEVALKA_DEFAULT_REQUEST_DELAY_MS,
  KLEVALKA_MINIMUM_REQUEST_DELAY_MS,
  crawlKlevalkaFishSnapshots,
  parseExternalCookieFile,
} from './klevalka-fish-snapshot-crawler.js';

interface CrawlCommand {
  workspacePath: string;
  cookieFilePath?: string;
  maximumFish?: number;
  requestDelayMs: number;
}

function requiredValue(args: readonly string[], index: number, option: string): string {
  const value = args[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseKlevalkaCrawlCommand(args: readonly string[]): CrawlCommand {
  let workspacePath: string | undefined;
  let cookieFilePath: string | undefined;
  let maximumFish: number | undefined;
  let requestDelayMs = KLEVALKA_DEFAULT_REQUEST_DELAY_MS;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === '--workspace') workspacePath = requiredValue(args, ++index, option);
    else if (option === '--cookie-file') cookieFilePath = requiredValue(args, ++index, option);
    else if (option === '--max-fish') {
      maximumFish = Number(requiredValue(args, ++index, option));
      if (!Number.isSafeInteger(maximumFish) || maximumFish < 1) {
        throw new Error('--max-fish must be a positive safe integer');
      }
    } else if (option === '--delay-ms') {
      requestDelayMs = Number(requiredValue(args, ++index, option));
      if (
        !Number.isSafeInteger(requestDelayMs) ||
        requestDelayMs < KLEVALKA_MINIMUM_REQUEST_DELAY_MS
      ) {
        throw new Error(
          `--delay-ms must be an integer of at least ${KLEVALKA_MINIMUM_REQUEST_DELAY_MS}`,
        );
      }
    } else throw new Error(`Unknown option: ${option ?? ''}`);
  }
  if (workspacePath === undefined) {
    throw new Error(
      'usage: crawl-klevalka-fish-snapshots --workspace <absolute external directory> [--cookie-file <absolute external file>] [--max-fish <count>] [--delay-ms <milliseconds>]',
    );
  }
  if (!isAbsolute(workspacePath)) throw new Error('--workspace must be an absolute path');
  if (cookieFilePath !== undefined && !isAbsolute(cookieFilePath)) {
    throw new Error('--cookie-file must be an absolute path');
  }
  return { workspacePath, cookieFilePath, maximumFish, requestDelayMs };
}

function isInside(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate);
  return fromParent === '' || (!fromParent.startsWith(`..${sep}`) && fromParent !== '..');
}

async function repositoryRoot(): Promise<string> {
  return realpath(resolve(import.meta.dirname, '../../../..'));
}

async function assertExternalWorkspace(workspacePath: string): Promise<string> {
  const repository = await repositoryRoot();
  const requested = resolve(workspacePath);
  if (isInside(repository, requested)) {
    throw new Error(`--workspace must resolve outside the repository: ${repository}`);
  }
  const { mkdir } = await import('node:fs/promises');
  await mkdir(requested, { recursive: true });
  const workspace = await realpath(requested);
  if (isInside(repository, workspace)) {
    throw new Error(`--workspace must resolve outside the repository: ${repository}`);
  }
  return workspace;
}

async function readExternalCookie(
  cookieFilePath: string | undefined,
): Promise<{ cookieHeader: string; method: 'COOKIE_FILE' | 'ENVIRONMENT' }> {
  const environmentCookie = process.env.KLEVALKA_COOKIE?.trim();
  if (cookieFilePath !== undefined && environmentCookie) {
    throw new Error('Use either --cookie-file or KLEVALKA_COOKIE, not both');
  }
  if (cookieFilePath !== undefined) {
    const repository = await repositoryRoot();
    const cookieFile = await realpath(cookieFilePath);
    if (isInside(repository, cookieFile)) {
      throw new Error('--cookie-file must resolve outside the repository');
    }
    if (!(await stat(cookieFile)).isFile()) throw new Error('--cookie-file must be a regular file');
    return {
      cookieHeader: parseExternalCookieFile(await readFile(cookieFile, 'utf8')),
      method: 'COOKIE_FILE',
    };
  }
  if (!environmentCookie) {
    throw new Error('Authentication is required through --cookie-file or KLEVALKA_COOKIE');
  }
  return { cookieHeader: environmentCookie, method: 'ENVIRONMENT' };
}

export async function runKlevalkaFishSnapshotCrawler(
  args: readonly string[] = process.argv.slice(2),
): Promise<void> {
  const command = parseKlevalkaCrawlCommand(args);
  const workspaceRoot = await assertExternalWorkspace(command.workspacePath);
  const authentication = await readExternalCookie(command.cookieFilePath);
  const result = await crawlKlevalkaFishSnapshots({
    workspaceRoot,
    cookieHeader: authentication.cookieHeader,
    maximumFish: command.maximumFish,
    requestDelayMs: command.requestDelayMs,
  });
  console.info(
    JSON.stringify(
      {
        workspaceRoot,
        authentication: authentication.method,
        discoveredFish: result.manifest.discovery.fishCount,
        selectedFish: result.manifest.selectedFishCount,
        savedFish: result.manifest.savedFishCount,
        failedFish: result.manifest.failedFishCount,
        fetched: result.fetched,
        reused: result.reused,
        complete: result.manifest.complete,
      },
      null,
      2,
    ),
  );
}

const entryPoint = process.argv[1];
if (entryPoint !== undefined && import.meta.url === pathToFileURL(entryPoint).href) {
  void runKlevalkaFishSnapshotCrawler().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
