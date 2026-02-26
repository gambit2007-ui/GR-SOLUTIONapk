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

  // Função de parsing de data robusta
  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    // Caso seja Firestore Timestamp
    if (typeof d === 'object' && d.seconds) return new Date(d.seconds * 1000);
    // Caso seja String ou Date objeto
    const date = new Date(d);
    // Se a data for inválida, retorna data atual para não quebrar o map
    return isNaN(date.getTime()) ? new Date() : date;
  };

  const todayStr = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const activeContracts = loans.filter(l => {
      const pAmount = Number(l.paidAmount || 0);
      const tReturn = Number(l.totalToReturn || 0);
      return pAmount < (tReturn - 0.1); // Considera ativo se não estiver liquidado
    }).length;

    const overdueContracts = loans.filter(l =>
      l.installments?.some(inst => {
        const s = String(inst.status || '').toUpperCase();
        return (s === 'PENDENTE' || s === 'ATRASADO') && inst.dueDate < todayStr;
      })
    ).length;

    return { activeContracts, overdueContracts, activeCustomers: customers.length };
  }, [loans, customers, todayStr]);

  const monthlyHistory = useMemo(() => {
    const monthsFull = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const data = [];
    const today = new Date();
    const currentYear = today.getFullYear();
    
    // Varre de 2024 até o ano atual (ajustado para cobrir histórico)
    for (let year = 2024; year <= currentYear; year++) {
      for (let month = 0; month <= 11; month++) {
        const tempDate = new Date(year, month, 1);
        if (tempDate > today) break;

        const isMatch = (dateValue: any) => {
          if (!dateValue) return false;
          const d = parseDate(dateValue);
          return d.getMonth() === month && d.getFullYear() === year;
        };

        // 1. Entradas de Caixa (Aportes/Manual)
        const entradasManuais = cashMovements.filter(m => {
          const t = String(m.type || '').toUpperCase();
          return isMatch(m.date) && (t === 'APORTE' || t === 'PAGAMENTO' || t === 'ENTRADA');
        });

        // 2. Saídas de Caixa (Retiradas/Estornos/Manual)
        const saidasManuais = cashMovements.filter(m => {
          const t = String(m.type || '').toUpperCase();
          return isMatch(m.date) && (t === 'RETIRADA' || t === 'ESTORNO' || t === 'SAIDA');
        });

        // 3. Recebimentos de Parcelas (Varre todos os empréstimos)
        const recebimentosParcelas: any[] = [];
        loans.forEach(loan => {
          loan.installments?.forEach(inst => {
            // Verifica se houve pagamento (seja total ou parcial via lastPaidValue)
            const pDate = inst.paymentDate || inst.lastPaymentDate;
            if (pDate && isMatch(pDate)) {
              const valorPago = Number(inst.lastPaidValue || 0);
              if (valorPago > 0) {
                recebimentosParcelas.push({
                  id: `p-${loan.id}-${inst.number}`,
                  description: `PARC ${inst.number}: ${loan.customerName}`,
                  amount: valorPago,
                  date: pDate,
                  type: 'PAGAMENTO'
                });
              }
            }
          });
        });

        // 4. Novos Empréstimos (Saída de Capital)
        const novosEmprestimos = loans.filter(l => isMatch(l.createdAt || l.startDate));

        const totalRetorno = [...entradasManuais, ...recebimentosParcelas].reduce((acc, r) => 
          acc + (Number(r.amount || r.value || 0)), 0);
        
        const totalSaida = novosEmprestimos.reduce((acc, l) => acc + Number(l.amount || 0), 0) + 
                           saidasManuais.reduce((acc, r) => acc + Number(r.amount || 0), 0);

        if (totalRetorno > 0 || totalSaida > 0 || (month === today.getMonth() && year === today.getFullYear())) {
          data.push({
            id: `${year}-${month}`,
            name: monthsFull[month],
            year: year,
            entradas: [...entradasManuais, ...recebimentosParcelas],
            saidasManuais,
            novosEmprestimos,
            totalSaida,
            totalRetorno
          });
        }
      }
    }
    return data.sort((a, b) => b.year !== a.year ? b.year - a.year : data.indexOf(b) - data.indexOf(a)).reverse().slice(-12).reverse();
  }, [loans, cashMovements]);

  if (!isMounted) return null;

  return (
    <div className="space-y-10 animate-in fade-in duration-700 pb-10 px-2">
      {/* CARDS PRINCIPAIS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="Contratos Ativos" value={stats.activeContracts.toString()} icon={<Briefcase size={20} className="text-[#BF953F]" />} description="Em andamento" />
        <StatCard title="Clientes na Base" value={stats.activeCustomers.toString()} icon={<Users size={20} className="text-blue-500" />} description="Cadastrados" />
        <StatCard 
          title="Inadimplência" 
          value={stats.overdueContracts.toString()} 
          icon={<AlertCircle size={20} className={stats.overdueContracts > 0 ? "text-red-500" : "text-zinc-600"} />} 
          description="Contratos com atraso" 
          border={stats.overdueContracts > 0 ? "border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.05)]" : "border-zinc-900"} 
        />
      </div>

      {/* HISTÓRICO MENSAL */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-6 opacity-60">
          <History size={16} className="text-[#BF953F]" />
          <h3 className="text-[10px] font-black uppercase tracking-[0.3em] text-white">Fluxo de Caixa Mensal</h3>
        </div>

        {monthlyHistory.map((month) => (
          <div key={month.id} className={`bg-[#0a0a0a] rounded-[2.5rem] border transition-all duration-500 ${expandedMonth === month.id ? 'border-[#BF953F]/40 shadow-2xl scale-[1.01]' : 'border-zinc-900 hover:border-zinc-800'}`}>
            <button onClick={() => setExpandedMonth(expandedMonth === month.id ? null : month.id)} className="w-full px-6 py-6 flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center border font-black text-[11px] transition-colors ${expandedMonth === month.id ? 'bg-[#BF953F] text-black border-[#BF953F]' : 'bg-black text-zinc-600 border-zinc-800'}`}>
                  {month.name.slice(0, 3).toUpperCase()}
                </div>
                <div className="text-left">
                  <h4 className="text-lg font-black text-white uppercase tracking-tight">{month.name} <span className="text-zinc-800 ml-1 font-bold">{month.year}</span></h4>
                  <div className="flex gap-4 mt-1">
                    <span className="text-[9px] font-black text-emerald-500 uppercase tracking-tighter">Entradas: {month.totalRetorno.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                    <span className="text-[9px] font-black text-red-500 uppercase tracking-tighter">Saídas: {month.totalSaida.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                  </div>
                </div>
              </div>
              <div className={`p-2 rounded-full border transition-all ${expandedMonth === month.id ? 'bg-[#BF953F]/10 border-[#BF953F]/20 rotate-180' : 'bg-transparent border-zinc-800'}`}>
                <ChevronDown size={18} className={expandedMonth === month.id ? 'text-[#BF953F]' : 'text-zinc-700'} />
              </div>
            </button>

            {expandedMonth === month.id && (
              <div className="px-6 pb-10 border-t border-white/5 pt-8 animate-in slide-in-from-top-4 duration-500">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
                  {/* COLUNA ENTRADAS */}
                  <div>
                    <h5 className="text-[9px] font-black text-emerald-500 uppercase mb-5 flex items-center gap-2 tracking-[0.2em]"><ArrowUpRight size={14} /> Receitas e Aportes</h5>
                    <div className="space-y-3">
                      {month.entradas.map((m, i) => <ListItem key={i} m={m} color="emerald" />)}
                      {month.entradas.length === 0 && <Empty msg="Sem entradas registradas" />}
                    </div>
                  </div>
                  
                  {/* COLUNA SAÍDAS */}
                  <div>
                    <h5 className="text-[9px] font-black text-red-500 uppercase mb-5 flex items-center gap-2 tracking-[0.2em]"><ArrowDownRight size={14} /> Investimentos e Custos</h5>
                    <div className="space-y-3">
                      {month.novosEmprestimos.map(l => (
                        <div key={l.id} className="bg-white/[0.01] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between group hover:border-red-500/20 transition-all">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-red-500/10 rounded-xl text-red-500"><Users size={14} /></div>
                            <div>
                              <p className="text-[10px] font-black text-zinc-200 uppercase">{l.customerName}</p>
                              <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-tighter">Capital Emprestado</p>
                            </div>
                          </div>
                          <span className="text-xs font-black text-red-500">-{Number(l.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                        </div>
                      ))}
                      {month.saidasManuais.map((m, i) => <ListItem key={i} m={m} color="red" />)}
                      {(month.novosEmprestimos.length === 0 && month.saidasManuais.length === 0) && <Empty msg="Sem saídas registradas" />}
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
  <div className={`bg-[#0a0a0a] p-8 rounded-[2.5rem] border ${border || 'border-zinc-900'} shadow-xl flex flex-col justify-between hover:border-zinc-700 transition-all group`}>
    <div className="flex items-center justify-between mb-6">
      <span className="text-[9px] font-black uppercase text-zinc-600 tracking-[0.2em] group-hover:text-zinc-400 transition-colors">{title}</span>
      <div className="p-3 bg-black rounded-2xl border border-zinc-800 group-hover:border-zinc-700 transition-all">{icon}</div>
    </div>
    <p className="text-5xl font-black text-white tracking-tighter mb-2">{value}</p>
    <p className="text-[9px] text-zinc-600 font-black uppercase tracking-widest">{description}</p>
  </div>
);

const ListItem = ({ m, color }: any) => {
  const isPos = color === 'emerald';
  const type = String(m.type || '').toUpperCase().trim();
  const displayAmount = Number(m.amount || m.value || 0);

  return (
    <div className={`bg-white/[0.01] border border-zinc-900 rounded-2xl p-4 flex items-center justify-between group hover:border-${color}-500/20 transition-all`}>
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-xl ${isPos ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'}`}>
          {type === 'APORTE' ? <PlusCircle size={14} /> : type === 'PAGAMENTO' ? <CheckCircle2 size={14} /> : <MinusCircle size={14} />}
        </div>
        <div>
          <p className="text-[10px] font-black text-zinc-300 uppercase tracking-tight group-hover:text-white transition-colors">{m.description || 'Movimentação'}</p>
          <p className="text-[8px] text-zinc-600 font-bold uppercase">
            {m.date ? new Date(m.date).toLocaleDateString('pt-BR') : 'Data Indefinida'}
          </p>
        </div>
      </div>
      <span className={`text-xs font-black ${isPos ? 'text-emerald-500' : 'text-red-500'}`}>
        {isPos ? '+' : '-'}{displayAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
      </span>
    </div>
  );
};

const Empty = ({ msg }: any) => (
  <div className="py-8 text-center border border-dashed border-zinc-900 rounded-[2rem] opacity-20">
    <p className="text-[8px] font-black uppercase tracking-widest text-zinc-500">{msg}</p>
  </div>
);

export default Dashboard;