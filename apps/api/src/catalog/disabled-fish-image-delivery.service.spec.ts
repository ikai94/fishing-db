import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DisabledFishImageDelivery } from './disabled-fish-image-delivery.service.js';

void describe('DisabledFishImageDelivery', () => {
  void it('returns no public image for keyed and keyless Fish', () => {
    const delivery = new DisabledFishImageDelivery();

    assert.equal(
      delivery.resolvePublicImage({ fishId: 'fish-with-image', officialFishImageKey: 1463 }),
      null,
    );
    assert.equal(
      delivery.resolvePublicImage({ fishId: 'fish-without-image', officialFishImageKey: null }),
      null,
    );
  });
});
