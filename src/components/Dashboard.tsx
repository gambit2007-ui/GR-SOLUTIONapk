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

  // --- PARSE DE DATA REFORÇADO PARA O SEU FIREBASE ---
  const parseDate = (d: any) => {
    if (!d) return new Date();
    // Trata Timestamp do Firebase (objeto com seconds)
    if (d && typeof d === 'object' && 'seconds' in d) return new Date(d.seconds * 1000);
    // Trata Strings ISO (como as da sua imagem) ou datas normais
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const activeContracts = loans.filter(l => {
      const status = String(l.status || '').toUpperCase();
      return status !== 'QUITADO' && status !== 'CANCELADO';
    }).length;

    const overdueContracts = loans.filter(l =>
      l.installments?.some(inst =>
        (inst.status?.toUpperCase() === 'PENDENTE' || inst.status?.toUpperCase() === 'ATRASADO') &&
        inst.dueDate < todayStr
      )
    ).length;

    return { activeContracts, overdueContracts, activeCustomers: customers.length };
  }, [loans, customers, todayStr]);

  const monthlyHistory = useMemo(() => {
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const data = [];
    const today = new Date();
    
    // Inicia em Janeiro de 2026
    for (let year = 2026; year <= today.getFullYear(); year++) {
      for (let month = 0; month <= 11; month++) {
        const tempDate = new Date(year, month, 1);
        if (tempDate > today) break;

        // Filtro de mês e ano ignorando fuso horário
        const isMatch = (dateValue: any) => {
          const d = parseDate(dateValue);
          return d.getUTCMonth() === month && d.getUTCFullYear() === year || 
                 d.getMonth() === month && d.getFullYear() === year;
        };

        // ENTRADAS (Baseado na sua imagem: APORTE e PAGAMENTO)
        const entradas = cashMovements.filter(m => {
          const type = String(m.type || '').toUpperCase().trim();
          return isMatch(m.date) && (type === 'APORTE' || type === 'PAGAMENTO' || type === 'ENTRADA');
        });

        // SAÍDAS (Baseado na sua imagem: RETIRADA)
        const saidasManuais = cashMovements.filter(m => {
          const type = String(m.type || '').toUpperCase().trim();
          return isMatch(m.date) && (type === 'RETIRADA' || type === 'ESTORNO' || type === 'SAIDA');
        });

        // PARCELAS PAGAS DENTRO DOS CONTRATOS
        const parcelasPagas: any[] = [];
        loans.forEach(loan => {
          loan.installments?.forEach(inst => {
            if (inst.status?.toUpperCase() === 'PAGO' && inst.paymentDate && isMatch(inst.paymentDate)) {
              parcelasPagas.push({
                id: `inst-${loan.id}-${inst.number}`,
                description: `REC. PARCELA: ${loan.customerName}`,
                amount: inst.value,
                date: inst.paymentDate,
                type: 'PAGAMENTO'
              });
            }
          });
        });

        const novosEmprestimos = loans.filter(l => isMatch(l.createdAt || l.startDate));

        const totalRetorno = [...entradas, ...parcelasPagas].reduce((acc, r) => acc + (Number(r.amount || r.value) || 0), 0);
        const totalSaida = novosEmprestimos.reduce((acc, l) => acc + (Number(l.amount) || 0), 0) + 
                           saidasManuais.reduce((acc, r) => acc + (Number(r.amount) || 0), 0);

        if (totalRetorno > 0 || totalSaida > 0 || (month === today.getMonth() && year === today.getFullYear())) {
          data.push({
            id: `${year}-${month}`,
            name: monthsFull[month],
            year: year,
            entradas: [...entradas, ...parcelasPagas],
            saidasManuais,
            novosEmprestimos,
            totalSaida,
            totalRetorno
          });
        }
      }
    }
    return data.reverse();
  }, [loans, cashMovements]);

  if (!isMounted) return null;

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-10 px-2">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Contratos Ativos" value={stats.activeContracts.toString()} icon={<Briefcase size={20} className="text-[#BF953F]" />} description="Em andamento" />
        <StatCard title="Clientes na Base" value={stats.activeCustomers.toString()} icon={<Users size={20} className="text-blue-500" />} description="Cadastrados no sistema" />
        <StatCard title="Inadimplência" value={stats.overdueContracts.toString()} icon={<AlertCircle size={20} className={stats.overdueContracts > 0 ? "text-red-500" : "text-zinc-600"} />} description="Contratos com atraso" border={stats.overdueContracts > 0 ? "border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]" : "border-zinc-900"} />
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-6 opacity-50">
          <History size={16} className="text-[#BF953F]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Fluxo de Caixa por Período</h3>
        </div>

        {monthlyHistory.map((month) => (
          <div key={month.id} className={`bg-[#0a0a0a] rounded-[2.5rem] border transition-all duration-300 ${expandedMonth === month.id ? 'border-[#BF953F]/40 shadow-2xl' : 'border-zinc-900'}`}>
            <button onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)} className="w-full px-6 py-6 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center border font-black text-[10px] ${expandedMonth === month.id ? 'bg-[#BF953F] text-black' : 'bg-black text-zinc-500 border-zinc-800'}`}>
                  {month.name.slice(0, 3).toUpperCase()}
                </div>
                <div className="text-left">
                  <h4 className="text-lg font-black text-white uppercase">{month.name} <span className="text-zinc-700">{month.year}</span></h4>
                  <div className="flex gap-3 mt-0.5">
                    <span className="text-[8px] font-black text-emerald-500 uppercase">In: {month.totalRetorno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    <span className="text-[8px] font-black text-red-500 uppercase">Out: {month.totalSaida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>
              </div>
              <ChevronDown className={`transition-transform ${expandedMonth === month.id ? 'rotate-180 text-[#BF953F]' : 'text-zinc-700'}`} />
            </button>

            {expandedMonth === month.id && (
              <div className="px-6 pb-8 border-t border-white/5 pt-8 animate-in slide-in-from-top-4">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div>
                    <h5 className="text-[9px] font-black text-emerald-500 uppercase mb-4 flex items-center gap-2"><ArrowUpRight size={14} /> Recebimentos e Aportes</h5>
                    <div className="space-y-3">
                      {month.entradas.map((m, i) => <ListItem key={i} m={m} color="emerald" />)}
                      {month.entradas.length === 0 && <Empty msg="Nenhuma entrada" />}
                    </div>
                  </div>
                  <div>
                    <h5 className="text-[9px] font-black text-red-500 uppercase mb-4 flex items-center gap-2"><ArrowDownRight size={14} /> Saídas e Empréstimos</h5>
                    <div className="space-y-3">
                      {month.novosEmprestimos.map(l => (
                        <div key={l.id} className="bg-white/[0.02] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-500/10 rounded-xl text-red-500"><Users size={14} /></div>
                            <div>
                              <p className="text-[10px] font-black text-zinc-200 uppercase">{l.customerName}</p>
                              <p className="text-[8px] text-zinc-600 font-bold uppercase">Novo Empréstimo</p>
                            </div>
                          </div>
                          <span className="text-xs font-black text-red-500">-{Number(l.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
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

// --- COMPONENTES AUXILIARES ---
const StatCard = ({ title, value, icon, border, description }: any) => (
  <div className={`bg-[#0a0a0a] p-8 rounded-[2.5rem] border ${border || 'border-zinc-900'} flex flex-col justify-between`}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-[9px] font-black uppercase text-zinc-600 tracking-widest">{title}</span>
      <div className="p-3 bg-black rounded-2xl border border-zinc-800">{icon}</div>
    </div>
    <p className="text-4xl font-black text-white tracking-tighter">{value}</p>
    <p className="text-[9px] text-zinc-600 font-bold uppercase">{description}</p>
  </div>
);

const ListItem = ({ m, color }: any) => {
  const isPos = color === 'emerald';
  const type = String(m.type || '').toUpperCase();
  return (
    <div className="bg-white/[0.02] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${isPos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {type === 'APORTE' ? <PlusCircle size={14} /> : type === 'PAGAMENTO' ? <CheckCircle2 size={14} /> : <MinusCircle size={14} />}
        </div>
        <div>
          <p className="text-[10px] font-black text-zinc-200 uppercase">{m.description || 'Movimentação'}</p>
          <p className="text-[8px] text-zinc-600 font-bold uppercase">{new Date(m.date).toLocaleDateString('pt-BR')}</p>
        </div>
      </div>
      <span className={`text-xs font-black ${isPos ? 'text-emerald-500' : 'text-red-500'}`}>
        {isPos ? '+' : '-'}{Number(m.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </span>
    </div>
  );
};

const Empty = ({ msg }: any) => (
  <div className="py-6 text-center border border-dashed border-zinc-900 rounded-[2rem] opacity-30">
    <p className="text-[8px] font-black uppercase text-zinc-500">{msg}</p>
  </div>
);

export default Dashboard;