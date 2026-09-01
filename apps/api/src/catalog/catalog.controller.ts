import { Controller, Get, Inject, Param } from '@nestjs/common';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { CatalogQueryService } from './catalog-query.service.js';
import {
  FishingBaseIdParamsDto,
  FishIdParamsDto,
  LocationIdParamsDto,
} from './dto/catalog-params.dto.js';

@Controller('catalog')
export class CatalogController {
  constructor(@Inject(CatalogQueryService) private readonly catalogQuery: CatalogQueryService) {}

  @Get('summary')
  getSummary() {
    return this.catalogQuery.getPublicSummary();
  }

  @Get('bases')
  listFishingBases() {
    return this.catalogQuery.listPublicFishingBases();
  }

  @Get('bases/:baseId')
  getFishingBase(
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto))
    params: FishingBaseIdParamsDto,
  ) {
    return this.catalogQuery.getPublicFishingBase(params.baseId);
  }

  @Get('locations/:locationId')
  getLocation(
    @Param(createApplicationValidationPipe(LocationIdParamsDto)) params: LocationIdParamsDto,
  ) {
    return this.catalogQuery.getPublicLocation(params.locationId);
  }

  @Get('fish')
  listFish() {
    return this.catalogQuery.listPublicFish();
  }

  @Get('fish/:fishId')
  getFish(@Param(createApplicationValidationPipe(FishIdParamsDto)) params: FishIdParamsDto) {
    return this.catalogQuery.getPublicFish(params.fishId);
  }

  @Get('baits')
  listBaits() {
    return this.catalogQuery.listPublicBaits();
  }

  @Get('screen-anchors')
  listScreenAnchors() {
    return this.catalogQuery.listPublicScreenAnchors();
  }
}
