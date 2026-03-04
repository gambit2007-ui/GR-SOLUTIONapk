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
import { Loan, Installment } from '../types';

type MovementType = 'APORTE' | 'RETIRADA' | 'PAGAMENTO' | 'ESTORNO';

type CashMovement = {
  type: MovementType;
  amount: number;
  description: string;
  date: string; // ISO
};

type InstallmentUI = Installment & {
  baseValue?: number;      // valor original (recomendado manter)
  lastPaidValue?: number;  // quanto foi pago (com juros)
  paidAt?: string;         // data de pagamento
};

interface ReportsProps {
  loans: Loan[];
  cashMovements: CashMovement[];
  caixa: number;
  onAddTransaction: (type: MovementType, amount: number, description: string) => void;
  onUpdateLoan: (loanId: string, newData: any) => Promise<void>;
  showToast: (message: string, type: 'success' | 'info' | 'error') => void;
}

const JUROS_DIA = 0.015; // 1,5% ao dia (mantive seu padrão)

const parseISODate = (iso?: string) => {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;

  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);

  const dt = new Date(y, mo, d);
  if (Number.isNaN(dt.getTime())) return null;
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
  const [movementForm, setMovementForm] = useState({
    type: 'APORTE' as 'APORTE' | 'RETIRADA',
    amount: '',
    description: '',
  });

  // trava anti “cliquei 2x e bagunçou o caixa”
  const [actionLock, setActionLock] = useState<string | null>(null);

  const calcularJurosAtraso = useCallback((dueDate: string, amount: unknown) => {
    const valorBase = Number(amount) || 0;
    if (valorBase <= 0) return { valorTotal: 0, diasAtraso: 0 };

    const vencimento = parseISODate(dueDate);
    if (!vencimento) return { valorTotal: valorBase, diasAtraso: 0 };

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    if (hoje <= vencimento) return { valorTotal: valorBase, diasAtraso: 0 };

    const diasAtraso = Math.floor((hoje.getTime() - vencimento.getTime()) / 86400000);
    const juros = valorBase * JUROS_DIA * diasAtraso;

    return { valorTotal: valorBase + juros, diasAtraso };
  }, []);

  const isLoanLate = useCallback((loan: Loan) => {
    const installments = (loan.installments || []) as any[];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    return installments.some((inst) => {
      if (inst.status === 'PAGO') return false;
      const venc = parseISODate(inst.dueDate);
      if (!venc) return false;
      return venc < hoje;
    });
  }, []);

  const isLiquidated = (loan: Loan) =>
    (loan.paidAmount || 0) >= ((loan.totalToReturn || 0) - 0.1);

  const filteredLoans = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return (loans || []).filter(l => {
      const liq = isLiquidated(l);
      const matchesSearch = !term || (l.customerName || '').toLowerCase().includes(term);

      if (!matchesSearch) return false;

      if (filterStatus === 'FINALIZADOS') return liq;
      if (filterStatus === 'ATRASADOS') return !liq && isLoanLate(l);

      // ATIVOS
      return !liq;
    });
  }, [loans, filterStatus, searchTerm, isLoanLate]);

  const stats = useMemo(() => {
    return (loans || []).reduce((acc, l) => {
      acc.totalEmprestado += (l.amount || 0);
      acc.totalRecebido += (l.paidAmount || 0);
      acc.totalAReceber += Math.max(0, (l.totalToReturn || 0) - (l.paidAmount || 0));
      return acc;
    }, { totalRecebido: 0, totalAReceber: 0, totalEmprestado: 0 });
  }, [loans]);

  const filteredMovements = useMemo(() => {
    const list = cashMovements || [];
    if (transFilter === 'TODOS') return list;
    return list.filter(m => m.type === transFilter);
  }, [cashMovements, transFilter]);

  const isInflow = (t: CashMovement) => t.type === 'PAGAMENTO' || t.type === 'APORTE';

  const handlePayInstallment = useCallback(async (loan: Loan, idx: number) => {
    const key = `${loan.id}:PAY:${idx}`;
    if (actionLock) return;
    setActionLock(key);

    try {
      const installments: InstallmentUI[] = JSON.parse(JSON.stringify(loan.installments || []));
      const inst = installments[idx];
      if (!inst) return;

      if (inst.status === 'PAGO') {
        showToast('Essa parcela já está paga.', 'info');
        return;
      }

      // Base real da parcela (sem depender de amount que pode ser mexido)
      const baseAmount = Number(inst.baseValue ?? inst.value ?? inst.amount ?? 0);
      const { valorTotal } = calcularJurosAtraso(inst.dueDate as any, baseAmount);

      const ok = window.confirm(`Receber R$ ${Number(valorTotal).toFixed(2)}?`);
      if (!ok) return;

      installments[idx] = {
        ...inst,
        status: 'PAGO',
        lastPaidValue: Number(valorTotal.toFixed(2)),
        paidAt: new Date().toISOString(),
      };

      const novoPago = Number(((loan.paidAmount || 0) + valorTotal).toFixed(2));

      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('PAGAMENTO', Number(valorTotal.toFixed(2)), `PAG: ${loan.customerName || 'CLIENTE'}`.toUpperCase());
      showToast('Recebido!', 'success');
    } catch (e) {
      console.error(e);
      showToast('Falha ao receber parcela.', 'error');
    } finally {
      setActionLock(null);
    }
  }, [actionLock, calcularJurosAtraso, onAddTransaction, onUpdateLoan, showToast]);

  const handleEstorno = useCallback(async (loan: Loan) => {
    const key = `${loan.id}:ESTORNO`;
    if (actionLock) return;
    setActionLock(key);

    try {
      const installments: InstallmentUI[] = JSON.parse(JSON.stringify(loan.installments || []));
      const lastPaidIndexFromEnd = installments.slice().reverse().findIndex(i => i.status === 'PAGO');
      const idx = lastPaidIndexFromEnd !== -1 ? (installments.length - 1 - lastPaidIndexFromEnd) : -1;

      if (idx === -1) {
        showToast('Sem parcelas pagas para estornar.', 'info');
        return;
      }

      const inst = installments[idx];
      const valor = Number(inst.lastPaidValue || 0);

      if (valor <= 0) {
        showToast('Valor de estorno inválido.', 'error');
        return;
      }

      const ok = window.confirm(`Estornar R$ ${valor.toFixed(2)}?`);
      if (!ok) return;

      const base = Number(inst.baseValue ?? inst.value ?? inst.amount ?? 0);

      installments[idx] = {
        ...inst,
        status: 'PENDENTE',
        lastPaidValue: 0,
        paidAt: undefined,
        amount: base > 0 ? base : inst.amount,
      };

      const novoPago = Number(((loan.paidAmount || 0) - valor).toFixed(2));

      await onUpdateLoan(loan.id, { installments, paidAmount: novoPago });
      onAddTransaction('ESTORNO', valor, `ESTORNO: ${loan.customerName || 'CLIENTE'}`.toUpperCase());
      showToast('Estornado!', 'info');
    } catch (e) {
      console.error(e);
      showToast('Falha ao estornar.', 'error');
    } finally {
      setActionLock(null);
    }
  }, [actionLock, onAddTransaction, onUpdateLoan, showToast]);

  const handleSaveMovement = useCallback(() => {
    const amt = Number(String(movementForm.amount).replace(',', '.'));
    const desc = movementForm.description.trim();

    if (!amt || amt <= 0) return showToast('Informe um valor válido.', 'error');
    if (!desc) return showToast('Informe uma descrição.', 'error');

    if (movementForm.type === 'RETIRADA' && amt > caixa) {
      return showToast('Retirada maior que o caixa atual.', 'error');
    }

    onAddTransaction(movementForm.type, Number(amt.toFixed(2)), desc.toUpperCase());
    setMovementForm({ type: 'APORTE', amount: '', description: '' });
    setIsAddingMovement(false);
    showToast('Movimento salvo.', 'success');
  }, [movementForm, caixa, onAddTransaction, showToast]);

  return (
    <div className="space-y-6 pb-20">
      {/* Resumo */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard title="Caixa" value={caixa} color="text-emerald-500" icon={<Wallet />} />
        <StatCard title="Recebido" value={stats.totalRecebido} color="text-blue-400" icon={<CheckCircle />} />
        <StatCard title="A Receber" value={stats.totalAReceber} color="text-red-500" icon={<History />} />
        <StatCard
          title="Lucro Bruto"
          value={stats.totalRecebido + stats.totalAReceber - stats.totalEmprestado}
          color="text-emerald-400"
          icon={<ArrowUpRight />}
        />
      </div>

      {/* Gestão de Caixa */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6 shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xs font-black uppercase text-white tracking-widest">Financeiro</h3>
          <button
            onClick={() => setIsAddingMovement(v => !v)}
            className="px-4 py-2 bg-white/5 border border-white/10 rounded-full text-[9px] font-black text-[#BF953F]"
          >
            {isAddingMovement ? 'FECHAR' : 'NOVO MOVIMENTO'}
          </button>
        </div>

        {isAddingMovement && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 bg-black/40 rounded-2xl border border-[#BF953F]/20">
            <select
              value={movementForm.type}
              onChange={e => setMovementForm({ ...movementForm, type: e.target.value as any })}
              className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white outline-none"
            >
              <option value="APORTE">APORTE</option>
              <option value="RETIRADA">RETIRADA</option>
            </select>

            <input
              placeholder="VALOR"
              value={movementForm.amount}
              onChange={e => setMovementForm({ ...movementForm, amount: e.target.value })}
              className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white outline-none"
            />

            <input
              placeholder="DESCRIÇÃO"
              value={movementForm.description}
              onChange={e => setMovementForm({ ...movementForm, description: e.target.value })}
              className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white outline-none"
            />

            <button
              onClick={handleSaveMovement}
              className="bg-[#BF953F] text-black rounded-lg text-[10px] font-black"
            >
              SALVAR
            </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 bg-black border border-white/10 rounded-full px-4 py-2 flex items-center gap-2">
            <Search size={14} className="text-zinc-600" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="PESQUISAR CLIENTE..."
              className="bg-transparent border-none text-[10px] text-white w-full outline-none uppercase"
            />
          </div>

          {/* Filtros ATIVOS / ATRASADOS / PAGOS */}
          <div className="flex bg-black p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setFilterStatus('ATIVOS')}
              className={`px-6 py-1.5 rounded-lg text-[9px] font-black ${
                filterStatus === 'ATIVOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'
              }`}
            >
              ATIVOS
            </button>

            <button
              onClick={() => setFilterStatus('ATRASADOS')}
              className={`px-6 py-1.5 rounded-lg text-[9px] font-black ${
                filterStatus === 'ATRASADOS' ? 'bg-red-500 text-white' : 'text-zinc-600'
              }`}
            >
              ATRASADOS
            </button>

            <button
              onClick={() => setFilterStatus('FINALIZADOS')}
              className={`px-6 py-1.5 rounded-lg text-[9px] font-black ${
                filterStatus === 'FINALIZADOS' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'
              }`}
            >
              PAGOS
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {filteredLoans.map(loan => {
            const saldo = ((loan.totalToReturn || 0) - (loan.paidAmount || 0));
            const liq = isLiquidated(loan);
            const late = !liq && isLoanLate(loan);

            return (
              <div key={loan.id} className="border border-white/5 rounded-[1.5rem] bg-black/20 overflow-hidden">
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-[#BF953F]">
                      <Calendar size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-white uppercase flex items-center">
                        {loan.customerName}
                        {late && (
                          <span className="ml-2 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[8px] font-black uppercase">
                            Atrasado
                          </span>
                        )}
                      </h4>
                      <p className="text-[9px] text-zinc-500">
                        SALDO: R$ {Number(saldo).toFixed(2)}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEstorno(loan)}
                      disabled={actionLock?.startsWith(`${loan.id}:`)}
                      className={`p-2 rounded-lg transition-all ${
                        actionLock?.startsWith(`${loan.id}:`)
                          ? 'bg-white/5 text-zinc-600 cursor-not-allowed'
                          : 'bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white'
                      }`}
                      title="Estornar última parcela paga"
                    >
                      <RotateCcw size={14} />
                    </button>

                    <button
                      onClick={() => setExpandedLoan(expandedLoan === loan.id ? null : loan.id)}
                      className="p-2 bg-[#BF953F]/10 text-[#BF953F] rounded-lg"
                      title="Ver parcelas"
                    >
                      <ChevronDown size={14} className={expandedLoan === loan.id ? 'rotate-180' : ''} />
                    </button>
                  </div>
                </div>

                {expandedLoan === loan.id && (
                  <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 border-t border-white/5 bg-black/40">
                    {(loan.installments as InstallmentUI[] | undefined)?.map((inst, idx) => {
                      const baseAmount = Number(inst.baseValue ?? inst.value ?? inst.amount ?? 0);

                      const calc =
                        inst.status !== 'PAGO'
                          ? calcularJurosAtraso(inst.dueDate as any, baseAmount)
                          : { valorTotal: Number(inst.lastPaidValue || baseAmount), diasAtraso: 0 };

                      const valorTotal = Number(calc.valorTotal || 0);
                      const diasAtraso = calc.diasAtraso || 0;

                      const locked = actionLock === `${loan.id}:PAY:${idx}`;

                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-xl border ${
                            inst.status === 'PAGO'
                              ? 'bg-emerald-500/5 border-emerald-500/20'
                              : diasAtraso > 0
                                ? 'bg-red-500/5 border-red-500/20'
                                : 'bg-white/5 border-white/5'
                          }`}
                        >
                          <div className="flex justify-between text-[8px] font-bold text-zinc-500 mb-1">
                            <span>PARCELA {inst.number}</span>
                            <span>{String(inst.dueDate || '').split('-').reverse().join('/')}</span>
                          </div>

                          <p className={`text-sm font-black ${diasAtraso > 0 && inst.status !== 'PAGO' ? 'text-red-500' : 'text-white'}`}>
                            R$ {valorTotal.toFixed(2)}
                          </p>

                          {inst.status !== 'PAGO' && (
                            <>
                              {diasAtraso > 0 && (
                                <p className="mt-1 text-[8px] font-bold text-red-400 uppercase">
                                  {diasAtraso} dia(s) em atraso
                                </p>
                              )}

                              <button
                                onClick={() => handlePayInstallment(loan, idx)}
                                disabled={locked || !!actionLock}
                                className={`w-full mt-2 py-1.5 text-[9px] font-black uppercase rounded-md ${
                                  locked || actionLock
                                    ? 'bg-white/10 text-zinc-400 cursor-not-allowed'
                                    : 'bg-[#BF953F] text-black'
                                }`}
                              >
                                {locked ? 'PROCESSANDO...' : 'Quitar'}
                              </button>
                            </>
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

      {/* Extrato */}
      <div className="bg-[#0a0a0a] border border-white/5 rounded-[2rem] p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-black uppercase text-white tracking-widest">Movimentações</h3>

          <select
            value={transFilter}
            onChange={e => setTransFilter(e.target.value as any)}
            className="bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] text-white outline-none"
          >
            <option value="TODOS">TODOS</option>
            <option value="APORTE">APORTE</option>
            <option value="RETIRADA">RETIRADA</option>
            <option value="PAGAMENTO">PAGAMENTO</option>
            <option value="ESTORNO">ESTORNO</option>
          </select>
        </div>

        <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
          {filteredMovements.slice().reverse().map((t, i) => {
            const entrada = isInflow(t);
            const Icon = entrada ? ArrowDownLeft : ArrowUpRightIcon;

            return (
              <div key={i} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-xl">
                <div className="flex items-center gap-3">
                  <div className={entrada ? 'text-emerald-500' : 'text-red-500'}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <p className="text-[9px] font-black text-white uppercase">{t.description}</p>
                    <p className="text-[7px] text-zinc-600 uppercase">
                      {new Date(t.date).toLocaleString()}
                    </p>
                  </div>
                </div>

                <p className={`text-[10px] font-black ${entrada ? 'text-emerald-500' : 'text-red-500'}`}>
                  R$ {Number(t.amount || 0).toFixed(2)}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, color, icon }: any) => (
  <div className="p-4 rounded-2xl bg-[#0a0a0a] border border-white/5">
    <div className={`p-2 w-fit rounded-lg bg-white/5 mb-2 ${color}`}>{icon}</div>
    <p className="text-[8px] font-bold text-zinc-500 uppercase">{title}</p>
    <h3 className="text-lg font-black text-white leading-none">
      R$ {Number(value || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
    </h3>
  </div>
);

export default Reports;