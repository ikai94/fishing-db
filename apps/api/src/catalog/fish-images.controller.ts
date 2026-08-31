import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { FishImageDelivery } from './fish-image-delivery.js';

@Controller('fish-images')
export class FishImagesController {
  constructor(@Inject(FishImageDelivery) private readonly delivery: FishImageDelivery) {}

  @Get(':fileName')
  async getFishImage(
    @Param('fileName') fileName: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | undefined> {
    const asset = await this.delivery.readPublicAsset(fileName);
    if (asset === null) throw new NotFoundException();

    const etag = `"${asset.sha256}"`;
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Content-Length', String(asset.sizeBytes));
    response.setHeader('ETag', etag);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (
      ifNoneMatch
        ?.split(',')
        .map((value) => value.trim())
        .includes(etag) === true
    ) {
      response.status(304);
      return undefined;
    }

    return new StreamableFile(asset.bytes);
  }
}
