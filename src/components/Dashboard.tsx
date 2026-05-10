import React, { useState, useEffect, useRef } from 'react';
import { Loan, Customer, CashMovement, Installment } from '../types';
import { TrendingUp, Users, FileText, Wallet, Activity, ChevronDown, Calendar as CalendarIcon, Clock, ArrowRight } from 'lucide-react';
import {
  effectiveLoanStatus,
  installmentAmount,
  installmentPaidAmount,
  normalizeInstallmentStatus,
} from '../utils/loanCompat';
import { formatDateTimeBR, getLocalISODate } from '../utils/dateTime';

interface DashboardProps {
  loans: Loan[];
  customers: Customer[];
  cashMovements: CashMovement[];
  onNavigateToLoan: (loanId: string) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ loans, customers, cashMovements, onNavigateToLoan }) => {
  const [expandedMonthLoans, setExpandedMonthLoans] = useState<string | null>(null);
  const [expandedMonthMovements, setExpandedMonthMovements] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState(getLocalISODate());
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Gera dias para o calendario horizontal (7 dias antes e 21 dias depois)
  const calendarDays = Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - 7 + i);
    return getLocalISODate(d);
  });

  useEffect(() => {
    if (scrollContainerRef.current) {
      const selectedElement = scrollContainerRef.current.querySelector(`[data-date="${selectedDate}"]`);
      if (selectedElement) {
        selectedElement.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }, [selectedDate]);

  const getDayName = (dateStr: string) => {
    const date = new Date(dateStr + 'T12:00:00');
    return date.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase();
  };

  const getDayNumber = (dateStr: string) => {
    return dateStr.split('-')[2];
  };

  const installmentStatusLabel: Record<string, string> = {
    PENDING: 'Pendente',
    PAID: 'Pago',
    OVERDUE: 'Atrasado',
  };

  const loanStatusLabel: Record<string, string> = {
    ACTIVE: 'Ativo',
    COMPLETED: 'Concluido',
    CANCELLED: 'Cancelado',
  };

  const getMovementActorLabel = (movement: CashMovement) => {
    if (movement.createdByName && movement.createdByName.trim()) return movement.createdByName.trim();
    if (movement.createdByEmail && movement.createdByEmail.trim()) return movement.createdByEmail.trim();
    if (movement.createdByUid && movement.createdByUid.trim()) return movement.createdByUid.trim();
    return 'Sistema';
  };

  const activeLoans = loans.filter((l) => effectiveLoanStatus(l) === 'ACTIVE');

  const calculateLateFee = (inst: Installment) => {
    if (normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const dueDate = new Date(inst.dueDate + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (dueDate < today) {
      const diffTime = today.getTime() - dueDate.getTime();
      const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays <= 0) return 0;
      return Number((installmentAmount(inst) * 0.015 * diffDays).toFixed(2));
    }
    return 0;
  };

  const roundMoney = (value: number) => Number((Number.isFinite(value) ? value : 0).toFixed(2));

  const getRemainingInstallmentValue = (inst: Installment) => {
    if (normalizeInstallmentStatus(inst.status) === 'PAID') return 0;
    const lateFee = calculateLateFee(inst);
    const totalWithFee = roundMoney(installmentAmount(inst) + lateFee);
    const remaining = roundMoney(totalWithFee - installmentPaidAmount(inst));
    return remaining > 0 ? remaining : 0;
  };

  // Identificar contratos em atraso
  const overdueLoans = loans.filter(loan => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return false;
    const today = getLocalISODate();
    return loan.installments.some(
      (inst) => normalizeInstallmentStatus(inst.status) !== 'PAID' && inst.dueDate < today,
    );
  });

  // Prestacoes do dia selecionado
  const installmentsOfDay = loans.flatMap((loan) => {
    if (effectiveLoanStatus(loan) !== 'ACTIVE') return [];
    const installments = Array.isArray(loan.installments) ? loan.installments : [];
    return installments
      .filter(
        (inst) =>
          inst.dueDate === selectedDate &&
          normalizeInstallmentStatus(inst.status) !== 'PAID' &&
          getRemainingInstallmentValue(inst) > 0,
      )
      .map((inst) => {
        const lateFee = calculateLateFee(inst);
        const remainingWithFee = getRemainingInstallmentValue(inst);
        return {
          ...inst,
          customerName: loan.customerName,
          loanId: loan.id,
          totalWithFee: remainingWithFee,
          lateFee,
        };
      });
  });

  const stats = [
    { label: 'Clientes Ativos', value: customers.length, icon: Users, color: 'text-blue-500' },
    { label: 'Contratos Ativos', value: activeLoans.length, icon: FileText, color: 'text-gold-500' },
    { 
      label: 'Contratos em Atraso', 
      value: overdueLoans.length, 
      icon: Activity, 
      color: 'text-red-500',
      onClick: () => {
        const element = document.getElementById('overdue-section');
        if (element) element.scrollIntoView({ behavior: 'smooth' });
      }
    },
  ];

  // Agrupamento por mes
  const groupByMonth = (data: any[], dateField: string) => {
    return data.reduce((acc: any, item: any) => {
      const date = new Date(item[dateField]);
      const monthYear = date.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
      if (!acc[monthYear]) acc[monthYear] = [];
      acc[monthYear].push(item);
      return acc;
    }, {});
  };

  const loansByMonth = groupByMonth(loans, 'startDate');
  const movementsByMonth = groupByMonth(cashMovements, 'date');

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {stats.map((stat, i) => (
          <div 
            key={i} 
            onClick={stat.onClick}
            className={`bg-[#050505] border border-zinc-900 p-6 rounded-3xl ${stat.onClick ? 'cursor-pointer hover:border-zinc-700 transition-all' : ''}`}
          >
            <div className="flex items-center justify-between mb-4">
              <stat.icon size={24} className={stat.color} />
              <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Indicador</span>
            </div>
            <p className="text-2xl font-black text-white">{stat.value}</p>
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mt-1">{stat.label}</p>
          </div>
        ))}
      </div>
      
      {/* AGENDA DE RECEBIMENTOS */}
      <div className="bg-[#050505] border border-zinc-900 p-4 rounded-[1.5rem]">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-zinc-900 rounded-lg border border-zinc-800">
              <CalendarIcon size={18} className="text-[#BF953F]" />
            </div>
            <div>
              <h3 className="text-[9px] font-black gold-text uppercase tracking-[0.2em]">Agenda de Recebimentos</h3>
              <p className="text-[7px] text-zinc-500 uppercase tracking-widest mt-0.5">Organize seus recebimentos diarios</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-[#000000] border border-zinc-900 p-1 rounded-lg">
            <input 
              type="date" 
              className="bg-transparent text-white text-[8px] font-black uppercase tracking-widest outline-none px-2 py-1"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
        </div>

        {/* CALENDARIO HORIZONTAL INTERATIVO */}
        <div className="mb-6">
          <div 
            ref={scrollContainerRef}
            className="flex gap-1.5 overflow-x-auto pb-3 scrollbar-hide snap-x"
          >
            {calendarDays.map((date) => {
              const isSelected = date === selectedDate;
              const todayStr = getLocalISODate();
              const isToday = date === todayStr;
              
              const hasOverdue = loans.some(l => 
                effectiveLoanStatus(l) === 'ACTIVE' && 
                l.installments.some(
                  (i) =>
                    i.dueDate === date &&
                    normalizeInstallmentStatus(i.status) !== 'PAID' &&
                    date < todayStr,
                )
              );
              
              return (
                <button
                  key={date}
                  data-date={date}
                  onClick={() => setSelectedDate(date)}
                  className={`flex-shrink-0 w-10 h-14 rounded-lg flex flex-col items-center justify-center transition-all snap-start border ${
                    isToday
                      ? isSelected
                        ? 'bg-blue-500 text-white border-blue-400 shadow-[0_2px_10px_rgba(59,130,246,0.45)] scale-105 z-10'
                        : 'bg-blue-500/15 text-blue-300 border-blue-400/50 hover:bg-blue-500/25'
                      : isSelected 
                      ? 'bg-[#BF953F] text-black border-[#BF953F] shadow-[0_2px_8px_rgba(191,149,63,0.3)] scale-105 z-10' 
                      : hasOverdue
                        ? 'bg-red-500/20 text-red-500 border-red-500/50 hover:bg-red-500/30'
                        : 'bg-zinc-900/50 text-zinc-500 border-zinc-800 hover:border-zinc-700'
                  }`}
                >
                  <span className={`text-[5px] font-black uppercase tracking-widest mb-0.5 ${
                    isToday
                      ? isSelected ? 'text-blue-100/90' : 'text-blue-300/90'
                      : isSelected ? 'text-black/60' : hasOverdue ? 'text-red-500/80' : 'text-zinc-600'
                  }`}>
                    {getDayName(date)}
                  </span>
                  <span className={`text-[10px] font-black ${
                    isToday
                      ? isSelected ? 'text-white' : 'text-blue-300'
                      : isSelected ? 'text-black' : hasOverdue ? 'text-red-500' : 'text-white'
                  }`}>
                    {getDayNumber(date)}
                  </span>
                  {isToday && !isSelected && (
                    <div className="w-0.5 h-0.5 rounded-full mt-0.5 bg-blue-400" />
                  )}
                </button>
              );
            })}
          </div>
          {/* Barra de progresso visual simulada para o scroll */}
          <div className="h-[1px] bg-zinc-900 w-full rounded-full overflow-hidden">
            <div className="h-full bg-[#BF953F]/30 w-1/4 rounded-full" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          {installmentsOfDay.length === 0 ? (
            <div className="col-span-full py-8 text-center border border-dashed border-zinc-900 rounded-2xl">
              <Clock size={24} className="text-zinc-800 mx-auto mb-3" />
              <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Nenhuma parcela prevista para esta data</p>
            </div>
          ) : (
            installmentsOfDay.map((inst, idx) => (
              <button
                key={`${inst.loanId}-${idx}`}
                onClick={() => onNavigateToLoan(inst.loanId)}
                className="group bg-[#000000] border border-zinc-900 p-3 rounded-2xl hover:border-[#BF953F]/50 transition-all text-left flex items-center justify-between"
              >
                <div className="min-w-0 flex-1 mr-2">
                  <p className="text-[9px] font-black text-white uppercase group-hover:text-[#BF953F] transition-colors truncate">{inst.customerName}</p>
                  <p className="text-[7px] text-zinc-500 uppercase tracking-widest mt-0.5 truncate">Parc. {inst.number}  -  ID: {inst.loanId}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[10px] font-black text-white">R$ {inst.totalWithFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
                  {inst.lateFee > 0 && (
                    <p className="text-[6px] font-black text-red-500 uppercase tracking-tighter">+ R$ {inst.lateFee.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} multa</p>
                  )}
                  <span className={`text-[6px] font-black px-1.5 py-0.5 rounded-full uppercase mt-0.5 inline-block ${
                    normalizeInstallmentStatus(inst.status) === 'PAID'
                      ? 'bg-emerald-500/10 text-emerald-500'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}>
                    {installmentStatusLabel[normalizeInstallmentStatus(inst.status)]}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* CONTRATOS EM ATRASO */}
      {overdueLoans.length > 0 && (
        <div id="overdue-section" className="bg-red-500/5 border border-red-500/20 p-8 rounded-[2.5rem] relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Activity size={120} className="text-red-500" />
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-red-500/20 rounded-lg">
                <Activity size={20} className="text-red-500 animate-pulse" />
              </div>
              <div>
                <h3 className="text-xs font-black text-red-500 uppercase tracking-[0.2em]">Atencao: Contratos em Atraso</h3>
                <p className="text-[9px] text-zinc-500 uppercase tracking-widest mt-1">Existem pendencias que requerem sua atencao imediata</p>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {overdueLoans.map((loan) => {
                const overdueInstallments = loan.installments.filter(i => {
                  const today = getLocalISODate();
                  return (
                    normalizeInstallmentStatus(i.status) !== 'PAID' &&
                    i.dueDate < today &&
                    getRemainingInstallmentValue(i) > 0
                  );
                });
                const overdueCount = overdueInstallments.length;
                const overdueValue = roundMoney(
                  overdueInstallments.reduce((sum, i) => sum + getRemainingInstallmentValue(i), 0),
                );

                return (
                  <button
                    key={loan.id}
                    onClick={() => onNavigateToLoan(loan.id)}
                    className="flex flex-col p-6 bg-[#000000] border border-zinc-900 rounded-3xl hover:border-red-500/50 transition-all text-left group relative overflow-hidden"
                  >
                    <div className="absolute top-0 right-0 w-1 h-full bg-red-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <p className="text-[10px] font-black text-white uppercase group-hover:text-red-500 transition-colors break-words">{loan.customerName}</p>
                        <p className="text-[8px] text-zinc-500 uppercase tracking-widest mt-1 break-all">ID: {loan.id}</p>
                      </div>
                      <span className="text-[8px] font-black text-red-500 bg-red-500/10 px-2 py-1 rounded-lg uppercase">
                        {overdueCount}x
                      </span>
                    </div>
                    <div className="mt-auto">
                      <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Valor em Atraso</p>
                      <p className="text-sm font-black text-white mt-1">
                        R$ {overdueValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <div className="mt-4 flex items-center gap-2 text-[8px] font-black text-red-500 uppercase tracking-widest opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                      Resolver Agora <TrendingUp size={10} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* CONTRATOS POR MES */}
        <div className="bg-[#050505] border border-zinc-900 p-8 rounded-[2rem]">
          <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-6">Contratos por Mes</h3>
          <div className="space-y-3">
            {Object.keys(loansByMonth).map((month) => (
              <div key={month} className="border border-zinc-900 rounded-2xl overflow-hidden">
                <button 
                  onClick={() => setExpandedMonthLoans(expandedMonthLoans === month ? null : month)}
                  className="w-full p-4 flex items-center justify-between bg-[#000000]/40 hover:bg-zinc-900/50 transition-colors"
                >
                  <span className="text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[70%] text-left">{month}</span>
                  <span className="text-[9px] font-black text-[#BF953F] px-2 py-1 bg-[#BF953F]/10 rounded-lg">
                    {loansByMonth[month].length}
                  </span>
                </button>
                {expandedMonthLoans === month && (
                  <div className="p-4 space-y-2 bg-[#000000]/20 border-t border-zinc-900 animate-in slide-in-from-top duration-200">
                    {loansByMonth[month].map((loan: Loan) => (
                      <div key={loan.id} className="flex items-center justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50">
                        <div className="min-w-0">
                          <p className="text-[9px] font-black text-white uppercase truncate">{loan.customerName}</p>
                          <p className="text-[8px] text-zinc-500 uppercase">R$ {loan.amount.toLocaleString('pt-BR')}</p>
                        </div>
                        <span className={`text-[7px] font-black px-2 py-0.5 rounded-full uppercase ${
                          effectiveLoanStatus(loan) === 'ACTIVE'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : effectiveLoanStatus(loan) === 'COMPLETED'
                              ? 'bg-blue-500/10 text-blue-500'
                              : 'bg-zinc-800 text-zinc-500'
                        }`}>
                          {loanStatusLabel[effectiveLoanStatus(loan)]}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* MOVIMENTACOES POR MES */}
        <div className="bg-[#050505] border border-zinc-900 p-8 rounded-[2rem]">
          <h3 className="text-xs font-black gold-text uppercase tracking-[0.2em] mb-6">Movimentacoes por Mes</h3>
          <div className="space-y-3">
            {Object.keys(movementsByMonth).map((month) => (
              <div key={month} className="border border-zinc-900 rounded-2xl overflow-hidden">
                <button 
                  onClick={() => setExpandedMonthMovements(expandedMonthMovements === month ? null : month)}
                  className="w-full p-4 flex items-center justify-between bg-[#000000]/40 hover:bg-zinc-900/50 transition-colors"
                >
                  <span className="text-[10px] font-black text-white uppercase tracking-widest truncate max-w-[70%] text-left">{month}</span>
                  <span className="text-[9px] font-black text-[#BF953F] px-2 py-1 bg-[#BF953F]/10 rounded-lg">
                    {movementsByMonth[month].length}
                  </span>
                </button>
                {expandedMonthMovements === month && (
                  <div className="p-4 bg-[#000000]/20 border-t border-zinc-900 animate-in slide-in-from-top duration-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {/* COLUNA DE ENTRADAS */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-3 px-1">
                          <span className="text-[8px] font-black text-emerald-500 uppercase tracking-[0.2em]">Entradas</span>
                          <span className="text-[8px] font-black text-zinc-600 uppercase">
                            Total: R$ {movementsByMonth[month]
                              .filter((m: CashMovement) => ['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type))
                              .reduce((acc: number, m: CashMovement) => acc + m.amount, 0)
                              .toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {movementsByMonth[month]
                            .filter((m: CashMovement) => ['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type))
                            .map((m: CashMovement) => (
                              <div key={m.id} className="flex items-start justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50 hover:border-emerald-500/30 transition-colors">
                                <div className="min-w-0 flex-1 mr-3">
                                  <p className="text-[9px] font-black text-white uppercase whitespace-normal break-words">{m.description}</p>
                                  <p className="text-[7px] text-zinc-500 uppercase tracking-tighter whitespace-normal break-words">
                                    {formatDateTimeBR(m.date)}  -  {m.type}  -  POR: {getMovementActorLabel(m)}
                                  </p>
                                </div>
                                <span className="text-[9px] font-black text-emerald-500 whitespace-nowrap">
                                  + R$ {m.amount.toLocaleString('pt-BR')}
                                </span>
                              </div>
                            ))}
                          {movementsByMonth[month].filter((m: CashMovement) => ['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type)).length === 0 && (
                            <p className="text-[8px] text-zinc-700 italic text-center py-4">Nenhuma entrada</p>
                          )}
                        </div>
                      </div>

                      {/* COLUNA DE SAIDAS */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between mb-3 px-1">
                          <span className="text-[8px] font-black text-red-500 uppercase tracking-[0.2em]">Saidas</span>
                          <span className="text-[8px] font-black text-zinc-600 uppercase">
                            Total: R$ {movementsByMonth[month]
                              .filter((m: CashMovement) => !['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type))
                              .reduce((acc: number, m: CashMovement) => acc + m.amount, 0)
                              .toLocaleString('pt-BR')}
                          </span>
                        </div>
                        <div className="space-y-2">
                          {movementsByMonth[month]
                            .filter((m: CashMovement) => !['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type))
                            .map((m: CashMovement) => (
                              <div key={m.id} className="flex items-start justify-between p-3 bg-zinc-950/50 rounded-xl border border-zinc-900/50 hover:border-red-500/30 transition-colors">
                                <div className="min-w-0 flex-1 mr-3">
                                  <p className="text-[9px] font-black text-white uppercase whitespace-normal break-words">{m.description}</p>
                                  <p className="text-[7px] text-zinc-500 uppercase tracking-tighter whitespace-normal break-words">
                                    {formatDateTimeBR(m.date)}  -  {m.type}  -  POR: {getMovementActorLabel(m)}
                                  </p>
                                </div>
                                <span className="text-[9px] font-black text-red-500 whitespace-nowrap">
                                  - R$ {m.amount.toLocaleString('pt-BR')}
                                </span>
                              </div>
                            ))}
                          {movementsByMonth[month].filter((m: CashMovement) => !['APORTE', 'PAGAMENTO', 'ENTRADA'].includes(m.type)).length === 0 && (
                            <p className="text-[8px] text-zinc-700 italic text-center py-4">Nenhuma saida</p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;







