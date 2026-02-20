
import React, { useState, useEffect } from 'react';
import { 
  Save, 
  ShieldCheck, 
  Calendar, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  Info,
  AlertCircle,
  MessageSquare
} from 'lucide-react';
import { Customer, Loan, Frequency, InterestType, Installment } from '../types';

interface LoanRegistrationProps {
  customers: Customer[];
  loans: Loan[];
  onSaveLoan: (loan: Loan) => void;
}

const LoanRegistration: React.FC<LoanRegistrationProps> = ({ customers, loans, onSaveLoan }) => {
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [amount, setAmount] = useState<number>(1000);
  const [interestRate, setInterestRate] = useState<number>(5);
  const [installmentsCount, setInstallmentsCount] = useState<number>(12);
  const [frequency, setFrequency] = useState<Frequency>('MENSAL');
  const [interestType, setInterestType] = useState<InterestType>('SIMPLES');
  const [startDate, setStartDate] = useState(''); 
  const [notes, setNotes] = useState('');
  const [showProjection, setShowProjection] = useState(false);
  
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
    if (loans.length === 0) return base.toString();
    const numbers = loans.map(l => parseInt(l.contractNumber));
    const max = Math.max(...numbers);
    return (max + 1).toString();
  };

  const calculate = () => {
    if (!startDate) {
      setSimulation(null);
      return;
    }

    const rateDecimal = interestRate / 100;
    let totalToReturn = 0;
    let installmentValue = 0;
    const schedule = [];

    if (interestType === 'SIMPLES') {
      totalToReturn = amount * (1 + rateDecimal);
      installmentValue = totalToReturn / installmentsCount;
    } else {
      const factor = Math.pow(1 + rateDecimal, installmentsCount);
      installmentValue = amount * (rateDecimal * factor) / (factor - 1);
      totalToReturn = installmentValue * installmentsCount;
    }

    const parsedDate = new Date(startDate + 'T12:00:00');
    let currentDate = isNaN(parsedDate.getTime()) ? new Date() : parsedDate;

    for (let i = 1; i <= installmentsCount; i++) {
      if (frequency === 'DIARIO') currentDate.setDate(currentDate.getDate() + 1);
      else if (frequency === 'SEMANAL') currentDate.setDate(currentDate.getDate() + 7);
      else if (frequency === 'MENSAL') currentDate.setMonth(currentDate.getMonth() + 1);
      
      schedule.push({
        date: currentDate.toISOString().split('T')[0],
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
  }, [amount, interestRate, installmentsCount, frequency, interestType, startDate]);

  const handleSave = () => {
    if (!selectedCustomerId || !simulation || !startDate) return;
    const customer = customers.find(c => c.id === selectedCustomerId);
    if (!customer) return;

    const installments: Installment[] = simulation.schedule.map((s, idx) => ({
      id: Math.random().toString(36).substr(2, 9),
      number: idx + 1,
      dueDate: s.date,
      value: s.value,
      status: 'PENDENTE'
    }));

    const contractDate = new Date(startDate + 'T12:00:00');
    const createdAtTimestamp = contractDate.getTime();

    const newLoan: Loan = {
      id: Math.random().toString(36).substr(2, 9),
      contractNumber: simulation.contractNumber,
      customerId: customer.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      amount,
      interestRate,
      installmentCount: installmentsCount,
      frequency,
      interestType,
      totalToReturn: simulation.totalToReturn,
      installmentValue: simulation.installmentValue,
      startDate: startDate,
      dueDate: simulation.dueDate,
      createdAt: createdAtTimestamp, 
      notes: notes,
      installments: installments
    };
    onSaveLoan(newLoan);
  };

  const isFormValid = selectedCustomerId !== '' && startDate !== '' && amount > 0;

  return (
    <div className="space-y-6 lg:space-y-10">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-10 max-w-7xl mx-auto animate-in zoom-in-95 duration-500">
        <div className="bg-[#0a0a0a] p-6 lg:p-10 rounded-3xl lg:rounded-[2.5rem] border border-zinc-800 shadow-2xl">
          <div className="flex items-center justify-between mb-8 lg:mb-10">
            <h2 className="text-base lg:text-xl font-black gold-text uppercase tracking-widest flex items-center gap-3">
              <FileText size={20} className="text-[#BF953F]" /> Registro Manual
            </h2>
          </div>

          <div className="space-y-5 lg:space-y-6">
            <div>
              <label className="block text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">Cliente / Devedor</label>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="w-full px-5 py-3.5 lg:px-6 lg:py-4 bg-black border border-zinc-800 rounded-xl lg:rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200 transition-all text-sm"
              >
                <option value="">Selecione...</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id} className="bg-black">{c.name} - {c.cpf}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
              <InputField label="Capital Liberado (R$)" type="number" value={amount} onChange={(v: number) => setAmount(v)} />
              <InputField label="Taxa de Juros (%)" type="number" value={interestRate} onChange={(v: number) => setInterestRate(v)} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
              <InputField label="Nº de Parcelas" type="number" value={installmentsCount} onChange={(v: number) => setInstallmentsCount(v)} />
              <div>
                <label className="block text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">Ciclo de Cobrança</label>
                <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className="w-full px-5 py-3.5 bg-black border border-zinc-800 rounded-xl focus:border-[#BF953F] outline-none text-zinc-200 text-sm">
                  <option value="DIARIO">Diário</option>
                  <option value="SEMANAL">Semanal</option>
                  <option value="MENSAL">Mensal</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 lg:gap-6">
               <div>
                <label className="flex items-center gap-2 text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">
                  <Calendar size={12} className="text-[#BF953F]" /> Data de Emissão
                </label>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={(e) => setStartDate(e.target.value)} 
                  className={`w-full px-5 py-3.5 bg-black border ${!startDate ? 'border-red-500/30' : 'border-zinc-800'} rounded-xl focus:border-[#BF953F] outline-none text-zinc-200 text-sm font-bold`} 
                />
              </div>
              <div>
                <label className="block text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1 text-center">Modelo Cálculo</label>
                <div className="flex gap-2 p-1 bg-black border border-zinc-900 rounded-xl">
                  <button onClick={() => setInterestType('SIMPLES')} className={`flex-1 py-2.5 rounded-lg text-[9px] font-black uppercase transition-all ${interestType === 'SIMPLES' ? 'gold-gradient text-black' : 'text-zinc-600'}`}>Simples</button>
                  <button onClick={() => setInterestType('PRICE')} className={`flex-1 py-2.5 rounded-lg text-[9px] font-black uppercase transition-all ${interestType === 'PRICE' ? 'gold-gradient text-black' : 'text-zinc-600'}`}>Price</button>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">
                 <span>Notas do Contrato</span>
              </label>
              <textarea 
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações especiais deste contrato..."
                rows={2}
                className="w-full px-5 py-3.5 bg-black border border-zinc-800 rounded-xl focus:border-[#BF953F] outline-none text-zinc-200 text-sm resize-none"
              ></textarea>
            </div>

            {!startDate && (
              <div className="bg-amber-500/5 border border-amber-500/10 p-3 lg:p-4 rounded-xl flex gap-3">
                <AlertCircle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[9px] text-zinc-500 uppercase font-bold leading-tight">
                  Preencha a data para calcular o cronograma.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="bg-[#050505] p-6 lg:p-10 rounded-3xl lg:rounded-[2.5rem] border border-[#BF953F]/30 shadow-2xl relative overflow-hidden group border-t-4 border-t-[#BF953F]">
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6 lg:mb-8">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="text-[#BF953F]" size={18} />
                  <h3 className="text-[9px] lg:text-[10px] font-black gold-text uppercase tracking-widest">Resumo Operacional</h3>
                </div>
                {simulation && (
                  <button onClick={() => setShowProjection(!showProjection)} className="text-[9px] font-bold text-[#BF953F] uppercase tracking-widest">
                    {showProjection ? 'Ocultar' : 'Ver Parcelas'}
                  </button>
                )}
              </div>
              
              {!simulation ? (
                <div className="py-12 lg:py-20 flex flex-col items-center justify-center text-center opacity-30">
                   <Calendar size={40} className="mb-4 text-zinc-700" />
                   <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500">Aguardando dados...</p>
                </div>
              ) : !showProjection ? (
                <>
                  <div className="mb-8 lg:mb-10 text-center lg:text-left">
                    <p className="text-zinc-500 text-[9px] font-bold uppercase tracking-widest mb-2">Parcela Individual</p>
                    <p className="text-4xl lg:text-6xl font-black gold-text tracking-tighter">
                      {simulation.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    <div className="mt-4 flex items-center justify-center lg:justify-start gap-2 text-emerald-500 text-[10px] font-bold uppercase">
                      <Calendar size={12} /> Início: {simulation.dueDate.split('-').reverse().join('/')}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-6 lg:gap-10 pt-8 lg:pt-10 border-t border-zinc-800/50">
                    <div>
                      <p className="text-zinc-600 text-[8px] font-bold uppercase tracking-widest mb-1">Total Retorno</p>
                      <p className="text-base lg:text-2xl font-black text-zinc-100">{simulation.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}</p>
                    </div>
                    <div>
                      <p className="text-zinc-600 text-[8px] font-bold uppercase tracking-widest mb-1">Lucro Bruto</p>
                      <p className="text-base lg:text-2xl font-black text-[#BF953F]">{simulation.totalInterest.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 })}</p>
                    </div>
                  </div>
                </>
              ) : (
                <div className="max-h-[250px] lg:max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                  <table className="w-full text-left">
                    <thead className="text-[8px] font-bold text-zinc-600 uppercase">
                      <tr>
                        <th className="pb-2">PARC.</th>
                        <th className="pb-2">VENC.</th>
                        <th className="pb-2 text-right">VALOR</th>
                      </tr>
                    </thead>
                    <tbody className="text-[10px] lg:text-xs divide-y divide-zinc-900">
                      {simulation.schedule.map((s, i) => (
                        <tr key={i}>
                          <td className="py-2.5 text-zinc-500">{i+1}ª</td>
                          <td className="py-2.5 text-zinc-300 font-bold">{s.date.split('-').reverse().join('/')}</td>
                          <td className="py-2.5 text-right text-[#BF953F] font-black">{s.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button
                onClick={handleSave}
                disabled={!isFormValid}
                className={`w-full mt-8 lg:mt-12 py-4 lg:py-5 rounded-2xl lg:rounded-[2rem] flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-widest transition-all shadow-xl ${
                  isFormValid ? 'gold-gradient text-black active:scale-95' : 'bg-zinc-900 text-zinc-700 opacity-50 cursor-not-allowed border border-zinc-800'
                }`}
              >
                <Save size={16} /> EFETIVAR CONTRATO
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const InputField: React.FC<{ label: string; type: string; value: number; onChange: (v: number) => void }> = ({ label, type, value, onChange }) => (
  <div className="space-y-2">
    <label className="block text-[9px] lg:text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 ml-1">{label}</label>
    <input 
      type={type} 
      value={value} 
      onChange={(e) => onChange(Number(e.target.value))} 
      className="w-full px-5 py-3.5 bg-black border border-zinc-800 rounded-xl focus:border-[#BF953F] outline-none text-zinc-200 font-bold text-sm" 
    />
  </div>
);

export default LoanRegistration;
