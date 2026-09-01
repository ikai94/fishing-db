import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../auth/admin.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { createApplicationValidationPipe } from '../common/validation/validation-exception.factory.js';
import { CatalogAdminService } from './catalog-admin.service.js';
import { CatalogQueryService } from './catalog-query.service.js';
import { AddFishingBaseFishDto } from './dto/add-fishing-base-fish.dto.js';
import {
  BaitIdParamsDto,
  FishIdParamsDto,
  FishingBaseFishParamsDto,
  FishingBaseIdParamsDto,
  LocationIdParamsDto,
  ScreenAnchorIdParamsDto,
} from './dto/catalog-params.dto.js';
import { CatalogStatusQueryDto } from './dto/catalog-status-query.dto.js';
import { CreateBaitDto } from './dto/create-bait.dto.js';
import { CreateFishDto } from './dto/create-fish.dto.js';
import { CreateFishingBaseDto } from './dto/create-fishing-base.dto.js';
import { CreateLocationDto } from './dto/create-location.dto.js';
import { CreateScreenAnchorDto } from './dto/create-screen-anchor.dto.js';
import { UpdateBaitDto } from './dto/update-bait.dto.js';
import { UpdateFishDto } from './dto/update-fish.dto.js';
import { UpdateFishingBaseFishDto } from './dto/update-fishing-base-fish.dto.js';
import { UpdateFishingBaseDto } from './dto/update-fishing-base.dto.js';
import { UpdateLocationDto } from './dto/update-location.dto.js';
import { UpdateScreenAnchorDto } from './dto/update-screen-anchor.dto.js';

@Controller('admin/catalog')
@UseGuards(AuthGuard, AdminGuard)
export class AdminCatalogController {
  constructor(
    @Inject(CatalogQueryService) private readonly catalogQuery: CatalogQueryService,
    @Inject(CatalogAdminService) private readonly catalogAdmin: CatalogAdminService,
  ) {}

  @Get('bases')
  listFishingBases(
    @Query(createApplicationValidationPipe(CatalogStatusQueryDto)) query: CatalogStatusQueryDto,
  ) {
    return this.catalogQuery.listAdminFishingBases(query.status);
  }

  @Post('bases')
  @HttpCode(HttpStatus.CREATED)
  createFishingBase(
    @Body(createApplicationValidationPipe(CreateFishingBaseDto)) dto: CreateFishingBaseDto,
  ) {
    return this.catalogAdmin.createFishingBase(dto);
  }

  @Get('bases/:baseId')
  getFishingBase(
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto))
    params: FishingBaseIdParamsDto,
  ) {
    return this.catalogQuery.getAdminFishingBase(params.baseId);
  }

  @Patch('bases/:baseId')
  updateFishingBase(
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto))
    params: FishingBaseIdParamsDto,
    @Body(createApplicationValidationPipe(UpdateFishingBaseDto)) dto: UpdateFishingBaseDto,
  ) {
    return this.catalogAdmin.updateFishingBase(params.baseId, dto);
  }

  @Post('bases/:baseId/locations')
  @HttpCode(HttpStatus.CREATED)
  createLocation(
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto))
    params: FishingBaseIdParamsDto,
    @Body(createApplicationValidationPipe(CreateLocationDto)) dto: CreateLocationDto,
  ) {
    return this.catalogAdmin.createLocation(params.baseId, dto);
  }

  @Get('locations/:locationId')
  getLocation(
    @Param(createApplicationValidationPipe(LocationIdParamsDto)) params: LocationIdParamsDto,
  ) {
    return this.catalogQuery.getAdminLocation(params.locationId);
  }

  @Patch('locations/:locationId')
  updateLocation(
    @Param(createApplicationValidationPipe(LocationIdParamsDto)) params: LocationIdParamsDto,
    @Body(createApplicationValidationPipe(UpdateLocationDto)) dto: UpdateLocationDto,
  ) {
    return this.catalogAdmin.updateLocation(params.locationId, dto);
  }

  @Get('fish')
  listFish(
    @Query(createApplicationValidationPipe(CatalogStatusQueryDto)) query: CatalogStatusQueryDto,
  ) {
    return this.catalogQuery.listAdminFish(query.status);
  }

  @Post('fish')
  @HttpCode(HttpStatus.CREATED)
  createFish(@Body(createApplicationValidationPipe(CreateFishDto)) dto: CreateFishDto) {
    return this.catalogAdmin.createFish(dto);
  }

  @Patch('fish/:fishId')
  updateFish(
    @Param(createApplicationValidationPipe(FishIdParamsDto)) params: FishIdParamsDto,
    @Body(createApplicationValidationPipe(UpdateFishDto)) dto: UpdateFishDto,
  ) {
    return this.catalogAdmin.updateFish(params.fishId, dto);
  }

  @Get('baits')
  listBaits(
    @Query(createApplicationValidationPipe(CatalogStatusQueryDto)) query: CatalogStatusQueryDto,
  ) {
    return this.catalogQuery.listAdminBaits(query.status);
  }

  @Post('baits')
  @HttpCode(HttpStatus.CREATED)
  createBait(@Body(createApplicationValidationPipe(CreateBaitDto)) dto: CreateBaitDto) {
    return this.catalogAdmin.createBait(dto);
  }

  @Patch('baits/:baitId')
  updateBait(
    @Param(createApplicationValidationPipe(BaitIdParamsDto)) params: BaitIdParamsDto,
    @Body(createApplicationValidationPipe(UpdateBaitDto)) dto: UpdateBaitDto,
  ) {
    return this.catalogAdmin.updateBait(params.baitId, dto);
  }

  @Get('screen-anchors')
  listScreenAnchors(
    @Query(createApplicationValidationPipe(CatalogStatusQueryDto)) query: CatalogStatusQueryDto,
  ) {
    return this.catalogQuery.listAdminScreenAnchors(query.status);
  }

  @Post('screen-anchors')
  @HttpCode(HttpStatus.CREATED)
  createScreenAnchor(
    @Body(createApplicationValidationPipe(CreateScreenAnchorDto)) dto: CreateScreenAnchorDto,
  ) {
    return this.catalogAdmin.createScreenAnchor(dto);
  }

  @Patch('screen-anchors/:anchorId')
  updateScreenAnchor(
    @Param(createApplicationValidationPipe(ScreenAnchorIdParamsDto))
    params: ScreenAnchorIdParamsDto,
    @Body(createApplicationValidationPipe(UpdateScreenAnchorDto)) dto: UpdateScreenAnchorDto,
  ) {
    return this.catalogAdmin.updateScreenAnchor(params.anchorId, dto);
  }

  @Post('bases/:baseId/fish')
  @HttpCode(HttpStatus.CREATED)
  addFishToFishingBase(
    @Param(createApplicationValidationPipe(FishingBaseIdParamsDto))
    params: FishingBaseIdParamsDto,
    @Body(createApplicationValidationPipe(AddFishingBaseFishDto)) dto: AddFishingBaseFishDto,
  ) {
    return this.catalogAdmin.addFishToFishingBase(params.baseId, dto);
  }

  @Patch('bases/:baseId/fish/:fishId')
  updateFishingBaseFish(
    @Param(createApplicationValidationPipe(FishingBaseFishParamsDto))
    params: FishingBaseFishParamsDto,
    @Body(createApplicationValidationPipe(UpdateFishingBaseFishDto))
    dto: UpdateFishingBaseFishDto,
  ) {
    return this.catalogAdmin.updateFishingBaseFish(params.baseId, params.fishId, dto);
  }

  @Delete('bases/:baseId/fish/:fishId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeFishFromFishingBase(
    @Param(createApplicationValidationPipe(FishingBaseFishParamsDto))
    params: FishingBaseFishParamsDto,
  ): Promise<void> {
    return this.catalogAdmin.removeFishFromFishingBase(params.baseId, params.fishId);
  }
}
