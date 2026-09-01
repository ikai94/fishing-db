export type PublicBaitImage = {
  url: string;
};

export type PublicBaitImageAsset = {
  bytes: Buffer;
  sha256: string;
  sizeBytes: number;
};

export type BaitImageSource = {
  baitId: string;
  nameNormalized: string;
};

export abstract class BaitImageDelivery {
  abstract resolvePublicImage(source: BaitImageSource): PublicBaitImage | null;
  abstract readPublicAsset(fileName: string): Promise<PublicBaitImageAsset | null>;
  abstract readonly mappedImageCount: number;
}
