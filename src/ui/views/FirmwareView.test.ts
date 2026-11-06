import { describe, expect, it } from 'vitest';
import { S } from '../strings';
import { validateDraft } from './FirmwareView';

const draft = { module: 'ble', version: '1.5.0', url: 'https://cdn/x.bin', sha256: 'abc', size: '1024', models: 'LT-100, LT-200 ,', notes: ' n ' };

describe('validateDraft', () => {
  it('builds an entry, splitting and trimming models', () => {
    expect(validateDraft(draft, [])).toEqual({
      module: 'ble', version: '1.5.0', url: 'https://cdn/x.bin', sha256: 'abc', size: 1024, models: ['LT-100', 'LT-200'], notes: 'n',
    });
  });

  it('reports the first problem', () => {
    expect(validateDraft({ ...draft, module: 'gps' }, [])).toBe(S.firmware.errors.module);
    expect(validateDraft({ ...draft, version: ' ' }, [])).toBe(S.firmware.errors.version);
    expect(validateDraft({ ...draft, url: 'ftp://x' }, [])).toBe(S.firmware.errors.url);
    expect(validateDraft({ ...draft, size: '1.5' }, [])).toBe(S.firmware.errors.size);
  });

  it('rejects a version the same module already has, but not one another module has', () => {
    expect(validateDraft(draft, [{ module: 'ble', version: '1.5.0' }])).toBe(S.firmware.errors.duplicate);
    expect(validateDraft(draft, [{ module: 'lte', version: '1.5.0' }])).not.toBeTypeOf('string');
    // Editing the entry itself is not a duplicate.
    expect(validateDraft(draft, [{ module: 'ble', version: '1.5.0' }], { module: 'ble', version: '1.5.0' })).not.toBeTypeOf('string');
  });
});
