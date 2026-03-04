import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet, CheckCircle, History, ArrowUpRight, ChevronDown, 
  RotateCcw, Search, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon
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
    if (!amt || amt <= 0 || !movementForm.description) return showToast('Preencha os dados.', 'error');
    onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase());
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
    setIsAddingMovement(false);
    showToast('Realizado!', 'success');
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
      showToast('Sucesso!', 'success');
    } catch (e) { showToast('Erro.', 'error'); } 
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
      if (lastPaidIdx === -1) return showToast('Sem parcelas pagas.', 'info');
      const inst = installments[lastPaidIdx];
      const valorEstorno = Number(inst.lastPaidValue || getValue(inst));

      if (!window.confirm(`Estornar R$ ${valorEstorno.toFixed(2)}?`)) return;
      installments[lastPaidIdx] = { ...inst, status: 'PENDENTE', lastPaidValue: 0, paymentDate: null };
      const novoPago = Math.max(0, Number(((loan.paidAmount || 0) - valorEstorno).toFixed(2)));
      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`);
      showToast('Estornado!', 'success');
    } catch (e) { showToast('Erro.', 'error'); } 
    finally { setActionLock(null); }
  };

  return (
    <div className="space-y-6 pb-20 max-w-[1400px] mx-auto">
      {/* SEÇÃO SUPERIOR: CARDS DESTACADOS */}
      <div className="flex flex-col xl:flex-row gap-4">
        {/* CARD PRINCIPAL: CAIXA GERAL */}
        <div className="xl:w-1/3 p-8 rounded-[2.5rem] bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 shadow-2xl flex flex-col justify-between relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-10 opacity-5 group-hover:scale-110 transition-transform">
             <Wallet size={120} className="text-emerald-500" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-2xl bg-emerald-500 text-black shadow-lg">
                <Wallet size={24} />
              </div>
              <span className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.3em]">Caixa Geral</span>
            </div>
            <h2 className="text-5xl font-black text-white tracking-tighter">
              R$ {Number(caixa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </h2>
          </div>
          <p className="text-[9px] font-bold text-zinc-500 mt-6 uppercase tracking-widest">Saldo total disponível no sistema</p>
        </div>

        {/* GRADE SECUNDÁRIA: OUTROS INDICADORES */}
        <div className="xl:flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="A Receber Total" value={stats.totalAReceber} color="text-red-500" icon={<History size={20}/>} desc="Capital + Lucros esperados" />
          <StatCard title="Valor na Rua" value={stats.valorEmRua} color="text-orange-400" icon={<ArrowUpRightIcon size={20}/>} desc="Apenas capital investido pendente" />
          <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-400" icon={<ArrowDownLeft size={20}/>} desc="Histórico total de saídas" />
          <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle size={20}/>} desc="Histórico total de entradas" />
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-xl">
        <div className="flex flex-col md:flex-row justify-between items-center mb-8 gap-4">
          <div className="flex items-center gap-4 w-full md:w-auto">
            <h3 className="text-[11px] font-black uppercase text-zinc-400 tracking-[0.2em]">Gestão de Contratos</h3>
            <div className="h-[1px] w-12 bg-white/10 hidden md:block" />
          </div>
          
          <button 
            onClick={() => setIsAddingMovement(!isAddingMovement)} 
            className={`w-full md:w-auto px-8 py-3 rounded-full text-[10px] font-black tracking-widest transition-all shadow-lg active:scale-95 ${
              isAddingMovement ? 'bg-red-500/10 text-red-500 border border-red-500/20' : 'bg-[#BF953F] text-black hover:brightness-110'
            }`}
          >
            {isAddingMovement ? 'CANCELAR OPERAÇÃO' : 'NOVA MOVIMENTAÇÃO'}
          </button>
        </div>

        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 p-6 bg-white/[0.02] rounded-3xl border border-[#BF953F]/20 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="space-y-2">
              <label className="text-[8px] font-black text-zinc-500 uppercase ml-2">Tipo</label>
              <select value={movementForm.type} onChange={e => setMovementForm({...movementForm, type: e.target.value as any})} className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-[11px] text-white focus:border-[#BF953F]/50 outline-none">
                <option value="APORTE">APORTE (ENTRADA)</option>
                <option value="RETIRADA">RETIRADA (SAÍDA)</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-[8px] font-black text-zinc-500 uppercase ml-2">Valor</label>
              <input placeholder="0,00" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-[11px] text-white focus:border-[#BF953F]/50 outline-none" />
            </div>
            <div className="space-y-2 md:col-span-1">
              <label className="text-[8px] font-black text-zinc-500 uppercase ml-2">Motivo / Descrição</label>
              <input placeholder="EX: REFORÇO DE CAIXA" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} className="w-full bg-black border border-white/10 rounded-2xl px-5 py-4 text-[11px] text-white focus:border-[#BF953F]/50 outline-none uppercase" />
            </div>
            <div className="flex items-end">
              <button onClick={handleSaveMovement} className="w-full bg-white text-black h-[58px] rounded-2xl text-[10px] font-black hover:bg-[#BF953F] transition-all uppercase tracking-widest shadow-xl">Confirmar Lançamento</button>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1 bg-black border border-white/10 rounded-2xl px-6 py-4 flex items-center gap-4 group focus-within:border-[#BF953F]/30 transition-all">
            <Search size={18} className="text-zinc-600 group-focus-within:text-[#BF953F]" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="PESQUISAR POR NOME DO CLIENTE..." className="bg-transparent border-none text-[11px] text-white w-full outline-none font-bold uppercase tracking-wider" />
          </div>
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
            <div key={loan.id} className="group border border-white/5 rounded-3xl bg-white/[0.01] hover:bg-white/[0.03] hover:border-white/10 transition-all overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border shadow-inner ${isLoanLate(loan) ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    <CheckCircle size={24} className={!isLoanLate(loan) && Number(loan.paidAmount) > 0 ? 'text-emerald-500' : ''} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase tracking-tight flex items-center gap-3">
                      {loan.customerName}
                      {isLoanLate(loan) && <span className="px-3 py-1 bg-red-600 text-[8px] rounded-full animate-pulse shadow-lg shadow-red-600/30">EM ATRASO</span>}
                    </h4>
                    <div className="flex gap-4 mt-1">
                      <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">Saldo devedor: <span className="text-white">R$ {(Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0)).toFixed(2)}</span></p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={() => handleEstorno(loan)} className="flex-1 sm:flex-none px-5 py-3 bg-red-500/5 text-red-500 rounded-2xl hover:bg-red-500 hover:text-white transition-all border border-red-500/10" title="Estornar último pagamento"><RotateCcw size={18} /></button>
                  <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="flex-1 sm:flex-none px-5 py-3 bg-white/5 text-zinc-400 rounded-2xl hover:text-white transition-all border border-white/5 flex items-center justify-center gap-2">
                    <span className="text-[9px] font-black uppercase">Parcelas</span>
                    <ChevronDown size={18} className={`transition-transform duration-300 ${expandedLoan === loan.id ? 'rotate-180' : ''}`} />
                  </button>
                </div>
              </div>
              {expandedLoan === loan.id && (
                <div className="p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 border-t border-white/5 bg-black/40 animate-in zoom-in-95 duration-300">
                  {loan.installments.map((inst, idx) => (
                    <div key={idx} className={`p-5 rounded-2xl border transition-all ${inst.status === 'PAGO' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                      <div className="flex justify-between items-center mb-3">
                        <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Parc {inst.number}</span>
                        <span className="text-[9px] font-bold text-zinc-400">{inst.dueDate.split('-').reverse().join('/')}</span>
                      </div>
                      <p className={`text-lg font-black ${inst.status === 'PAGO' ? 'text-emerald-500' : 'text-white'}`}>R$ {getValue(inst).toFixed(2)}</p>
                      {inst.status !== 'PAGO' && <button onClick={() => handlePayInstallment(loan, idx)} className="w-full mt-4 py-3 bg-white text-black text-[10px] font-black rounded-xl hover:bg-[#BF953F] transition-all uppercase shadow-lg shadow-black/20">Receber</button>}
                      {inst.status === 'PAGO' && <div className="mt-4 flex items-center gap-2 text-[8px] font-black text-emerald-600 uppercase tracking-widest justify-center"><CheckCircle size={10}/> Liquidada</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// COMPONENTE DE CARD MENOR REESTILIZADO
const StatCard = ({ title, value, color, icon, desc }: any) => (
  <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all group shadow-lg">
    <div className="flex justify-between items-start mb-4">
      <div className={`p-3 rounded-xl bg-black border border-white/5 shadow-inner ${color}`}>
        {icon}
      </div>
      <div className="text-right">
        <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-1">{title}</p>
        <h3 className="text-2xl font-black text-white leading-none tracking-tight">
          R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
        </h3>
      </div>
    </div>
    <p className="text-[8px] font-bold text-zinc-600 uppercase tracking-tighter">{desc}</p>
  </div>
);

export default Reports;