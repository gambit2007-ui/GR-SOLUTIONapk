import React, { useState, useMemo } from 'react';
import { Calendar, FileText, AlertCircle } from 'lucide-react';
import { Customer, Loan, InterestType, Frequency } from '../types';

interface LoanSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddLoan: (loan: Loan) => void;
}

const LoanSection: React.FC<LoanSectionProps> = ({ customers, loans, onAddLoan }) => {
  // --- ESTADOS DO FORMULÁRIO ---
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('10');
  const [installmentsCount, setInstallmentsCount] = useState('1');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [interestType, setInterestType] = useState<'FIXO' | 'PRICE'>('FIXO');

  // --- LÓGICA DE CÁLCULO (SISTEMA PRICE E SIMPLES) ---
  const calculation = useMemo(() => {
    const principal = parseFloat(amount) || 0;
    const rate = (parseFloat(interestRate) || 0) / 100;
    const count = parseInt(installmentsCount) || 1;

    if (principal === 0) return { totalReturn: 0, installmentValue: 0, totalInterest: 0 };

    if (interestType === 'PRICE') {
      // Fórmula Price: PMT = PV * [i * (1+i)^n] / [(1+i)^n - 1]
      const factor = Math.pow(1 + rate, count);
      const installmentValue = principal * (rate * factor) / (factor - 1);
      const totalReturn = installmentValue * count;
      const totalInterest = totalReturn - principal;

      return { totalReturn, installmentValue, totalInterest };
    } else {
      // Cálculo Simples (Taxa fixa sobre o capital)
      const totalInterest = principal * rate;
      const totalReturn = principal + totalInterest;
      const installmentValue = totalReturn / count;

      return { totalReturn, installmentValue, totalInterest };
    }
  }, [amount, interestRate, installmentsCount, interestType]);

  // --- FUNÇÃO DE SUBMISSÃO ---
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Aqui usamos o 'customers', resolvendo o erro do TypeScript
    const customer = customers.find(c => c.id === selectedCustomerId);
    
    if (!customer || !amount) {
      alert("Selecione um cliente e preencha o valor.");
      return;
    }

    const loanData: any = {
      customerId: selectedCustomerId,
      customerName: customer.name,
      amount: parseFloat(amount),
      interestRate: parseFloat(interestRate),
      installmentCount: parseInt(installmentsCount),
      totalToReturn: calculation.totalReturn,
      installmentValue: calculation.installmentValue,
      startDate,
      dueDate: startDate,
      status: 'active',
      interestType: interestType,
      frequency: 'MENSAL',
      installments: []
    };

    onAddLoan(loanData);
    
    // Reset
    setAmount('');
    setSelectedCustomerId('');
  };

  return (
    <div className="w-full bg-black min-h-screen p-6 lg:p-10">
      <div className="max-w-[1400px] mx-auto">
        
        <div className="flex items-center gap-3 mb-10">
          <div className="w-[2px] h-5 bg-[#BF953F] shadow-[0_0_10px_#BF953F]" />
          <h2 className="text-[11px] font-black text-white uppercase tracking-[0.5em]">Contratos</h2>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
          
          {/* LADO ESQUERDO: FORMULÁRIO */}
          <div className="xl:col-span-7 bg-[#0a0a0a] border border-white/5 p-8 rounded-[2rem] shadow-2xl">
            <div className="flex items-center gap-3 mb-10 text-[#BF953F]">
              <FileText size={20} />
              <h3 className="text-sm font-black uppercase tracking-[0.2em]">Registro Manual</h3>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6 text-left">
              
              <div className="space-y-2">
                <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1">Cliente / Devedor</label>
                <select 
                  required
                  value={selectedCustomerId} 
                  onChange={(e) => setSelectedCustomerId(e.target.value)} 
                  className="w-full bg-black border border-zinc-800/50 p-4 rounded-xl text-white text-xs outline-none focus:border-[#BF953F] appearance-none"
                >
                  <option value="">Selecione...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1">Capital (R$)</label>
                  <input required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full bg-black border border-zinc-800/50 p-4 rounded-xl text-white text-xs outline-none focus:border-[#BF953F]" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1">Taxa de Juros (%)</label>
                  <input required type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="w-full bg-black border border-zinc-800/50 p-4 rounded-xl text-white text-xs outline-none focus:border-[#BF953F]" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1">Nº Parcelas</label>
                  <input required type="number" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} className="w-full bg-black border border-zinc-800/50 p-4 rounded-xl text-white text-xs outline-none focus:border-[#BF953F]" />
                </div>
                <div className="space-y-2">
                  <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1 flex items-center gap-2">
                    <Calendar size={12}/> Data de Emissão
                  </label>
                  <input required type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full bg-black border border-zinc-800/50 p-4 rounded-xl text-white text-xs outline-none focus:border-[#BF953F]" />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[9px] text-zinc-500 font-black uppercase tracking-widest ml-1 block">Modelo de Cálculo</label>
                <div className="flex p-1 bg-black border border-zinc-800/50 rounded-xl max-w-[200px]">
                  <button 
                    type="button"
                    onClick={() => setInterestType('FIXO')}
                    className={`flex-1 text-[9px] font-black rounded-lg py-2 uppercase transition-all ${interestType === 'FIXO' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}
                  >
                    Simples
                  </button>
                  <button 
                    type="button"
                    onClick={() => setInterestType('PRICE')}
                    className={`flex-1 text-[9px] font-black rounded-lg py-2 uppercase transition-all ${interestType === 'PRICE' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}
                  >
                    Price
                  </button>
                </div>
              </div>

              <div className="p-4 bg-[#BF953F]/5 border border-[#BF953F]/10 rounded-xl flex items-center gap-3">
                <AlertCircle size={14} className="text-[#BF953F]" />
                <p className="text-[9px] text-[#BF953F]/70 font-bold uppercase tracking-widest">Cálculo automático baseado no sistema {interestType}.</p>
              </div>
            </form>
          </div>

          {/* LADO DIREITO: RESUMO */}
          <div className="xl:col-span-5 border border-[#BF953F]/30 bg-[#050505] rounded-[2rem] p-8 flex flex-col justify-between min-h-[500px]">
            <div>
              <div className="flex items-center gap-2 mb-10">
                <div className="w-4 h-4 rounded-full border border-[#BF953F] flex items-center justify-center">
                  <div className="w-1 h-1 bg-[#BF953F] rounded-full" />
                </div>
                <h3 className="text-[10px] font-black text-[#BF953F] uppercase tracking-[0.3em]">Resumo Operacional</h3>
              </div>
              
              <div className="space-y-8">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-6">
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Total a Receber</span>
                  <span className="text-2xl font-black text-[#BF953F]">
                    R$ {calculation.totalReturn.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-900 pb-6">
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Parcelas</span>
                  <span className="text-base font-bold text-white">
                    {installmentsCount}x R$ {calculation.installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-900 pb-6">
                  <span className="text-[10px] text-zinc-500 font-black uppercase tracking-widest">Juros Acumulados</span>
                  <span className="text-base font-bold text-white">
                    R$ {calculation.totalInterest.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            <button 
              onClick={handleSubmit} 
              disabled={!selectedCustomerId || !amount} 
              className={`w-full py-5 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 ${
                (!selectedCustomerId || !amount) 
                ? 'bg-zinc-900/50 text-zinc-700 cursor-not-allowed' 
                : 'bg-[#BF953F] text-black hover:scale-[1.02] shadow-[0_10px_20px_rgba(191,149,63,0.2)]'
              }`}
            >
              <FileText size={16} />
              Efetivar Contrato
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoanSection;