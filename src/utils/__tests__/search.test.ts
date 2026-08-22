import { describe, expect, it } from 'vitest';
import { normalizeSearchText } from '../search';

describe('normalizeSearchText', () => {
  it('normaliza acentos, caixa e espacos para buscas por nome', () => {
    expect(normalizeSearchText('  Joao VICTOR  ')).toBe('joao victor');
    expect(normalizeSearchText('João Víctor')).toBe('joao victor');
  });

  it('aceita valores ausentes sem interromper a busca', () => {
    expect(normalizeSearchText(undefined)).toBe('');
    expect(normalizeSearchText(null)).toBe('');
  });
});
