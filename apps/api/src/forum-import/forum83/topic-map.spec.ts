import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadForum83TopicMap } from './topic-map.js';

void describe('approved forum83 topic/Base map', () => {
  void it('pins all 77 Bases and exactly the seven reviewed bindings', () => {
    const { map, sha256 } = loadForum83TopicMap();
    assert.equal(map.topics.length, 77);
    assert.match(sha256, /^[0-9a-f]{64}$/u);
    assert.deepEqual(
      map.topics
        .filter(({ resolution }) => resolution === 'REVIEWED')
        .map(({ topicId }) => topicId)
        .sort((left, right) => Number(left) - Number(right)),
      ['410', '416', '31382', '31383', '32075', '32257', '33553'],
    );
    assert.equal(new Set(map.topics.map(({ topicId }) => topicId)).size, 77);
    assert.equal(new Set(map.topics.map(({ baseName }) => baseName)).size, 77);
  });
});
