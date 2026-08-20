import { describe, expect, it } from 'vitest';
import { canCloseMonth } from '../../utils/dateTime';

describe('fechamento mensal', () => {
  const referenceDate = new Date(2026, 7, 20, 12, 0, 0);

  it('permite fechar somente competencias anteriores', () => {
    expect(canCloseMonth('2026-07', referenceDate)).toBe(true);
    expect(canCloseMonth('2026-08', referenceDate)).toBe(false);
    expect(canCloseMonth('2026-09', referenceDate)).toBe(false);
  });

  it('rejeita competencias invalidas', () => {
    expect(canCloseMonth('2026-13', referenceDate)).toBe(false);
    expect(canCloseMonth('agosto-2026', referenceDate)).toBe(false);
  });
});
