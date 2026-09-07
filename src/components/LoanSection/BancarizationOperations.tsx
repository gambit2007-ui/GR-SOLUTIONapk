import React, { useState } from 'react';
import { Ban, CheckCircle, Copy, ExternalLink, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { CredigrupoOperationSummary } from '../../lib/creditProviders/types';
import { formatCredigrupoFormalizationStatus } from '../../lib/creditProviders/loanStatus';
import { validateCredigrupoSigningUrl } from '../../lib/creditProviders/signingUrl';
import {
  canCancelCredigrupoOperation,
  canConfirmExistingCredigrupoLoan,
  canDiscoverExistingCredigrupoLoan,
  canReconcileCredigrupoOperation,
  canTestCredigrupoFunding,
} from '../../lib/creditProviders/operationActions';
import {
  cancelCredigrupoOperation,
  discoverExistingCredigrupoLoan,
  listCredigrupoOperations,
  reconcileConfirmedCredigrupoLoan,
  reconcileCredigrupoOperation,
  recoverCredigrupoSigningLinks,
  testPayCredigrupoSandbox,
} from '../../services/credigrupoService';

interface BancarizationOperationsProps {
  enabled: boolean;
  refreshKey: number;
  showToast: (message: string, type?: 'success' | 'error') => void;
  onOpenLoan: (loanId: string) => void;
  isAdmin: boolean;
  isSandbox: boolean;
}

interface ConfirmedReconciliationDraft {
  operationId: string;
  proposalId: string;
  requestId: string;
  amountCents: string;
  expiresAt: string;
  correlationId: string;
}

const formatMoney = (cents: number) =>
  (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const statusLabel = (status: string) => ({
  CREATING: 'Criando proposta',
  AWAITING_LENDER_PAYMENT: 'Aguardando funding',
  AWAITING_SIGNATURES: 'Aguardando assinaturas',
  SIGNED: 'Assinado, ativando contrato',
  FUNDED: 'Desembolsado',
  CANCELLED: 'Cancelado',
  CANCELLATION_REQUESTED: 'Cancelamento solicitado',
  RECONCILIATION_REQUIRED: 'Requer conciliacao',
  CREATE_FAILED: 'Falha ao criar',
}[status] || status.replaceAll('_', ' '));

const safeOpen = (value?: string) => {
  if (!value) return;
  const validation = validateCredigrupoSigningUrl(value);
  if (validation.valid) {
    window.open(validation.url, '_blank', 'noopener,noreferrer');
  }
};

const BancarizationOperations: React.FC<BancarizationOperationsProps> = ({ enabled, refreshKey, showToast, onOpenLoan, isAdmin, isSandbox }) => {
  const [operations, setOperations] = useState<CredigrupoOperationSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [confirmedDraft, setConfirmedDraft] = useState<ConfirmedReconciliationDraft | null>(null);
  const [testPayConfirmationId, setTestPayConfirmationId] = useState<string | null>(null);

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

  const handleRecoverSigningLinks = async (operationId: string) => {
    setProcessingId(operationId);
    try {
      const result = await recoverCredigrupoSigningLinks(operationId);
      const investorResult = result.investorPreSigned ? ' Investidor ja pre-assinado.' : '';
      const signingHosts = result.investorHostname && result.investorHostname !== result.borrowerHostname
        ? `${result.borrowerHostname} / ${result.investorHostname}`
        : result.borrowerHostname;
      showToast(`Links de assinatura recuperados (${signingHosts}).${investorResult}`, 'success');
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao recuperar links de assinatura', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDiscover = async (operationId: string) => {
    setProcessingId(operationId);
    try {
      const result = await discoverExistingCredigrupoLoan(operationId);
      if (result.status === 'RECONCILED') {
        showToast(result.alreadyReconciled ? 'Negociacao ja estava reconciliada' : 'Negociacao localizada e reconciliada', 'success');
      } else if (result.status === 'AMBIGUOUS') {
        showToast('Mais de uma negociacao possivel. Revise manualmente.', 'error');
      } else {
        showToast('Negociacao nao localizada na primeira pagina da Credigrupo.', 'error');
      }
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao localizar negociacao', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const handleConfirmedReconciliation = async () => {
    if (!confirmedDraft) return;
    const operationId = confirmedDraft.operationId;
    const proposalId = confirmedDraft.proposalId.trim();
    const requestId = confirmedDraft.requestId.trim();
    const expiresAt = confirmedDraft.expiresAt.trim();
    const correlationId = confirmedDraft.correlationId.trim();
    const amountCents = Number(confirmedDraft.amountCents);
    if (!proposalId || !requestId || !correlationId) {
      showToast('Preencha todos os metadados confirmados.', 'error');
      return;
    }
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || Number.isNaN(Date.parse(expiresAt))) {
      showToast('Metadados confirmados invalidos.', 'error');
      return;
    }

    setProcessingId(operationId);
    try {
      await reconcileConfirmedCredigrupoLoan({
        operationId,
        proposalId,
        requestId,
        pix: { amountCents, expiresAt, correlationId },
      });
      showToast('Proposta confirmada e reconciliada.', 'success');
      setConfirmedDraft(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha na conciliacao confirmada', 'error');
    } finally {
      setProcessingId(null);
    }
  };

  const openConfirmedReconciliation = (operationId: string) => {
    setConfirmedDraft({ operationId, proposalId: '', requestId: '', amountCents: '', expiresAt: '', correlationId: '' });
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

  const handleTestFunding = async (operationId: string) => {
    setProcessingId(operationId);
    try {
      await testPayCredigrupoSandbox({ operationId });
      showToast('Funding simulado. Aguarde os eventos da Credigrupo.', 'success');
      setTestPayConfirmationId(null);
      await load();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao simular funding', 'error');
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
            const canReconcile = canReconcileCredigrupoOperation(operation, isAdmin);
            const canDiscover = canDiscoverExistingCredigrupoLoan(operation, isAdmin);
            const canConfirm = canConfirmExistingCredigrupoLoan(operation, isAdmin);
            const canCancel = canCancelCredigrupoOperation(operation, isAdmin);
            const canTestFunding = canTestCredigrupoFunding(operation, isAdmin, isSandbox);
            return (
              <article key={operation.id} className="rounded-2xl border border-zinc-900 bg-black p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[9px] font-black text-white uppercase">{operation.customerName}</p><p className="text-[7px] text-zinc-600 uppercase mt-1">{operation.investorName} - {operation.fundingSource === 'GR' ? 'Capital GR' : 'Capital externo'}</p></div>
                  <span className="text-[7px] font-black uppercase px-2 py-1 rounded-full bg-[#BF953F]/10 text-[#F5D77B]">{statusLabel(operation.status)}</span>
                </div>
                <div className="flex items-center justify-between text-[8px]"><span className="text-zinc-500">Valor</span><strong className="text-white">{formatMoney(operation.amountCents)}</strong></div>
                <div className="grid grid-cols-2 gap-2 rounded-xl border border-zinc-900 px-3 py-2 text-[7px] uppercase">
                  <div><span className="text-zinc-600">Status Credigrupo</span><p className="mt-1 font-black text-zinc-300">{operation.externalStatus || 'Nao informado'}</p></div>
                  <div><span className="text-zinc-600">Formalizacao</span><p className="mt-1 font-black text-[#F5D77B]">{formatCredigrupoFormalizationStatus(operation.formalizationStatus)}</p></div>
                </div>
                {operation.pix?.brcode && operation.status === 'AWAITING_LENDER_PAYMENT' && (
                  <button type="button" onClick={() => { void navigator.clipboard.writeText(operation.pix?.brcode || ''); showToast('PIX copiado', 'success'); }} className="w-full py-2.5 rounded-xl bg-[#BF953F]/10 text-[#F5D77B] text-[8px] font-black uppercase flex items-center justify-center gap-2"><Copy size={12} /> Copiar PIX de funding</button>
                )}
                <div className="flex flex-wrap gap-2">
                  {operation.borrowerSignUrl && <button type="button" onClick={() => safeOpen(operation.borrowerSignUrl)} className="px-3 py-2 rounded-xl bg-blue-500/10 text-blue-400 text-[7px] font-black uppercase flex items-center gap-1"><ExternalLink size={11} /> Assinar cliente</button>}
                  {operation.investorSignUrl && <button type="button" onClick={() => safeOpen(operation.investorSignUrl)} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><ExternalLink size={11} /> Assinar investidor</button>}
                  {operation.investorSignaturePreSigned && <span className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><CheckCircle size={11} /> Investidor pre-assinado</span>}
                  {isAdmin && operation.status === 'AWAITING_SIGNATURES' && (!operation.borrowerSignUrl || (!operation.investorSignUrl && !operation.investorSignaturePreSigned)) && <button type="button" disabled={processingId === operation.id} onClick={() => void handleRecoverSigningLinks(operation.id)} className="px-3 py-2 rounded-xl border border-blue-500/30 text-blue-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><RefreshCw size={11} className={processingId === operation.id ? 'animate-spin' : ''} /> Recuperar links CCB</button>}
                  {operation.localLoanId && operation.status === 'FUNDED' && <button type="button" onClick={() => onOpenLoan(operation.localLoanId || '')} className="px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><CheckCircle size={11} /> Abrir contrato</button>}
                  {canDiscover && <button type="button" disabled={processingId === operation.id} onClick={() => void handleDiscover(operation.id)} className="px-3 py-2 rounded-xl border border-amber-500/30 text-amber-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><RefreshCw size={11} className={processingId === operation.id ? 'animate-spin' : ''} /> Localizar negociacao</button>}
                  {canConfirm && <button type="button" disabled={processingId === operation.id} onClick={() => openConfirmedReconciliation(operation.id)} className="px-3 py-2 rounded-xl border border-blue-500/30 text-blue-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><CheckCircle size={11} /> Reconciliar ID confirmado</button>}
                  {canReconcile && <button type="button" disabled={processingId === operation.id} onClick={() => void handleReconcile(operation.id)} className="px-3 py-2 rounded-xl border border-zinc-800 text-zinc-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><RefreshCw size={11} className={processingId === operation.id ? 'animate-spin' : ''} /> Conciliar</button>}
                  {canTestFunding && testPayConfirmationId !== operation.id && <button type="button" disabled={processingId === operation.id} onClick={() => setTestPayConfirmationId(operation.id)} className="px-3 py-2 rounded-xl bg-amber-500/10 text-amber-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><ShieldCheck size={11} /> Simular funding</button>}
                  {canCancel && <button type="button" disabled={processingId === operation.id} onClick={() => void handleCancel(operation.id)} className="px-3 py-2 rounded-xl bg-red-500/10 text-red-400 text-[7px] font-black uppercase disabled:opacity-50 flex items-center gap-1"><Ban size={11} /> Cancelar</button>}
                </div>
                {confirmedDraft?.operationId === operation.id && (
                  <form onSubmit={(event) => { event.preventDefault(); void handleConfirmedReconciliation(); }} className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 space-y-3">
                    <p className="text-[8px] font-black uppercase text-blue-300">Confirmar proposta existente</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {([
                        ['proposalId', 'Proposal ID'],
                        ['requestId', 'Request ID'],
                        ['amountCents', 'PIX da taxa em centavos'],
                        ['expiresAt', 'Expiracao PIX (ISO)'],
                        ['correlationId', 'Correlation ID'],
                      ] as const).map(([field, label]) => (
                        <label key={field} className={field === 'correlationId' ? 'sm:col-span-2 space-y-1' : 'space-y-1'}>
                          <span className="block text-[7px] font-black uppercase text-zinc-500">{label}</span>
                          <input
                            required
                            autoComplete="off"
                            inputMode={field === 'amountCents' ? 'numeric' : 'text'}
                            value={confirmedDraft[field]}
                            onChange={(event) => setConfirmedDraft((current) => current ? { ...current, [field]: event.target.value } : current)}
                            className="w-full rounded-lg border border-zinc-800 bg-black px-3 py-2 text-[9px] text-white outline-none focus:border-blue-500/60"
                          />
                        </label>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={processingId === operation.id} className="px-3 py-2 rounded-lg bg-blue-500/15 text-blue-300 text-[7px] font-black uppercase disabled:opacity-50">Validar GET e reconciliar</button>
                      <button type="button" disabled={processingId === operation.id} onClick={() => setConfirmedDraft(null)} className="px-3 py-2 rounded-lg border border-zinc-800 text-zinc-500 text-[7px] font-black uppercase disabled:opacity-50">Fechar</button>
                    </div>
                  </form>
                )}
                {canTestFunding && testPayConfirmationId === operation.id && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-2">
                    <p className="text-[8px] font-black uppercase text-amber-300">Confirmar test-pay sandbox da taxa</p>
                    <p className="text-[8px] text-zinc-500">A acao sera enviada uma unica vez e nao representa pagamento real.</p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" disabled={processingId === operation.id} onClick={() => void handleTestFunding(operation.id)} className="px-3 py-2 rounded-lg bg-amber-500/15 text-amber-300 text-[7px] font-black uppercase disabled:opacity-50">Confirmar test-pay sandbox</button>
                      <button type="button" disabled={processingId === operation.id} onClick={() => setTestPayConfirmationId(null)} className="px-3 py-2 rounded-lg border border-zinc-800 text-zinc-500 text-[7px] font-black uppercase disabled:opacity-50">Voltar</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default BancarizationOperations;
