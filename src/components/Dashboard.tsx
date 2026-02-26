import React, { useMemo, useState, useEffect } from 'react';
import {
  Users,
  Briefcase,
  AlertCircle,
  ChevronDown,
  PlusCircle,
  MinusCircle,
  ArrowUpRight,
  ArrowDownRight,
  History,
  CheckCircle2
} from 'lucide-react';
import { Loan, Customer, CashMovement } from '../types';

interface DashboardProps {
  loans: Loan[];
  customers: Customer[];
  cashMovements: CashMovement[];
}

const Dashboard: React.FC<DashboardProps> = ({ loans = [], customers = [], cashMovements = [] }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
    const now = new Date();
    setExpandedMonth(`${now.getFullYear()}-${now.getMonth()}`);
  }, []);

  const todayStr = new Date().toISOString().split('T')[0];

  const parseDate = (d: any) => {
    if (!d) return new Date();
    if (d?.seconds) return new Date(d.seconds * 1000);
    return new Date(d);
  };

  // --- 1. MÉTRICAS GERAIS ---
  const stats = useMemo(() => {
    const activeContracts = loans.filter(l => {
      const status = l.status?.toUpperCase();
      return status !== 'QUITADO' && status !== 'CANCELADO';
    }).length;

    const overdueContracts = loans.filter(l =>
      l.installments?.some(inst =>
        (inst.status === 'PENDENTE' || inst.status === 'ATRASADO') &&
        inst.dueDate < todayStr
      )
    ).length;

    const activeCustomersCount = customers.length;

    return { activeContracts, overdueContracts, activeCustomers: activeCustomersCount };
  }, [loans, customers, todayStr]);

  // --- 2. LÓGICA DAS GAVETAS (CORRIGIDA) ---
  const monthlyHistory = useMemo(() => {
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const data = [];
    const today = new Date();
    const startDate = new Date(2026, 0, 1);
    let tempDate = new Date(startDate.getFullYear(), startDate.getMonth(), 1);

    while (tempDate <= today) {
      const mIdx = tempDate.getMonth();
      const yIdx = tempDate.getFullYear();

      const filterByMonth = (dateField: any) => {
        const d = parseDate(dateField);
        return d.getMonth() === mIdx && d.getFullYear() === yIdx;
      };

      // Aportes manuais da tabela CashMovements
      const aportes = cashMovements.filter(m => filterByMonth(m.date) && m.type?.toUpperCase() === 'APORTE');
      
      // Retiradas e Estornos
      const retiradas = cashMovements.filter(m => filterByMonth(m.date) && (m.type?.toUpperCase() === 'RETIRADA' || m.type?.toUpperCase() === 'ESTORNO'));

      // 🔍 NOVIDADE: Buscar recebimentos dentro das parcelas de cada Loan
      const recebimentosParcelas: any[] = [];
      loans.forEach(loan => {
        loan.installments?.forEach(inst => {
          // Se a parcela está paga e o pagamento foi neste mês
          if (inst.status === 'PAGO' && inst.paymentDate && filterByMonth(inst.paymentDate)) {
            recebimentosParcelas.push({
              id: `${loan.id}-${inst.number}`,
              description: `PARCELA: ${loan.customerName} (${inst.number}/${loan.installmentCount})`,
              amount: inst.value,
              date: inst.paymentDate,
              type: 'PAGAMENTO'
            });
          }
        });
      });

      const novosEmprestimos = loans.filter(l => filterByMonth(l.createdAt || l.startDate));

      const totalSaida = novosEmprestimos.reduce((acc, l) => acc + (Number(l.amount) || 0), 0) + 
                         retiradas.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);
      
      const totalRetorno = aportes.reduce((acc, a) => acc + (Number(a.amount) || 0), 0) + 
                           recebimentosParcelas.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

      if (aportes.length > 0 || retiradas.length > 0 || recebimentosParcelas.length > 0 || novosEmprestimos.length > 0 || (mIdx === today.getMonth() && yIdx === today.getFullYear())) {
        data.push({
          id: `${yIdx}-${mIdx}`,
          name: monthsFull[mIdx],
          year: yIdx,
          aportes,
          retiradas,
          novosEmprestimos,
          recebimentos: recebimentosParcelas,
          totalSaida,
          totalRetorno
        });
      }
      tempDate.setMonth(tempDate.getMonth() + 1);
    }
    return data.reverse();
  }, [loans, cashMovements]);

  if (!isMounted) return null;

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-10 px-2">
      
      {/* SEÇÃO DE CARDS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Contratos Ativos"
          value={stats.activeContracts.toString()}
          icon={<Briefcase size={20} className="text-[#BF953F]" />}
          description="Em andamento"
        />
        <StatCard
          title="Clientes na Base"
          value={stats.activeCustomers.toString()}
          icon={<Users size={20} className="text-blue-500" />}
          description="Cadastrados no sistema"
        />
        <StatCard
          title="Inadimplência"
          value={stats.overdueContracts.toString()}
          icon={<AlertCircle size={20} className={stats.overdueContracts > 0 ? "text-red-500" : "text-zinc-600"} />}
          description="Contratos com atraso"
          border={stats.overdueContracts > 0 ? "border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : "border-zinc-900"}
        />
      </div>

      {/* HISTÓRICO MENSAL */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-6 opacity-50">
          <History size={16} className="text-[#BF953F]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Fluxo de Caixa por Período</h3>
        </div>

        {monthlyHistory.map((month) => (
          <div key={month.id} className={`bg-[#0a0a0a] rounded-[2.5rem] border transition-all duration-300 ${expandedMonth === month.id ? 'border-[#BF953F]/40 shadow-2xl' : 'border-zinc-900'}`}>
            <button
              onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)}
              className="w-full px-6 py-6 flex items-center justify-between"
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border font-black text-[10px] transition-colors ${expandedMonth === month.id ? 'bg-[#BF953F] text-black border-[#BF953F]' : 'bg-black text-zinc-500 border-zinc-800'}`}>
                  {month.name.slice(0, 3).toUpperCase()}
                </div>
                <div className="text-left">
                  <h4 className="text-lg font-black text-white uppercase tracking-tighter">
                    {month.name} <span className="text-zinc-700 ml-1">{month.year}</span>
                  </h4>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">In: {month.totalRetorno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    <span className="text-[8px] font-black text-red-500 uppercase tracking-widest">Out: {month.totalSaida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>
              </div>
              <ChevronDown className={`transition-transform duration-300 ${expandedMonth === month.id ? 'rotate-180 text-[#BF953F]' : 'text-zinc-700'}`} />
            </button>

            {expandedMonth === month.id && (
              <div className="px-6 pb-8 border-t border-white/5 pt-8 animate-in slide-in-from-top-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  {/* ENTRADAS (REBIMENTOS + APORTES) */}
                  <div>
                    <h5 className="text-[9px] font-black text-emerald-500 uppercase mb-4 flex items-center gap-2 tracking-widest">
                      <ArrowUpRight size={14} /> Recebimentos e Aportes
                    </h5>
                    <div className="space-y-3">
                      {[...month.aportes, ...month.recebimentos].sort((a,b) => parseDate(b.date).getTime() - parseDate(a.date).getTime()).map(m => (
                        <ListItem key={m.id} m={m} color="emerald" />
                      ))}
                      {month.aportes.length + month.recebimentos.length === 0 && <Empty msg="Nenhuma entrada" />}
                    </div>
                  </div>

                  {/* SAÍDAS (EMPRÉSTIMOS + RETIRADAS) */}
                  <div>
                    <h5 className="text-[9px] font-black text-red-500 uppercase mb-4 flex items-center gap-2 tracking-widest">
                      <ArrowDownRight size={14} /> Saídas e Empréstimos
                    </h5>
                    <div className="space-y-3">
                      {month.novosEmprestimos.map(l => (
                        <div key={l.id} className="bg-white/[0.02] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-500/10 rounded-xl text-red-500"><Users size={14} /></div>
                            <div>
                              <p className="text-[10px] font-black text-zinc-200 uppercase">{l.customerName || 'Cliente'}</p>
                              <p className="text-[8px] text-zinc-600 font-bold uppercase">Novo Contrato: {l.contractNumber}</p>
                            </div>
                          </div>
                          <span className="text-xs font-black text-red-500">-{Number(l.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        </div>
                      ))}
                      {month.retiradas.map(m => <ListItem key={m.id} m={m} color="red" />)}
                      {month.novosEmprestimos.length + month.retiradas.length === 0 && <Empty msg="Nenhuma saída" />}
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

// --- AUXILIARES ---

const StatCard: React.FC<{ title: string, value: string, icon: React.ReactNode, border?: string, description: string }> = ({ title, value, icon, border, description }) => (
  <div className={`bg-[#0a0a0a] p-8 rounded-[2.5rem] border ${border || 'border-zinc-900'} shadow-xl flex flex-col justify-between hover:border-zinc-800 transition-all`}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-[9px] font-black uppercase text-zinc-600 tracking-[0.2em]">{title}</span>
      <div className="p-3 bg-black rounded-2xl border border-zinc-800">{icon}</div>
    </div>
    <p className="text-4xl font-black text-white tracking-tighter mb-1">{value}</p>
    <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">{description}</p>
  </div>
);

const ListItem: React.FC<{ m: any, color: 'emerald' | 'red' }> = ({ m, color }) => {
  const isPos = color === 'emerald';
  const parseDate = (d: any) => (d?.seconds ? new Date(d.seconds * 1000) : new Date(d));
  
  return (
    <div className="bg-white/[0.02] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between hover:border-zinc-700 transition-all">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${isPos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {m.type === 'APORTE' ? <PlusCircle size={14} /> : m.type === 'PAGAMENTO' ? <CheckCircle2 size={14} /> : <MinusCircle size={14} />}
        </div>
        <div>
          <p className="text-[10px] font-black text-zinc-200 uppercase tracking-tighter">{m.description || 'Movimentação'}</p>
          <p className="text-[8px] text-zinc-600 font-bold uppercase">{parseDate(m.date).toLocaleDateString('pt-BR')}</p>
        </div>
      </div>
      <span className={`text-xs font-black ${isPos ? 'text-emerald-500' : 'text-red-500'}`}>
        {isPos ? '+' : '-'}{Number(m.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </span>
    </div>
  );
};

const Empty: React.FC<{ msg: string }> = ({ msg }) => (
  <div className="py-6 text-center border border-dashed border-zinc-900 rounded-[2rem] opacity-30">
    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{msg}</p>
  </div>
);

export default Dashboard;