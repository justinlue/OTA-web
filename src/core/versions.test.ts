import { describe, expect, it } from 'vitest';
import { compareVersions } from './versions';

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('v1.2.3', '1.2.4')).toBe(-1);
  });

  it('falls back to string comparison for non-numeric parts', () => {
    expect(compareVersions('1.0.0-beta', '1.0.0-alpha')).toBe(1);
  });
});
