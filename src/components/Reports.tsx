import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet, CheckCircle, History, ArrowUpRight, ChevronDown,
  RotateCcw, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon, MessageCircle
} from 'lucide-react';
import { Loan, Installment, CashMovement } from '../types';

type MovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO';

interface ReportsProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  onAddTransaction: (type: MovementType, amount: number, description: string) => Promise<void>;
  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;
  onUpdateLoanAndAddTransaction?: (
    loanId: string,
    newData: Partial<Loan>,
    type: MovementType,
    amount: number,
    description: string,
  ) => Promise<void>;
  onRecalculateCash: () => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const JUROS_DIA = 0.015;

const parseISODate = (iso?: string) => {
  if (!iso) return null;
  const parts = iso.split('-');
  const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  dt.setHours(0, 0, 0, 0);
  return dt;
};

const Reports: React.FC<ReportsProps> = ({
  loans = [],
  cashMovements = [],
  caixa = 0,
  onAddTransaction,
  onUpdateLoan,
  onUpdateLoanAndAddTransaction,
  onRecalculateCash,
  showToast,
}) => {
  const [filterStatus, setFilterStatus] = useState<'ATIVOS' | 'ATRASADOS' | 'FINALIZADOS'>('ATIVOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [actionLock, setActionLock] = useState<string | null>(null);

  const [cashActionType, setCashActionType] = useState<'APORTE' | 'RETIRADA' | null>(null);
  const [cashValue, setCashValue] = useState('');
  const [cashReason, setCashReason] = useState('');
  const [cashSubmitting, setCashSubmitting] = useState(false);
  const [recalcLoading, setRecalcLoading] = useState(false);

  const getValue = (inst: any) => Number(inst.amount || inst.value || inst.baseValue || 0);

  const getValueWithJuros = (inst: Installment) => {
    const base = getValue(inst);
    if (inst.status === 'PAGO') return inst.lastPaidValue || base;
    const vencimento = parseISODate(inst.dueDate);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (vencimento && hoje > vencimento) {
      const diasAtraso = Math.floor((hoje.getTime() - vencimento.getTime()) / (1000 * 60 * 60 * 24));
      return Number((base + (base * JUROS_DIA * diasAtraso)).toFixed(2));
    }
    return base;
  };

  const stats = useMemo(() => {
    return (loans || []).reduce((acc, l) => {
      const emprestado = Number(l.amount || 0);
      const pago = Number(l.paidAmount || 0);
      const totalToReturn = Number(l.totalToReturn || 0);
      acc.totalEmprestado += emprestado;
      acc.totalRecebido += pago;
      acc.totalAReceber += Math.max(0, totalToReturn - pago);
      acc.valorEmRua += Math.max(0, emprestado - pago);
      return acc;
    }, { totalRecebido: 0, totalAReceber: 0, totalEmprestado: 0, valorEmRua: 0 });
  }, [loans, cashMovements]);

  const cashTotals = useMemo(() => {
    return (cashMovements || []).reduce((acc, movement) => {
      const type = String(movement.type || '').toUpperCase();
      const description = String(movement.description || '').toUpperCase();
      const amount = Math.abs(Number(movement.amount || movement.value || 0));
      if (!Number.isFinite(amount)) return acc;

      if (type === 'APORTE') acc.totalAportes += amount;
      const isManualRetirada =
        type === 'RETIRADA' &&
        (description.startsWith('RETIRADA:') || description.includes('RETIRADA VIA CAIXA'));
      if (isManualRetirada) acc.totalRetiradas += amount;
      return acc;
    }, { totalAportes: 0, totalRetiradas: 0 });
  }, [cashMovements]);

  const isLoanLate = useCallback((loan: Loan) => {
    const saldo = Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0);
    if (saldo <= 0.1) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return (loan.installments || []).some(inst => {
      if (inst.status === 'PAGO') return false;
      const venc = parseISODate(inst.dueDate);
      return venc ? venc < hoje : false;
    });
  }, []);

  const filteredLoans = useMemo(() => {
    return (loans || []).filter(l => {
      const saldo = Number(l.totalToReturn || 0) - Number(l.paidAmount || 0);
      const isLiq = saldo <= 0.5;
      const matchesSearch = l.customerName.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (filterStatus === 'FINALIZADOS') return isLiq;
      if (filterStatus === 'ATRASADOS') return !isLiq && isLoanLate(l);
      return !isLiq;
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const closeCashModal = () => {
    setCashActionType(null);
    setCashValue('');
    setCashReason('');
    setCashSubmitting(false);
  };

  const handleCashAction = async () => {
    if (!cashActionType) return;

    const value = Number(String(cashValue).replace(',', '.'));
    const reason = cashReason.trim();

    if (!Number.isFinite(value) || value <= 0) {
      showToast('Informe um valor valido maior que zero.', 'error');
      return;
    }

    if (!reason) {
      showToast('Motivo obrigatorio: informe o motivo da movimentacao.', 'error');
      return;
    }

    try {
      setCashSubmitting(true);
      await onAddTransaction(cashActionType, value, `${cashActionType}: ${reason}`);
      closeCashModal();
    } catch {
      setCashSubmitting(false);
      showToast('Nao foi possivel registrar a movimentacao.', 'error');
    }
  };

  const handlePayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    setActionLock(`${loan.id}-${idx}`);

    try {
      const installments = [...loan.installments];
      const inst = installments[idx];
      if (!inst || inst.status === 'PAGO') {
        showToast('Parcela ja quitada.', 'info');
        return;
      }

      const valorComJuros = getValueWithJuros(inst);
      const parcialPagoAtual = Number(inst.partialPaid || 0);
      const valorRestante = Math.max(0, Number((valorComJuros - parcialPagoAtual).toFixed(2)));

      if (valorRestante <= 0.01) {
        showToast('Parcela ja quitada.', 'info');
        return;
      }

      if (!window.confirm(`Receber R$ ${valorRestante.toFixed(2)}?`)) return;

      const { partialPaid, ...baseInstallment } = inst;
      installments[idx] = {
        ...baseInstallment,
        status: 'PAGO',
        lastPaidValue: valorComJuros,
        paymentDate: new Date().toISOString(),
      };

      const novoPago = Number(((loan.paidAmount || 0) + valorRestante).toFixed(2));
      const saldoRestante = Number(loan.totalToReturn || 0) - novoPago;
      const novoStatus = saldoRestante <= 0.5 ? 'QUITADO' : 'ATIVO';

      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago, status: novoStatus });
      await onAddTransaction('PAGAMENTO', valorRestante, `PAG: ${loan.customerName} (P${inst.number})`);
      showToast('Pagamento registrado!', 'success');
    } catch {
      showToast('Erro ao processar.', 'error');
    } finally {
      setActionLock(null);
    }
  };
  const handlePartialPayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    setActionLock(`${loan.id}-${idx}-partial`);

    try {
      const installments = [...loan.installments];
      const inst = installments[idx];

      if (!inst || inst.status === 'PAGO') {
        showToast('Parcela ja quitada.', 'info');
        return;
      }

      const valorComJuros = getValueWithJuros(inst);
      const parcialPagoAtual = Number(inst.partialPaid || 0);
      const valorRestante = Number((valorComJuros - parcialPagoAtual).toFixed(2));

      if (valorRestante <= 0) {
        showToast('Parcela ja quitada.', 'info');
        return;
      }

      const parcialInput = window.prompt(`Valor parcial (restante R$ ${valorRestante.toFixed(2)}):`);
      if (!parcialInput) return;

      const valorParcial = Number(String(parcialInput).replace(',', '.'));
      if (!Number.isFinite(valorParcial) || valorParcial <= 0) {
        showToast('Informe um valor parcial valido.', 'error');
        return;
      }

      let valorParaDistribuir = Number(valorParcial.toFixed(2));
      let valorAplicado = 0;
      const parcelasAfetadas: number[] = [];
      const nowIso = new Date().toISOString();

      for (let i = idx; i < installments.length && valorParaDistribuir > 0.009; i += 1) {
        const parcelaAtual = installments[i];
        if (!parcelaAtual || parcelaAtual.status === 'PAGO') continue;

        const valorAtualComJuros = getValueWithJuros(parcelaAtual);
        const parcialAtual = Number(parcelaAtual.partialPaid || 0);
        const restanteAtual = Number((valorAtualComJuros - parcialAtual).toFixed(2));
        if (restanteAtual <= 0) continue;

        const valorNestePagamento = Math.min(valorParaDistribuir, restanteAtual);
        const novoParcialPago = Number((parcialAtual + valorNestePagamento).toFixed(2));
        const quitada = novoParcialPago >= valorAtualComJuros - 0.01;

        parcelasAfetadas.push(parcelaAtual.number);

        if (quitada) {
          const { partialPaid, ...baseInstallment } = parcelaAtual;
          installments[i] = {
            ...baseInstallment,
            status: 'PAGO',
            lastPaidValue: valorAtualComJuros,
            paymentDate: nowIso,
          };
        } else {
          const { paymentDate, lastPaidValue, ...baseInstallment } = parcelaAtual;
          installments[i] = {
            ...baseInstallment,
            status: parcelaAtual.status === 'ATRASADO' ? 'ATRASADO' : 'PENDENTE',
            partialPaid: novoParcialPago,
          };
        }

        valorAplicado = Number((valorAplicado + valorNestePagamento).toFixed(2));
        valorParaDistribuir = Number((valorParaDistribuir - valorNestePagamento).toFixed(2));
      }

      if (valorAplicado <= 0) {
        showToast('Nao foi possivel aplicar o pagamento parcial.', 'error');
        return;
      }

      const novoPago = Number(((loan.paidAmount || 0) + valorAplicado).toFixed(2));
      const saldoRestante = Number(loan.totalToReturn || 0) - novoPago;
      const novoStatus = saldoRestante <= 0.5 ? 'QUITADO' : 'ATIVO';

      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago, status: novoStatus });

      const primeiraParcela = parcelasAfetadas[0];
      const ultimaParcela = parcelasAfetadas[parcelasAfetadas.length - 1];
      const faixaParcelas = parcelasAfetadas.length > 1
        ? `P${primeiraParcela} a P${ultimaParcela}`
        : `P${primeiraParcela}`;

      await onAddTransaction('PAGAMENTO', valorAplicado, `PAG PARCIAL: ${loan.customerName} (${faixaParcelas})`);

      if (valorParaDistribuir > 0.01) {
        showToast(`Pagamento aplicado. Excedente de R$ ${valorParaDistribuir.toFixed(2)} ignorado por falta de saldo.`, 'info');
        return;
      }

      if (parcelasAfetadas.length > 1) {
        showToast(`Pagamento parcial distribuido ate ${faixaParcelas}.`, 'success');
        return;
      }

      const parcelaAtualizada = installments[idx];
      if (parcelaAtualizada.status === 'PAGO') {
        showToast('Parcela quitada com pagamento parcial final!', 'success');
      } else {
        const valorAtualizado = getValueWithJuros(parcelaAtualizada);
        const parcialAtualizado = Number(parcelaAtualizada.partialPaid || 0);
        const restante = Math.max(0, Number((valorAtualizado - parcialAtualizado).toFixed(2)));
        showToast(`Pagamento parcial registrado. Restante: R$ ${restante.toFixed(2)}`, 'info');
      }
    } catch {
      showToast('Erro ao registrar pagamento parcial.', 'error');
    } finally {
      setActionLock(null);
    }
  };

  const handleRefundInstallment = async (loan: Loan, idx: number) => {
    const inst = loan.installments[idx];
    if (!inst || inst.status !== 'PAGO') {
      showToast('Parcela nao esta paga.', 'info');
      return;
    }

    const valorParaEstornar = Number(inst.lastPaidValue || getValue(inst));
    if (!Number.isFinite(valorParaEstornar) || valorParaEstornar <= 0) {
      showToast('Valor invalido para estorno.', 'error');
      return;
    }

    if (!window.confirm(`Estornar pagamento de R$ ${valorParaEstornar.toFixed(2)}?`)) return;

    try {
      const installments = [...loan.installments];
      const installmentBase: Installment = { ...inst };
      delete installmentBase.paymentDate;
      delete installmentBase.lastPaidValue;
      delete installmentBase.partialPaid;
      installments[idx] = { ...installmentBase, status: 'PENDENTE' };

      const novoPago = Math.max(0, Number((Number(loan.paidAmount || 0) - valorParaEstornar).toFixed(2)));
      const saldoRestante = Number(loan.totalToReturn || 0) - novoPago;
      const novoStatus = saldoRestante <= 0.5 ? 'QUITADO' : 'ATIVO';
      const updatePayload = { installments, paidAmount: novoPago, status: novoStatus };
      const estornoDesc = `ESTORNO: ${loan.customerName} (P${inst.number})`;

      if (onUpdateLoanAndAddTransaction) {
        await onUpdateLoanAndAddTransaction(loan.id, updatePayload, 'ESTORNO', valorParaEstornar, estornoDesc);
      } else {
        await onUpdateLoan(loan.id, updatePayload);
        await onAddTransaction('ESTORNO', valorParaEstornar, estornoDesc);
      }

      showToast('Estorno realizado!', 'info');
    } catch {
      showToast('Erro ao estornar.', 'error');
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-[1400px] mx-auto">
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="xl:w-[300px] p-6 rounded-[2rem] bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 shadow-2xl relative overflow-hidden group flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2.5 rounded-2xl bg-emerald-500 text-black shadow-lg"><Wallet size={20} /></div>
              <span className="text-[9px] font-black uppercase text-emerald-500 tracking-[0.28em]">Caixa Geral</span>
            </div>
            <h2 className="text-4xl font-black text-white tracking-tighter mb-6">
              R$ {Number(caixa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h2>
          </div>

          <div className="space-y-2 relative z-10">
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setCashActionType('APORTE');
                  setCashValue('');
                  setCashReason('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-black text-[9px] font-black uppercase hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <ArrowDownLeft size={14} /> Aporte
              </button>
              <button
                onClick={() => {
                  setCashActionType('RETIRADA');
                  setCashValue('');
                  setCashReason('');
                }}
                className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-[9px] font-black uppercase hover:bg-red-500 hover:text-white transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <ArrowUpRight size={14} /> Retirada
              </button>
            </div>
            <button
              onClick={async () => {
                if (!window.confirm('Recalcular o caixa com base em todo o historico de movimentacoes?')) return;
                try {
                  setRecalcLoading(true);
                  await onRecalculateCash();
                } finally {
                  setRecalcLoading(false);
                }
              }}
              disabled={recalcLoading}
              className="w-full py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 text-zinc-200 text-[9px] font-black uppercase hover:bg-zinc-800 transition-all disabled:opacity-60"
            >
              {recalcLoading ? 'Recalculando...' : 'Recalcular Caixa'}
            </button>
          </div>
        </div>

        <div className="xl:flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="A Receber Total" value={stats.totalAReceber} color="text-red-500" icon={<History size={20}/>} desc="Inclui juros previstos" />
          <StatCard title="Valor na Rua" value={stats.valorEmRua} color="text-orange-400" icon={<ArrowUpRightIcon size={20}/>} desc="Capital puro pendente" />
          <StatCard title="Lucro Estimado" value={Math.max(0, Number((stats.totalAReceber - stats.valorEmRua).toFixed(2)))} color="text-emerald-300" icon={<CheckCircle size={20}/>} desc="A receber menos valor na rua" />
          <StatCard title="Aportes / Retiradas" value={cashTotals.totalAportes} color="text-emerald-400" icon={<ArrowDownLeft size={20}/>} desc={`Aportes: R$ ${Number(cashTotals.totalAportes || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} | Retiradas: R$ ${Number(cashTotals.totalRetiradas || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`} />
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-xl">
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="PESQUISAR CLIENTE..." className="flex-1 bg-black border border-white/10 rounded-2xl px-6 py-4 text-[11px] text-white outline-none font-bold uppercase tracking-wider" />
          <div className="flex bg-black p-1.5 rounded-2xl border border-white/5">
            {(['ATIVOS', 'ATRASADOS', 'FINALIZADOS'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-8 py-3 rounded-xl text-[10px] font-black transition-all ${filterStatus === s ? (s === 'ATRASADOS' ? 'bg-red-600 text-white shadow-lg shadow-red-600/20' : 'bg-white text-black shadow-lg') : 'text-zinc-500 hover:text-zinc-300'}`}>
                {s === 'FINALIZADOS' ? 'QUITADOS' : s}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.map(loan => (
            <div key={loan.id} className="group border border-white/5 rounded-3xl bg-white/[0.01] hover:bg-white/[0.03] transition-all overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${isLoanLate(loan) ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    <CheckCircle size={24} />
                  </div>
                  <div>
                    <div className="flex items-center gap-3">
                      <h4 className="text-sm font-black text-white uppercase">{loan.customerName}</h4>
                      <button
                        onClick={() => {
                          const msg = encodeURIComponent(
                            `Ola ${loan.customerName}, entrando em contato sobre seu contrato com a GR SOLUTION.`
                          );
                          window.open(`https://wa.me/?text=${msg}`, '_blank');
                        }}
                        className="p-1.5 bg-green-500/10 text-green-500 rounded-lg hover:bg-green-500 hover:text-white transition-all"
                        title="Cobrar via WhatsApp"
                      >
                        <MessageCircle size={14} />
                      </button>

                      {loan.paidAmount > 0 && (
                        <button
                          onClick={async () => {
                            if (!window.confirm('ESTORNAR TODOS os pagamentos deste cliente?')) return;

                            const valorTotalEstorno = Number(loan.paidAmount || 0);
                            if (!Number.isFinite(valorTotalEstorno) || valorTotalEstorno <= 0) {
                              showToast('Nao ha valor pago para estornar.', 'info');
                              return;
                            }

                            const reset = loan.installments.map(i => {
                              const installmentBase: Installment = { ...i };
                              delete installmentBase.paymentDate;
                              delete installmentBase.lastPaidValue;
                              delete installmentBase.partialPaid;
                              return { ...installmentBase, status: 'PENDENTE' as const };
                            });

                            try {
                              if (onUpdateLoanAndAddTransaction) {
                                await onUpdateLoanAndAddTransaction(
                                  loan.id,
                                  { installments: reset, paidAmount: 0, status: 'ATIVO' },
                                  'ESTORNO',
                                  valorTotalEstorno,
                                  `ESTORNO TOTAL: ${loan.customerName}`,
                                );
                              } else {
                                await onUpdateLoan(loan.id, { installments: reset, paidAmount: 0, status: 'ATIVO' });
                                await onAddTransaction('ESTORNO', valorTotalEstorno, `ESTORNO TOTAL: ${loan.customerName}`);
                              }

                              showToast('Contrato resetado!', 'info');
                            } catch {
                              showToast('Erro ao estornar contrato.', 'error');
                            }
                          }}
                          className="p-1.5 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-all"
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase">Saldo Devedor: R$ {(Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0)).toFixed(2)}</p>
                  </div>
                </div>
                <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="px-5 py-3 bg-white/5 text-zinc-400 rounded-2xl hover:text-white transition-all border border-white/5 flex items-center justify-center gap-2">
                  <span className="text-[9px] font-black uppercase tracking-widest">Ver Parcelas</span>
                  <ChevronDown size={18} className={expandedLoan === loan.id ? 'rotate-180' : ''} />
                </button>
              </div>

              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-white/5 bg-black/40">
                  {loan.installments.map((inst, idx) => {
                    const valorAtualizado = getValueWithJuros(inst);
                    const temJuros = valorAtualizado > getValue(inst) && inst.status !== 'PAGO';
                    const parcialPago = Number(inst.partialPaid || 0);
                    const restanteParcial = Math.max(0, Number((valorAtualizado - parcialPago).toFixed(2))); 
                    return (
                      <div key={idx} className={`p-5 rounded-2xl border transition-all ${inst.status === 'PAGO' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[8px] font-black text-zinc-500 uppercase">P{inst.number}</span>
                          <span className={`text-[9px] font-bold ${temJuros ? 'text-red-500' : 'text-zinc-400'}`}>{inst.dueDate.split('-').reverse().join('/')}</span>
                        </div>
                        <p className={`text-lg font-black ${inst.status === 'PAGO' ? 'text-emerald-500' : (temJuros ? 'text-red-500' : 'text-white')}`}>
                          R$ {valorAtualizado.toFixed(2)}
                        </p>
                        <div className="mt-4 space-y-2">
                          {inst.status !== 'PAGO' ? (
                            <>
                              {parcialPago > 0 && (
                                <div className="text-[8px] font-black text-amber-500 uppercase text-center">
                                  Pago parcial: R$ {parcialPago.toFixed(2)} | Restante: R$ {restanteParcial.toFixed(2)}
                                </div>
                              )}
                              <button onClick={() => handlePayInstallment(loan, idx)} className="w-full py-3 bg-white text-black text-[10px] font-black rounded-xl hover:bg-emerald-500 transition-all uppercase">Receber Agora</button>
                              <button onClick={() => handlePartialPayInstallment(loan, idx)} className="w-full py-2 bg-amber-500/10 text-amber-400 text-[9px] font-black rounded-lg hover:bg-amber-500 hover:text-black transition-all uppercase">
                                Pagamento Parcial
                              </button>
                            </>
                          ) : (
                            <>
                              <div className="text-[8px] font-black text-emerald-600 uppercase flex items-center gap-2 justify-center"><CheckCircle size={10}/> Pago em {new Date(inst.paymentDate!).toLocaleDateString()}</div>
                              <button onClick={() => handleRefundInstallment(loan, idx)} className="w-full py-2 bg-red-500/10 text-red-500 text-[9px] font-black rounded-lg hover:bg-red-600 hover:text-white transition-all uppercase flex items-center justify-center gap-2">
                                <RotateCcw size={12}/> Estornar Parcela
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {cashActionType && (
        <div className="fixed inset-0 z-[210] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-[#0b0b0b] p-6 space-y-5 shadow-2xl">
            <h3 className="text-sm font-black uppercase tracking-widest text-white">
              {cashActionType === 'APORTE' ? 'Registrar Aporte' : 'Registrar Retirada'}
            </h3>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Valor (R$)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={cashValue}
                onChange={(e) => setCashValue(e.target.value)}
                className="w-full px-4 py-3 rounded-xl bg-black border border-zinc-800 text-white outline-none focus:border-[#BF953F]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Motivo</label>
              <p className="text-[10px] text-zinc-400">Campo obrigatorio.</p>
              <textarea
                value={cashReason}
                onChange={(e) => setCashReason(e.target.value)}
                rows={3}
                className="w-full px-4 py-3 rounded-xl bg-black border border-zinc-800 text-white outline-none focus:border-[#BF953F] resize-none"
                placeholder="Descreva o motivo"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={closeCashModal}
                className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-300 text-[10px] font-black uppercase"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={cashSubmitting}
                onClick={handleCashAction}
                className="px-5 py-2 rounded-xl gold-gradient text-black text-[10px] font-black uppercase disabled:opacity-50"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ title, value, color, icon, desc }: any) => (
  <div className="h-full min-h-[152px] p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all shadow-lg flex flex-col justify-between">
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-xl bg-black border border-white/5 shadow-inner ${color}`}>{icon}</div>
      <div className="text-right">
        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">{title}</p>
        <h3 className="text-2xl font-black text-white tracking-tight">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
      </div>
    </div>
    <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">{desc}</p>
  </div>
);

export default Reports;










