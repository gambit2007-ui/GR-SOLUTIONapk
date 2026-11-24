import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataAvailability } from '../DataAvailability';

describe('protege indicadores e acoes quando faltam dados', () => {
  it.each(['idle', 'loading', 'error'] as const)('nao renderiza valores nem formulario em %s', (status) => {
    const html = renderToStaticMarkup(<DataAvailability status={status} onRetry={() => {}}>
      <button>Confirmar pagamento</button><span>R$ 0,00</span>
    </DataAvailability>);
    expect(html).not.toContain('Confirmar pagamento');
    expect(html).not.toContain('R$ 0,00');
    expect(html).toContain('Tentar novamente');
  });
  it('libera a tela somente quando os dados estao prontos', () => {
    const html = renderToStaticMarkup(<DataAvailability status="ready" onRetry={() => {}}>
      <span>Saldo confirmado</span>
    </DataAvailability>);
    expect(html).toContain('Saldo confirmado');
    expect(html).not.toContain('Tentar novamente');
  });
});
