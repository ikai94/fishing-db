import { describe, expect, test, vi } from 'vitest';
import { captureAndClearAuthToken } from './auth-token-fragment';

describe('captureAndClearAuthToken', () => {
  test('captures a fragment token and removes the complete fragment while preserving path and query', () => {
    const replaceState = vi.fn();
    const token = captureAndClearAuthToken(
      {
        pathname: '/verify-email',
        search: '?source=email',
        hash: '#token=secret%2Dtoken&ignored=value',
      } as Location,
      { state: { navigation: true }, replaceState } as unknown as History,
    );

    expect(token).toBe('secret-token');
    expect(replaceState).toHaveBeenCalledWith(
      { navigation: true },
      '',
      '/verify-email?source=email',
    );
  });

  test('returns null without writing history when there is no fragment', () => {
    const replaceState = vi.fn();

    expect(
      captureAndClearAuthToken(
        { pathname: '/reset-password', search: '', hash: '' } as Location,
        { state: null, replaceState } as unknown as History,
      ),
    ).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
