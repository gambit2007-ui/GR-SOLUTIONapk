import React, { useMemo, useState } from 'react';
import { ScanSearch, ShieldCheck, X } from 'lucide-react';
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
import { formatDateTimeBR } from '../utils/dateTime';
import { resolveCashDelta } from '../utils/domainParsers';
import { buildFinancialAudit } from '../utils/financialAudit';
import { effectiveLoanStatus } from '../utils/loanCompat';

interface AuditTabProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  currentUserUid?: string;
  onNavigateToLoan: (loanId: string) => void;
  onDownloadBackup: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const loanStatusLabel: Record<string, string> = {
  ACTIVE: 'Ativo',
  COMPLETED: 'Concluido',
  CANCELLED: 'Cancelado',
};

const cashEntryTypes = new Set(['APORTE', 'PAGAMENTO', 'ENTRADA']);

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
  caixa,
  currentUserUid,
  onNavigateToLoan,
  onDownloadBackup,
  showToast,
}) => {
  const [migrationPreview, setMigrationPreview] = useState<LegacyMigrationPreview | null>(null);
  const [isAuditingLegacyPayments, setIsAuditingLegacyPayments] = useState(false);
  const [isApplyingLegacyMigration, setIsApplyingLegacyMigration] = useState(false);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalDiagnosticEvent[] | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);
  const [expandedMonthLoans, setExpandedMonthLoans] = useState<string | null>(null);
  const [expandedMonthMovements, setExpandedMonthMovements] = useState<string | null>(null);
  const [selectedCashMovement, setSelectedCashMovement] = useState<CashMovement | null>(null);

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
              const entryMovements = monthMovements.filter((movement) => cashEntryTypes.has(movement.type));
              const exitMovements = monthMovements.filter((movement) => !cashEntryTypes.has(movement.type));
              const entryTotal = entryMovements.reduce(
                (total, movement) => total + getMovementDisplayAmount(movement),
                0,
              );
              const exitTotal = exitMovements.reduce(
                (total, movement) => total + getMovementDisplayAmount(movement),
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
                            <span className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.2em]">Entradas</span>
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
                            <span className="text-[8px] font-black text-red-500 uppercase tracking-[0.2em]">Saidas</span>
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
                    </div>
                  )}
                </div>
              );
            })}
            {Object.keys(movementsByMonth).length === 0 && (
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
