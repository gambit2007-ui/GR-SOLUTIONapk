import React, { useMemo, useState, useCallback } from 'react';
import {
  Wallet,
  CheckCircle,
  History,
  ArrowUpRight,
  ChevronDown,
  RotateCcw,
  Calendar,
  Search,
  ArrowDownLeft,
  ArrowUpRight as ArrowUpRightIcon
} from 'lucide-react';
import { Loan, Installment, CashMovement } from '../types';

type MovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO';

type InstallmentUI = Installment & {
  baseValue?: number;
  lastPaidValue?: number;
  paidAt?: string;
};

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
  if (parts.length !== 3) return null;
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
  const [transFilter, setTransFilter] = useState<'TODOS' | MovementType>('TODOS');
  const [expandedLoan, setExpandedLoan] = useState<string | null>(null);
  const [isAddingMovement, setIsAddingMovement] = useState(false);
  const [movementForm, setMovementForm] = useState({ type: 'APORTE' as 'APORTE' | 'RETIRADA', amount: '', description: '' });
  const [actionLock, setActionLock] = useState<string | null>(null);

  const calcularJurosAtraso = useCallback((dueDate: string, amount: any) => {
    const valorBase = Number(amount) || 0;
    const vencimento = parseISODate(dueDate);
    if (!vencimento || valorBase <= 0) return { valorTotal: valorBase, diasAtraso: 0 };

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (hoje <= vencimento) return { valorTotal: valorBase, diasAtraso: 0 };

    const diasAtraso = Math.floor((hoje.getTime() - vencimento.getTime()) / 86400000);
    const juros = valorBase * JUROS_DIA * diasAtraso;

    return { valorTotal: Number((valorBase + juros).toFixed(2)), diasAtraso };
  }, []);

  const isLoanLate = useCallback((loan: Loan) => {
    const pago = Number(loan.paidAmount || 0);
    const total = Number(loan.totalToReturn || 0);
    if (pago >= (total - 0.5)) return false; // Quitado não atrasa

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    return (loan.installments || []).some((inst) => {
      if (inst.status === 'PAGO') return false;
      const venc = parseISODate(inst.dueDate);
      return venc ? venc < hoje : false;
    });
  }, []);

  const filteredLoans = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return (loans || []).filter(l => {
      const saldo = Number(l.totalToReturn || 0) - Number(l.paidAmount || 0);
      const liq = saldo <= 0.5;
      const matchesSearch = !term || l.customerName.toLowerCase().includes(term);
      if (!matchesSearch) return false;

      if (filterStatus === 'FINALIZADOS') return liq;
      if (filterStatus === 'ATRASADOS') return !liq && isLoanLate(l);
      return !liq; // ATIVOS
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const stats = useMemo(() => {
    return (loans || []).reduce((acc, l) => {
      acc.totalEmprestado += Number(l.amount || 0);
      acc.totalRecebido += Number(l.paidAmount || 0);
      acc.totalAReceber += Math.max(0, Number(l.totalToReturn || 0) - Number(l.paidAmount || 0));
      return acc;
    }, { totalRecebido: 0, totalAReceber: 0, totalEmprestado: 0 });
  }, [loans]);

  const handlePayInstallment = async (loan: Loan, idx: number) => {
    if (actionLock) return;
    const key = `${loan.id}:PAY:${idx}`;
    setActionLock(key);

    try {
      const installments: InstallmentUI[] = JSON.parse(JSON.stringify(loan.installments || []));
      const inst = installments[idx];
      const baseAmount = Number(inst.baseValue ?? inst.value ?? inst.amount ?? 0);
      const { valorTotal } = calcularJurosAtraso(inst.dueDate, baseAmount);

      if (!window.confirm(`Receber R$ ${valorTotal.toFixed(2)}?`)) return;

      installments[idx] = { 
        ...inst, 
        status: 'PAGO', 
        lastPaidValue: valorTotal, 
        paidAt: new Date().toISOString() 
      };

      const novoPago = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));

      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('PAGAMENTO', valorTotal, `PAG: ${loan.customerName} (P${inst.number})`.toUpperCase());
      showToast('Pagamento recebido!', 'success');
    } catch (e) {
      showToast('Erro ao processar pagamento.', 'error');
    } finally {
      setActionLock(null);
    }
  };

  const handleEstorno = useCallback(async (loan: Loan) => {
    if (actionLock) return;
    setActionLock(`${loan.id}:ESTORNO`);

    try {
      const installments: InstallmentUI[] = JSON.parse(JSON.stringify(loan.installments || []));
      let lastPaidIdx = -1;
      for (let i = installments.length - 1; i >= 0; i--) {
        if (String(installments[i].status).toUpperCase() === 'PAGO') {
          lastPaidIdx = i;
          break;
        }
      }

      if (lastPaidIdx === -1) return showToast('Sem parcelas pagas.', 'info');

      const inst = installments[lastPaidIdx];
      const valorEstorno = Number(inst.lastPaidValue || 0);

      if (!window.confirm(`Estornar R$ ${valorEstorno.toFixed(2)}?`)) return;

      installments[lastPaidIdx] = {
        ...inst,
        status: 'PENDENTE',
        lastPaidValue: 0,
        paidAt: undefined,
        amount: Number(inst.baseValue ?? inst.value ?? inst.amount ?? 0)
      };

      const novoPago = Math.max(0, Number((loan.paidAmount || 0) - valorEstorno));

      await onUpdateLoan(loan.id, { installments, paidAmount: Number(novoPago.toFixed(2)) });
      onAddTransaction('ESTORNO', valorEstorno, `ESTORNO: ${loan.customerName}`.toUpperCase());
      showToast('Estornado com sucesso!', 'success');
    } catch (e) {
      showToast('Falha no estorno.', 'error');
    } finally {
      setActionLock(null);
    }
  }, [actionLock, onAddTransaction, onUpdateLoan, showToast]);

  const handleSaveMovement = () => {
    const amt = Number(movementForm.amount.replace(',', '.'));
    if (!amt || amt <= 0 || !movementForm.description) return showToast('Dados inválidos.', 'error');
    if (movementForm.type === 'RETIRADA' && amt > caixa) return showToast('Saldo insuficiente.', 'error');

    onAddTransaction(movementForm.type, amt, movementForm.description.toUpperCase());
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
    setIsAddingMovement(false);
    showToast('Movimentação salva!', 'success');
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="Caixa Atual" value={caixa} color="text-emerald-500" icon={<Wallet size={18}/>} />
        <StatCard title="Total Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle size={18}/>} />
        <StatCard title="Saldo Devedor" value={stats.totalAReceber} color="text-red-500" icon={<History size={18}/>} />
        <StatCard title="Previsão Lucro" value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado} color="text-[#BF953F]" icon={<ArrowUpRight size={18}/>} />
      </div>

      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-[10px] font-black uppercase text-zinc-500 tracking-[0.2em]">Gestão de Contratos</h3>
          <button onClick={() => setIsAddingMovement(!isAddingMovement)} className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-[#BF953F] hover:bg-[#BF953F] hover:text-black transition-all">
            {isAddingMovement ? 'CANCELAR' : 'NOVA MOVIMENTAÇÃO'}
          </button>
        </div>

        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-black/40 rounded-2xl border border-[#BF953F]/20 animate-in slide-in-from-top-2">
            <select value={movementForm.type} onChange={e => setMovementForm({...movementForm, type: e.target.value as any})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white">
              <option value="APORTE">APORTE (ENTRADA)</option>
              <option value="RETIRADA">RETIRADA (SAÍDA)</option>
            </select>
            <input placeholder="VALOR (R$)" value={movementForm.amount} onChange={e => setMovementForm({...movementForm, amount: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none focus:border-[#BF953F]/50" />
            <input placeholder="DESCRIÇÃO" value={movementForm.description} onChange={e => setMovementForm({...movementForm, description: e.target.value})} className="bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] text-white outline-none focus:border-[#BF953F]/50" />
            <button onClick={handleSaveMovement} className="bg-[#BF953F] text-black rounded-xl text-[10px] font-black hover:scale-[1.02] active:scale-95 transition-all">CONFIRMAR</button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 bg-black border border-white/10 rounded-full px-5 py-3 flex items-center gap-3">
            <Search size={14} className="text-zinc-600" />
            <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="BUSCAR CLIENTE..." className="bg-transparent border-none text-[10px] text-white w-full outline-none uppercase font-bold" />
          </div>
          <div className="flex bg-black p-1 rounded-2xl border border-white/5">
            {(['ATIVOS', 'ATRASADOS', 'FINALIZADOS'] as const).map(s => (
              <button key={s} onClick={() => setFilterStatus(s)} className={`px-6 py-2 rounded-xl text-[9px] font-black transition-all ${filterStatus === s ? (s === 'ATRASADOS' ? 'bg-red-500 text-white' : 'bg-[#BF953F] text-black') : 'text-zinc-600 hover:text-zinc-400'}`}>
                {s === 'FINALIZADOS' ? 'QUITADOS' : s}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {filteredLoans.map(loan => {
            const saldo = Number(loan.totalToReturn || 0) - Number(loan.paidAmount || 0);
            const late = !isLiquidated(loan) && isLoanLate(loan);
            return (
              <div key={loan.id} className="border border-white/5 rounded-[1.8rem] bg-black/20 overflow-hidden hover:border-white/10 transition-all">
                <div className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-[#BF953F] border border-white/5"><Calendar size={20} /></div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase flex items-center gap-2">
                        {loan.customerName}
                        {late && <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-[7px] font-black uppercase border border-red-500/20">Atraso</span>}
                      </h4>
                      <p className="text-[9px] text-zinc-500 font-bold mt-1 uppercase tracking-tighter">Saldo Devedor: <span className="text-zinc-300">R$ {Math.max(0, saldo).toFixed(2)}</span></p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEstorno(loan)} className="p-3 bg-red-500/5 text-red-500 rounded-xl hover:bg-red-500 hover:text-white transition-all" title="Estornar último pagamento"><RotateCcw size={16} /></button>
                    <button onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)} className="p-3 bg-white/5 text-zinc-400 rounded-xl hover:text-white transition-all"><ChevronDown size={16} className={expandedLoan === loan.id ? 'rotate-180' : ''} /></button>
                  </div>
                </div>

                {expandedLoan === loan.id && (
                  <div className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-t border-white/5 bg-black/40 animate-in fade-in zoom-in-95 duration-300">
                    {(loan.installments as InstallmentUI[]).map((inst, idx) => {
                      const { valorTotal, diasAtraso } = inst.status !== 'PAGO' ? calcularJurosAtraso(inst.dueDate, inst.baseValue || inst.amount) : { valorTotal: inst.lastPaidValue || 0, diasAtraso: 0 };
                      const isLate = diasAtraso > 0 && inst.status !== 'PAGO';
                      return (
                        <div key={idx} className={`p-4 rounded-2xl border transition-all ${inst.status === 'PAGO' ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60' : isLate ? 'bg-red-500/5 border-red-500/20' : 'bg-white/5 border-white/5'}`}>
                          <div className="flex justify-between text-[7px] font-black text-zinc-500 mb-2 uppercase"><span>Parc {inst.number}</span><span>{inst.dueDate.split('-').reverse().join('/')}</span></div>
                          <p className={`text-sm font-black ${isLate ? 'text-red-500' : inst.status === 'PAGO' ? 'text-emerald-500' : 'text-white'}`}>R$ {valorTotal.toFixed(2)}</p>
                          {inst.status !== 'PAGO' ? (
                            <button onClick={() => handlePayInstallment(loan, idx)} className="w-full mt-3 py-2 bg-[#BF953F] text-black text-[9px] font-black rounded-lg hover:scale-[1.02] active:scale-95 transition-all">RECEBER</button>
                          ) : (
                            <div className="mt-3 flex items-center gap-1 text-[7px] font-black text-emerald-600 uppercase"><CheckCircle size={10}/> Pago em {inst.paidAt ? new Date(inst.paidAt).toLocaleDateString() : '-'}</div>
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

const isLiquidated = (l: Loan) => (Number(l.totalToReturn || 0) - Number(l.paidAmount || 0)) <= 0.5;

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-5 rounded-3xl bg-[#0a0a0a] border border-white/5 hover:border-white/10 transition-all">
    <div className={`p-2.5 w-fit rounded-xl bg-white/5 mb-3 ${color}`}>{icon}</div>
    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">{title}</p>
    <h3 className="text-xl font-black text-white mt-1">R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</h3>
  </div>
);

export default Reports;