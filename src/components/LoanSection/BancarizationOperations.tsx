import React, { useState } from 'react';
import { Ban, CheckCircle, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CredigrupoOperationSummary } from '../../lib/creditProviders/types';
import {
  cancelCredigrupoOperation,
  listCredigrupoOperations,
  reconcileCredigrupoOperation,
} from '../../services/credigrupoService';

interface BancarizationOperationsProps {
  enabled: boolean;
  refreshKey: number;
  showToast: (message: string, type?: 'success' | 'error') => void;
  onOpenLoan: (loanId: string) => void;
}

const formatMoney = (cents: number) =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const statusLabel = (status: string) => ({
  CREATING: 'Criando proposta',
  AWAITING_LENDER_PAYMENT: 'Aguardando funding',
  AWAITING_SIGNATURES: 'Aguardando assinaturas',
  SIGNED: 'Assinado, desembolsando',
  FUNDED: 'Desembolsado',
  CANCELLED: 'Cancelado',
  CANCELLATION_REQUESTED: 'Cancelamento solicitado',
  RECONCILIATION_REQUIRED: 'Requer conciliacao',
}[status] || status.replaceAll('_', ' '));

const allowedExternalHosts = new Set(['app.zapsign.com.br', 'storage.supabase.co']);

const safeOpen = (value?: string) => {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && allowedExternalHosts.has(url.hostname.toLowerCase())) {
      window.open(url.toString(), '_blank', 'noopener,noreferrer');
    }
  } catch {
    // URLs externas invalidas permanecem bloqueadas.
  }
};

const BancarizationOperations: React.FC<BancarizationOperationsProps> = ({ enabled, refreshKey, showToast, onOpenLoan }) => {
  const [operations, setOperations] = useState<CredigrupoOperationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const load = async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      setOperations(await listCredigrupoOperations());
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao carregar bancarizacoes', 'error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    void load();
  }, [enabled, refreshKey]);

  if (!enabled) return null;

  const handleReconcile = async (operationId: string) => {
    setProcessingId(operationId);
    try {
      await reconcileCredigrupoOperation(operationId);
      showToast('Operacao conciliada com a Credigrupo', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha na conciliacao', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (operationId: string) => {
    if (!window.confirm('Cancelar esta proposta bancarizada antes da assinatura?')) return;
    setProcessingId(operationId);
    try {
      await cancelCredigrupoOperation(operationId);
      showToast('Cancelamento solicitado', 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao cancelar', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const visibleOperations = operations.filter((operation) => operation.status !== 'CANCELLED').slice(0, 8);
  if (!loading && visibleOperations.length === 0) return null;

  return (
    <section className="rounded-[2rem] border border-[#BF953F]/20 bg-[#050505] p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[#BF953F]" />
          <div><h3 className="text-[9px] font-black text-[#F5D77B] uppercase tracking-widest">Bancarizacoes Credigrupo</h3><p className="text-[7px] text-zinc-600 uppercase mt-1">Sandbox</p></div>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="p-2 text-zinc-500 hover:text-white disabled:opacity-50" aria-label="Atualizar bancarizacoes">
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      {loading && visibleOperations.length === 0 ? (
        <div className="py-5 flex justify-center"><Loader2 size={16} className="animate-spin text-[#BF953F]" /></div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {visibleOperations.map((operation) => {
            const canCancel = !['SIGNED', 'FUNDED', 'CANCELLED', 'CANCELLATION_REQUESTED'].includes(operation.status);
            return (
              <article key={operation.id} className="rounded-2xl border border-zinc-900 bg-black p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[9px] font-black text-white uppercase">{operation.customerName}</p><p className="text-[7px] text-zinc-600 uppercase mt-1">{operation.investorName} - {operation.fundingSource === 'GR' ? 'Capital GR' : 'Capital externo'}</p></div>
                  <span className="text-[7px] font-black uppercase px-2 py-1 rounded-full bg-[#BF953F]/10 text-[#F5D77B]">{statusLabel(operation.status)}</span>
                </div>
                <div className="flex items-center justify-between text-[8px]"><span className="text-zinc-500">Valor</span><strong className="text-white">{formatMoney(operation.amountCents)}</strong></div>
                {operation.pix?.brcode && operation.status === 'AWAITING_LENDER_PAYMENT' && (
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(operation.pix?.brcode || ''); showToast('PIX copiado', 'success'); }} className="w-full py-2.5 rounded-xl bg-[#BF953F]/10 text-[#F5D77B] text-[8px] font-black uppercase flex items-center justify-center gap-2"><Copy size={12} /> Copiar PIX de funding</button>
                )}
                <div className="flex flex-wrap gap-2">
                  {operation.borrowerSignUrl && <button type="button" onClick={() => safeOpen(operation.borrowerSignUrl)} className="px-3 py-2 rounded-xl bg-blue-500/10 text-blue-400 text-[7px] font-black uppercase flex items-center gap-1"><ExternalLink size={11} /> Assinar cliente</button>}
                  {operation.investorSignUrl && <button type="button" onClick={() => safeOpen(operation.investorSignUrl)} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><ExternalLink size={11} /> Assinar investidor</button>}
                  {operation.localLoanId && operation.status === 'FUNDED' && <button type="button" onClick={() => onOpenLoan(operation.localLoanId || '')} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><CheckCircle size={11} /> Abrir contrato</button>}
                  <button type="button" disabled={processingId === operation.id} onClick={() => void handleReconcile(operation.id)} className="px-3 py-2 rounded-xl border border-zinc-800 text-zinc-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><RefreshCw size={11} className={processingId === operation.id ? 'animate-spin' : ''} /> Conciliar</button>
                  {canCancel && <button type="button" disabled={processingId === operation.id} onClick={() => void handleCancel(operation.id)} className="px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><Ban size={11} /> Cancelar</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default BancarizationOperations;
