import { Injectable } from '@nestjs/common';
import {
  FishImageDelivery,
  type FishImageSource,
  type PublicFishImage,
} from './fish-image-delivery.js';

@Injectable()
export class DisabledFishImageDelivery extends FishImageDelivery {
  readonly mappedImageCount = 0;

  resolvePublicImage(source: FishImageSource): PublicFishImage | null {
    void source;
    return null;
  }

  readPublicAsset(fileName: string): Promise<null> {
    void fileName;
    return Promise.resolve(null);
  }
}
