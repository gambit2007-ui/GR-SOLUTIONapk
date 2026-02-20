
import React, { useMemo, useState, useEffect, useRef } from 'react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  Tooltip, 
  ResponsiveContainer,
  Legend
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
  CalendarDays,
  Filter,
  Calendar,
  FileDown,
  FileText
} from 'lucide-react';
import { Loan, Customer } from '../types';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';

interface DashboardProps {
  loans: Loan[];
  customers: Customer[];
}

type FilterPeriod = '7D' | '30D' | '90D' | '12M' | 'ALL' | 'CUSTOM';

const Dashboard: React.FC<DashboardProps> = ({ loans, customers }) => {
  const [isMounted, setIsMounted] = useState(false);
  const [period, setPeriod] = useState<FilterPeriod>('30D');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const dashboardRef = useRef<HTMLDivElement>(null);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const dateRange = useMemo(() => {
    let start = new Date();
    let end = new Date();

    switch (period) {
      case '7D':
        start.setDate(today.getDate() - 7);
        break;
      case '30D':
        start.setDate(today.getDate() - 30);
        break;
      case '90D':
        start.setDate(today.getDate() - 90);
        break;
      case '12M':
        start.setFullYear(today.getFullYear() - 1);
        break;
      case 'ALL':
        start = new Date(2000, 0, 1);
        break;
      case 'CUSTOM':
        if (customStart) start = new Date(customStart + 'T00:00:00');
        if (customEnd) end = new Date(customEnd + 'T23:59:59');
        break;
    }
    
    return { 
      start: start.toISOString().split('T')[0], 
      end: end.toISOString().split('T')[0],
      startDate: start,
      endDate: end
    };
  }, [period, customStart, customEnd]);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const stats = useMemo(() => {
    const activeContracts = loans.filter(l => 
      l.installments.some(inst => inst.status === 'PENDENTE')
    ).length;

    const overdueContracts = loans.filter(l => 
      l.installments.some(inst => inst.status === 'PENDENTE' && inst.dueDate < todayStr)
    ).length;

    // Total recebido no período selecionado
    const receivedInPeriod = loans.reduce((acc, l) => {
      return acc + l.installments.reduce((sum, inst) => {
        if (inst.status === 'PAGO' && inst.paidAt) {
          const paidDateStr = inst.paidAt.split('T')[0];
          if (paidDateStr >= dateRange.start && paidDateStr <= dateRange.end) {
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

    return { activeContracts, overdueContracts, customerCount: customers.length, receivedInPeriod, totalPaidAllTime };
  }, [loans, customers, todayStr, dateRange]);

  const monthlyHistory = useMemo(() => {
    const monthsShort = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const data = [];
    
    // Determinar quantos meses mostrar baseado no range
    const diffTime = Math.abs(dateRange.endDate.getTime() - dateRange.startDate.getTime());
    const diffMonths = Math.ceil(diffTime / (1000 * 60 * 60 * 24 * 30));
    const monthsToDisplay = Math.min(Math.max(diffMonths, 1), 12);

    for (let i = monthsToDisplay - 1; i >= 0; i--) {
      const targetDate = new Date(dateRange.endDate.getFullYear(), dateRange.endDate.getMonth() - i, 1);
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
  }, [loans, dateRange]);

  const cashFlowData = useMemo(() => {
    const totalSaida = monthlyHistory.reduce((acc, m) => acc + m.saida, 0);
    const totalRetorno = monthlyHistory.reduce((acc, m) => acc + m.retorno, 0);
    return [
      { name: 'Saída (Capital)', value: totalSaida, color: '#FF8C00' },
      { name: 'Retorno (Recebido)', value: totalRetorno, color: '#00C853' }
    ];
  }, [monthlyHistory]);

  const exportToPDF = async () => {
    if (!dashboardRef.current) return;
    try {
      const dataUrl = await toPng(dashboardRef.current, { 
        quality: 0.95, 
        backgroundColor: '#050505',
        style: {
          borderRadius: '0'
        }
      });
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`dashboard-gr-solution-${dateRange.start}-a-${dateRange.end}.pdf`);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao gerar PDF. Tente novamente.');
    }
  };

  const exportToCSV = () => {
    const headers = ['Mes', 'Saida', 'Retorno', 'Resultado'];
    const rows = monthlyHistory.map(m => [
      m.fullName,
      m.saida.toFixed(2),
      m.retorno.toFixed(2),
      m.resultado.toFixed(2)
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `fluxo-caixa-gr-solution-${dateRange.start}-a-${dateRange.end}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const statusData = useMemo(() => {
    const active = loans.filter(l => !l.installments.every(i => i.status === 'PAGO') && !l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length;
    const overdue = loans.filter(l => !l.installments.every(i => i.status === 'PAGO') && l.installments.some(i => i.status === 'PENDENTE' && i.dueDate < todayStr)).length;
    const finished = loans.filter(l => l.installments.every(i => i.status === 'PAGO')).length;
    
    return [
      { name: 'Ativos', value: active, color: '#BF953F' },
      { name: 'Atrasados', value: overdue, color: '#EF4444' },
      { name: 'Finalizados', value: finished, color: '#10B981' }
    ];
  }, [loans, todayStr]);

  return (
    <div className="space-y-6 lg:space-y-8 animate-in fade-in duration-700">
      {/* Filtros de Período e Exportação */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 bg-[#0a0a0a] p-4 rounded-3xl border border-zinc-900 shadow-xl">
        <div className="flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-black rounded-xl border border-zinc-800">
              <Filter size={16} className="text-[#BF953F]" />
            </div>
            <div>
              <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Filtro de Período</h4>
              <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-tighter">Visualizando dados de {dateRange.start} até {dateRange.end}</p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {(['7D', '30D', '90D', '12M', 'ALL', 'CUSTOM'] as FilterPeriod[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all ${
                  period === p 
                    ? 'bg-[#BF953F] text-black shadow-[0_0_15px_rgba(191,149,63,0.3)]' 
                    : 'bg-black text-zinc-500 border border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {p === '7D' ? '7 Dias' : p === '30D' ? '30 Dias' : p === '90D' ? '90 Dias' : p === '12M' ? '1 Ano' : p === 'ALL' ? 'Tudo' : 'Personalizado'}
              </button>
            ))}
          </div>

          {period === 'CUSTOM' && (
            <div className="flex items-center gap-2 animate-in slide-in-from-right-4 duration-300">
              <div className="relative">
                <input 
                  type="date" 
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="bg-black border border-zinc-800 rounded-xl px-3 py-1.5 text-[9px] font-bold text-zinc-300 outline-none focus:border-[#BF953F] transition-colors"
                />
              </div>
              <span className="text-zinc-700 text-[10px] font-black">→</span>
              <div className="relative">
                <input 
                  type="date" 
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="bg-black border border-zinc-800 rounded-xl px-3 py-1.5 text-[9px] font-bold text-zinc-300 outline-none focus:border-[#BF953F] transition-colors"
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t xl:border-t-0 xl:border-l border-zinc-900 pt-4 xl:pt-0 xl:pl-4">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-white hover:border-zinc-700 transition-all"
          >
            <FileText size={14} /> CSV
          </button>
          <button 
            onClick={exportToPDF}
            className="flex items-center gap-2 px-4 py-2 gold-gradient text-black rounded-xl text-[9px] font-black uppercase tracking-widest shadow-lg hover:scale-105 transition-all"
          >
            <FileDown size={14} /> Exportar PDF
          </button>
        </div>
      </div>

      <div ref={dashboardRef} className="space-y-6 lg:space-y-8 p-1">
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
          title="Retorno no Período" 
          value={stats.receivedInPeriod.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}
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
        {/* Gráficos em Pizza */}
        <div className="lg:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 shadow-2xl flex flex-col">
            <div className="mb-6">
              <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-1">Distribuição de Capital</h3>
              <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">Saída vs Retorno (Período)</p>
            </div>
            <div className="h-[250px] w-full">
              {isMounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={cashFlowData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {cashFlowData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#050505', border: '1px solid #27272a', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'bold' }}
                      formatter={(value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36}
                      formatter={(value) => <span className="text-[9px] font-black text-zinc-500 uppercase tracking-tighter">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-zinc-900 shadow-2xl flex flex-col">
            <div className="mb-6">
              <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-1">Status da Carteira</h3>
              <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">Contratos por Situação</p>
            </div>
            <div className="h-[250px] w-full">
              {isMounted && (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {statusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#050505', border: '1px solid #27272a', borderRadius: '12px' }}
                      itemStyle={{ color: '#fff', fontSize: '10px', fontWeight: 'bold' }}
                    />
                    <Legend 
                      verticalAlign="bottom" 
                      height={36}
                      formatter={(value) => <span className="text-[9px] font-black text-zinc-500 uppercase tracking-tighter">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
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
