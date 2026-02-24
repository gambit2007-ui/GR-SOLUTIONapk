import React, { useState } from 'react';
import { Save, ShieldCheck } from 'lucide-react';
import { Customer, Loan } from '../types';
import { generateContractPDF } from '../utils/contractGenerator';

interface Props {
  customers: Customer[];
  loans: Loan[];
  onSaveLoan: (loan: any) => void;
}

export default function LoanRegistration({ customers, onSaveLoan }: Props) {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState(0);

  const handleSave = () => {
    if (!selectedCustomerId || amount <= 0) {
      alert("Selecione um cliente e um valor válido!");
      return;
    }
    
    // Criando um objeto simples para testar a gravação
    const newLoan = {
      customerId: selectedCustomerId,
      amount: amount,
      createdAt: Date.now(),
      status: 'ATIVO'
    };

    onSaveLoan(newLoan as any);
  };

  return (
    <div className="max-w-4xl mx-auto bg-zinc-900 border border-amber-600/30 p-8 rounded-2xl text-white shadow-2xl">
      <h2 className="text-2xl font-bold text-amber-500 mb-8 flex items-center gap-3">
        <ShieldCheck size={32} /> 
        Novo Contrato de Empréstimo
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1">Cliente</label>
          <select 
            className="w-full bg-black border border-zinc-800 p-4 rounded-xl focus:border-amber-500 outline-none transition-all"
            value={selectedCustomerId}
            onChange={(e) => setSelectedCustomerId(e.target.value)}
          >
            <option value="">Selecione um cliente...</option>
            {customers?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-widest text-zinc-500 ml-1">Valor (R$)</label>
          <input 
            type="number" 
            placeholder="0,00"
            className="w-full bg-black border border-zinc-800 p-4 rounded-xl focus:border-amber-500 outline-none transition-all"
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </div>
      </div>
      
      <div className="mt-10 p-4 bg-amber-500/5 border border-amber-500/10 rounded-xl flex items-center gap-4">
        <div className="p-2 bg-amber-500 rounded-lg text-black">
            <Save size={20} />
        </div>
        <p className="text-sm text-zinc-400">Verifique os dados antes de efetivar o contrato no banco de dados.</p>
      </div>
      
      <button 
        onClick={handleSave}
        className="w-full mt-8 bg-amber-600 hover:bg-amber-500 text-black font-black py-4 rounded-xl transition-all transform active:scale-95 uppercase tracking-widest"
      >
        Efetivar Empréstimo
      </button>
    </div>
  );
}