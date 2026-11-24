import { describe, expect, it } from 'vitest';
import { getFinancialMonthKey, parseFinancialDate } from '../dateTime';

describe('datas financeiras compartilhadas por tela e PDFs', () => {
  it.each(['2026-01-01', '2026-11-01', '2026-12-31', '2024-02-29'])('preserva o dia civil de %s', (value) => {
    const date = parseFinancialDate(value)!;
    expect(date.getFullYear()).toBe(Number(value.slice(0, 4)));
    expect(date.getMonth() + 1).toBe(Number(value.slice(5, 7)));
    expect(date.getDate()).toBe(Number(value.slice(8, 10)));
    expect(date.getHours()).toBe(12);
    expect(getFinancialMonthKey(value)).toBe(value.slice(0, 7));
  });

  it('preserva instantes completos e aceita Timestamp sem alterar o original', () => {
    const original = new Date('2026-11-01T01:00:00.000Z');
    for (const input of [original, original.toISOString(), original.getTime(), { toDate: () => original }]) {
      const parsed = parseFinancialDate(input)!;
      expect(parsed.getTime()).toBe(original.getTime());
      expect(getFinancialMonthKey(input)).toBe(`${original.getFullYear()}-${String(original.getMonth() + 1).padStart(2, '0')}`);
      expect(parsed).not.toBe(original);
    }
  });

  it.each(['2026-02-29', '2026-11-31', '2026-13-01', '', 'invalido', null, undefined, {}, new Date(NaN)])(
    'rejeita datas invalidas sem inclui-las em outro mes: %s', (input) => {
      expect(parseFinancialDate(input)).toBeNull();
      expect(getFinancialMonthKey(input)).toBeNull();
    },
  );
});
