import React, { useState } from 'react';
import { 
  Save, 
  ShieldCheck, 
  Calendar, 
  FileText, 
  ChevronDown, 
  ChevronUp,
  Info,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase'; 
import { Customer, Loan, Frequency, InterestType, Installment } from '../types';
import { generateContractPDF } from '../utils/contractGenerator';

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
  const [isSuccess, setIsSuccess] = useState(false);
  const [lastCreatedLoan, setLastCreatedLoan] = useState<{customer: Customer, loan: Loan} | null>(null);
  
  // Simulação simplificada (Certifique-se de ter sua lógica de cálculo aqui)
  const [simulation, setSimulation] = useState<any>(null);

  const handleSave = async () => {
    if (!selectedCustomerId || !simulation || !startDate) {
      alert("Preencha todos os campos e realize a simulação.");
      return;
    }

    const customer = customers.find(c => c.id === selectedCustomerId);
    if (!customer) return;

    // Gerar parcelas
    const installments: Installment[] = simulation.schedule.map((s: any, idx: number) => ({
      id: Math.random().toString(36).substr(2, 9),
      number: idx + 1,
      dueDate: s.date,
      value: s.value,
      status: 'PENDENTE'
    }));

    const contractDate = new Date(startDate + 'T12:00:00');
    const createdAtTimestamp = contractDate.getTime();

    // Objeto do Novo Empréstimo
    const newLoan: Loan = {
      id: Math.random().toString(36).substr(2, 9),
      contractNumber: simulation.contractNumber,
      customerId: customer.id, // Vinculação com o cliente
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

    try {
      // 1. REGISTRA A SAÍDA NO CAIXA (Coleção cashMovement)
      await addDoc(collection(db, "cashMovement"), {
        type: 'RETIRADA',
        amount: -Math.abs(amount),
        description: `Empréstimo: ${customer.name} (Contrato #${simulation.contractNumber})`,
        date: serverTimestamp(),
        loanId: newLoan.id
      });

      // 2. GERA O PDF PARA O CLIENTE
      generateContractPDF(customer, newLoan);

      // 3. ENVIA PARA O PAI (App.tsx) SALVAR NA COLEÇÃO 'loans'
      onSaveLoan(newLoan);
      
      setLastCreatedLoan({ customer, loan: newLoan });
      setIsSuccess(true);

      // Resetar formulário após sucesso (opcional)
      setTimeout(() => setIsSuccess(false), 5000);

    } catch (error) {
      console.error("Erro ao processar empréstimo:", error);
      alert("Erro técnico ao registrar. Verifique sua conexão.");
    }
  };

  return (
    <div className="p-6 bg-[#0a0a0a] border border-zinc-800 rounded-3xl">
      <h2 className="text-xl font-black text-white uppercase mb-6 flex items-center gap-2">
        <FileText className="text-[#BF953F]" /> Registro de Contrato
      </h2>

      {/* Interface do Formulário aqui... */}
      <div className="space-y-4">
         {/* Seus inputs de seleção de cliente, valor, etc */}
         
         <button 
           onClick={handleSave}
           className="w-full py-4 gold-gradient text-black font-black rounded-2xl uppercase tracking-tighter hover:scale-[1.02] transition-transform"
         >
           Efetivar Empréstimo e Gerar Contrato
         </button>
      </div>

      {isSuccess && (
        <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl flex items-center gap-3 text-emerald-500 text-sm font-bold">
          <CheckCircle2 size={18} /> Contrato registrado e salvo na base de dados!
        </div>
      )}
    </div>
  );
};

export default LoanRegistration;