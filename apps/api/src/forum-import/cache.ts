import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FORUM_IMPORT_LOCAL_ROOT = new URL(
  '../../.local/forum-import/rus-fishsoft/',
  import.meta.url,
);

export interface HttpCacheMetadata {
  schemaVersion: 1;
  url: string;
  finalUrl: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  bodySha256: string;
}

export interface HttpCacheEntry {
  metadata: HttpCacheMetadata;
  body: string;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return null;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, contents, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  const source = await readOptionalFile(path);
  return source === null ? null : (JSON.parse(source) as T);
}

export class ForumLocalStore {
  readonly rootPath: string;

  constructor(root: URL | string = FORUM_IMPORT_LOCAL_ROOT) {
    this.rootPath = root instanceof URL ? fileURLToPath(root) : root;
  }

  async readHttp(url: string): Promise<HttpCacheEntry | null> {
    const key = sha256Hex(url);
    const metadata = await readJsonFile<HttpCacheMetadata>(
      join(this.rootPath, 'http-cache', `${key}.json`),
    );
    const body = await readOptionalFile(join(this.rootPath, 'http-cache', `${key}.html`));

    if (metadata === null || body === null) return null;
    if (metadata.schemaVersion !== 1 || metadata.url !== url) return null;
    if (sha256Hex(body) !== metadata.bodySha256) return null;
    return { metadata, body };
  }

  async writeHttp(entry: HttpCacheEntry): Promise<void> {
    const key = sha256Hex(entry.metadata.url);
    const cacheDirectory = join(this.rootPath, 'http-cache');
    const metadata: HttpCacheMetadata = {
      ...entry.metadata,
      bodySha256: sha256Hex(entry.body),
    };
    await writeFileAtomic(join(cacheDirectory, `${key}.html`), entry.body);
    await writeJsonAtomic(join(cacheDirectory, `${key}.json`), metadata);
  }

  checkpointPath(scopeKey: string): string {
    return join(this.rootPath, 'checkpoints', `${scopeKey}.json`);
  }

  outputDirectory(scopeKey: string): string {
    return join(this.rootPath, 'outputs', scopeKey);
  }

  entityPath(kind: 'forums' | 'posts' | 'topics', id: string): string {
    return join(this.rootPath, 'entities', kind, `${id}.json`);
  }

  postRevisionPath(postId: string, bodySha256: string): string {
    return join(this.rootPath, 'entities', 'post-revisions', postId, `${bodySha256}.json`);
  }
}
