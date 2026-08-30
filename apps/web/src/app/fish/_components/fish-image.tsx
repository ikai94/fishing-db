'use client';

import { useState } from 'react';
import styles from '../../public-catalog.module.css';
import type { PublicFishImage } from '@/lib/catalog-api';

type FishImageProps = {
  fishName: string;
  image: PublicFishImage | null;
  variant: 'thumbnail' | 'detail';
};

export function FishImage({ fishName, image, variant }: FishImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const isThumbnail = variant === 'thumbnail';
  const canRenderImage = image !== null && image.url !== failedUrl;

  return (
    <div
      aria-hidden={isThumbnail ? true : undefined}
      className={`${styles.fishImageFrame} ${
        isThumbnail ? styles.fishImageThumbnail : styles.fishImageDetail
      }`}
      data-fish-image={variant}
    >
      {canRenderImage ? (
        // Delivery URLs are restricted by the public catalog decoder to application-owned paths.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={isThumbnail ? '' : `Изображение рыбы «${fishName}»`}
          className={styles.fishImage}
          loading={isThumbnail ? 'lazy' : 'eager'}
          onError={() => setFailedUrl(image.url)}
          src={image.url}
        />
      ) : isThumbnail ? (
        <span className={styles.fishImageQuietPlaceholder} />
      ) : (
        <span className={styles.fishImageFallback}>Нет изображения</span>
      )}
    </div>
  );
}
