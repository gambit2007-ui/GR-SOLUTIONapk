import React, { useState } from 'react';
import { Loan, CashMovement, MovementType } from '../types';
import { Suspense, lazy, useMemo } from 'react';
import { Wallet, RefreshCcw, Plus, TrendingUp, BarChart3, ChevronDown, Info, Download } from 'lucide-react';
import {
  installmentAmount,
  normalizeInstallmentStatus,
} from '../utils/loanCompat';
import { buildMonthlyCashLedger } from '../utils/cashLedger';

interface ReportsProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  onAddTransaction: (type: MovementType, amount: number, description: string) => Promise<void>;
  onUpdateLoan: (loanId: string, newData: Partial<Loan>) => Promise<void>;
  onUpdateLoanAndAddTransaction: (loanId: string, newData: Partial<Loan>, type: MovementType, amount: number, description: string) => Promise<void>;
  onRecalculateCash: () => Promise<void>;
  onDownloadBackup: () => Promise<void>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const ReportsMonthlyChart = lazy(() => import('./ReportsMonthlyChart'));

const Reports: React.FC<ReportsProps> = ({
  cashMovements, caixa, onAddTransaction, onRecalculateCash, onDownloadBackup, showToast,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [formData, setFormData] = useState({
    type: 'ENTRADA' as MovementType,
    amount: '',
    description: ''
  });

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

  const calculateLateFee = (installment: Loan['installments'][number]) => {
    if (!installment?.dueDate || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
    const dueDate = new Date(`${installment.dueDate}T00:00:00`);
    if (Number.isNaN(dueDate.getTime())) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (dueDate >= today) return 0;

    const diffTime = today.getTime() - dueDate.getTime();
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 0;

    return Number((installmentAmount(installment) * 0.015 * diffDays).toFixed(2));
  };

  const parseAmountInput = (value: string): number => {
    const raw = String(value ?? '').trim();
    if (!raw) return Number.NaN;

    let normalized = raw
      .replace(/\s/g, '')
      .replace(/R\$/gi, '')
      .replace(/[^\d,.-]/g, '');

    if (!normalized) return Number.NaN;

    const hasComma = normalized.includes(',');
    const hasDot = normalized.includes('.');

    if (hasComma && hasDot) {
      const lastComma = normalized.lastIndexOf(',');
      const lastDot = normalized.lastIndexOf('.');
      const decimalSeparator = lastComma > lastDot ? ',' : '.';

      if (decimalSeparator === ',') {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else if (hasComma) {
      normalized = normalized.replace(',', '.');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const ledgerMonths = useMemo(() => buildMonthlyCashLedger(cashMovements, currentYear), [cashMovements, currentYear]);
  const currentLedgerMonth = ledgerMonths[currentMonthIndex] || ledgerMonths[ledgerMonths.length - 1];
  const faturamentoAno = roundMoney(ledgerMonths.reduce((sum, month) => sum + Number(month.totalEntries || 0), 0));
  const monthlyData = ledgerMonths.slice(0, currentMonthIndex + 1);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const amountValue = parseAmountInput(formData.amount);
    if (Number.isNaN(amountValue) || amountValue <= 0) {
      showToast('Valor invalido para movimentacao', 'error');
      return;
    }

    try {
      await onAddTransaction(formData.type, Number(amountValue.toFixed(2)), formData.description);
      setIsModalOpen(false);
      setFormData({ type: 'ENTRADA', amount: '', description: '' });
    } catch (e) {
      // Erro tratado no App.tsx
    }
  };

  const handleBackupDownload = async () => {
    setIsDownloadingBackup(true);
    try {
      await onDownloadBackup();
    } catch {
      // Erro tratado no App.tsx.
    } finally {
      setIsDownloadingBackup(false);
    }
  };

  const financialCards = [
    { label: 'Saldo Inicial do Mes', value: currentLedgerMonth?.openingBalance || 0, color: 'text-zinc-400' },
    { label: 'Entradas do Mes', value: currentLedgerMonth?.totalEntries || 0, color: 'text-emerald-500' },
    { label: 'Saidas do Mes', value: currentLedgerMonth?.totalExits || 0, color: 'text-red-500' },
    { label: 'Estornos do Mes', value: currentLedgerMonth?.totalReversals || 0, color: 'text-violet-500' },
    { label: 'Ajustes do Mes', value: currentLedgerMonth?.totalAdjustments || 0, color: 'text-amber-500' },
    { label: 'Saldo Final do Mes', value: currentLedgerMonth?.closingBalance || caixa, color: 'text-[#BF953F]' },
    { label: 'Saldo Consolidado', value: caixa, color: 'text-cyan-500' },
  ];

  return (
    <div className="space-y-8">
      {/* Cartao principal de caixa */}
      <div className="bg-[#050505] border border-zinc-900 p-6 sm:p-8 md:p-12 rounded-[3rem] relative overflow-hidden flex flex-col md:flex-row md:items-center justify-between gap-8">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Wallet size={160} className="text-[#BF953F]" />
        </div>
        <div className="relative z-10">
          <p className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.3em] mb-4">Saldo Consolidado em Caixa</p>
          <h2 className="text-3xl sm:text-4xl md:text-6xl font-black gold-text tracking-tighter break-words">
            R$ {caixa.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h2>
          <div className="flex items-center gap-6 mt-6">
            <button 
              onClick={onRecalculateCash}
              className="flex items-center gap-2 text-[9px] font-black text-zinc-500 uppercase tracking-widest hover:text-[#BF953F] transition-colors"
            >
              <RefreshCcw size={12} /> Sincronizar Saldo
            </button>
            <div className="h-4 w-[1px] bg-zinc-800" />
            <div className="flex items-center gap-2">
              <TrendingUp size={12} className="text-emerald-500" />
              <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Operacao Ativa</span>
            </div>
          </div>
          <div className="mt-4 inline-flex items-center gap-3 px-4 py-2.5 bg-zinc-900/40 border border-zinc-800 rounded-2xl">
            <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Faturamento do Ano</span>
            <span className="text-[11px] font-black text-[#BF953F]">
              R$ {faturamentoAno.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </span>
          </div>
        </div>
        
        <div className="relative z-10 shrink-0 flex flex-col sm:flex-row gap-3">
          <button 
            onClick={() => { setFormData({ ...formData, type: 'ENTRADA' }); setIsModalOpen(true); }}
            className="px-6 sm:px-10 py-4 sm:py-6 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] sm:text-[11px] tracking-[0.2em] hover:scale-105 transition-all shadow-[0_0_40px_rgba(191,149,63,0.15)] flex items-center gap-2 sm:gap-3"
          >
            <Plus size={18} /> Novo Lancamento
          </button>
          <button
            onClick={handleBackupDownload}
            disabled={isDownloadingBackup}
            className="px-6 sm:px-8 py-4 sm:py-6 bg-zinc-900 border border-zinc-800 text-white rounded-2xl font-black uppercase text-[10px] sm:text-[11px] tracking-[0.15em] hover:border-[#BF953F]/50 transition-all flex items-center gap-2 sm:gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Download size={18} /> {isDownloadingBackup ? 'Gerando Backup...' : 'Backup do Banco'}
          </button>
        </div>
      </div>

      {/* Grade de indicadores financeiros */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {financialCards.map((card, i) => (
          <div key={i} className="bg-[#050505] border border-zinc-900 p-5 rounded-2xl hover:border-[#BF953F]/30 transition-all group">
            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-2 group-hover:text-zinc-400 transition-colors break-words">{card.label}</p>
            <p className={`text-sm font-black ${card.color}`}>
              R$ {card.value.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </p>
          </div>
        ))}
      </div>

      {/* Resumo do livro caixa */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[2.5rem] p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-8">
          <div className="shrink-0">
            <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em]">Livro Caixa Mensal</h3>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">
              Fechamento oficial do mes {currentLedgerMonth?.monthLabel || `${String(currentMonthIndex + 1).padStart(2, '0')}/${String(currentYear).slice(2)}`}
            </p>
          </div>

          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-5 border-l-2 border-[#BF953F] bg-zinc-900/10 rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Saldo Inicial</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                R$ {(currentLedgerMonth?.openingBalance || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-2">
                Saldo final: R$ {(currentLedgerMonth?.closingBalance || caixa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>

            <div className="p-5 border-l-2 border-emerald-500 bg-zinc-900/10 rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Movimento Liquido</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                R$ {(currentLedgerMonth?.netMovement || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-widest mt-2">
                Entradas R$ {(currentLedgerMonth?.totalEntries || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} | Saidas R$ {(currentLedgerMonth?.totalExits || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Detalhamento mensal */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[3rem] p-6 sm:p-8 md:p-10">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h3 className="text-sm font-black gold-text uppercase tracking-[0.3em]">Detalhamento Mensal</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] mt-2">Livro oficial baseado em cashMovement</p>
          </div>
          <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
            <BarChart3 size={24} className="text-[#BF953F]" />
          </div>
        </div>

        <div className="space-y-6">
          {monthlyData.map((data) => (
            <div key={data.monthKey} className="border border-zinc-900 rounded-3xl overflow-hidden bg-[#000000]/20">
              <button
                onClick={() => setExpandedMonth(expandedMonth === data.monthKey ? null : data.monthKey)}
                className="w-full p-6 flex items-center justify-between hover:bg-zinc-900/30 transition-colors"
              >
                <div className="flex items-center gap-6 flex-wrap">
                  <span className="text-xs font-black text-white uppercase tracking-widest w-20">{data.monthLabel}</span>
                  <div className="hidden sm:flex items-center gap-4">
                    <div className="flex flex-col items-start">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Saldo inicial</span>
                      <span className="text-[10px] font-black text-zinc-300">R$ {data.openingBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Entradas</span>
                      <span className="text-[10px] font-black text-emerald-500">R$ {data.totalEntries.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                    <div className="flex flex-col items-start">
                      <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Saidas</span>
                      <span className="text-[10px] font-black text-red-500">R$ {data.totalExits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest block">Saldo Final</span>
                    <span className={`text-xs font-black ${data.closingBalance >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                      R$ {data.closingBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <ChevronDown size={16} className={`text-zinc-500 transition-transform ${expandedMonth === data.monthKey ? 'rotate-180' : ''}`} />
                </div>
              </button>

              {expandedMonth === data.monthKey && (
                <div className="p-6 border-t border-zinc-900 bg-zinc-950/30 animate-in slide-in-from-top duration-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Entradas</p>
                      <p className="text-sm font-black text-emerald-500">R$ {data.totalEntries.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Saidas</p>
                      <p className="text-sm font-black text-red-500">R$ {data.totalExits.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Estornos</p>
                      <p className="text-sm font-black text-violet-500">R$ {data.totalReversals.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                      <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-2">Ajustes</p>
                      <p className="text-sm font-black text-amber-500">R$ {data.totalAdjustments.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                    </div>
                  </div>

                  <div className="mt-6 p-4 bg-[#000000]/50 border border-zinc-900 rounded-2xl">
                    <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Fechamento do mes</p>
                    <p className={`text-2xl font-black ${data.closingBalance >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                      R$ {data.closingBalance.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-3">
                      Base oficial: entradas, saidas, estornos e ajustes do `cashMovement`
                    </p>
                  </div>

                  <Suspense
                    fallback={(
                      <div className="mt-8 h-[350px] w-full bg-[#000000]/40 p-6 rounded-[2rem] border border-zinc-900/50 flex items-center justify-center">
                        <div className="flex items-center gap-3 px-5 py-4 bg-[#050505] border border-zinc-900 rounded-2xl">
                          <div className="h-4 w-4 rounded-full border-2 border-zinc-800 border-t-[#BF953F] animate-spin" />
                          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">
                            Carregando grafico...
                          </span>
                        </div>
                      </div>
                    )}
                  >
                    <ReportsMonthlyChart data={data} />
                  </Suspense>

                  <div className="mt-8 space-y-3">
                    {data.movements.length === 0 ? (
                      <div className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-widest">Sem movimentacoes neste mes</p>
                      </div>
                    ) : data.movements.map((movement) => (
                      <div key={movement.id} className="p-4 bg-[#000000]/40 border border-zinc-900 rounded-2xl flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full ${
                              movement.category === 'ENTRADA'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : movement.category === 'SAIDA'
                                  ? 'bg-red-500/10 text-red-500'
                                  : movement.category === 'ESTORNO'
                                    ? 'bg-violet-500/10 text-violet-500'
                                    : 'bg-amber-500/10 text-amber-500'
                            }`}>
                              {movement.category}
                            </span>
                            <span className="text-[9px] font-black text-white uppercase tracking-widest">{movement.description}</span>
                          </div>
                          <p className="text-[9px] text-zinc-500 uppercase tracking-widest">
                            {movement.date} | {movement.actorName}
                            {movement.customerName ? ` | ${movement.customerName}` : ''}
                            {movement.loanId ? ` | Contrato ${movement.loanId}` : ''}
                          </p>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-right">
                          <div>
                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Valor</p>
                            <p className={`text-[10px] font-black ${movement.signedAmount >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                              R$ {Math.abs(movement.signedAmount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <div>
                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Antes</p>
                            <p className="text-[10px] font-black text-zinc-300">
                              R$ {movement.balanceBefore.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                          <div>
                            <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Depois</p>
                            <p className="text-[10px] font-black text-[#BF953F]">
                              R$ {movement.balanceAfter.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-[#000000]/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-lg rounded-[2.5rem] p-5 sm:p-8 relative max-h-[92dvh] overflow-y-auto">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <Plus className="rotate-45" size={24} />
            </button>
            <h2 className="text-xl font-black gold-text uppercase tracking-tighter mb-8">Movimentacao de Caixa</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Tipo</label>
                <select
                  required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
                  value={formData.type}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                >
                  <option value="ENTRADA">ENTRADA / APORTE</option>
                  <option value="SAIDA">SAIDA / RETIRADA</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor</label>
                <input
                  type="text" inputMode="decimal" placeholder="0,00" required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                  value={formData.amount}
                  onChange={e => setFormData({ ...formData, amount: e.target.value.replace(/[^\d,.-]/g, '') })}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Descricao / Motivo</label>
                <input
                  type="text" placeholder="EX: APORTE INICIAL" required
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
                <button 
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="py-5 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:text-white transition-all"
                >
                  Cancelar
                </button>
                <button className="py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest shadow-[0_0_20px_rgba(191,149,63,0.1)]">
                  Confirmar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Reports;







