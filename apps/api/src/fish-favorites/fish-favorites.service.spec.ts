import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { FishFavoritesService } from './fish-favorites.service.js';

void describe('FishFavoritesService', () => {
  void it('lists only the authenticated user scope in one query', async () => {
    let receivedQuery: unknown;
    const service = new FishFavoritesService({
      userFavoriteFish: {
        findMany: (query: unknown) => {
          receivedQuery = query;
          return Promise.resolve([{ fishId: 'fish-a' }, { fishId: 'fish-b' }]);
        },
      },
    } as never);

    assert.deepEqual(await service.list('user-a'), {
      items: [{ fishId: 'fish-a' }, { fishId: 'fish-b' }],
    });
    assert.deepEqual(receivedQuery, {
      where: { userId: 'user-a' },
      orderBy: { fishId: 'asc' },
      select: { fishId: true },
    });
  });

  void it('idempotently upserts the composite user and Fish identity', async () => {
    let receivedQuery: unknown;
    const service = new FishFavoritesService({
      fish: { findUnique: () => Promise.resolve({ id: 'fish-a' }) },
      userFavoriteFish: {
        upsert: (query: unknown) => {
          receivedQuery = query;
          return Promise.resolve({ fishId: 'fish-a' });
        },
      },
    } as never);

    assert.deepEqual(await service.add('user-a', 'fish-a'), {
      favorite: { fishId: 'fish-a' },
    });
    assert.deepEqual(receivedQuery, {
      where: { userId_fishId: { userId: 'user-a', fishId: 'fish-a' } },
      create: { userId: 'user-a', fishId: 'fish-a' },
      update: {},
      select: { fishId: true },
    });
  });

  void it('returns FISH_NOT_FOUND before creating a dangling favorite', async () => {
    const service = new FishFavoritesService({
      fish: { findUnique: () => Promise.resolve(null) },
    } as never);

    await assert.rejects(
      () => service.add('user-a', 'missing-fish'),
      (error: unknown) =>
        error instanceof NotFoundException &&
        (error.getResponse() as { code?: string }).code === 'FISH_NOT_FOUND',
    );
  });

  void it('removes only the selected relation and remains idempotent', async () => {
    let receivedQuery: unknown;
    const service = new FishFavoritesService({
      userFavoriteFish: {
        deleteMany: (query: unknown) => {
          receivedQuery = query;
          return Promise.resolve({ count: 0 });
        },
      },
    } as never);

    await service.remove('user-a', 'fish-a');
    assert.deepEqual(receivedQuery, { where: { userId: 'user-a', fishId: 'fish-a' } });
  });
});
