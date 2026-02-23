import React, { useState } from 'react';
import { FilePlus, Calculator, Calendar, User, DollarSign, Percent, Info } from 'lucide-react';

interface LoanRegistrationProps {
  customers: any[];
  loans: any[];
  onSaveLoan: (loan: any) => void;
}

const LoanRegistration: React.FC<LoanRegistrationProps> = ({ customers, onSaveLoan }) => {
  const [formData, setFormData] = useState({
    customerId: '',
    amount: '',
    installments: '12',
    interestRate: '5',
    startDate: new Date().toISOString().split('T')[0]
  });

  // --- LÓGICA DE SIMULAÇÃO EM TEMPO REAL ---
  const amountNum = Number(formData.amount) || 0;
  const rateNum = Number(formData.interestRate) / 100;
  const instNum = Number(formData.installments) || 1;

  // Cálculo da Parcela (Price/Juros Compostos)
  const monthlyPayment = amountNum > 0 
    ? (amountNum * rateNum) / (1 - Math.pow(1 + rateNum, -instNum))
    : 0;
  
  const totalToPay = monthlyPayment * instNum;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.customerId) {
      alert("Por favor, selecione um cliente!");
      return;
    }

    onSaveLoan({
      customerId: formData.customerId,
      amount: Number(formData.amount),
      installments: Number(formData.installments),
      interestRate: Number(formData.interestRate),
      status: 'active',
      startDate: new Date(formData.startDate).getTime()
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="p-4 bg-[#BF953F]/10 rounded-2xl">
          <FilePlus className="text-[#BF953F]" size={32} />
        </div>
        <div>
          <h2 className="text-2xl font-black text-white uppercase tracking-tighter">Novo Contrato</h2>
          <p className="text-zinc-500 text-[10px] font-black uppercase tracking-widest mt-1">Efetivação de crédito para clientes base</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-zinc-900/40 p-8 rounded-3xl border border-zinc-800">
        
        {/* Seleção de Cliente */}
        <div className="md:col-span-2 space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Selecionar Cliente</label>
          <div className="relative">
            <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <select
              required
              className="w-full bg-black border border-zinc-800 text-white px-12 py-4 rounded-2xl focus:border-[#BF953F] outline-none appearance-none"
              value={formData.customerId}
              onChange={(e) => setFormData({...formData, customerId: e.target.value})}
            >
              <option value="">Selecione um cliente cadastrado...</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name} - {c.cpf}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Valor do Empréstimo */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor do Empréstimo</label>
          <div className="relative">
            <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 text-[#BF953F]" size={18} />
            <input
              type="number"
              required
              placeholder="0,00"
              className="w-full bg-black border border-zinc-800 text-white px-12 py-4 rounded-2xl focus:border-[#BF953F] outline-none"
              value={formData.amount}
              onChange={(e) => setFormData({...formData, amount: e.target.value})}
            />
          </div>
        </div>

        {/* Taxa de Juros */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Taxa de Juros (% AM)</label>
          <div className="relative">
            <Percent className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <input
              type="number"
              className="w-full bg-black border border-zinc-800 text-white px-12 py-4 rounded-2xl focus:border-[#BF953F] outline-none"
              value={formData.interestRate}
              onChange={(e) => setFormData({...formData, interestRate: e.target.value})}
            />
          </div>
        </div>

        {/* Parcelas */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Número de Parcelas</label>
          <div className="relative">
            <Calculator className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <input
              type="number"
              className="w-full bg-black border border-zinc-800 text-white px-12 py-4 rounded-2xl focus:border-[#BF953F] outline-none"
              value={formData.installments}
              onChange={(e) => setFormData({...formData, installments: e.target.value})}
            />
          </div>
        </div>

        {/* Data de Início */}
        <div className="space-y-2">
          <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest ml-1">Data da Primeira Parcela</label>
          <div className="relative">
            <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={18} />
            <input
              type="date"
              className="w-full bg-black border border-zinc-800 text-white px-12 py-4 rounded-2xl focus:border-[#BF953F] outline-none"
              value={formData.startDate}
              onChange={(e) => setFormData({...formData, startDate: e.target.value})}
            />
          </div>
        </div>

        {/* --- BOX DE RESUMO DA SIMULAÇÃO --- */}
        <div className="md:col-span-2 bg-black border border-[#BF953F]/30 p-6 rounded-2xl mt-4 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[#BF953F] rounded-lg text-black">
              <Info size={20} />
            </div>
            <div>
              <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Valor da Parcela</p>
              <p className="text-2xl font-black text-white">R$ {monthlyPayment.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            </div>
          </div>
          
          <div className="text-right">
            <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Total com Juros</p>
            <p className="text-lg font-bold text-[#BF953F]">R$ {totalToPay.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        <button
          type="submit"
          className="md:col-span-2 mt-4 w-full bg-[#BF953F] hover:bg-[#d4a74a] text-black font-black py-5 rounded-2xl uppercase tracking-widest text-xs transition-all shadow-lg"
        >
          Confirmar e Gerar Contrato
        </button>
      </form>
    </div>
  );
};

export default LoanRegistration;