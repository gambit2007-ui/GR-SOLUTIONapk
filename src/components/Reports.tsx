import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet, CheckCircle, History, ArrowUpRight, ChevronDown, 
  RotateCcw, Calendar, Search, ArrowDownLeft, PlusCircle, MinusCircle,
  ArrowUpRight as ArrowUpRightIcon
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
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });
  const [actionLock, setActionLock] = useState<string | null>(null);

  const getValue = (inst: any) => Number(inst.amount || inst.value || inst.baseValue || 0);

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
  }, [loans]);

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
      const isLiq = saldo <= 0.1;
      const matchesSearch = l.customerName.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (filterStatus === 'FINALIZADOS') return isLiq;
      if (filterStatus === 'ATRASADOS') return !isLiq && isLoanLate(l);
      return !isLiq;
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const handleSaveMovement = () => {
    const amt = Number(movementForm.amount.replace(',', '.'));
    if (!amt || amt <= 0 || !movementForm.description) return showToast('Dados inválidos.', 'error');
    onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase());
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
    setIsAddingMovement(false);
    showToast('Movimentação salva!', 'success');
  };

  const handlePayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    setActionLock(`${loan.id}-${idx}`);
    try {
      const installments = JSON.parse(JSON.stringify(loan.installments || []));
      const inst = installments[idx];
      const baseValue = getValue(inst);
      const hoje = new Date();
      hoje.setHours(0, 0, 0, 0);
      const vencimento = parseISODate(inst.dueDate);
      
      let valorFinal = baseValue;
      if (vencimento && hoje > vencimento) {
        const dias = Math.floor((hoje.getTime() - vencimento.getTime()) / 86400000);
        valorFinal = Number((baseValue + (baseValue * JUROS_DIA * dias)).toFixed(2));
      }

      if (!window.confirm(`Receber R$ ${valorFinal.toFixed(2)}?`)) return;

      installments[idx] = { ...inst, status: 'PAGO', lastPaidValue: valorFinal, paymentDate: hoje.toISOString() };
      const novoPago = Number(((loan.paidAmount || 0) + valorFinal).toFixed(2));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('PAGAMENTO', valorFinal, `PAG: ${loan.customerName} (P${inst.number})`);
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
      installments[lastPaidIdx] = { ...inst, status: 'PENDENTE', lastPaidValue: 0, paymentDate: null };
      const novoPago = Math.max(0, Number(((loan.paidAmount || 0) - valorEstorno).toFixed(2)));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`);
      showToast('Estornado!', 'success');
    } catch (e) { showToast('Erro no estorno.', 'error'); } 
    finally { setActionLock(null); }
  };

  return (
    <div className="space-y-6 pb-20">
      {/* 1. CARDS DE RESUMO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Caixa Geral" value={caixa} color="text-emerald-500" icon={<Wallet size={16}/>} />
        <StatCard title="Valor na Rua" value={stats.valorEmRua} color="text-orange-400" icon={<ArrowUpRightIcon size={16}/>} />
        <StatCard title="A Receber" value={stats.totalAReceber} color="text-red-500" icon={<History size={16}/>} />
        <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-400" icon={<ArrowDownLeft size={16}/>} />
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle size={16}/>} />
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6">
        {/* 2. CABEÇALHO E BOTÃO DE APORTE */}
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em]">Gestão de Contratos</h3>
          <button onClick={() => setIsAddingMovement(!isAddingMovement)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-[#BF953F] hover:bg-[#BF953F] hover:text-black transition-all">
            {isAddingMovement ? 'CANCELAR' : 'NOVA MOVIMENTAÇÃO'}
          </button>
        </div>

        {/* 3. FORMULÁRIO DE APORTE/RETIRADA */}
        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-black/40 rounded-2xl border border-[#BF953F]/20 animate-in slide-in-from-top-2">
            <select value={movementForm.type} onChange={e => setMovementForm({...movementForm, type: e.target.value as any})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white">
              <option value="APORTE">APORTE (ENTRADA)</option>
              <option value="RETIRADA">RETIRADA (SAÍDA)</option>
            </select>
            <input placeholder="VALOR (R$)" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none focus:border-[#BF953F]/50" />
            <input placeholder="DESCRIÇÃO" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none focus:border-[#BF953F]/50 uppercase" />
            <button onClick={handleSaveMovement} className="bg-[#BF953F] text-black rounded-xl text-[10px] font-black hover:scale-[1.02] active:scale-95 transition-all uppercase">Confirmar</button>
          </div>
        )}

        {/* 4. BUSCA E FILTROS */}
        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 bg-black border border-white/10 rounded-full px-5 py-3 flex items-center gap-3">
            <Search size={14} className="text-zinc-600" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="BUSCAR CLIENTE..." className="bg-transparent border-none text-[10px] text-white w-full outline-none uppercase font-bold" />
          </div>
          <div className="flex bg-black p-1 rounded-2xl border border-white/5">
            {(['ATIVOS', 'ATRASADOS', 'FINALIZADOS'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-6 py-2 rounded-xl text-[9px] font-black transition-all ${filterStatus === s ? (s === 'ATRASADOS' ? 'bg-red-600 text-white' : 'bg-[#BF953F] text-black') : 'text-zinc-600'}`}>
                {s === 'FINALIZADOS' ? 'QUITADOS' : s}
              </button>
            ))}
          </div>
        </div>

        {/* 5. LISTA DE CONTRATOS (OS 6 CARDS) */}
        <div className="space-y-3 mb-10">
          {filteredLoans.map(loan => (
            <div key={loan.id} className="border border-white/5 rounded-[1.5rem] bg-black/20">
              <div className="p-4 flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-white uppercase flex items-center gap-2">{loan.customerName} {isLoanLate(loan) && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}</h4>
                  <p className="text-[9px] text-zinc-500 font-bold">DEVEDOR: R$ {Math.max(0, Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0)).toFixed(2)}</p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => handleEstorno(loan)} className="p-3 bg-red-500/10 text-red-500 rounded-xl"><RotateCcw size={14} /></button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-3 bg-white/5 text-zinc-400 rounded-xl"><ChevronDown size={14} /></button>
                </div>
              </div>
              {expandedLoan === loan.id && (
                <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-white/5 bg-black/40">
                  {loan.installments.map((inst, idx) => (
                    <div key={idx} className={`p-4 rounded-2xl border ${inst.status === 'PAGO' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5'}`}>
                      <p className="text-[7px] font-black text-zinc-500 uppercase mb-1">P{inst.number} - {inst.dueDate.split('-').reverse().join('/')}</p>
                      <p className={`text-sm font-black ${inst.status === 'PAGO' ? 'text-emerald-500' : 'text-white'}`}>R$ {getValue(inst).toFixed(2)}</p>
                      {inst.status !== 'PAGO' && <button onClick={() => handlePayInstallment(loan, idx)} className="w-full mt-2 py-2 bg-[#BF953F] text-black text-[9px] font-black rounded-lg">RECEBER</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 6. EXTRATO DE MOVIMENTAÇÕES (FIXO NO FINAL) */}
        <div className="mt-12 pt-8 border-t border-white/5">
          <div className="flex items-center gap-2 mb-6 opacity-60">
            <History size={16} className="text-[#BF953F]" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Últimas Movimentações</h3>
          </div>
          <div className="space-y-3">
            {cashMovements.slice().reverse().slice(0, 10).map((m, i) => (
              <div key={i} className="bg-white/[0.02] border border-white/5 rounded-2xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-xl ${(m.type === 'APORTE' || m.type === 'PAGAMENTO') ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
                    {(m.type === 'APORTE' || m.type === 'PAGAMENTO') ? <PlusCircle size={14} /> : <MinusCircle size={14} />}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-zinc-300 uppercase">{m.description}</p>
                    <p className="text-[8px] text-zinc-600 font-bold uppercase">{new Date(m.date).toLocaleDateString()}</p>
                  </div>
                </div>
                <span className={`text-xs font-black ${(m.type === 'APORTE' || m.type === 'PAGAMENTO') ? 'text-emerald-500' : 'text-red-500'}`}>
                  {(m.type === 'APORTE' || m.type === 'PAGAMENTO') ? '+' : '-'}R$ {Number(m.amount).toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5">
    <div className={`p-2 w-fit rounded-lg bg-white/5 mb-2 ${color}`}>{icon}</div>
    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{title}</p>
    <h3 className="text-lg font-black text-white">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;