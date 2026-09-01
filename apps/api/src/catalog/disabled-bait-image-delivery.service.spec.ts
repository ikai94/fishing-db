import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisabledBaitImageDelivery } from './disabled-bait-image-delivery.service.js';

void describe('DisabledBaitImageDelivery', () => {
  void it('returns no public image or asset while delivery is disabled', async () => {
    const delivery = new DisabledBaitImageDelivery();

    assert.equal(delivery.resolvePublicImage({ baitId: 'bait-id', nameNormalized: 'живец' }), null);
    assert.equal(delivery.mappedImageCount, 0);
    assert.equal(await delivery.readPublicAsset(`${'a'.repeat(64)}.png`), null);
  });
});
