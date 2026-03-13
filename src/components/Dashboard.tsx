import React, { useMemo, useState, useEffect } from 'react';
import {
  Users, Briefcase, AlertCircle, ChevronDown, 
  PlusCircle, MinusCircle, ArrowUpRight, 
  ArrowDownRight, History, CheckCircle2
} from 'lucide-react';
import { Loan, Customer, CashMovement } from '../types';

interface DashboardProps {
  loans: Loan[];
  customers: Customer[];
  cashMovements: CashMovement[];
  onNavigateToLoan?: (loanId: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ loans = [], customers = [], cashMovements = [] }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
    const now = new Date();
    setExpandedMonth(`${now.getFullYear()}-${now.getMonth()}`);
  }, []);

  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    if (typeof d === 'object' && d.seconds) return new Date(d.seconds * 1000);
    const date = new Date(d);
    return isNaN(date.getTime()) ? new Date() : date;
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const activeContracts = (loans || []).filter(l => {
      const pago = Number(l.paidAmount || 0);
      const total = Number(l.totalToReturn || 0);
      return pago < (total - 0.5);
    }).length;

    const overdueContracts = (loans || []).filter(l => {
      // REGRA DE OURO: Se o saldo devedor e zero, ele nunca esta inadimplente
      const saldoDevedor = Number(l.totalToReturn || 0) - Number(l.paidAmount || 0);
      if (saldoDevedor <= 0.5) return false;

      return (l.installments || []).some(inst => {
        const status = String(inst.status || '').trim().toUpperCase();
        if (status === 'PAGO' || status === 'LIQUIDADO') return false;

        const vencimento = String(inst.dueDate || '').trim();
        const jaVenceu = vencimento < todayStr;
        const temValor = (Number(inst.amount) || Number(inst.value) || 0) > 0.1;

        return jaVenceu && temValor;
      });
    }).length;

    return { 
      activeContracts, 
      overdueContracts: Math.max(0, overdueContracts), 
      activeCustomers: (customers || []).length 
    };
  }, [loans, customers, todayStr]);

  const monthlyHistory = useMemo(() => {
    const monthsFull = ['Janeiro', 'Fevereiro', 'Mar\u00E7o', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const data = [];
    const today = new Date();
    
    for (let year = 2024; year <= today.getFullYear(); year++) {
      for (let month = 0; month <= 11; month++) {
        const tempDate = new Date(year, month, 1);
        if (tempDate > today) break;

        const isMatch = (dateValue: any) => {
          if (!dateValue) return false;
          const d = parseDate(dateValue);
          return d.getMonth() === month && d.getFullYear() === year;
        };

        const normalize = (value: string) =>
          String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toUpperCase()
            .trim();

        const entradasManuais = (cashMovements || []).filter(m => {
          const t = normalize(String(m.type || ''));
          return isMatch(m.date) && (t === 'APORTE' || t === 'PAGAMENTO' || t === 'ENTRADA');
        });


        const estornosDoMes = (cashMovements || []).filter(m => {
          const t = normalize(String(m.type || ''));
          return isMatch(m.date) && t === 'ESTORNO';
        });
        const isMovementLinkedToLoan = (movement: CashMovement, loan: Loan) => {
          if (!isMatch(movement.date)) return false;

          if (movement.loanId && movement.loanId === loan.id) return true;

          const desc = normalize(String(movement.description || ''));
          const customerName = normalize(String(loan.customerName || ''));
          const contractNumber = normalize(String(loan.contractNumber || ''));

          if (contractNumber && desc.includes(contractNumber)) return true;
          if (desc.includes('EMPRESTIMO') && customerName && desc.includes(customerName)) return true;

          const amountMatch = Math.abs(Number(movement.amount || 0)) === Math.abs(Number(loan.amount || 0));
          const sameDate = parseDate(movement.date).toDateString() === parseDate(loan.createdAt || loan.startDate).toDateString();
          return amountMatch && sameDate;
        };

        const saidasManuais = (cashMovements || []).filter(m => {
          const t = normalize(String(m.type || ''));
          if (!isMatch(m.date)) return false;
          if (t === 'RETIRADA' || t === 'SAIDA') {
            const linkedLoan = (loans || []).some(loan => isMovementLinkedToLoan(m as CashMovement, loan));
            if (linkedLoan) return false;
          }
          return t === 'RETIRADA' || t === 'SAIDA';
        });

        const novosEmprestimos = (loans || []).filter(l => isMatch(l.createdAt || l.startDate));
        const totalRetorno = entradasManuais.reduce((acc, r) => acc + (Number(r.amount || r.value || 0)), 0);
        const totalSaida = novosEmprestimos.reduce((acc, l) => acc + Number(l.amount || 0), 0) + saidasManuais.reduce((acc, r) => acc + Number(r.amount || 0), 0) + estornosDoMes.reduce((acc, r) => acc + Number(r.amount || r.value || 0), 0);

        if (totalRetorno > 0 || totalSaida > 0 || (month === today.getMonth() && year === today.getFullYear())) {
          data.push({ id: `${year}-${month}`, name: monthsFull[month], year, entradas: entradasManuais, saidasManuais, novosEmprestimos, totalSaida, totalRetorno });
        }
      }
    }
    return data.sort((a, b) => b.year !== a.year ? b.year - a.year : 0).reverse().slice(-12);
  }, [loans, cashMovements]);

  if (!isMounted) return null;

  return (
    <div className="space-y-6 sm:space-y-10 animate-in fade-in duration-700 pb-8 sm:pb-10 px-0 sm:px-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        <StatCard title="Contratos Ativos" value={stats.activeContracts.toString()} icon={<Briefcase size={20} className="text-[#BF953F]" />} description="Em andamento" />
        <StatCard title="Clientes na Base" value={stats.activeCustomers.toString()} icon={<Users size={20} className="text-blue-500" />} description="Cadastrados" />
        <StatCard 
          title="Inadimpl\u00EAncia" 
          value={stats.overdueContracts.toString()} 
          icon={<AlertCircle size={20} className={stats.overdueContracts > 0 ? "text-red-500" : "text-zinc-600"} />} 
          description="Contratos com atraso real" 
          border={stats.overdueContracts > 0 ? "border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.05)]" : "border-zinc-900"} 
        />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-6 opacity-60">
          <History size={16} className="text-[#BF953F]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Fluxo de Caixa Mensal</h3>
        </div>

        {monthlyHistory.map((month) => (
          <div key={month.id} className={`bg-[#0a0a0a] rounded-3xl sm:rounded-[2.5rem] border transition-all duration-500 ${expandedMonth === month.id ? 'border-[#BF953F]/40 shadow-2xl scale-[1.01]' : 'border-zinc-900 hover:border-zinc-800'}`}>
            <button onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)} className="w-full px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-5">
                <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center border font-black text-[10px] sm:text-[11px] ${expandedMonth === month.id ? 'bg-[#BF953F] text-black border-[#BF953F]' : 'bg-black text-zinc-600 border-zinc-800'}`}>
                  {month.name.slice(0, 3).toUpperCase()}
                </div>
                <div className="text-left">
                  <h4 className="text-base sm:text-lg font-black text-white uppercase">{month.name} <span className="text-zinc-800 ml-1">{month.year}</span></h4>
                  <div className="flex flex-wrap gap-2 sm:gap-4 mt-1">
                    <span className="text-[9px] font-black text-emerald-500 uppercase">Entradas: {month.totalRetorno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    <span className="text-[9px] font-black text-red-500 uppercase">Sa\u00EDdas: {month.totalSaida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>
              </div>
              <ChevronDown size={18} className={`transition-transform ${expandedMonth === month.id ? 'rotate-180 text-[#BF953F]' : 'text-zinc-700'}`} />
            </button>
            {expandedMonth === month.id && (
              <div className="px-4 sm:px-6 pb-6 sm:pb-10 border-t border-white/5 pt-6 sm:pt-8 animate-in slide-in-from-top-4">
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 sm:gap-10">
                  <div>
                    <h5 className="text-[9px] font-black text-emerald-500 uppercase mb-5 flex items-center gap-2 tracking-[0.2em]"><ArrowUpRight size={14} /> Receitas</h5>
                    <div className="space-y-3">
                      {month.entradas.map((m, i) => <ListItem key={i} m={m} color="emerald" />)}
                      {month.entradas.length === 0 && <Empty msg="Sem entradas" />}
                    </div>
                  </div>
                  <div>
                    <h5 className="text-[9px] font-black text-red-500 uppercase mb-5 flex items-center gap-2 tracking-[0.2em]"><ArrowDownRight size={14} /> Sa\u00EDdas</h5>
                    <div className="space-y-3">
                      {month.novosEmprestimos.map(l => (
                         <div key={l.id} className="bg-white/[0.01] border border-zinc-900 rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                               <div className="p-2 bg-red-500/10 rounded-xl text-red-500"><Users size={14} /></div>
                               <div>
                                  <p className="text-[10px] font-black text-zinc-200 uppercase truncate max-w-[44vw] sm:max-w-none">{l.customerName}</p>
                                  <p className="text-[8px] text-zinc-600 font-bold uppercase">Empr\u00E9stimo</p>
                               </div>
                            </div>
                            <span className="text-[11px] sm:text-xs font-black text-red-500 shrink-0">-{Number(l.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                         </div>
                      ))}
                      {month.saidasManuais.map((m, i) => <ListItem key={i} m={m} color="red" />)}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, border, description }: any) => (
  <div className={`bg-[#0a0a0a] p-5 sm:p-8 rounded-3xl sm:rounded-[2.5rem] border ${border || 'border-zinc-900'} shadow-xl group transition-all`}>
    <div className="flex items-center justify-between mb-6">
      <span className="text-[8px] sm:text-[9px] font-black uppercase text-zinc-600 tracking-[0.2em] group-hover:text-zinc-400">{title}</span>
      <div className="p-2.5 sm:p-3 bg-black rounded-2xl border border-zinc-800">{icon}</div>
    </div>
    <p className="text-3xl sm:text-5xl font-black text-white tracking-tighter mb-2">{value}</p>
    <p className="text-[8px] sm:text-[9px] text-zinc-600 font-black uppercase tracking-widest">{description}</p>
  </div>
);

const ListItem = ({ m, color }: any) => (
  <div className={`bg-white/[0.01] border border-zinc-900 rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-3 hover:border-${color}-500/20 transition-all`}>
    <div className="flex items-center gap-3 min-w-0">
      <div className={`p-2 rounded-xl ${color === 'emerald' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
        {color === 'emerald' ? <PlusCircle size={14} /> : <MinusCircle size={14} />}
      </div>
      <div>
        <p className="text-[10px] font-black text-zinc-300 uppercase truncate max-w-[50vw] sm:max-w-none">{m.description || 'Movimenta\u00E7\u00E3o'}</p>
        <p className="text-[8px] text-zinc-600 font-bold uppercase">{m.date ? new Date(m.date).toLocaleDateString('pt-BR') : 'Data Indefinida'}</p>
      </div>
    </div>
    <span className={`text-[11px] sm:text-xs font-black shrink-0 ${color === 'emerald' ? 'text-emerald-500' : 'text-red-500'}`}>
      {color === 'emerald' ? '+' : '-'}{(m.amount || m.value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
    </span>
  </div>
);

const Empty = ({ msg }: any) => (
  <div className="py-8 text-center border border-dashed border-zinc-900 rounded-[2rem] opacity-20">
    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{msg}</p>
  </div>
);

export default Dashboard;
