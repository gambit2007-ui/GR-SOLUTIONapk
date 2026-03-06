import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet, CheckCircle, History, ArrowUpRight, ChevronDown, 
  RotateCcw, Search, ArrowDownLeft, ArrowUpRight as ArrowUpRightIcon, Star
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

const JUROS_DIA = 0.015; // 1,5% ao dia

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

  // FUNÇÃO QUE CALCULA O VALOR ATUALIZADO COM JUROS
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
      const isLiq = saldo <= 0.5; // Margem para considerar quitado
      const matchesSearch = l.customerName.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (filterStatus === 'FINALIZADOS') return isLiq;
      if (filterStatus === 'ATRASADOS') return !isLiq && isLoanLate(l);
      return !isLiq;
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const handlePayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    setActionLock(`${loan.id}-${idx}`);
    try {
      const installments = [...loan.installments];
      const inst = installments[idx];
      const valorComJuros = getValueWithJuros(inst);

      if (!window.confirm(`Receber R$ ${valorComJuros.toFixed(2)} (com juros se aplicável)?`)) return;

      installments[idx] = { 
        ...inst, 
        status: 'PAGO', 
        lastPaidValue: valorComJuros, 
        paymentDate: new Date().toISOString() 
      };

      const novoPago = Number(((loan.paidAmount || 0) + valorComJuros).toFixed(2));
      const saldoRestante = Number(loan.totalToReturn || 0) - novoPago;
      
      // Se o saldo for quase zero, marca o contrato como FINALIZADO
      const novoStatus = saldoRestante <= 0.5 ? 'FINALIZADO' : (loan.status || 'EM_CURSO');

      await onUpdateLoan(loan.id, { 
        installments, 
        paidAmount: novoPago,
        status: novoStatus 
      });

      onAddTransaction('PAGAMENTO', valorComJuros, `PAG: ${loan.customerName} (P${inst.number})`);
      showToast('Pagamento registado!', 'success');
    } catch (e) { showToast('Erro ao processar.', 'error'); } 
    finally { setActionLock(null); }
  };

  return (
    <div className="space-y-6 pb-20 max-w-[1400px] mx-auto">
      {/* HEADER DE INDICADORES */}
      <div className="flex flex-col xl:flex-row gap-4">
        <div className="xl:w-1/3 p-8 rounded-[2.5rem] bg-gradient-to-br from-emerald-500/10 to-transparent border border-emerald-500/20 shadow-2xl relative overflow-hidden group">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-2xl bg-emerald-500 text-black shadow-lg"><Wallet size={24} /></div>
            <span className="text-[10px] font-black uppercase text-emerald-500 tracking-[0.3em]">Caixa Geral</span>
          </div>
          <h2 className="text-5xl font-black text-white tracking-tighter">
            R$ {Number(caixa || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
          </h2>
        </div>

        <div className="xl:flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <StatCard title="A Receber Total" value={stats.totalAReceber} color="text-red-500" icon={<History size={20}/>} desc="Inclui juros previstos" />
          <StatCard title="Valor na Rua" value={stats.valorEmRua} color="text-orange-400" icon={<ArrowUpRightIcon size={20}/>} desc="Capital puro pendente" />
          <StatCard title="Total Emprestado" value={stats.totalEmprestado} color="text-zinc-400" icon={<ArrowDownLeft size={20}/>} desc="Histórico de saídas" />
          <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle size={20}/>} desc="Histórico de entradas" />
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2.5rem] p-8 shadow-xl">
        {/* BUSCA E FILTROS */}
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

        {/* LISTA DE CLIENTES */}
        <div className="grid grid-cols-1 gap-4">
          {filteredLoans.map(loan => (
            <div key={loan.id} className="group border border-white/5 rounded-3xl bg-white/[0.01] hover:bg-white/[0.03] transition-all overflow-hidden">
              <div className="p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-5">
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border ${isLoanLate(loan) ? 'bg-red-500/10 border-red-500/20 text-red-500' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
                    <CheckCircle size={24} />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white uppercase flex items-center gap-3">
                      {loan.customerName}
                      {isLoanLate(loan) && <span className="px-3 py-1 bg-red-600 text-[8px] rounded-full animate-pulse shadow-lg">EM ATRASO (1.5%/DIA)</span>}
                    </h4>
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

                    return (
                      <div key={idx} className={`p-5 rounded-2xl border transition-all ${inst.status === 'PAGO' ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-white/5 bg-white/[0.02]'}`}>
                        <div className="flex justify-between items-center mb-2">
                          <span className="text-[8px] font-black text-zinc-500 uppercase">P{inst.number}</span>
                          <span className={`text-[9px] font-bold ${temJuros ? 'text-red-500' : 'text-zinc-400'}`}>{inst.dueDate.split('-').reverse().join('/')}</span>
                        </div>
                        <p className={`text-lg font-black ${inst.status === 'PAGO' ? 'text-emerald-500' : (temJuros ? 'text-red-500' : 'text-white')}`}>
                          R$ {valorAtualizado.toFixed(2)}
                        </p>
                        {temJuros && <p className="text-[7px] font-black text-red-600 uppercase mt-1">+ Juros de Atraso Aplicado</p>}
                        
                        {inst.status !== 'PAGO' && (
                          <button onClick={() => handlePayInstallment(loan, idx)} className="w-full mt-4 py-3 bg-white text-black text-[10px] font-black rounded-xl hover:bg-emerald-500 transition-all uppercase">Receber Agora</button>
                        )}
                        {inst.status === 'PAGO' && (
                          <div className="mt-4 flex items-center gap-2 text-[8px] font-black text-emerald-600 uppercase tracking-widest justify-center"><CheckCircle size={10}/> Paga em {new Date(inst.paymentDate!).toLocaleDateString()}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon, desc }: any) => (
  <div className="p-6 rounded-[2rem] bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all shadow-lg">
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