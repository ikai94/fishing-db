'use client';

import { useState } from 'react';
import styles from './bait-image.module.css';
import type { PublicBaitImage } from '@/lib/catalog-api';

type BaitImageProps = {
  baitName: string;
  image: PublicBaitImage | null;
  variant?: 'catalog' | 'compact';
};

export function BaitImage({ baitName, image, variant = 'catalog' }: BaitImageProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const canRenderImage = image !== null && image.url !== failedUrl;

  return (
    <span
      aria-hidden="true"
      className={`${styles.frame} ${variant === 'compact' ? styles.compact : ''}`}
    >
      {canRenderImage ? (
        // Delivery URLs are restricted by the public catalog decoder to application-owned paths.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt=""
          className={styles.image}
          loading="lazy"
          onError={() => setFailedUrl(image.url)}
          src={image.url}
          title={baitName}
        />
      ) : (
        <span className={styles.placeholder} />
      )}
    </span>
  );
}
