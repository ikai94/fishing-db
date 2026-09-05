type FragmentLocation = Pick<Location, 'hash' | 'pathname' | 'search'>;
type FragmentHistory = Pick<History, 'replaceState' | 'state'>;

export function captureAndClearAuthToken(
  location: FragmentLocation,
  history: FragmentHistory,
): string | null {
  const fragment = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
  const token = new URLSearchParams(fragment).get('token')?.trim() ?? '';

  if (location.hash !== '') {
    history.replaceState(history.state, '', `${location.pathname}${location.search}`);
  }

  return token.length > 0 ? token : null;
}
