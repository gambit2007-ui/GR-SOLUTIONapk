import React, { useMemo, useState } from 'react';
import { LoaderCircle, ScanSearch, ShieldCheck, X } from 'lucide-react';
import type { CashMovement, Loan } from '../types';
import {
  applySafeLegacyPaymentMigration,
  buildLegacyPaymentMigrationPreview,
  type LegacyMigrationPreview,
} from '../services/legacyPaymentMigrationService';
import {
  listRecentOperationalErrors,
  type OperationalDiagnosticEvent,
} from '../services/operationalLoggingService';
import {
  archiveCredigrupoHomologation,
  auditCredigrupoHomologation,
  CredigrupoServiceError,
  getCredigrupoRuntimeDiagnostics,
} from '../services/credigrupoService';
import type { CredigrupoHomologationAudit, CredigrupoRuntimeDiagnostics } from '../lib/creditProviders/types';
import { formatDateTimeBR } from '../utils/dateTime';
import { resolveCashDelta } from '../utils/domainParsers';
import { buildFinancialAudit } from '../utils/financialAudit';
import { getReversedCashMovementIds, groupCashBookMonthMovements } from '../utils/cashBookPresentation';
import { effectiveLoanStatus } from '../utils/loanCompat';
import { listRecentCreditRiskDecisions, type CreditRiskDecisionRecord } from '../services/creditRiskAuditService';
import { listRecentFinancialAuditEvents, type FinancialAuditEvent } from '../services/financialAuditEventService';
import BankStatementAudit from './BankStatementAudit';

interface AuditTabProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  cashMovementsStatus: 'idle' | 'loading' | 'ready' | 'error';
  caixa: number;
  currentUserUid?: string;
  isAdmin: boolean;
  onNavigateToLoan: (loanId: string) => void;
  onDownloadBackup: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const loanStatusLabel: Record<string, string> = {
  ACTIVE: 'Ativo',
  COMPLETED: 'Concluido',
  CANCELLED: 'Cancelado',
};

const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

const formatCurrency = (value: number) =>
  roundMoney(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const getMovementDisplayAmount = (movement: CashMovement) =>
  Math.abs(roundMoney(Number(movement.amount ?? movement.value ?? 0)));

const getMovementTime = (movement: CashMovement) => {
  const timestamp = new Date(movement.date).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getMovementActorLabel = (movement: CashMovement) => {
  if (movement.createdByName?.trim()) return movement.createdByName.trim();
  if (movement.createdByEmail?.trim()) return movement.createdByEmail.trim();
  if (movement.createdByUid?.trim()) return movement.createdByUid.trim();
  return 'Sistema';
};

const groupByMonth = <T,>(items: T[], getDate: (item: T) => string) =>
  items.reduce<Record<string, T[]>>((groups, item) => {
    const date = new Date(getDate(item));
    const monthYear = Number.isNaN(date.getTime())
      ? 'Sem data'
      : date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    (groups[monthYear] ||= []).push(item);
    return groups;
  }, {});

const AuditTab: React.FC<AuditTabProps> = ({
  loans,
  cashMovements,
  cashMovementsStatus,
  caixa,
  currentUserUid,
  isAdmin,
  onNavigateToLoan,
  onDownloadBackup,
  showToast,
}) => {
  const [migrationPreview, setMigrationPreview] = useState<LegacyMigrationPreview | null>(null);
  const [isAuditingLegacyPayments, setIsAuditingLegacyPayments] = useState(false);
  const [isApplyingLegacyMigration, setIsApplyingLegacyMigration] = useState(false);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalDiagnosticEvent[] | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [credigrupoDiagnostics, setCredigrupoDiagnostics] = useState<CredigrupoRuntimeDiagnostics | null>(null);
  const [isLoadingCredigrupoDiagnostics, setIsLoadingCredigrupoDiagnostics] = useState(false);
  const [homologationAudit, setHomologationAudit] = useState<CredigrupoHomologationAudit | null>(null);
  const [isLoadingHomologationAudit, setIsLoadingHomologationAudit] = useState(false);
  const [archivingHomologationOperationId, setArchivingHomologationOperationId] = useState<string | null>(null);
  const [expandedMonthLoans, setExpandedMonthLoans] = useState<string | null>(null);
  const [expandedMonthMovements, setExpandedMonthMovements] = useState<string | null>(null);
  const [selectedCashMovement, setSelectedCashMovement] = useState<CashMovement | null>(null);
  const [creditRiskDecisions, setCreditRiskDecisions] = useState<CreditRiskDecisionRecord[] | null>(null);
  const [isLoadingCreditRiskDecisions, setIsLoadingCreditRiskDecisions] = useState(false);
  const [financialEvents, setFinancialEvents] = useState<FinancialAuditEvent[] | null>(null);
  const [isLoadingFinancialEvents, setIsLoadingFinancialEvents] = useState(false);

  const loadCreditRiskDecisions = async () => {
    if (!isAdmin || isLoadingCreditRiskDecisions) return;
    setIsLoadingCreditRiskDecisions(true);
    try {
      setCreditRiskDecisions(await listRecentCreditRiskDecisions());
    } catch (error) {
      console.error('Falha ao consultar auditoria de credito:', error);
      showToast('Nao foi possivel carregar decisoes de credito', 'error');
    } finally {
      setIsLoadingCreditRiskDecisions(false);
    }
  };

  const loadFinancialEvents = async () => {
    if (!isAdmin || isLoadingFinancialEvents) return;
    setIsLoadingFinancialEvents(true);
    try {
      setFinancialEvents(await listRecentFinancialAuditEvents());
    } catch (error) {
      console.error('Falha ao consultar eventos financeiros:', error);
      showToast('Nao foi possivel carregar a trilha financeira', 'error');
    } finally {
      setIsLoadingFinancialEvents(false);
    }
  };

  const financialAudit = useMemo(() => buildFinancialAudit({
    loans,
    cashMovements,
    recordedCashBalance: caixa,
  }), [caixa, cashMovements, loans]);

  const loansByMonth = useMemo(() => groupByMonth(loans, (loan) => loan.startDate), [loans]);
  const movementsByMonth = useMemo(
    () => groupByMonth(cashMovements, (movement) => movement.date),
    [cashMovements],
  );
  const reversedMovementIds = useMemo(
    () => getReversedCashMovementIds(cashMovements),
    [cashMovements],
  );

  const getMonthCashBalance = (monthMovements: CashMovement[]) => {
    const firstMovement = monthMovements[0];
    const monthDate = firstMovement ? new Date(firstMovement.date) : new Date();
    const monthStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getTime();
    const nextMonthStart = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1).getTime();

    const openingBalance = cashMovements.reduce((total, movement) => (
      getMovementTime(movement) < monthStart
        ? roundMoney(total + resolveCashDelta(movement))
        : total
    ), 0);
    const closingBalance = cashMovements.reduce((total, movement) => (
      getMovementTime(movement) < nextMonthStart
        ? roundMoney(total + resolveCashDelta(movement))
        : total
    ), 0);

    return {
      openingBalance: roundMoney(openingBalance),
      closingBalance: roundMoney(closingBalance),
    };
  };

  const handleLoadDiagnostics = async () => {
    if (isLoadingDiagnostics) return;
    if (diagnosticEvents !== null) {
      setDiagnosticEvents(null);
      return;
    }

    setIsLoadingDiagnostics(true);
    try {
      setDiagnosticEvents(await listRecentOperationalErrors());
    } catch (error) {
      console.error('Falha ao consultar diagnosticos:', error);
      showToast('Somente administradores podem consultar diagnosticos', 'error');
    } finally {
      setIsLoadingDiagnostics(false);
    }
  };

  const handleLoadCredigrupoDiagnostics = async () => {
    if (isLoadingCredigrupoDiagnostics) return;
    setIsLoadingCredigrupoDiagnostics(true);
    try {
      setCredigrupoDiagnostics(await getCredigrupoRuntimeDiagnostics());
    } catch (error) {
      console.error('Falha ao consultar runtime Credigrupo:', error);
      showToast('Somente administradores podem consultar o runtime', 'error');
    } finally {
      setIsLoadingCredigrupoDiagnostics(false);
    }
  };

  const handleAuditCredigrupoHomologation = async () => {
    if (!isAdmin || isLoadingHomologationAudit) return;
    setIsLoadingHomologationAudit(true);
    try {
      const result = await auditCredigrupoHomologation();
      setHomologationAudit(result.audit);
      showToast('Auditoria de homologacao concluida sem alteracoes', 'success');
    } catch (error) {
      console.error('Falha ao auditar homologacao Credigrupo:', error);
      showToast('Nao foi possivel consultar a auditoria de homologacao', 'error');
    } finally {
      setIsLoadingHomologationAudit(false);
    }
  };

  const handleArchiveCredigrupoHomologation = async (operationId: string, customerName: string) => {
    if (!isAdmin || archivingHomologationOperationId) return;
    const confirmed = window.confirm(
      `Arquivar ${customerName} e os vinculos de homologacao Credigrupo? A proposta e a auditoria serao preservadas, sem cancelar ou alterar valores financeiros.`,
    );
    if (!confirmed) return;

    setArchivingHomologationOperationId(operationId);
    try {
      const result = await archiveCredigrupoHomologation(operationId);
      const refreshed = await auditCredigrupoHomologation();
      setHomologationAudit(refreshed.audit);
      showToast(result.alreadyArchived ? 'Dados de homologacao ja estavam arquivados' : 'Dados de homologacao arquivados com seguranca', 'success');
    } catch (error) {
      console.error('Falha ao arquivar homologacao Credigrupo:', error);
      const archiveBlockers: Record<string, string> = {
        CUSTOMER_NOT_FOUND: 'Arquivamento bloqueado: cliente de homologacao nao encontrado.',
        NO_CREDIGRUPO_RECORDS: 'Arquivamento bloqueado: nenhum vinculo Credigrupo foi encontrado.',
        FINANCIAL_EFFECT_FOUND: 'Arquivamento bloqueado: existe vinculo financeiro associado.',
        UNCONFIRMED_SANDBOX_RECORD: 'Arquivamento bloqueado: a origem sandbox nao foi confirmada.',
      };
      const message = error instanceof CredigrupoServiceError
        ? archiveBlockers[error.code]
        : undefined;
      showToast(message || 'Nao foi possivel arquivar a homologacao. Nenhum dado financeiro foi alterado.', 'error');
    } finally {
      setArchivingHomologationOperationId(null);
    }
  };

  const handleAuditLegacyPayments = async () => {
    if (isAuditingLegacyPayments) return;
    setIsAuditingLegacyPayments(true);
    try {
      const preview = await buildLegacyPaymentMigrationPreview();
      setMigrationPreview(preview);
      showToast(`Auditoria concluida: ${preview.safeToMigrate} pagamento(s) seguro(s) para migrar`, 'success');
    } catch (error) {
      console.error('Falha ao auditar pagamentos antigos:', error);
      showToast('Nao foi possivel auditar pagamentos antigos', 'error');
    } finally {
      setIsAuditingLegacyPayments(false);
    }
  };

  const handleApplyLegacyMigration = async () => {
    if (!migrationPreview || !currentUserUid || migrationPreview.safeToMigrate <= 0) return;
    if (!window.confirm(`Migrar ${migrationPreview.safeToMigrate} pagamento(s) classificados como seguros? Um backup sera baixado antes.`)) return;

    setIsApplyingLegacyMigration(true);
    try {
      await onDownloadBackup();
      const result = await applySafeLegacyPaymentMigration(migrationPreview, currentUserUid);
      showToast(`${result.migratedInstallments} pagamento(s) antigo(s) migrado(s) com seguranca`, 'success');
      setMigrationPreview(await buildLegacyPaymentMigrationPreview());
    } catch (error) {
      console.error('Falha ao migrar pagamentos antigos:', error);
      showToast('Migracao interrompida; execute a auditoria novamente', 'error');
    } finally {
      setIsApplyingLegacyMigration(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-[#050505] border border-zinc-900 rounded-[2rem] p-6 sm:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-2xl bg-[#BF953F]/10 border border-[#BF953F]/20">
            <ShieldCheck size={22} className="text-[#BF953F]" />
          </div>
          <div>
            <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">Auditoria e Historico</h2>
            <p className="mt-2 text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed">
              Integridade, contratos e rastreabilidade financeira
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { void handleAuditLegacyPayments(); }}
          disabled={isAuditingLegacyPayments}
          title="Gerar previa sem alterar pagamentos antigos"
          className="min-h-[42px] px-4 bg-zinc-950/80 border border-zinc-800 text-blue-400 rounded-xl font-black uppercase text-[8px] tracking-[0.12em] hover:border-blue-500/30 transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ScanSearch size={14} /> {isAuditingLegacyPayments ? 'Auditando...' : 'Auditar Legado'}
        </button>
      </div>

      {isAdmin && (
        <BankStatementAudit
          loans={loans}
          cashMovements={cashMovements}
          cashMovementsStatus={cashMovementsStatus}
          currentUserUid={currentUserUid}
          showToast={showToast}
        />
      )}

      {isAdmin && (
        <section className="rounded-[2rem] border border-[#BF953F]/20 bg-[#050505] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-[#BF953F]">Decisoes de risco de credito</h3>
              <p className="mt-1 text-[9px] text-zinc-500">Concessoes com exposicao e liberacoes excepcionais registradas no servidor.</p>
            </div>
            <button type="button" onClick={() => { void loadCreditRiskDecisions(); }} disabled={isLoadingCreditRiskDecisions} className="rounded-xl border border-zinc-800 px-4 py-2 text-[8px] font-black uppercase text-zinc-300 disabled:opacity-50">
              {isLoadingCreditRiskDecisions ? 'Carregando...' : 'Consultar ultimas 50'}
            </button>
          </div>
          {creditRiskDecisions !== null && (
            <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
              {creditRiskDecisions.length === 0 && <p className="text-[9px] text-zinc-500">Nenhuma decisao registrada.</p>}
              {creditRiskDecisions.map((decision) => (
                <div key={decision.id} className="rounded-xl border border-zinc-800 p-3 text-[9px] text-zinc-300">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-black uppercase text-white">{decision.action === 'EXCEPTIONAL_CREDIT_RELEASE' ? 'Liberacao excepcional de credito' : decision.action === 'NEW_GRANT_WITH_EXISTING_EXPOSURE' ? 'Nova concessao com exposicao existente' : 'Nova concessao de credito'}</p>
                    <span className="text-zinc-500">{decision.createdAt?.toDate?.().toLocaleString('pt-BR') || 'Sem data'}</span>
                  </div>
                  <p className="mt-1">Cliente: {decision.customerName || decision.customerId} · Responsavel: {decision.actorName || decision.actorEmail || 'Nao identificado'}</p>
                  <p className="mt-1">Contratos ativos: {decision.activeLoanIds?.join(', ') || 'nenhum'} · Saldo: {formatCurrency(decision.openAmount)} · Vencido: {formatCurrency(decision.overdueAmount)}</p>
                  <p className="mt-1">Atraso atual: {decision.maxCurrentOverdueDays} dias · Historico: {decision.maxHistoricalOverdueDays} dias · Situacao: {decision.status || 'registrada'}</p>
                  <p className="mt-1">Contrato: {decision.loanId || 'aguardando'} · Operacao: {decision.operationId || decision.id}</p>
                  {decision.justification && <p className="mt-2 border-t border-zinc-800 pt-2 text-amber-400">Motivo: {decision.justification}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isAdmin && (
        <section className="rounded-[2rem] border border-zinc-900 bg-[#050505] p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[9px] font-black uppercase tracking-widest text-[#BF953F]">Trilha permanente de alteracoes</h3>
              <p className="mt-1 text-[9px] text-zinc-500">Edicoes, cancelamentos e exclusoes seguros de contratos. Pagamentos e estornos permanecem no livro caixa; fechamentos mensais sao imutaveis.</p>
            </div>
            <button type="button" onClick={() => { void loadFinancialEvents(); }} disabled={isLoadingFinancialEvents} className="rounded-xl border border-zinc-800 px-4 py-2 text-[8px] font-black uppercase text-zinc-300 disabled:opacity-50">
              {isLoadingFinancialEvents ? 'Carregando...' : 'Consultar ultimos 50'}
            </button>
          </div>
          {financialEvents !== null && (
            <div className="mt-4 max-h-96 space-y-2 overflow-y-auto">
              {financialEvents.length === 0 && <p className="text-[9px] text-zinc-500">Nenhuma alteracao registrada desde a ativacao desta trilha.</p>}
              {financialEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-zinc-800 p-3 text-[9px] text-zinc-300">
                  <div className="flex flex-wrap justify-between gap-2">
                    <p className="font-black uppercase text-white">{{
                      CONTRACT_EDIT: 'Edicao de contrato',
                      CANCELLATION: 'Cancelamento de contrato',
                      LOAN_DELETION: 'Exclusao segura de contrato',
                      CASH_RECONCILIATION: 'Conciliacao de caixa',
                    }[event.type]}</p>
                    <span className="text-zinc-500">{event.recordedAt?.toDate?.().toLocaleString('pt-BR') || 'Sem data'}</span>
                  </div>
                  <p className="mt-1">Contrato: {event.loanId || '—'} · Responsavel: {event.actorName || event.actorEmail || event.actorUid}</p>
                  {event.previousAmount !== undefined && <p className="mt-1">Principal anterior: {formatCurrency(event.previousAmount)}{event.newAmount !== undefined ? ` · Novo principal: ${formatCurrency(event.newAmount)}` : ''}</p>}
                  {event.previousCash !== undefined && <p className="mt-1">Caixa: {formatCurrency(event.previousCash)} → {formatCurrency(event.newCash || 0)}</p>}
                  {event.reason && <p className="mt-1 text-amber-400">Motivo: {event.reason}</p>}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {migrationPreview && (
        <div className="bg-[#050505] border border-zinc-900 rounded-2xl p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-[9px] font-black text-zinc-400 uppercase tracking-widest">Previa da migracao fiscal</p>
            <p className="mt-2 text-[10px] text-zinc-600 uppercase tracking-wider">
              Seguros: <span className="text-emerald-500 font-black">{migrationPreview.safeToMigrate}</span>
              {' | '}Revisao manual: <span className="text-[#BF953F] font-black">{migrationPreview.reviewRequired}</span>
              {' | '}Ignorados: <span className="text-zinc-400 font-black">{migrationPreview.skipped}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => { void handleApplyLegacyMigration(); }}
            disabled={isApplyingLegacyMigration || migrationPreview.safeToMigrate <= 0 || !currentUserUid}
            className="px-4 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-xl font-black uppercase text-[8px] tracking-widest disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isApplyingLegacyMigration ? 'Migrando...' : 'Baixar backup e migrar seguros'}
          </button>
        </div>
      )}

      <div className={`bg-[#050505] border rounded-[2rem] p-5 sm:p-6 ${
        financialAudit.isConsistent ? 'border-emerald-500/20' : 'border-red-500/30'
      }`}>
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck size={15} className={financialAudit.isConsistent ? 'text-emerald-500' : 'text-red-500'} />
              <p className="text-[9px] font-black text-zinc-300 uppercase tracking-widest">
                Auditoria de integridade financeira
              </p>
            </div>
            <p className="mt-2 text-[9px] text-zinc-600 uppercase tracking-wider">
              {financialAudit.isConsistent
                ? 'Caixa reconciliado e sem divergencias criticas detectadas'
                : `${financialAudit.errors} erro(s) e ${financialAudit.warnings} alerta(s) encontrados`}
            </p>
            <button
              type="button"
              onClick={() => { void handleLoadDiagnostics(); }}
              disabled={isLoadingDiagnostics}
              className="mt-3 text-[8px] font-black uppercase tracking-widest text-zinc-500 hover:text-blue-400 disabled:opacity-50"
            >
              {isLoadingDiagnostics
                ? 'Carregando diagnosticos...'
                : diagnosticEvents === null ? 'Ver diagnosticos recentes' : 'Ocultar diagnosticos'}
            </button>
            {isAdmin && <>
              <button
                type="button"
                onClick={() => { void handleLoadCredigrupoDiagnostics(); }}
                disabled={isLoadingCredigrupoDiagnostics}
                className="mt-3 ml-4 text-[8px] font-black uppercase tracking-widest text-zinc-500 hover:text-[#BF953F] disabled:opacity-50"
              >
                {isLoadingCredigrupoDiagnostics ? 'Verificando runtime...' : 'Diagnosticar runtime Credigrupo'}
              </button>
              <button
                type="button"
                onClick={() => { void handleAuditCredigrupoHomologation(); }}
                disabled={isLoadingHomologationAudit}
                className="mt-3 ml-4 text-[8px] font-black uppercase tracking-widest text-zinc-500 hover:text-[#BF953F] disabled:opacity-50"
              >
                {isLoadingHomologationAudit ? 'Auditando homologacao...' : 'Auditar dados de homologacao'}
              </button>
            </>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-0 lg:min-w-[520px]">
            <div className="rounded-xl border border-zinc-900 px-3 py-2.5">
              <p className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">Saldo informado</p>
              <p className="mt-1 text-[10px] font-black text-white">R$ {financialAudit.recordedCashBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-xl border border-zinc-900 px-3 py-2.5">
              <p className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">Saldo calculado</p>
              <p className="mt-1 text-[10px] font-black text-white">R$ {financialAudit.expectedCashBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="rounded-xl border border-zinc-900 px-3 py-2.5">
              <p className="text-[7px] font-black text-zinc-600 uppercase tracking-widest">Diferenca</p>
              <p className={`mt-1 text-[10px] font-black ${Math.abs(financialAudit.cashDifference) <= 0.01 ? 'text-emerald-500' : 'text-red-500'}`}>
                R$ {financialAudit.cashDifference.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>

        {financialAudit.issues.length > 0 && (
          <div className="mt-4 border-t border-zinc-900 pt-4 grid grid-cols-1 lg:grid-cols-2 gap-2">
            {financialAudit.issues.slice(0, 6).map((issue, index) => (
              <div key={`${issue.code}-${issue.entityId || index}`} className="flex items-start gap-2 rounded-xl bg-black/40 px-3 py-2.5">
                <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${issue.severity === 'ERROR' ? 'bg-red-500' : 'bg-[#BF953F]'}`} />
                <div className="min-w-0">
                  <p className="text-[7px] font-black text-zinc-500 uppercase tracking-widest">{issue.code}</p>
                  <p className="mt-1 text-[9px] text-zinc-300 leading-relaxed">{issue.message}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {diagnosticEvents !== null && (
          <div className="mt-4 border-t border-zinc-900 pt-4">
            <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Falhas operacionais recentes</p>
            {diagnosticEvents.length === 0 ? (
              <p className="mt-3 text-[9px] text-emerald-500 uppercase tracking-wider">Nenhuma falha registrada</p>
            ) : (
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-2">
                {diagnosticEvents.map((event) => (
                  <div key={event.id} className="rounded-xl border border-zinc-900 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[8px] font-black text-zinc-300 uppercase tracking-wider">{event.source}</p>
                      <span className="text-[7px] text-zinc-600">
                        {event.recordedAt ? new Date(event.recordedAt).toLocaleString('pt-BR') : 'Sem horario'}
                      </span>
                    </div>
                    <p className="mt-1 text-[8px] text-red-500 font-black">{event.errorCode}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {credigrupoDiagnostics && (
          <pre className="mt-4 overflow-x-auto border-t border-zinc-900 pt-4 text-[9px] leading-relaxed text-zinc-400">
            {JSON.stringify(credigrupoDiagnostics, null, 2)}
          </pre>
        )}

        {homologationAudit && (
          <div className="mt-4 border-t border-zinc-900 pt-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[8px] font-black uppercase tracking-widest text-[#BF953F]">Auditoria de homologacao Credigrupo</p>
                <p className="mt-1 text-[8px] uppercase tracking-wider text-zinc-600">Somente leitura: sandbox e dados de teste explicitamente identificados</p>
              </div>
              <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">
                Robson Leandro possui outro cliente local: <span className={homologationAudit.robsonLeandro.hasSeparateLocalCustomer ? 'text-red-400' : 'text-emerald-500'}>{homologationAudit.robsonLeandro.hasSeparateLocalCustomer ? 'SIM' : 'NAO'}</span>
              </p>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
              {[
                ['Clientes sandbox', homologationAudit.totals.customerIds],
                ['Tomadores', homologationAudit.totals.borrowerIds],
                ['Simulacoes', homologationAudit.totals.simulations],
                ['Operacoes', homologationAudit.totals.operations],
                ['Propostas', homologationAudit.totals.proposals],
                ['Contratos reais', homologationAudit.totals.realContractsAffected],
                ['Caixa real', homologationAudit.totals.realCashMovementsAffected],
                ['Ledger real', homologationAudit.totals.realLedgerEntriesAffected],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-xl border border-zinc-900 bg-black/40 px-3 py-2.5">
                  <p className="text-[7px] font-black uppercase tracking-widest text-zinc-600">{label}</p>
                  <p className={`mt-1 text-[11px] font-black ${String(label).includes('reais') || String(label).includes('real') ? Number(value) === 0 ? 'text-emerald-500' : 'text-red-500' : 'text-white'}`}>{value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              {homologationAudit.customers.map((customer) => (
                (() => {
                  const archiveOperation = customer.operations.find((operation) => operation.environment === 'sandbox' && operation.testData === true);
                  return (
                    <div key={customer.customer.id} className="rounded-2xl border border-zinc-900 bg-black/40 p-4">
                      <div className="flex flex-col justify-between gap-2 sm:flex-row">
                        <div>
                          <p className="text-[9px] font-black uppercase tracking-widest text-white">{customer.customer.name || 'Cliente sem nome disponivel'}</p>
                          <p className="mt-1 break-all text-[8px] uppercase tracking-wider text-zinc-600">customerId: {customer.customer.id}</p>
                        </div>
                        <p className="text-[8px] font-black uppercase tracking-widest text-[#BF953F]">{customer.customer.environment || 'sem ambiente'} / testData: {customer.customer.testData ? 'SIM' : 'NAO'}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-2 text-[8px] uppercase tracking-wider text-zinc-500 md:grid-cols-2">
                        <p className="break-all">Borrower IDs: {customer.borrowerLinks.map((borrower) => borrower.borrowerId || borrower.id).join(', ') || 'Nenhum'}</p>
                        <p className="break-all">Simulation IDs: {customer.simulations.map((simulation) => simulation.id).join(', ') || 'Nenhuma'}</p>
                        <p className="break-all">External IDs: {customer.simulations.map((simulation) => simulation.externalId).filter(Boolean).join(', ') || 'Nenhum'}</p>
                        <p className="break-all">Operation IDs: {customer.operations.map((operation) => operation.id).join(', ') || 'Nenhuma'}</p>
                        <p className="break-all">Proposal IDs: {customer.operations.map((operation) => operation.proposalId).filter(Boolean).join(', ') || 'Nenhuma'}</p>
                        <p>Vinculos: {customer.linkedCounts.contracts} contrato(s), {customer.linkedCounts.cashMovements} movimento(s) de caixa, {customer.linkedCounts.ledgerEntries} registro(s) de ledger</p>
                      </div>
                      {isAdmin && archiveOperation && (
                        <button
                          type="button"
                          onClick={() => { void handleArchiveCredigrupoHomologation(archiveOperation.id, customer.customer.name || 'este cliente de teste'); }}
                          disabled={archivingHomologationOperationId !== null}
                          className="mt-4 rounded-xl border border-amber-500/40 px-3 py-2 text-[8px] font-black uppercase tracking-widest text-amber-400 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {archivingHomologationOperationId === archiveOperation.id ? 'Arquivando homologacao...' : 'Arquivar dados de homologacao'}
                        </button>
                      )}
                      {isAdmin && !archiveOperation && (
                        <p className="mt-4 text-[8px] font-black uppercase tracking-widest text-red-400">Arquivamento bloqueado: nenhuma operacao sandbox confirmada</p>
                      )}
                    </div>
                  );
                })()
              ))}
              {homologationAudit.customers.length === 0 && (
                <p className="py-4 text-center text-[8px] font-black uppercase tracking-widest text-zinc-600">Nenhum dado sandbox explicitamente marcado como teste foi encontrado</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[#050505] border border-zinc-900 p-6 sm:p-8 rounded-[2rem]">
          <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-6">Contratos por Mes</h3>
          <div className="space-y-3">
            {Object.entries(loansByMonth).map(([month, monthLoans]) => (
              <div key={month} className="border border-zinc-900 rounded-2xl overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedMonthLoans(expandedMonthLoans === month ? null : month)}
                  aria-expanded={expandedMonthLoans === month}
                  className="w-full p-4 flex items-center justify-between bg-black/40 hover:bg-zinc-900/50 transition-colors"
                >
                  <span className="text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[70%] text-left">
                    {month}
                  </span>
                  <span className="text-[9px] font-black text-[#BF953F] px-2 py-1 bg-[#BF953F]/10 rounded-lg">
                    {monthLoans.length}
                  </span>
                </button>
                {expandedMonthLoans === month && (
                  <div className="p-4 space-y-2 bg-black/20 border-t border-zinc-900 animate-in slide-in-from-top duration-200">
                    {monthLoans.map((loan) => {
                      const status = effectiveLoanStatus(loan);
                      return (
                        <button
                          key={loan.id}
                          type="button"
                          onClick={() => onNavigateToLoan(loan.id)}
                          className="w-full flex items-center justify-between gap-3 p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50 hover:border-[#BF953F]/40 transition-colors text-left"
                        >
                          <div className="min-w-0">
                            <p className="text-[9px] font-black text-white uppercase truncate">{loan.customerName}</p>
                            <p className="text-[8px] text-zinc-500 uppercase">{formatCurrency(loan.amount)}</p>
                          </div>
                          <span className={`text-[7px] font-black px-2 py-0.5 rounded-full uppercase shrink-0 ${
                            status === 'ACTIVE'
                              ? 'bg-emerald-500/10 text-emerald-500'
                              : status === 'COMPLETED'
                                ? 'bg-blue-500/10 text-blue-500'
                                : 'bg-zinc-800 text-zinc-500'
                          }`}>
                            {loanStatusLabel[status] || status}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
            {Object.keys(loansByMonth).length === 0 && (
              <p className="py-8 text-center text-[9px] text-zinc-600 uppercase tracking-widest">Nenhum contrato encontrado</p>
            )}
          </div>
        </section>

        <section className="bg-[#050505] border border-zinc-900 p-6 sm:p-8 rounded-[2rem]">
          <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-6">Livro Caixa</h3>
          <div className="space-y-3">
            {Object.entries(movementsByMonth).map(([month, monthMovements]) => {
              const { entryMovements, exitMovements, reversalMovements } = groupCashBookMonthMovements(
                monthMovements, reversedMovementIds,
              );
              const entryTotal = entryMovements.reduce(
                (total, movement) => total + getMovementDisplayAmount(movement),
                0,
              );
              const exitTotal = exitMovements.reduce(
                (total, movement) => total + getMovementDisplayAmount(movement),
                0,
              );
              const reversalNet = reversalMovements.reduce(
                (total, movement) => roundMoney(total + resolveCashDelta(movement)),
                0,
              );
              const { openingBalance, closingBalance } = getMonthCashBalance(monthMovements);

              return (
                <div key={month} className="border border-zinc-900 rounded-2xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedMonthMovements(expandedMonthMovements === month ? null : month)}
                    aria-expanded={expandedMonthMovements === month}
                    className="w-full p-4 flex items-center justify-between bg-black/40 hover:bg-zinc-900/50 transition-colors"
                  >
                    <span className="text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[70%] text-left">
                      {month}
                    </span>
                    <span className="text-[9px] font-black text-[#BF953F] px-2 py-1 bg-[#BF953F]/10 rounded-lg">
                      {monthMovements.length}
                    </span>
                  </button>
                  {expandedMonthMovements === month && (
                    <div className="p-4 bg-black/20 border-t border-zinc-900 animate-in slide-in-from-top duration-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-3">
                          <p className="text-[7px] font-black text-zinc-500 uppercase tracking-[0.2em]">Saldo inicial do mes</p>
                          <p className="text-sm font-black text-white mt-1">{formatCurrency(openingBalance)}</p>
                        </div>
                        <div className="bg-zinc-950/60 border border-zinc-900 rounded-2xl p-3">
                          <p className="text-[7px] font-black text-zinc-500 uppercase tracking-[0.2em]">Saldo final do mes</p>
                          <p className={`text-sm font-black mt-1 ${closingBalance >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {formatCurrency(closingBalance)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-3 px-1 gap-3">
                            <span className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.2em]">Entradas não estornadas</span>
                            <span className="text-[8px] font-black text-zinc-600 uppercase">Total: {formatCurrency(entryTotal)}</span>
                          </div>
                          {entryMovements.map((movement) => (
                            <button
                              key={movement.id}
                              type="button"
                              onClick={() => setSelectedCashMovement(movement)}
                              className="w-full flex items-start justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50 hover:border-emerald-500/30 transition-colors text-left"
                            >
                              <div className="min-w-0 flex-1 mr-3">
                                <p className="text-[9px] font-black text-white uppercase whitespace-normal break-words">{movement.description}</p>
                                <p className="text-[7px] text-zinc-500 uppercase tracking-tighter whitespace-normal break-words">
                                  {formatDateTimeBR(movement.date)} - {movement.type} - POR: {getMovementActorLabel(movement)}
                                </p>
                              </div>
                              <span className="text-[9px] font-black text-emerald-500 whitespace-nowrap">
                                + {formatCurrency(getMovementDisplayAmount(movement))}
                              </span>
                            </button>
                          ))}
                          {entryMovements.length === 0 && (
                            <p className="text-[8px] text-zinc-700 italic text-center py-4">Nenhuma entrada</p>
                          )}
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-3 px-1 gap-3">
                            <span className="text-[8px] font-black text-red-500 uppercase tracking-[0.2em]">Saídas sem estornos</span>
                            <span className="text-[8px] font-black text-zinc-600 uppercase">Total: {formatCurrency(exitTotal)}</span>
                          </div>
                          {exitMovements.map((movement) => (
                            <button
                              key={movement.id}
                              type="button"
                              onClick={() => setSelectedCashMovement(movement)}
                              className="w-full flex items-start justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50 hover:border-red-500/30 transition-colors text-left"
                            >
                              <div className="min-w-0 flex-1 mr-3">
                                <p className="text-[9px] font-black text-white uppercase whitespace-normal break-words">{movement.description}</p>
                                <p className="text-[7px] text-zinc-500 uppercase tracking-tighter whitespace-normal break-words">
                                  {formatDateTimeBR(movement.date)} - {movement.type} - POR: {getMovementActorLabel(movement)}
                                </p>
                              </div>
                              <span className="text-[9px] font-black text-red-500 whitespace-nowrap">
                                - {formatCurrency(getMovementDisplayAmount(movement))}
                              </span>
                            </button>
                          ))}
                          {exitMovements.length === 0 && (
                            <p className="text-[8px] text-zinc-700 italic text-center py-4">Nenhuma saida</p>
                          )}
                        </div>
                      </div>
                      {reversalMovements.length > 0 && (
                        <div className="mt-5 border-t border-zinc-900 pt-5">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
                            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-amber-400">Lançamentos estornados</span>
                            <span className="text-[8px] font-black uppercase text-zinc-500">
                              Efeito no mês: {reversalNet >= 0 ? '+' : '-'} {formatCurrency(Math.abs(reversalNet))}
                            </span>
                          </div>
                          <p className="mb-3 px-1 text-[8px] text-zinc-500">
                            Original e estorno continuam no histórico. O saldo mensal considera cada movimento na data em que ocorreu.
                          </p>
                          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                            {reversalMovements.map((movement) => {
                              const isReversal = movement.type === 'ESTORNO' || Boolean(movement.reversalOfMovementId);
                              return (
                                <button
                                  key={movement.id}
                                  type="button"
                                  onClick={() => setSelectedCashMovement(movement)}
                                  className="flex w-full items-start justify-between gap-3 rounded-xl border border-amber-500/20 bg-zinc-950/50 p-3 text-left transition-colors hover:border-amber-500/40"
                                >
                                  <div className="min-w-0 flex-1">
                                    <p className="break-words text-[9px] font-black uppercase text-zinc-300">{movement.description}</p>
                                    <p className="mt-1 text-[7px] font-black uppercase tracking-wider text-amber-400">
                                      {isReversal ? 'Estorno registrado' : 'Lançamento estornado'}
                                    </p>
                                    <p className="break-words text-[7px] uppercase text-zinc-500">
                                      {formatDateTimeBR(movement.date)} - POR: {getMovementActorLabel(movement)}
                                    </p>
                                  </div>
                                  <span className="whitespace-nowrap text-[9px] font-black text-zinc-400">
                                    {resolveCashDelta(movement) >= 0 ? '+' : '-'} {formatCurrency(getMovementDisplayAmount(movement))}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {(cashMovementsStatus === 'idle' || cashMovementsStatus === 'loading') && (
              <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-8 text-zinc-600">
                <LoaderCircle size={14} className="animate-spin text-[#BF953F]" />
                <p className="text-[9px] font-black uppercase tracking-widest">Carregando movimentacoes</p>
              </div>
            )}
            {cashMovementsStatus === 'error' && (
              <p role="alert" className="py-8 text-center text-[9px] font-black text-red-500 uppercase tracking-widest">
                Nao foi possivel carregar as movimentacoes
              </p>
            )}
            {cashMovementsStatus === 'ready' && Object.keys(movementsByMonth).length === 0 && (
              <p className="py-8 text-center text-[9px] text-zinc-600 uppercase tracking-widest">Nenhuma movimentacao encontrada</p>
            )}
          </div>
        </section>
      </div>

      {selectedCashMovement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-2xl bg-[#050505] border border-zinc-800 rounded-[2rem] p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 mb-6">
              <div>
                <p className="text-[9px] font-black text-[#BF953F] uppercase tracking-[0.25em] mb-2">Detalhe do Livro Caixa</p>
                <h4 className="text-xl font-black text-white uppercase leading-tight break-words">
                  {selectedCashMovement.description}
                </h4>
                {(selectedCashMovement.type === 'ESTORNO' || selectedCashMovement.reversalOfMovementId || reversedMovementIds.has(selectedCashMovement.id || '')) && (
                  <p className="mt-2 text-xs font-black uppercase tracking-wider text-amber-400">
                    {selectedCashMovement.type === 'ESTORNO' || selectedCashMovement.reversalOfMovementId
                      ? 'Estorno registrado' : 'Lançamento estornado'}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedCashMovement(null)}
                className="shrink-0 p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600 transition-colors"
                aria-label="Fechar detalhe da movimentacao"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-black border border-zinc-900 rounded-2xl p-4">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Valor</p>
                <p className={`text-2xl font-black mt-1 ${resolveCashDelta(selectedCashMovement) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {resolveCashDelta(selectedCashMovement) >= 0 ? '+' : '-'} {formatCurrency(getMovementDisplayAmount(selectedCashMovement))}
                </p>
              </div>
              <div className="bg-black border border-zinc-900 rounded-2xl p-4">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Tipo</p>
                <p className="text-sm font-black text-white uppercase mt-2">{selectedCashMovement.type}</p>
              </div>
              <div className="bg-black border border-zinc-900 rounded-2xl p-4">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Data</p>
                <p className="text-sm font-black text-white uppercase mt-2">{formatDateTimeBR(selectedCashMovement.date)}</p>
              </div>
              <div className="bg-black border border-zinc-900 rounded-2xl p-4">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Responsavel</p>
                <p className="text-sm font-black text-white uppercase mt-2 break-words">{getMovementActorLabel(selectedCashMovement)}</p>
              </div>
              {selectedCashMovement.reversalOfMovementId && (
                <div className="sm:col-span-2 bg-black border border-zinc-900 rounded-2xl p-4">
                  <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Movimento original estornado</p>
                  <p className="text-sm font-black text-white mt-2 break-all">{selectedCashMovement.reversalOfMovementId}</p>
                </div>
              )}
              {selectedCashMovement.loanId && (
                <button
                  type="button"
                  onClick={() => {
                    const loanId = selectedCashMovement.loanId;
                    setSelectedCashMovement(null);
                    if (loanId) onNavigateToLoan(loanId);
                  }}
                  className="sm:col-span-2 bg-black border border-zinc-900 rounded-2xl p-4 text-left hover:border-[#BF953F]/40 transition-colors"
                >
                  <p className="text-[8px] font-black text-zinc-500 uppercase tracking-[0.2em]">Contrato vinculado</p>
                  <p className="text-sm font-black text-white uppercase mt-2 break-all">{selectedCashMovement.loanId}</p>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditTab;
