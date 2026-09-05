import { Suspense } from 'react';
import { CatalogSearchPage } from './catalog-search-page';

export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <CatalogSearchPage />
    </Suspense>
  );
}
