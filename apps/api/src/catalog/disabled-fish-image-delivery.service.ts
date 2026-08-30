import { Injectable } from '@nestjs/common';
import {
  FishImageDelivery,
  type FishImageSource,
  type PublicFishImage,
} from './fish-image-delivery.js';

@Injectable()
export class DisabledFishImageDelivery extends FishImageDelivery {
  resolvePublicImage(source: FishImageSource): PublicFishImage | null {
    void source;
    return null;
  }
}
