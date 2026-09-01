import { Injectable } from '@nestjs/common';
import {
  BaitImageDelivery,
  type BaitImageSource,
  type PublicBaitImage,
} from './bait-image-delivery.js';

@Injectable()
export class DisabledBaitImageDelivery extends BaitImageDelivery {
  readonly mappedImageCount = 0;

  resolvePublicImage(source: BaitImageSource): PublicBaitImage | null {
    void source;
    return null;
  }

  readPublicAsset(fileName: string): Promise<null> {
    void fileName;
    return Promise.resolve(null);
  }
}
