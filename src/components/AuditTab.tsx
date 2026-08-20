import React, { useMemo, useState } from 'react';
import { ScanSearch, ShieldCheck } from 'lucide-react';
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
import { buildFinancialAudit } from '../utils/financialAudit';

interface AuditTabProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  currentUserUid?: string;
  onDownloadBackup: () => Promise<void>;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const AuditTab: React.FC<AuditTabProps> = ({
  loans,
  cashMovements,
  caixa,
  currentUserUid,
  onDownloadBackup,
  showToast,
}) => {
  const [migrationPreview, setMigrationPreview] = useState<LegacyMigrationPreview | null>(null);
  const [isAuditingLegacyPayments, setIsAuditingLegacyPayments] = useState(false);
  const [isApplyingLegacyMigration, setIsApplyingLegacyMigration] = useState(false);
  const [diagnosticEvents, setDiagnosticEvents] = useState<OperationalDiagnosticEvent[] | null>(null);
  const [isLoadingDiagnostics, setIsLoadingDiagnostics] = useState(false);

  const financialAudit = useMemo(() => buildFinancialAudit({
    loans,
    cashMovements,
    recordedCashBalance: caixa,
  }), [caixa, cashMovements, loans]);

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
            <h2 className="text-sm font-black text-white uppercase tracking-[0.2em]">Auditoria e Diagnosticos</h2>
            <p className="mt-2 text-[9px] text-zinc-500 uppercase tracking-widest leading-relaxed">
              Area administrativa separada da operacao financeira diaria
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
    </div>
  );
};

export default AuditTab;
