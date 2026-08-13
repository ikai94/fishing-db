import { describe, expect, test } from 'vitest';
import { readFishBaseSelection, writeFishBaseSelection } from './fish-base-selection';

const available = ['base-c', 'base-a', 'base-b'];

describe('Fish Base URL selection', () => {
  test('treats absent state as all current memberships and scope=none as none', () => {
    expect(readFishBaseSelection(available, new URLSearchParams())).toEqual(available);
    expect(readFishBaseSelection(available, new URLSearchParams('scope=none'))).toEqual([]);
  });

  test('round-trips selected and excluded representations while ignoring stale IDs', () => {
    expect(
      readFishBaseSelection(available, new URLSearchParams('baseIds=base-b,stale,base-a,base-b')),
    ).toEqual(['base-a', 'base-b']);
    expect(
      readFishBaseSelection(available, new URLSearchParams('excludeBaseIds=base-b,stale,base-b')),
    ).toEqual(['base-c', 'base-a']);
  });

  test('writes canonical all, none, selected-minority and excluded-minority states', () => {
    expect(writeFishBaseSelection('', available, available)).toBe('');
    expect(writeFishBaseSelection('', available, [])).toBe('scope=none');
    expect(writeFishBaseSelection('', available, ['base-b'])).toBe('baseIds=base-b');
    expect(writeFishBaseSelection('', available, ['base-a', 'base-c'])).toBe(
      'excludeBaseIds=base-b',
    );
  });

  test('is deterministic and preserves unrelated search parameters', () => {
    expect(
      writeFishBaseSelection('view=compact&scope=none&baseIds=stale', available, [
        'base-c',
        'base-a',
      ]),
    ).toBe('view=compact&excludeBaseIds=base-b');
    expect(writeFishBaseSelection('', available, ['base-c', 'base-a'])).toBe(
      'excludeBaseIds=base-b',
    );
  });

  test('gives explicit none precedence over stale selection parameters', () => {
    expect(
      readFishBaseSelection(
        available,
        new URLSearchParams('scope=none&baseIds=base-a&excludeBaseIds=base-b'),
      ),
    ).toEqual([]);
  });
});
