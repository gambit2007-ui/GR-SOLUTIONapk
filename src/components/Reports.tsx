import React, { useState } from 'react';
import { Loan, CashMovement, MovementType, PaymentBreakdown } from '../types';
import { useMemo } from 'react';
import { Wallet, ArrowUpCircle, ArrowDownCircle, RefreshCcw, Plus, TrendingUp, BarChart3, ChevronDown, Info, Download } from 'lucide-react';
import {
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer, 
  Cell,
  LabelList,
  LineChart,
  Line,
  AreaChart,
  Area
} from 'recharts';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
} from '../utils/loanCompat';

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

interface FiscalMonthMetrics {
  principalRecovered: number;
  interestReceived: number;
  lateFeesReceived: number;
  serviceFeesReceived: number;
  taxableRevenue: number;
  totalPaid: number;
}

const Reports: React.FC<ReportsProps> = ({
  loans, cashMovements, caixa, onAddTransaction, onRecalculateCash, onDownloadBackup, showToast
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isDownloadingBackup, setIsDownloadingBackup] = useState(false);
  const [formData, setFormData] = useState({
    type: 'ENTRADA' as MovementType,
    amount: '',
    description: ''
  });

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));
  const monthNamesUpper = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

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

  const getRemainingInstallmentValue = (installment: Loan['installments'][number]) => {
    if (!installment || normalizeInstallmentStatus(installment.status) === 'PAID') return 0;
    const lateFee = calculateLateFee(installment);
    const totalWithFee = roundMoney(installmentAmount(installment) + lateFee);
    const remaining = roundMoney(totalWithFee - installmentPaidAmount(installment));
    return remaining > 0 ? remaining : 0;
  };

  const getInstallmentPrincipalRecovered = (loan: Loan, installment: Loan['installments'][number]) => {
    const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
    if (paymentEntries.length > 0) {
      return roundMoney(paymentEntries.reduce((sum, entry) => sum + Number(entry.principalPaid || 0), 0));
    }

    if (installment.paymentBreakdown) {
      return roundMoney(Number(installment.paymentBreakdown.principalPaid || 0));
    }

    if (normalizeInstallmentStatus(installment.status) === 'PAID') {
      if (Number.isFinite(Number(installment.expectedPrincipal)) && Number(installment.expectedPrincipal) > 0) {
        return roundMoney(Number(installment.expectedPrincipal));
      }

      const installmentsCount = loanInstallmentsCount(loan) || 1;
      return roundMoney(Number(loan.amount || 0) / installmentsCount);
    }

    return 0;
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

  const makeMonthKey = (dateValue: string) => {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  };

  const getMonthShortLabel = (monthIndex: number, year: number) =>
    `${monthNamesUpper[monthIndex]}/${String(year).slice(2)}`;

  const fiscalData = useMemo(() => {
    const monthly: Record<string, FiscalMonthMetrics> = {};

    const totals = {
      principalRecovered: 0,
      interestReceived: 0,
      lateFeesReceived: 0,
      serviceFeesReceived: 0,
      taxableRevenue: 0,
      totalPaid: 0,
    };

    const registerMetrics = (monthKey: string, breakdown: PaymentBreakdown) => {
      if (!monthly[monthKey]) {
        monthly[monthKey] = {
          principalRecovered: 0,
          interestReceived: 0,
          lateFeesReceived: 0,
          serviceFeesReceived: 0,
          taxableRevenue: 0,
          totalPaid: 0,
        };
      }

      const principalPaid = roundMoney(Number(breakdown.principalPaid || 0));
      const interestPaid = roundMoney(Number(breakdown.interestPaid || 0));
      const lateFeePaid = roundMoney(Number(breakdown.lateFeePaid || 0));
      const serviceFeePaid = roundMoney(Number(breakdown.serviceFeePaid || 0));
      const totalPaid = roundMoney(Number(breakdown.totalPaid || 0));
      const taxableRevenue = roundMoney(interestPaid + lateFeePaid + serviceFeePaid);

      monthly[monthKey].principalRecovered = roundMoney(monthly[monthKey].principalRecovered + principalPaid);
      monthly[monthKey].interestReceived = roundMoney(monthly[monthKey].interestReceived + interestPaid);
      monthly[monthKey].lateFeesReceived = roundMoney(monthly[monthKey].lateFeesReceived + lateFeePaid);
      monthly[monthKey].serviceFeesReceived = roundMoney(monthly[monthKey].serviceFeesReceived + serviceFeePaid);
      monthly[monthKey].taxableRevenue = roundMoney(monthly[monthKey].taxableRevenue + taxableRevenue);
      monthly[monthKey].totalPaid = roundMoney(monthly[monthKey].totalPaid + totalPaid);

      totals.principalRecovered = roundMoney(totals.principalRecovered + principalPaid);
      totals.interestReceived = roundMoney(totals.interestReceived + interestPaid);
      totals.lateFeesReceived = roundMoney(totals.lateFeesReceived + lateFeePaid);
      totals.serviceFeesReceived = roundMoney(totals.serviceFeesReceived + serviceFeePaid);
      totals.taxableRevenue = roundMoney(totals.taxableRevenue + taxableRevenue);
      totals.totalPaid = roundMoney(totals.totalPaid + totalPaid);
    };

    loans.forEach((loan) => {
      const installments = Array.isArray(loan.installments) ? loan.installments : [];
      installments.forEach((installment) => {
        const paymentEntries = Array.isArray(installment.paymentEntries) ? installment.paymentEntries : [];
        if (paymentEntries.length > 0) {
          paymentEntries.forEach((entry) => {
            const monthKey = makeMonthKey(entry.recordedAt);
            if (!monthKey) return;
            registerMetrics(monthKey, {
              principalPaid: Number(entry.principalPaid || 0),
              interestPaid: Number(entry.interestPaid || 0),
              lateFeePaid: Number(entry.lateFeePaid || 0),
              serviceFeePaid: Number(entry.serviceFeePaid || 0),
              discountApplied: Number(entry.discountApplied || 0),
              totalPaid: Number(entry.totalPaid || 0),
            });
          });
          return;
        }

        if (normalizeInstallmentStatus(installment.status) !== 'PAID') return;
        const breakdown = installment.paymentBreakdown;
        if (!breakdown) return;

        const paymentDate = installment.paidAt || installment.paymentDate || installment.lastPaymentDate;
        if (!paymentDate) return;

        const monthKey = makeMonthKey(paymentDate);
        if (!monthKey) return;
        registerMetrics(monthKey, breakdown);
      });
    });

    return { monthly, totals };
  }, [loans]);

  // Calculos Financeiros
  const totalAportes = cashMovements
    .filter((m) => ['APORTE', 'ENTRADA'].includes(String(m.type || '').toUpperCase()))
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const totalRetiradas = cashMovements
    .filter((m) => {
      const type = String(m.type || '').toUpperCase();
      const desc = String(m.description || '').toUpperCase();
      const isManualWithdrawal = type === 'RETIRADA' && (desc.startsWith('RETIRADA:') || desc.includes('RETIRADA VIA CAIXA'));
      return isManualWithdrawal || type === 'SAIDA';
    })
    .reduce((acc, m) => acc + Number(m.amount || 0), 0);

  const totalEmprestado = loans.reduce((acc, l) => acc + Number(l.amount || 0), 0);

  const totalRecebido = cashMovements
    .reduce((acc, m) => {
      if (m.type === 'PAGAMENTO') return acc + m.amount;
      if (m.type === 'ESTORNO') return acc - m.amount;
      return acc;
    }, 0);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIndex = now.getMonth();
  const currentMonthLabel = getMonthShortLabel(currentMonthIndex, currentYear);

  const faturamentoAno = useMemo(() => {
    return roundMoney(
      (Object.entries(fiscalData.monthly) as Array<[string, FiscalMonthMetrics]>).reduce((sum, [monthKey, metrics]) => {
        const [yearRaw] = monthKey.split('-');
        if (Number(yearRaw) !== currentYear) return sum;
        return sum + Number(metrics.taxableRevenue || 0);
      }, 0),
    );
  }, [currentYear, fiscalData.monthly]);

  const totalAReceber = loans.reduce((acc, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return acc;
    const unpaid = loan.installments
      .reduce((sum, installment) => sum + getRemainingInstallmentValue(installment), 0);
    return acc + unpaid;
  }, 0);

  const getLoanExpectedTotal = (loan: Loan) => {
    const installmentsTotal = (Array.isArray(loan.installments) ? loan.installments : [])
      .reduce((acc, inst) => acc + Number(inst?.amount || 0), 0);

    if (installmentsTotal > 0) {
      return installmentsTotal;
    }

    return loan.amount * (1 + (loan.interestRate / 100));
  };

  // Valor em Rua (Principal Pendente)
  const valorEmRua = loans.reduce((acc, loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return acc;
    const principalRecovered = roundMoney(
      loan.installments.reduce((sum, installment) => sum + getInstallmentPrincipalRecovered(loan, installment), 0),
    );
    return acc + Math.max(roundMoney(Number(loan.amount || 0) - principalRecovered), 0);
  }, 0);

  const lucroEstimado = loans.reduce((acc, loan) => {
    const totalExpected = getLoanExpectedTotal(loan);
    const profit = Math.max(totalExpected - loan.amount, 0);
    return acc + profit;
  }, 0);

  // Agrupamento mensal para o grafico e gavetas
  const getMonthlyData = () => {
    const months: { [key: string]: { 
      month: string, 
      lucro: number, 
      recebido: number, 
      emprestado: number, 
      entradas: number, 
      saidas: number
    } } = {};

    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const key = `${currentYear}-${String(monthIndex + 1).padStart(2, '0')}`;
      months[key] = {
        month: getMonthShortLabel(monthIndex, currentYear),
        lucro: roundMoney(Number(fiscalData.monthly[key]?.taxableRevenue || 0)),
        recebido: 0,
        emprestado: 0,
        entradas: 0,
        saidas: 0,
      };
    }

    cashMovements.forEach((movement) => {
      const date = new Date(movement.date);
      if (Number.isNaN(date.getTime()) || date.getFullYear() !== currentYear) return;

      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!months[key]) return;

      const movementType = String(movement.type || '').toUpperCase();
      const amount = Number(movement.amount || 0);
      const isEntrada = ['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(movementType);
      if (isEntrada) {
        months[key].entradas = roundMoney(months[key].entradas + amount);
      } else {
        months[key].saidas = roundMoney(months[key].saidas + amount);
      }

      if (movementType === 'PAGAMENTO' || movementType === 'ESTORNO') {
        const signedAmount = movementType === 'ESTORNO' ? -amount : amount;
        months[key].recebido = roundMoney(months[key].recebido + signedAmount);
      }

      if (movementType === 'RETIRADA' && String(movement.description || '').toUpperCase().includes('EMPRESTIMO')) {
        months[key].emprestado = roundMoney(months[key].emprestado + amount);
      }
    });

    return Object.keys(months)
      .sort()
      .map((key) => months[key]);
  };

  const monthlyData = getMonthlyData();
  const chartData = monthlyData;
  const [expandedMonth, setExpandedMonth] = useState<string | null>(currentMonthLabel);

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
    { label: 'Total a Receber', value: totalAReceber, color: 'text-[#BF953F]' },
    { label: 'Valor em Rua', value: valorEmRua, color: 'text-blue-500' },
    { label: 'Lucro Projetado', value: lucroEstimado, color: 'text-purple-500' },
    { label: 'Total Emprestado', value: totalEmprestado, color: 'text-zinc-400' },
    { label: 'Total Recebido', value: totalRecebido, color: 'text-emerald-500' },
    { label: 'Total Aportes', value: totalAportes, color: 'text-cyan-500' },
    { label: 'Total Retiradas', value: totalRetiradas, color: 'text-red-500' },
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

      {/* Resumo de lucratividade */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[2.5rem] p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-12">
          <div className="shrink-0">
            <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em]">Resumo de Lucratividade</h3>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Indicadores de desempenho real</p>
          </div>
          
          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="p-5 border-l-2 border-[#BF953F] bg-zinc-900/10 relative group cursor-help rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Media Mensal de Lucro Real</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                R$ {(chartData.reduce((acc, curr) => acc + curr.lucro, 0) / (chartData.length || 1)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
              </p>
              
              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 w-56 p-4 bg-[#0a0a0a] border border-zinc-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl transform translate-y-2 group-hover:translate-y-0">
                <p className="text-[8px] font-black text-[#BF953F] uppercase tracking-widest mb-2">Analise de Media</p>
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Media aritmetica do lucro real (juros recebidos) nos ultimos {chartData.length} meses.
                </p>
              </div>
            </div>

            <div className="p-5 border-l-2 border-emerald-500 bg-zinc-900/10 relative group cursor-help rounded-r-2xl">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Recorde de Lucro Real</p>
                <Info size={10} className="text-zinc-700" />
              </div>
              <p className="text-xl font-black text-white">
                {chartData.length > 0 ? chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).month : '---'}
              </p>

              {/* Tooltip */}
              <div className="absolute bottom-full left-0 mb-2 w-56 p-4 bg-[#0a0a0a] border border-zinc-800 rounded-2xl opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-50 shadow-2xl transform translate-y-2 group-hover:translate-y-0">
                <p className="text-[8px] font-black text-emerald-500 uppercase tracking-widest mb-2">Pico de Desempenho</p>
                {chartData.length > 0 ? (
                  <p className="text-[10px] text-zinc-500 leading-relaxed">
                    Mes com maior volume de juros recebidos: {chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).month} (R$ {chartData.reduce((prev, current) => (prev.lucro > current.lucro) ? prev : current).lucro.toLocaleString('pt-BR')})
                  </p>
                ) : (
                  <p className="text-[10px] text-zinc-500">Dados insuficientes para analise.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desempenho mensal */}
      <div className="bg-[#050505] border border-zinc-900 rounded-[3rem] p-6 sm:p-8 md:p-10">
        <div className="flex items-center justify-between mb-12">
          <div>
            <h3 className="text-sm font-black gold-text uppercase tracking-[0.3em]">Desempenho Mensal</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] mt-2">Historico detalhado de fluxo e rentabilidade</p>
          </div>
          <div className="p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800">
            <BarChart3 size={24} className="text-[#BF953F]" />
          </div>
        </div>
        
        <div className="space-y-6">
            {monthlyData.map((data) => (
              <div key={data.month} className="border border-zinc-900 rounded-3xl overflow-hidden bg-[#000000]/20">
                <button 
                  onClick={() => setExpandedMonth(expandedMonth === data.month ? null : data.month)}
                  className="w-full p-6 flex items-center justify-between hover:bg-zinc-900/30 transition-colors"
                >
                  <div className="flex items-center gap-6">
                    <span className="text-xs font-black text-white uppercase tracking-widest w-20">{data.month}</span>
                    <div className="hidden sm:flex items-center gap-4">
                      <div className="flex flex-col items-start">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Entradas</span>
                        <span className="text-[10px] font-black text-emerald-500">R$ {data.entradas.toLocaleString('pt-BR')}</span>
                      </div>
                      <div className="flex flex-col items-start">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Saidas</span>
                        <span className="text-[10px] font-black text-red-500">R$ {data.saidas.toLocaleString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <span className="text-[8px] font-black text-zinc-600 uppercase tracking-widest block">Lucro Real</span>
                        <span className={`text-xs font-black ${data.lucro >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                          R$ {data.lucro.toLocaleString('pt-BR')}
                        </span>
                    </div>
                    <ChevronDown size={16} className={`text-zinc-500 transition-transform ${expandedMonth === data.month ? 'rotate-180' : ''}`} />
                  </div>
                </button>
                
                {expandedMonth === data.month && (
                  <div className="p-6 border-t border-zinc-900 bg-zinc-950/30 animate-in slide-in-from-top duration-200">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total de Entradas</span>
                          <span className="text-xs font-black text-emerald-500">R$ {data.entradas.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total de Saidas</span>
                          <span className="text-xs font-black text-red-500">R$ {data.saidas.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Total Recebido</span>
                          <span className="text-xs font-black text-zinc-300">R$ {data.recebido.toLocaleString('pt-BR')}</span>
                        </div>
                        <div className="flex items-center justify-between border-b border-zinc-900 pb-2">
                          <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Capital Emprestado</span>
                          <span className="text-xs font-black text-zinc-300">R$ {data.emprestado.toLocaleString('pt-BR')}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-6 p-4 bg-[#000000]/50 border border-zinc-900 rounded-2xl">
                      <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Lucro Real do Mes</p>
                      <p className={`text-2xl font-black ${data.lucro >= 0 ? 'text-[#BF953F]' : 'text-red-500'}`}>
                        R$ {data.lucro.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                      <p className="text-[9px] text-zinc-600 uppercase tracking-widest mt-3">
                        Baseado em juros, multas e taxas
                      </p>
                    </div>
                    
                    <div className="mt-8 h-[350px] w-full bg-[#000000]/40 p-6 rounded-[2rem] border border-zinc-900/50">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={[data]} margin={{ top: 30, right: 30, left: 20, bottom: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" vertical={false} opacity={0.5} />
                          <XAxis 
                            dataKey="month" 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
                          />
                          <YAxis 
                            axisLine={false} 
                            tickLine={false}
                            tick={{ fill: '#52525b', fontSize: 10, fontWeight: 900 }}
                            tickFormatter={(value) => `R$ ${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`}
                          />
                          <Tooltip 
                            cursor={{ fill: 'transparent' }}
                            contentStyle={{ 
                              backgroundColor: '#050505', 
                              border: '1px solid #27272a', 
                              borderRadius: '1.5rem',
                              padding: '12px 16px',
                              boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'
                            }}
                            itemStyle={{ fontSize: '10px', fontWeight: 900, textTransform: 'uppercase', padding: '2px 0' }}
                            formatter={(value: number) => [`R$ ${value.toLocaleString('pt-BR')}`, '']}
                          />
                          <Legend 
                            verticalAlign="top" 
                            align="right"
                            iconType="circle"
                            iconSize={8}
                            wrapperStyle={{ paddingBottom: '20px', fontSize: '9px', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}
                          />
                          <Bar dataKey="entradas" name="Entradas" fill="#10b981" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="entradas" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#10b981', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                          <Bar dataKey="saidas" name="Saidas" fill="#ef4444" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="saidas" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#ef4444', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                          <Bar dataKey="lucro" name="Lucro Real" fill="#BF953F" radius={[6, 6, 0, 0]} barSize={45}>
                            <LabelList 
                              dataKey="lucro" 
                              position="top" 
                              formatter={(v: number) => v > 0 ? `R$ ${v.toLocaleString('pt-BR')}` : ''}
                              style={{ fill: '#BF953F', fontSize: '9px', fontWeight: 900 }}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
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







