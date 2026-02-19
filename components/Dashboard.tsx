
import React, { useMemo } from 'react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { 
  Users, 
  Briefcase,
  AlertCircle,
  ShieldCheck,
  CheckCircle,
  ArrowUpRight,
  ArrowDownRight,
  TrendingUp,
  CalendarDays
} from 'lucide-react';
import { Loan, Customer } from '../types';

interface DashboardProps {
  loans: Loan[];
  customers: Customer[];
}

const Dashboard: React.FC<DashboardProps> = ({ loans, customers }) => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const currentMonth = today.getMonth();
  const currentYear = today.getFullYear();

  const stats = useMemo(() => {
    const activeContracts = loans.filter(l => 
      l.installments.some(inst => inst.status === 'PENDENTE')
    ).length;

    const overdueContracts = loans.filter(l => 
      l.installments.some(inst => inst.status === 'PENDENTE' && inst.dueDate < todayStr)
    ).length;

    // Total recebido este mês especificamente
    const receivedThisMonth = loans.reduce((acc, l) => {
      return acc + l.installments.reduce((sum, inst) => {
        if (inst.status === 'PAGO' && inst.paidAt) {
          const paidDate = new Date(inst.paidAt);
          if (paidDate.getMonth() === currentMonth && paidDate.getFullYear() === currentYear) {
            return sum + inst.value + (inst.penaltyApplied || 0);
          }
        }
        return sum;
      }, 0);
    }, 0);

    const totalPaidAllTime = loans.reduce((acc, l) => {
      return acc + l.installments.reduce((sum, inst) => {
        if (inst.status === 'PAGO') {
          return sum + inst.value + (inst.penaltyApplied || 0);
        }
        return sum;
      }, 0);
    }, 0);

    return { activeContracts, overdueContracts, customerCount: customers.length, receivedThisMonth, totalPaidAllTime };
  }, [loans, customers, todayStr, currentMonth, currentYear]);

  const monthlyHistory = useMemo(() => {
    const monthsShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const data = [];

    for (let i = 5; i >= 0; i--) {
      const targetDate = new Date(currentYear, currentMonth - i, 1);
      const mIdx = targetDate.getMonth();
      const yIdx = targetDate.getFullYear();

      // Saída: Novos empréstimos criados neste mês
      const saida = loans
        .filter(l => {
          const d = new Date(l.createdAt);
          return d.getMonth() === mIdx && d.getFullYear() === yIdx;
        })
        .reduce((acc, l) => acc + l.amount, 0);

      // Retorno: Parcelas pagas neste mês (pela data de pagamento real)
      const retorno = loans.reduce((acc, l) => {
        return acc + l.installments.reduce((sum, inst) => {
          if (inst.status === 'PAGO' && inst.paidAt) {
            const pDate = new Date(inst.paidAt);
            if (pDate.getMonth() === mIdx && pDate.getFullYear() === yIdx) {
              return sum + inst.value + (inst.penaltyApplied || 0);
            }
          }
          return sum;
        }, 0);
      }, 0);

      data.push({
        name: monthsShort[mIdx],
        fullName: `${monthsShort[mIdx]} / ${yIdx}`,
        saida,
        retorno,
        resultado: retorno - saida
      });
    }
    return data;
  }, [loans, currentMonth, currentYear]);

  return (
    <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-700">
      {/* Cards de Status */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          title="Ativos" 
          value={stats.activeContracts.toString()}
          icon={<Briefcase size={18} className="text-[#BF953F]" />}
        />
        <StatCard 
          title="Inadimplência" 
          value={stats.overdueContracts.toString()}
          icon={<AlertCircle size={18} className={stats.overdueContracts > 0 ? "text-red-500" : "text-zinc-600"} />}
          border={stats.overdueContracts > 0 ? "border-red-500/30" : "border-zinc-800"}
        />
        <StatCard 
          title="Retorno Mensal" 
          value={stats.receivedThisMonth.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
          icon={<ArrowUpRight size={18} className="text-emerald-500" />}
          border="border-emerald-500/20"
        />
        <StatCard 
          title="Base Clientes" 
          value={stats.customerCount.toString()}
          icon={<Users size={18} className="text-blue-500" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Gráfico Principal */}
        <div className="lg:col-span-8 bg-[#0a0a0a] p-6 lg:p-10 rounded-[2.5rem] border border-zinc-900 shadow-2xl">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-10">
            <div>
              <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-1">Performance por Período</h3>
              <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">Fluxo de Caixa: Capital vs Recebíveis</p>
            </div>
            <div className="flex gap-4">
               <div className="flex items-center gap-2">
                 <div className="w-2.5 h-2.5 rounded-full bg-[#FF8C00]"></div>
                 <span className="text-[9px] font-black text-zinc-500 uppercase">Saída</span>
               </div>
               <div className="flex items-center gap-2">
                 <div className="w-2.5 h-2.5 rounded-full bg-[#00C853]"></div>
                 <span className="text-[9px] font-black text-zinc-500 uppercase">Retorno</span>
               </div>
            </div>
          </div>
          
          <div className="h-[250px] lg:h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyHistory} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#18181b" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#3f3f46', fontSize: 10, fontWeight: 700 }} 
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#3f3f46', fontSize: 9 }}
                  tickFormatter={(value) => `R$ ${value >= 1000 ? (value/1000).toFixed(0)+'k' : value}`}
                />
                <Tooltip 
                  cursor={{ fill: 'rgba(255,255,255,0.02)' }} 
                  contentStyle={{ backgroundColor: '#050505', border: '1px solid #27272a', borderRadius: '16px', padding: '12px' }}
                  itemStyle={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase' }}
                  labelStyle={{ color: '#BF953F', marginBottom: '8px', fontSize: '10px', fontWeight: 900 }}
                  formatter={(value: number) => [value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }), '']}
                />
                <Bar dataKey="saida" fill="#FF8C00" radius={[6, 6, 0, 0]} barSize={24} />
                <Bar dataKey="retorno" fill="#00C853" radius={[6, 6, 0, 0]} barSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Mini Tabela de Controle Mensal */}
        <div className="lg:col-span-4 bg-[#0a0a0a] rounded-[2.5rem] border border-zinc-900 overflow-hidden flex flex-col shadow-2xl">
          <div className="p-6 border-b border-zinc-900 bg-zinc-900/10 flex items-center gap-3">
             <CalendarDays size={18} className="text-[#BF953F]" />
             <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Controle Mensal</h4>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
             <table className="w-full text-left">
                <thead className="bg-zinc-900/30 text-[8px] font-black text-zinc-600 uppercase tracking-widest sticky top-0">
                   <tr>
                      <th className="px-6 py-4">Mês</th>
                      <th className="px-6 py-4 text-right">Saldo</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900">
                   {monthlyHistory.slice().reverse().map((m, idx) => (
                      <tr key={idx} className="hover:bg-zinc-900/30 transition-colors group">
                         <td className="px-6 py-5">
                            <p className="text-[10px] font-black text-zinc-200 group-hover:text-[#BF953F] transition-colors">{m.fullName}</p>
                            <div className="flex gap-3 mt-1.5">
                               <span className="text-[8px] font-bold text-[#FF8C00]">S: {m.saida.toLocaleString('pt-BR', { notation: 'compact' })}</span>
                               <span className="text-[8px] font-bold text-[#00C853]">R: {m.retorno.toLocaleString('pt-BR', { notation: 'compact' })}</span>
                            </div>
                         </td>
                         <td className="px-6 py-5 text-right">
                            <div className={`flex items-center justify-end gap-1.5 text-[11px] font-black ${m.resultado >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                               {m.resultado >= 0 ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                               {Math.abs(m.resultado).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
                            </div>
                         </td>
                      </tr>
                   ))}
                </tbody>
             </table>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Atividade Recente */}
        <div className="lg:col-span-2 bg-[#0a0a0a] rounded-[2.5rem] border border-zinc-900 overflow-hidden shadow-2xl">
          <div className="p-6 border-b border-zinc-900 flex justify-between items-center">
            <h4 className="text-[9px] font-black text-zinc-500 uppercase tracking-widest flex items-center gap-2">
              <TrendingUp size={14} className="text-[#BF953F]" /> 
              Fluxo de Contratos Recentes
            </h4>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[400px]">
              <tbody className="divide-y divide-zinc-900">
                {loans.slice(-5).reverse().map(l => (
                  <tr key={l.id} className="hover:bg-zinc-900/30 transition-all group">
                    <td className="px-8 py-5">
                      <p className="text-xs font-black text-zinc-200 group-hover:text-[#BF953F] transition-colors">{l.customerName}</p>
                      <p className="text-[8px] text-zinc-700 uppercase font-mono tracking-tighter">Contrato #{l.contractNumber}</p>
                    </td>
                    <td className="px-8 py-5 text-center">
                       <span className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full text-[8px] font-black text-zinc-500 uppercase">{l.interestType}</span>
                    </td>
                    <td className="px-8 py-5 text-right">
                      <p className="text-sm font-black text-[#BF953F]">{l.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                      <p className="text-[8px] text-zinc-700 font-bold uppercase">Principal</p>
                    </td>
                  </tr>
                ))}
                {loans.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-16 text-center text-zinc-700 text-[10px] uppercase font-black italic tracking-widest opacity-30">Nenhum contrato registrado na base</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Resumo de Ativo */}
        <div className="bg-[#BF953F]/5 border border-[#BF953F]/20 rounded-[2.5rem] p-8 flex flex-col justify-between relative group overflow-hidden shadow-2xl">
           <div className="absolute -right-8 -bottom-8 text-[#BF953F]/10 group-hover:scale-110 transition-transform duration-1000">
             <ShieldCheck size={160} />
           </div>
           <div className="relative z-10">
             <div className="flex items-center gap-3 mb-8">
               <div className="w-10 h-10 rounded-2xl bg-black border border-[#BF953F]/30 flex items-center justify-center">
                 <CheckCircle size={20} className="text-[#BF953F]" />
               </div>
               <div>
                 <h4 className="text-[10px] font-black gold-text uppercase tracking-widest">Saúde Operacional</h4>
                 <p className="text-[8px] text-zinc-500 font-bold uppercase">Qualidade da Carteira</p>
               </div>
             </div>
             
             <div className="space-y-6">
                <div>
                  <div className="flex justify-between items-center text-[9px] font-black uppercase tracking-widest mb-2">
                     <span className="text-zinc-500">Taxa de Adimplência</span>
                     <span className="text-emerald-500">{(stats.activeContracts > 0 ? ((stats.activeContracts - stats.overdueContracts) / stats.activeContracts * 100) : 100).toFixed(0)}%</span>
                  </div>
                  <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-zinc-900">
                     <div 
                      className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)] transition-all duration-1000" 
                      style={{ width: `${(stats.activeContracts > 0 ? ((stats.activeContracts - stats.overdueContracts) / stats.activeContracts * 100) : 100)}%` }} 
                     />
                  </div>
                </div>

                <div className="pt-6 border-t border-[#BF953F]/10">
                   <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest mb-1">Total Recuperado</p>
                   <p className="text-xl font-black text-zinc-200">{stats.totalPaidAllTime.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                </div>
             </div>
           </div>
        </div>
      </div>
    </div>
  );
};

const StatCard = ({ title, value, icon, border }: any) => (
  <div className={`bg-[#0a0a0a] p-6 rounded-3xl border ${border || 'border-zinc-900'} shadow-xl group hover:border-[#BF953F]/30 transition-all`}>
    <div className="flex items-center justify-between mb-4">
      <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600 group-hover:text-zinc-400 transition-colors">{title}</span>
      <div className="p-2.5 bg-black rounded-xl border border-zinc-800 shadow-inner">{icon}</div>
    </div>
    <p className="text-xl lg:text-2xl font-black text-zinc-100 tracking-tighter">{value}</p>
  </div>
);

export default Dashboard;
