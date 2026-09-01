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
import { BaitImageDelivery } from './bait-image-delivery.js';

@Controller('bait-images')
export class BaitImagesController {
  constructor(@Inject(BaitImageDelivery) private readonly delivery: BaitImageDelivery) {}

  @Get(':fileName')
  async getBaitImage(
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
