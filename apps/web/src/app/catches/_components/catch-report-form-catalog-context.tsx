'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getApiErrorMessage } from '@/lib/api-client';
import {
  getFishingBase,
  listBaits,
  listFishingBases,
  listScreenAnchors,
  type PublicBait,
  type PublicCatalogItem,
  type PublicFishingBase,
  type PublicScreenAnchor,
} from '@/lib/catalog-api';

export type CatchReportFormCatalogState =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      bases: PublicCatalogItem[];
      baits: PublicBait[];
      screenAnchors: PublicScreenAnchor[];
    }
  | { kind: 'error'; message: string };

type SharedCatchReportCatalog = {
  state: CatchReportFormCatalogState;
  revision: number;
  reload: () => void;
  loadBase: (baseId: string) => Promise<PublicFishingBase>;
};

const CatalogContext = createContext<SharedCatchReportCatalog | null>(null);

export function CatchReportFormCatalogProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<CatchReportFormCatalogState>({ kind: 'loading' });
  const controllerRef = useRef<AbortController | null>(null);
  const baseRequestsRef = useRef(new Map<string, Promise<PublicFishingBase>>());

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current = controller;
    async function loadCatalog() {
      try {
        const [bases, baits, screenAnchors] = await Promise.all([
          listFishingBases(controller.signal),
          listBaits(controller.signal),
          listScreenAnchors(controller.signal),
        ]);
        if (!controller.signal.aborted) setState({ kind: 'ready', bases, baits, screenAnchors });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          kind: 'error',
          message: getApiErrorMessage(error, 'Не удалось загрузить активный игровой каталог.'),
        });
      }
    }
    void loadCatalog();
    return () => {
      controller.abort();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [revision]);

  const loadBase = useCallback((baseId: string) => {
    const current = baseRequestsRef.current.get(baseId);
    if (current !== undefined) return current;
    const controller = controllerRef.current;
    if (controller === null || controller.signal.aborted) {
      return Promise.reject(new Error('Активный игровой каталог ещё не загружен'));
    }
    const request = getFishingBase(baseId, controller.signal);
    baseRequestsRef.current.set(baseId, request);
    void request.catch(() => baseRequestsRef.current.delete(baseId));
    return request;
  }, []);

  const reload = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    baseRequestsRef.current.clear();
    setState({ kind: 'loading' });
    setRevision((current) => current + 1);
  }, []);

  const value = useMemo(
    () => ({ state, revision, reload, loadBase }),
    [loadBase, reload, revision, state],
  );

  return <CatalogContext value={value}>{children}</CatalogContext>;
}

export function useSharedCatchReportFormCatalog(): SharedCatchReportCatalog | null {
  return useContext(CatalogContext);
}
