import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet, CheckCircle, History, ArrowUpRight, ChevronDown, 
  RotateCcw, Calendar, Search, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon
} from 'lucide-react';
import { Loan, Installment, CashMovement } from '../types';

type MovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO';

interface ReportsProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  onAddTransaction: (type: MovementType, amount: number, description: string) => void;
  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;
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
  showToast,
}) => {
  const [filterStatus, setFilterStatus] = useState<'ATIVOS' | 'ATRASADOS' | 'FINALIZADOS'>('ATIVOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [actionLock, setActionLock] = useState<string | null>(null);

  // PROTEÇÃO CONTRA VALOR ZERO: Busca em todos os campos possíveis
  const getValue = (inst: any) => Number(inst.amount || inst.value || inst.baseValue || 0);

  const calcularJurosAtraso = useCallback((dueDate: string, amount: number) => {
    const vencimento = parseISODate(dueDate);
    if (!vencimento || amount <= 0) return { valorTotal: amount, diasAtraso: 0 };
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (hoje <= vencimento) return { valorTotal: amount, diasAtraso: 0 };
    const diasAtraso = Math.floor((hoje.getTime() - vencimento.getTime()) / 86400000);
    const juros = amount * JUROS_DIA * diasAtraso;
    return { valorTotal: Number((amount + juros).toFixed(2)), diasAtraso };
  }, []);

  const isLoanLate = useCallback((loan: Loan) => {
    const saldo = Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0);
    if (saldo <= 0.5) return false;
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
      return !isLiq; // ATIVOS
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const handlePayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    setActionLock(`${loan.id}-${idx}`);
    try {
      const installments = JSON.parse(JSON.stringify(loan.installments || []));
      const inst = installments[idx];
      const baseValue = getValue(inst);
      const { valorTotal } = calcularJurosAtraso(inst.dueDate, baseValue);

      if (!window.confirm(`Receber R$ ${valorTotal.toFixed(2)}?`)) return;

      installments[idx] = { 
        ...inst, 
        status: 'PAGO', 
        lastPaidValue: valorTotal, 
        paymentDate: new Date().toISOString() 
      };

      const novoPago = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName} (P${inst.number})`);
      showToast('Pagamento recebido!', 'success');
    } catch (e) { showToast('Erro ao pagar.', 'error'); } 
    finally { setActionLock(null); }
  };

  const handleEstorno = async (loan: Loan) => {
    if (actionLock) return;
    setActionLock('estorno');
    try {
      const installments = JSON.parse(JSON.stringify(loan.installments || []));
      let lastPaidIdx = -1;
      for (let i = installments.length - 1; i >= 0; i--) {
        if (installments[i].status === 'PAGO') { lastPaidIdx = i; break; }
      }
      if (lastPaidIdx === -1) return showToast('Nada para estornar.', 'info');

      const inst = installments[lastPaidIdx];
      const valorEstorno = Number(inst.lastPaidValue || getValue(inst));

      if (!window.confirm(`Estornar R$ ${valorEstorno.toFixed(2)}?`)) return;

      installments[lastPaidIdx] = {
        ...inst,
        status: 'PENDENTE',
        lastPaidValue: 0,
        paymentDate: null
      };

      const novoPago = Math.max(0, Number(((loan.paidAmount || 0) - valorEstorno).toFixed(2)));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`);
      showToast('Estornado!', 'success');
    } catch (e) { showToast('Erro no estorno.', 'error'); } 
    finally { setActionLock(null); }
  };

  return (
    <div className="space-y-6 pb-20">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard title="Caixa" value={caixa} color="text-emerald-500" icon={<Wallet size={16}/>} />
        <StatCard title="Recebido" value={loans.reduce((acc, l) => acc + Number(l.paidAmount || 0), 0)} color="text-blue-400" icon={<CheckCircle size={16}/>} />
        <StatCard title="Restante" value={loans.reduce((acc, l) => acc + Math.max(0, Number(l.totalToReturn || 0) - Number(l.paidAmount || 0)), 0)} color="text-red-500" icon={<History size={16}/>} />
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6">
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <input 
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            placeholder="PESQUISAR CLIENTE..."
            className="flex-1 bg-black border border-white/10 rounded-full px-6 py-3 text-[10px] text-white outline-none font-bold uppercase"
          />
          <div className="flex bg-black p-1 rounded-2xl border border-white/5">
            {(['ATIVOS', 'ATRASADOS', 'FINALIZADOS'] as const).map(s => (
              <button 
                key={s} 
                onClick={() => setFilterStatus(s)} 
                className={`px-6 py-2 rounded-xl text-[9px] font-black transition-all ${
                  filterStatus === s 
                  ? (s === 'ATRASADOS' ? 'bg-red-600 text-white' : 'bg-[#BF953F] text-black') 
                  : 'text-zinc-600'
                }`}
              >
                {s === 'FINALIZADOS' ? 'QUITADOS' : s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filteredLoans.map(loan => {
            const saldo = Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0);
            const late = isLoanLate(loan);
            return (
              <div key={loan.id} className="border border-white/5 rounded-[1.5rem] bg-black/20">
                <div className="p-4 flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-black text-white uppercase flex items-center gap-2">
                      {loan.customerName}
                      {late && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
                    </h4>
                    <p className="text-[9px] text-zinc-500 font-bold">SALDO: R$ {Math.max(0, saldo).toFixed(2)}</p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEstorno(loan)} className="p-3 bg-red-500/10 text-red-500 rounded-xl"><RotateCcw size={14} /></button>
                    <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-3 bg-white/5 text-zinc-400 rounded-xl"><ChevronDown size={14} /></button>
                  </div>
                </div>
                {expandedLoan === loan.id && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-white/5 bg-black/40">
                    {loan.installments.map((inst, idx) => {
                      const base = getValue(inst);
                      const { valorTotal, diasAtraso } = inst.status !== 'PAGO' ? calcularJurosAtraso(inst.dueDate, base) : { valorTotal: inst.lastPaidValue || base, diasAtraso: 0 };
                      const isLate = diasAtraso > 0 && inst.status !== 'PAGO';
                      return (
                        <div key={idx} className={`p-4 rounded-2xl border ${inst.status === 'PAGO' ? 'border-emerald-500/20 bg-emerald-500/5' : isLate ? 'border-red-500/20 bg-red-500/5' : 'border-white/5'}`}>
                          <p className="text-[7px] font-black text-zinc-500 uppercase mb-1">P{inst.number} - {inst.dueDate.split('-').reverse().join('/')}</p>
                          <p className={`text-sm font-black ${inst.status === 'PAGO' ? 'text-emerald-500' : isLate ? 'text-red-500' : 'text-white'}`}>R$ {valorTotal.toFixed(2)}</p>
                          {inst.status !== 'PAGO' && (
                            <button onClick={() => handlePayInstallment(loan, idx)} className="w-full mt-2 py-2 bg-[#BF953F] text-black text-[9px] font-black rounded-lg">RECEBER</button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5">
    <div className={`p-2 w-fit rounded-lg bg-white/5 mb-2 ${color}`}>{icon}</div>
    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{title}</p>
    <h3 className="text-xl font-black text-white">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;