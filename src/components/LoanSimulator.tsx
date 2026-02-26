import React, { useState, useEffect } from 'react';
import { 
  Calculator, 
  RefreshCcw, 
  Save, 
  HelpCircle,
  TrendingUp,
  CreditCard,
  ShieldCheck,
  Calendar
} from 'lucide-react';
import { Customer, Loan, Frequency, InterestType, Installment } from '../types';

interface LoanSimulatorProps {
  customers: Customer[];
  loans: Loan[];
  onSaveLoan: (loan: Loan) => void;
}

const LoanSimulator: React.FC<LoanSimulatorProps> = ({ customers, loans, onSaveLoan }) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState<number>(1000);
  const [interestRate, setInterestRate] = useState<number>(5);
  const [installments, setInstallments] = useState<number>(12);
  const [frequency, setFrequency] = useState<Frequency>('MENSAL');
  const [interestType, setInterestType] = useState<InterestType>('SIMPLES');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  const [simulation, setSimulation] = useState<{
    totalToReturn: number;
    installmentValue: number;
    totalInterest: number;
    dueDate: string;
    contractNumber: string;
    schedule: { date: string; value: number }[];
  } | null>(null);

  const getNextContractNumber = () => {
    const base = 2026001;
    if (!loans || loans.length === 0) return base.toString();
    const numbers = loans.map(l => parseInt(l.contractNumber)).filter(n => !isNaN(n));
    if (numbers.length === 0) return base.toString();
    const max = Math.max(...numbers);
    return (max + 1).toString();
  };

  const calculate = () => {
    const rateDecimal = interestRate / 100;
    let totalToReturn = 0;
    let installmentValue = 0;
    const schedule = [];

    if (interestType === 'SIMPLES') {
      totalToReturn = amount * (1 + (rateDecimal * installments));
      installmentValue = totalToReturn / installments;
    } else {
      if (rateDecimal === 0) {
        totalToReturn = amount;
        installmentValue = amount / installments;
      } else {
        const factor = Math.pow(1 + rateDecimal, installments);
        installmentValue = amount * (rateDecimal * factor) / (factor - 1);
        totalToReturn = installmentValue * installments;
      }
    }

    let currentDate = new Date(startDate + 'T12:00:00'); // Usar meio-dia evita problemas de fuso horário
    for (let i = 1; i <= installments; i++) {
      const installmentDate = new Date(currentDate);
      if (frequency === 'DIARIO') installmentDate.setDate(currentDate.getDate() + i);
      else if (frequency === 'SEMANAL') installmentDate.setDate(currentDate.getDate() + (i * 7));
      else if (frequency === 'MENSAL') installmentDate.setMonth(currentDate.getMonth() + i);
      
      schedule.push({
        date: installmentDate.toISOString().split('T')[0],
        value: installmentValue
      });
    }

    setSimulation({
      totalToReturn,
      installmentValue,
      totalInterest: totalToReturn - amount,
      dueDate: schedule[0]?.date || startDate,
      contractNumber: getNextContractNumber(),
      schedule
    });
  };

  useEffect(() => {
    calculate();
  }, [amount, interestRate, installments, frequency, interestType, startDate, loans]);

  const handleSave = () => {
    if (!selectedCustomerId || !simulation) return;
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (!customer) return;

    const installmentObjects: Installment[] = simulation.schedule.map((s, idx) => ({
      number: idx + 1,
      dueDate: s.date,
      value: Number(s.value.toFixed(2)),
      status: 'PENDENTE'
    }));

    // Objeto Loan completo seguindo estritamente a sua interface
    const newLoan: Loan = {
      id: Math.random().toString(36).substr(2, 9),
      contractNumber: simulation.contractNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone || '',
      amount: Number(amount),
      interestRate: Number(interestRate),
      installmentCount: Number(installments),
      frequency,
      interestType,
      totalToReturn: Number(simulation.totalToReturn.toFixed(2)),
      installmentValue: Number(simulation.installmentValue.toFixed(2)),
      startDate: startDate,
      dueDate: simulation.dueDate,
      createdAt: Date.now(),
      installments: installmentObjects,
      // ✅ CAMPOS ADICIONADOS PARA RESOLVER O ERRO TS(2739)
      status: 'ATIVO',
      paidAmount: 0
    };

    onSaveLoan(newLoan);
    resetSimulation();
    alert('Contrato efetivado com sucesso!');
  };

  const resetSimulation = () => {
    setAmount(1000);
    setInterestRate(5);
    setInstallments(12);
    setFrequency('MENSAL');
    setInterestType('SIMPLES');
    setSelectedCustomerId('');
    setStartDate(new Date().toISOString().split('T')[0]);
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-10 max-w-7xl mx-auto animate-in zoom-in-95 duration-500">
      <div className="bg-[#0a0a0a] p-10 rounded-[2.5rem] border border-zinc-800 shadow-2xl relative">
        <div className="flex items-center justify-between mb-10">
          <h2 className="text-xl font-black text-[#BF953F] uppercase tracking-[0.2em] flex items-center gap-4">
            <Calculator size={24} className="text-[#BF953F]" />
            Simulação Premium
          </h2>
          <button 
            onClick={resetSimulation}
            className="p-3 text-zinc-600 hover:text-[#BF953F] bg-zinc-900 rounded-2xl transition-all"
          >
            <RefreshCcw size={18} />
          </button>
        </div>

        <div className="space-y-8">
          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 ml-2">Proprietário do Contrato</label>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200 transition-all appearance-none cursor-pointer"
            >
              <option value="">Selecione um perfil...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id} className="bg-black">{c.name} - {c.cpf}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <SimulatorInput label="Montante Principal (R$)" type="number" value={amount} onChange={(e: any) => setAmount(Number(e.target.value))} />
            <SimulatorInput label={`Taxa de Juros (% ${frequency.toLowerCase()})`} type="number" value={interestRate} onChange={(e: any) => setInterestRate(Number(e.target.value))} />
          </div>

          <div className="grid grid-cols-2 gap-8">
            <SimulatorInput label="Nº de Parcelas" type="number" value={installments} onChange={(e: any) => setInstallments(Number(e.target.value))} />
            <div>
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 ml-2">Período</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
                className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200"
              >
                <option value="DIARIO" className="bg-black">Diário</option>
                <option value="SEMANAL" className="bg-black">Semanal</option>
                <option value="MENSAL" className="bg-black">Mensal</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 ml-2">Data de Início</label>
            <input 
              type="date" 
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200 transition-all cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4 ml-2 text-center">Metodologia de Cálculo</label>
            <div className="flex gap-4 p-2 bg-black border border-zinc-900 rounded-3xl">
              <button
                onClick={() => setInterestType('SIMPLES')}
                className={`flex-1 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
                  interestType === 'SIMPLES' 
                    ? 'bg-[#BF953F] text-black shadow-xl' 
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                Simples
              </button>
              <button
                onClick={() => setInterestType('PRICE')}
                className={`flex-1 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${
                  interestType === 'PRICE' 
                    ? 'bg-[#BF953F] text-black shadow-xl' 
                    : 'text-zinc-600 hover:text-zinc-400'
                }`}
              >
                Price
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        <div className="bg-[#050505] p-10 rounded-[2.5rem] border border-[#BF953F]/30 shadow-2xl relative overflow-hidden group border-t-4 border-t-[#BF953F]">
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10">
              <ShieldCheck className="text-[#BF953F]" size={20} />
              <h3 className="text-[10px] font-black text-[#BF953F] uppercase tracking-[0.4em]">Sumário do Ativo</h3>
            </div>
            
            <div className="mb-10">
              <p className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest mb-2">Valor da Parcela</p>
              <p className="text-6xl font-black text-[#BF953F] tracking-tighter">
                {simulation?.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </p>
              <div className="mt-4 flex items-center gap-2 text-emerald-500 text-xs font-bold">
                <Calendar size={14} />
                Primeiro vencimento em: {simulation?.dueDate.split('-').reverse().join('/')}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-10 pt-10 border-t border-zinc-800/50">
              <div>
                <p className="text-zinc-600 text-[9px] font-bold uppercase tracking-widest mb-1">Montante Final</p>
                <p className="text-2xl font-black text-zinc-100">
                  {simulation?.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
              <div>
                <p className="text-zinc-600 text-[9px] font-bold uppercase tracking-widest mb-1">Lucro Estimado</p>
                <p className="text-2xl font-black text-[#BF953F]">
                  {simulation?.totalInterest.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                </p>
              </div>
            </div>

            <button
              onClick={handleSave}
              disabled={!selectedCustomerId}
              className={`w-full mt-12 py-5 rounded-[2rem] flex items-center justify-center gap-4 text-xs font-black uppercase tracking-[0.3em] transition-all shadow-2xl ${
                selectedCustomerId 
                  ? 'bg-[#BF953F] text-black hover:scale-[1.02] active:scale-95' 
                  : 'bg-zinc-900 text-zinc-700 cursor-not-allowed border border-zinc-800'
              }`}
            >
              <Save size={18} />
              EFETIVAR CONTRATO
            </button>
          </div>
        </div>

        <div className="bg-zinc-900/30 p-8 rounded-[2rem] border border-zinc-800 flex items-start gap-6">
          <div className="p-4 bg-[#BF953F] rounded-2xl text-black shadow-lg shrink-0">
            <HelpCircle size={24} />
          </div>
          <div>
            <h4 className="font-bold text-zinc-200 text-sm uppercase tracking-widest mb-2">Segurança Financeira</h4>
            <p className="text-[11px] text-zinc-500 leading-relaxed italic">
              Este sistema utiliza criptografia de ponta a ponta para proteger as operações de crédito e os dados sensíveis.
            </p>
            <div className="mt-4 flex gap-4">
              <div className="flex items-center gap-2 text-[9px] font-bold text-[#BF953F] bg-[#BF953F]/5 px-3 py-1.5 rounded-full border border-[#BF953F]/20">
                <TrendingUp size={12} /> PROTOCOLO {interestType}
              </div>
              <div className="flex items-center gap-2 text-[9px] font-bold text-zinc-400 bg-zinc-800/50 px-3 py-1.5 rounded-full border border-zinc-800">
                <CreditCard size={12} /> FREQUÊNCIA {frequency}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const SimulatorInput: React.FC<{ label: string; type: string; value: any; onChange: any }> = ({ label, type, value, onChange }) => (
  <div className="space-y-3">
    <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-2">{label}</label>
    <input 
      type={type} 
      value={value} 
      onChange={onChange}
      className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200 transition-all font-bold"
    />
  </div>
);

export default LoanSimulator;