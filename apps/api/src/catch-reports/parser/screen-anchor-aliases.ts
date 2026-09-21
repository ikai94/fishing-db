/**
 * Закрытый набор одобренных сокращений экранных ориентиров.
 * Алиас применяется только когда его канонический ScreenAnchor активен в каталоге.
 */
export const SCREEN_ANCHOR_ALIASES = {
  уда: 'удочка',
} as const;

/** Допустимое написание ключа из статического словаря ориентиров. */
export type ScreenAnchorAlias = keyof typeof SCREEN_ANCHOR_ALIASES;
