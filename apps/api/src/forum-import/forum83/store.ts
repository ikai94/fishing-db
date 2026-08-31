import { ForumLocalStore } from '../cache.js';

export const FORUM83_LOCAL_ROOT = new URL(
  '../../../.local/forum-import/rus-fishsoft/forum83/',
  import.meta.url,
);

export function createForum83Store(root: URL | string = FORUM83_LOCAL_ROOT): ForumLocalStore {
  return new ForumLocalStore(root);
}
