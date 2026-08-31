export type PublicFishImage = {
  url: string;
};

export type PublicFishImageAsset = {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
};

export type FishImageSource = {
  fishId: string;
  officialFishImageKey: number | null;
};

export abstract class FishImageDelivery {
  abstract resolvePublicImage(source: FishImageSource): PublicFishImage | null;
  abstract readPublicAsset(fileName: string): Promise<PublicFishImageAsset | null>;
  abstract readonly mappedImageCount: number;
}
