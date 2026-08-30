export type PublicFishImage = {
  url: string;
};

export type FishImageSource = {
  fishId: string;
  officialFishImageKey: number | null;
};

export abstract class FishImageDelivery {
  abstract resolvePublicImage(source: FishImageSource): PublicFishImage | null;
}
