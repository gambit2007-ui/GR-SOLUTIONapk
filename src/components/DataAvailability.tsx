import type { ReactNode } from 'react';
import type { DataStatus } from '../utils/realtimeResource';

export const DataAvailability = ({ status, onRetry, children }: {
  status: DataStatus; onRetry: () => void; children: ReactNode;
}) => {
  if (status === 'ready') return <>{children}</>;
  return <section role={status === 'error' ? 'alert' : 'status'} aria-live="polite"
    className="rounded-3xl border border-[#BF953F]/30 bg-[#050505] p-6 text-center space-y-4">
    <h2 className="text-sm font-bold text-[#F5D77B]">
      {status === 'error' ? 'Dados financeiros indisponiveis' : 'Sincronizando dados financeiros'}
    </h2>
    <p className="text-xs text-zinc-400 leading-relaxed">
      Os indicadores e operacoes desta tela ficam indisponiveis ate confirmar os dados.
      Falha de leitura nao significa saldo zero. Confira sua conexao.
    </p>
    <button type="button" onClick={onRetry}
      className="px-5 py-3 rounded-xl border border-[#BF953F]/40 text-[#F5D77B] text-xs font-bold">
      Tentar novamente
    </button>
  </section>;
};
