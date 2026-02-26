import React, { useState, useMemo } from 'react';
import { 
  FileText, 
  Save,
  CalendarDays
} from 'lucide-react';
import { Customer, Loan } from '../types';
import { generateContractPDF } from '../utils/contractGenerator';

interface LoanSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddLoan: (loan: Loan) => void;
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void;
}

const LoanSection: React.FC<LoanSectionProps> = ({ 
  customers = [], 
  loans = [], 
  onAddLoan, 
  showToast 
}) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [interestRate, setInterestRate] = useState('10');
  const [installmentsCount, setInstallmentsCount] = useState('1');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [interestType, setInterestType] = useState<'SIMPLES' | 'PRICE'>('SIMPLES');
  const [frequency, setFrequency] = useState<'MENSAL' | 'QUINZENAL' | 'SEMANAL' | 'DIARIO'>('MENSAL');
  
  const [isSuccess, setIsSuccess] = useState(false);
  const [lastCreated, setLastCreated] = useState<{customer: Customer, loan: Loan} | null>(null);

  const getNextContractNumber = () => {
    const base = 2026001;
    if (!loans || loans.length === 0) return base.toString();
    const numbers = loans.map(l => l?.contractNumber ? parseInt(l.contractNumber) : 0).filter(n => !isNaN(n));
    const max = numbers.length > 0 ? Math.max(...numbers) : base;
    return (max + 1).toString();
  };

  const calculation = useMemo(() => {
    const principal = parseFloat(amount) || 0;
    const rate = (parseFloat(interestRate) || 0) / 100;
    const count = parseInt(installmentsCount) || 1;

    if (principal === 0) return { totalReturn: 0, installmentValue: 0, totalInterest: 0, schedule: [] };

    let totalReturn = 0;
    let installmentValue = 0;
    
    if (interestType === 'PRICE') {
      const factor = Math.pow(1 + rate, count);
      installmentValue = principal * (rate * factor) / (factor - 1);
      totalReturn = installmentValue * count;
    } else {
      const totalInterest = principal * rate; 
      totalReturn = principal + totalInterest;
      installmentValue = totalReturn / count;
    }

    const schedule = [];
    for (let i = 1; i <= count; i++) {
      const [year, month, day] = startDate.split('-').map(Number);
      const d = new Date(year, month - 1, day);

      if (frequency === 'MENSAL') d.setMonth(d.getMonth() + i);
      else if (frequency === 'QUINZENAL') d.setDate(d.getDate() + (i * 15));
      else if (frequency === 'SEMANAL') d.setDate(d.getDate() + (i * 7));
      else if (frequency === 'DIARIO') d.setDate(d.getDate() + i);

      schedule.push({
        number: i,
        date: d.toISOString().split('T')[0],
        value: Number(installmentValue.toFixed(2))
      });
    }

    return { 
      totalReturn: Number(totalReturn.toFixed(2)), 
      installmentValue: Number(installmentValue.toFixed(2)), 
      totalInterest: Number((totalReturn - principal).toFixed(2)),
      schedule
    };
  }, [amount, interestRate, installmentsCount, interestType, startDate, frequency]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const customer = customers.find(c => c.id === selectedCustomerId);
    
    if (!customer || !amount || parseFloat(amount) <= 0) {
      showToast?.("Selecione o cliente e um valor válido.", "error");
      return;
    }

    const contractNumber = getNextContractNumber();
    const loanId = Math.random().toString(36).substr(2, 9);

    const newLoan: Loan = {
      id: loanId,
      contractNumber: contractNumber,
      customerId: selectedCustomerId,
      customerName: customer.name || 'Não informado',
      customerPhone: customer.phone || '',
      amount: parseFloat(amount),
      interestRate: parseFloat(interestRate),
      installmentCount: parseInt(installmentsCount),
      totalToReturn: calculation.totalReturn,
      installmentValue: calculation.installmentValue,
      paidAmount: 0,
      startDate: startDate, 
      dueDate: calculation.schedule[0]?.date || startDate, 
      status: 'ATIVO',
      interestType: interestType,
      frequency: frequency, 
      createdAt: Date.now(),
      installments: calculation.schedule.map(s => ({
        id: Math.random().toString(36).substr(2, 9),
        number: s.number,
        dueDate: s.date,
        value: Number(s.value.toFixed(2)),
        status: 'PENDENTE',
        originalValue: Number(s.value.toFixed(2))
      }))
    };

    try {
      // ✅ ÚNICA CHAMADA: Delegamos toda a gravação e financeiro para o App.tsx
      // Isso evita registros duplicados no cashMovement e erros de saldo.
      await onAddLoan(newLoan);

      // Gera o PDF
      if (generateContractPDF) {
        generateContractPDF(customer, newLoan);
      }

      setLastCreated({ customer, loan: newLoan });
      setIsSuccess(true);
      showToast?.("Contrato gerado com sucesso!", "success");

    } catch (error) {
      console.error("Erro ao efetivar:", error);
      showToast?.("Erro técnico ao salvar.", "error");
    }
  };

  // Se o contrato foi criado com sucesso, exibe tela de confirmação
  if (isSuccess && lastCreated) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center animate-in zoom-in-95 duration-500">
        <div className="w-24 h-24 bg-emerald-500/10 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-8 border border-emerald-500/20 shadow-[0_0_50px_rgba(16,185,129,0.1)]">
          <Save size={40} />
        </div>
        <h2 className="text-4xl font-black text-white uppercase tracking-tighter mb-4">Contrato Efetivado!</h2>
        <p className="text-zinc-500 mb-10 font-medium">O contrato nº {lastCreated.loan.contractNumber} de {lastCreated.customer.name} foi registrado e o PDF gerado.</p>
        <button 
          onClick={() => { setIsSuccess(false); setSelectedCustomerId(''); setAmount(''); }} 
          className="px-10 py-4 gold-gradient text-black font-black rounded-2xl uppercase text-[10px] tracking-[0.2em] shadow-2xl hover:scale-105 transition-transform"
        >
          Novo Empréstimo
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto animate-in fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 text-left">
        <div className="bg-[#0a0a0a] p-8 rounded-[2.5rem] border border-white/5">
          <h2 className="text-xl font-black text-white uppercase tracking-widest mb-8 flex items-center gap-3">
            <FileText size={20} className="text-[#BF953F]" /> Novo Registro
          </h2>
          
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Cliente</label>
              <select value={selectedCustomerId} onChange={(e) => setSelectedCustomerId(e.target.value)} className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl text-zinc-200 text-sm">
                <option value="">Selecione...</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor (R$)</label>
                  <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl text-white outline-none focus:border-[#BF953F]" />
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Juros Mensal (%)</label>
                  <input type="number" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl text-white outline-none focus:border-[#BF953F]" />
               </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Parcelas</label>
                  <input type="number" value={installmentsCount} onChange={(e) => setInstallmentsCount(e.target.value)} className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl text-white outline-none focus:border-[#BF953F]" />
               </div>
               <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Início</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full px-6 py-4 bg-black border border-zinc-800 rounded-2xl text-white outline-none focus:border-[#BF953F]" />
               </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 block">Frequência</label>
              <div className="flex flex-wrap bg-black p-1 rounded-2xl border border-zinc-800 w-fit gap-1">
                {['MENSAL', 'QUINZENAL', 'SEMANAL', 'DIARIO'].map((f) => (
                  <button 
                    key={f}
                    type="button" 
                    onClick={() => setFrequency(f as any)} 
                    className={`px-4 py-2 rounded-xl text-[9px] font-black uppercase transition-all ${frequency === f ? 'bg-[#BF953F] text-black' : 'text-zinc-600 hover:text-zinc-400'}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1 block">Sistema</label>
              <div className="flex bg-black p-1 rounded-2xl border border-zinc-800 w-fit">
                <button type="button" onClick={() => setInterestType('SIMPLES')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${interestType === 'SIMPLES' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>Simples</button>
                <button type="button" onClick={() => setInterestType('PRICE')} className={`px-6 py-2 rounded-xl text-[10px] font-black uppercase transition-all ${interestType === 'PRICE' ? 'bg-[#BF953F] text-black' : 'text-zinc-600'}`}>Price</button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-[#050505] p-8 rounded-[2.5rem] border border-[#BF953F]/30 shadow-2xl flex flex-col justify-between h-full">
            <div className="space-y-8">
              <h3 className="text-[10px] font-black text-[#BF953F] uppercase tracking-[0.3em] flex items-center gap-2">
                <CalendarDays size={14}/> Resumo Financeiro
              </h3>
              
              <div className="space-y-6">
                <div className="flex justify-between items-center border-b border-zinc-900 pb-4">
                  <span className="text-[10px] text-zinc-500 font-black uppercase">Total Final</span>
                  <span className="text-2xl font-black text-[#BF953F]">R$ {calculation.totalReturn.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between items-center border-b border-zinc-900 pb-4">
                  <span className="text-[10px] text-zinc-500 font-black uppercase">Valor {frequency}</span>
                  <span className="text-lg font-bold text-white">R$ {calculation.installmentValue.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-zinc-500 font-black uppercase">Lucro Bruto</span>
                  <span className="text-lg font-bold text-emerald-500">R$ {calculation.totalInterest.toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
                </div>
              </div>
            </div>

            <button onClick={handleSubmit} disabled={!selectedCustomerId || !amount} className={`w-full mt-10 py-5 rounded-2xl flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest transition-all ${(selectedCustomerId && amount) ? 'gold-gradient text-black shadow-xl' : 'bg-zinc-900 text-zinc-700 cursor-not-allowed'}`}>
              <Save size={18} /> Efetivar Contrato
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoanSection;