
import React, { useState, useEffect, useRef } from 'react';
import { 
  Calculator, 
  MessageCircle, 
  FileText, 
  Users, 
  Eye, 
  Settings2,
  Calendar,
  ChevronRight,
  Share2
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import { toPng } from 'html-to-image';
import { Frequency, InterestType, Customer } from '../types';

interface SimulationTabProps {
  customers?: Customer[];
}

const SimulationTab: React.FC<SimulationTabProps> = ({ customers = [] }) => {
  const proposalRef = useRef<HTMLDivElement>(null);
  const [activeSubTab, setActiveSubTab] = useState<'CONFIG' | 'PROPOSAL'>('CONFIG');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [amount, setAmount] = useState<number>(5000);
  const [interestRate, setInterestRate] = useState<number>(10);
  const [installments, setInstallments] = useState<number>(12);
  const [frequency, setFrequency] = useState<Frequency>('MENSAL');
  const [interestType, setInterestType] = useState<InterestType>('SIMPLES');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);

  const [simulation, setSimulation] = useState<{
    totalToReturn: number;
    installmentValue: number;
    totalInterest: number;
    schedule: { date: string; value: number; balance: number }[];
  } | null>(null);

  useEffect(() => {
    if (selectedCustomerId) {
      const customer = customers.find(c => c.id === selectedCustomerId);
      if (customer) {
        setClientName(customer.name);
        setClientPhone(customer.phone);
      }
    }
  }, [selectedCustomerId, customers]);

  const calculate = () => {
    const rateDecimal = interestRate / 100;
    let totalToReturn = 0;
    let installmentValue = 0;
    const schedule = [];

    if (interestType === 'SIMPLES') {
      totalToReturn = amount * (1 + rateDecimal);
      installmentValue = totalToReturn / installments;
    } else {
      const rate = rateDecimal;
      if (rate === 0) {
        totalToReturn = amount;
        installmentValue = amount / installments;
      } else {
        const factor = Math.pow(1 + rate, installments);
        installmentValue = amount * (rate * factor) / (factor - 1);
        totalToReturn = installmentValue * installments;
      }
    }

    let runningBalance = totalToReturn;
    let currentDate = new Date(startDate + 'T12:00:00');

    for (let i = 1; i <= installments; i++) {
      if (frequency === 'DIARIO') currentDate.setDate(currentDate.getDate() + 1);
      else if (frequency === 'SEMANAL') currentDate.setDate(currentDate.getDate() + 7);
      else if (frequency === 'MENSAL') currentDate.setMonth(currentDate.getMonth() + 1);

      runningBalance -= installmentValue;
      schedule.push({
        date: currentDate.toISOString().split('T')[0],
        value: installmentValue,
        balance: Math.max(0, runningBalance)
      });
    }

    setSimulation({
      totalToReturn,
      installmentValue,
      totalInterest: totalToReturn - amount,
      schedule
    });
  };

  useEffect(() => {
    calculate();
  }, [amount, interestRate, installments, frequency, interestType, startDate]);

  const handleSendWhatsApp = () => {
    if (!simulation) return;
    const phoneDigits = clientPhone.replace(/\D/g, '');
    const finalPhone = phoneDigits.length <= 11 ? `55${phoneDigits}` : phoneDigits;
    
    const message = `*GR SULUTION - PROPOSTA DE CRÉDITO*%0A_ajudando voce e sua familia_%0A%0A` +
      `Olá *${clientName || 'Cliente'}*, segue o resumo da sua simulação:%0A%0A` +
      `💰 *Total:* ${amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}%0A` +
      `📅 *Parcelas:* ${installments}x de ${simulation.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}%0A%0A` +
      `✅ *TOTAL A PAGAR:* *${simulation.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}*%0A%0A` +
      `_Aguardamos o seu retorno para formalização._`;

    window.open(`https://api.whatsapp.com/send?phone=${finalPhone}&text=${message}`, '_blank');
  };

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  const handleExportAndSendWhatsApp = async () => {
    if (!proposalRef.current || isGeneratingPDF) return;
    
    // Primeiro gera o PDF
    await handleExportPDF();
    
    // Depois abre o WhatsApp
    handleSendWhatsApp();
  };

  const handleExportPDF = async () => {
    if (!proposalRef.current || isGeneratingPDF) return;
    
    setIsGeneratingPDF(true);
    
    // Se não estiver na aba de proposta, muda para ela primeiro
    if (activeSubTab !== 'PROPOSAL') {
      setActiveSubTab('PROPOSAL');
      // Delay maior para garantir renderização completa
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    try {
      const element = proposalRef.current;
      
      // Forçar scroll para o topo do elemento para evitar cortes
      element.scrollTop = 0;

      const dataUrl = await toPng(element, { 
        quality: 1, 
        backgroundColor: '#ffffff',
        skipFonts: true,
        cacheBust: true,
        pixelRatio: 2,
        width: element.scrollWidth,
        height: element.scrollHeight,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top left'
        }
      });
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(dataUrl);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(dataUrl, 'PNG', 0, 0, pdfWidth, pdfHeight, undefined, 'FAST');
      pdf.save(`proposta-gr-solution-${clientName.trim() || 'cliente'}.pdf`);
    } catch (err) {
      console.error('Erro ao exportar PDF:', err);
      alert('Erro ao gerar PDF. Verifique se há imagens bloqueadas ou tente novamente.');
    } finally {
      setIsGeneratingPDF(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6 lg:space-y-8 pb-10">
      <style>
        {`
          @media print {
            body { background: white !important; color: black !important; padding: 0 !important; margin: 0 !important; }
            .no-print { display: none !important; }
            main { overflow: visible !important; height: auto !important; padding: 0 !important; }
            .print-area { width: 100% !important; margin: 0 !important; padding: 20px !important; box-shadow: none !important; border: none !important; }
            .proposal-card { box-shadow: none !important; border: none !important; width: 100% !important; padding: 40px !important; }
          }
          /* Remove a seta nativa do seletor de data em alguns navegadores para usar o ícone customizado */
          input[type="date"]::-webkit-calendar-picker-indicator {
            background: transparent;
            bottom: 0;
            color: transparent;
            cursor: pointer;
            height: auto;
            left: 0;
            position: absolute;
            right: 0;
            top: 0;
            width: auto;
          }
        `}
      </style>

      {/* Seletor Minimalista */}
      <div className="flex justify-center no-print">
        <div className="bg-zinc-900/40 backdrop-blur-md p-1 rounded-2xl border border-zinc-800/50 flex w-full max-w-[280px]">
          <button 
            onClick={() => setActiveSubTab('CONFIG')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'CONFIG' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            <Settings2 size={13} /> Parâmetros
          </button>
          <button 
            onClick={() => setActiveSubTab('PROPOSAL')}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest transition-all ${activeSubTab === 'PROPOSAL' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-600 hover:text-zinc-400'}`}
          >
            <Eye size={13} /> Documento
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {activeSubTab === 'CONFIG' && (
          <div className="lg:col-span-5 space-y-6 no-print animate-in slide-in-from-bottom lg:slide-in-from-left duration-500">
            <div className="bg-[#080808] p-6 lg:p-8 rounded-[2rem] border border-zinc-900 shadow-2xl">
              <div className="flex items-center gap-3 mb-8">
                <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Calculator size={16} className="text-[#BF953F]" />
                </div>
                <h2 className="text-xs font-black text-zinc-300 uppercase tracking-[0.2em]">Simulação Estruturada</h2>
              </div>
              
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">Perfil do Solicitante</label>
                  <select 
                    value={selectedCustomerId}
                    onChange={(e) => setSelectedCustomerId(e.target.value)}
                    className="w-full px-4 py-3.5 bg-black border border-zinc-900 rounded-xl text-zinc-400 text-[11px] font-bold focus:border-[#BF953F]/50 outline-none transition-all"
                  >
                    <option value="">Entrada de Dados Manual</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <InputField label="Nome Proponente" placeholder="Nome Completo" value={clientName} onChange={setClientName} />
                  <InputField label="Canal WhatsApp" placeholder="DDD + Número" value={clientPhone} onChange={setClientPhone} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <SimInput label="Principal (R$)" value={amount} onChange={setAmount} />
                  <SimInput label="Tx Mensal (%)" value={interestRate} onChange={setInterestRate} />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <SimInput label="Ciclos" value={installments} onChange={setInstallments} />
                  <div className="space-y-2">
                    <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">Frequência</label>
                    <select 
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as Frequency)}
                      className="w-full px-4 py-3.5 bg-black border border-zinc-900 rounded-xl text-zinc-400 text-[11px] font-bold focus:border-[#BF953F]/50 outline-none"
                    >
                      <option value="DIARIO">Diário</option>
                      <option value="SEMANAL">Semanal</option>
                      <option value="MENSAL">Mensal</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">Data Efetiva</label>
                    <div className="relative group/date">
                      <input 
                        type="date" 
                        value={startDate} 
                        onChange={(e) => setStartDate(e.target.value)} 
                        onClick={(e) => (e.target as any).showPicker?.()}
                        className="w-full px-4 py-3.5 bg-black border border-zinc-900 rounded-xl text-zinc-400 text-[11px] font-bold focus:border-[#BF953F]/50 outline-none transition-all cursor-pointer block" 
                      />
                      <Calendar size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-700 pointer-events-none group-hover/date:text-[#BF953F]/50 transition-colors" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1 text-center">Regime</label>
                    <div className="flex gap-1 p-1 bg-black border border-zinc-900 rounded-xl">
                      <button onClick={() => setInterestType('SIMPLES')} className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all ${interestType === 'SIMPLES' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-700 hover:text-zinc-500'}`}>Simples</button>
                      <button onClick={() => setInterestType('PRICE')} className={`flex-1 py-2 rounded-lg text-[8px] font-black uppercase transition-all ${interestType === 'PRICE' ? 'bg-zinc-800 text-zinc-200' : 'text-zinc-700 hover:text-zinc-500'}`}>Price</button>
                    </div>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => setActiveSubTab('PROPOSAL')}
                className="w-full mt-10 py-4 bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-800/50 text-zinc-500 hover:text-zinc-200 font-black text-[9px] rounded-2xl uppercase tracking-[0.3em] transition-all flex items-center justify-center gap-3 active:scale-95"
              >
                VISUALIZAR DOCUMENTO <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}

        <div className={`${activeSubTab === 'PROPOSAL' ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-6 transition-all duration-500`}>
          
          {/* Barra de Ações Ultra Discreta (Apenas Ícones) */}
          <div className="no-print flex items-center justify-between gap-4 px-4 py-2.5 bg-zinc-900/10 rounded-2xl border border-zinc-900/30">
            <div className="flex items-center gap-2">
              <Share2 size={12} className="text-zinc-700" />
              <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest">Ações</span>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={handleExportAndSendWhatsApp}
                disabled={isGeneratingPDF}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/5 text-[#BF953F] hover:bg-[#BF953F] hover:text-black transition-all active:scale-95 ${isGeneratingPDF ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isGeneratingPDF ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Share2 size={14} />
                )}
                <span className="text-[9px] font-black uppercase tracking-widest">Gerar e Enviar</span>
              </button>

              <div className="w-px h-6 bg-zinc-900/50 mx-1"></div>

              <button 
                onClick={handleSendWhatsApp}
                title="Compartilhar via WhatsApp"
                className="w-10 h-10 flex items-center justify-center rounded-xl border border-zinc-800 hover:border-emerald-500/50 hover:bg-emerald-500/5 text-zinc-600 hover:text-emerald-500 transition-all active:scale-90"
              >
                <MessageCircle size={18} />
              </button>
              
              <button 
                onClick={handleExportPDF}
                disabled={isGeneratingPDF}
                title="Gerar Proposta em PDF"
                className={`w-10 h-10 flex items-center justify-center rounded-xl border border-zinc-800 transition-all active:scale-90 ${isGeneratingPDF ? 'opacity-50 cursor-not-allowed' : 'hover:border-[#BF953F]/50 hover:bg-[#BF953F]/5 text-zinc-600 hover:text-[#BF953F]'}`}
              >
                {isGeneratingPDF ? (
                  <div className="w-4 h-4 border-2 border-[#BF953F] border-t-transparent rounded-full animate-spin" />
                ) : (
                  <FileText size={18} />
                )}
              </button>
            </div>
          </div>

          <div ref={proposalRef} className="print-area bg-white rounded-[2rem] overflow-hidden shadow-2xl transition-all border border-zinc-900/10">
             <div className="proposal-card bg-white p-8 lg:p-20 text-black font-sans min-h-[1000px] flex flex-col text-left">
                
                {/* Header Documento */}
                <div className="flex justify-between items-start border-b border-gray-100 pb-10 mb-12">
                   <div className="flex items-center gap-4 lg:gap-8">
                      <div>
                         <h1 className="text-2xl lg:text-4xl font-black tracking-tighter mb-1">GR SULUTION</h1>
                         <p className="text-[7px] lg:text-[9px] uppercase tracking-[0.4em] font-black text-gray-400">Wealth & Asset Management</p>
                      </div>
                   </div>
                   <div className="text-right shrink-0">
                      <p className="text-[8px] lg:text-[10px] font-black uppercase text-[#BF953F] tracking-widest mb-1">Protocolo de Emissão</p>
                      <p className="text-xs lg:text-sm font-bold text-gray-800">{new Date().toLocaleDateString('pt-BR')}</p>
                      <p className="text-[9px] font-mono text-gray-300 mt-1 uppercase">#{Math.random().toString(36).substr(2, 6).toUpperCase()}</p>
                   </div>
                </div>

                {/* Seção Cliente */}
                <div className="mb-12">
                   <div className="flex items-center gap-3 mb-4">
                      <div className="w-1.5 h-4 bg-[#BF953F] rounded-full"></div>
                      <p className="text-[10px] lg:text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Titular da Proposta</p>
                   </div>
                   <div className="bg-gray-50/50 border border-gray-100 rounded-2xl p-6 lg:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                         <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Nome do Beneficiário</p>
                         <p className="text-base font-bold uppercase text-gray-800">{clientName || 'SOLICITANTE NÃO IDENTIFICADO'}</p>
                      </div>
                      <div>
                         <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest mb-1">Meio de Contato</p>
                         <p className="text-base font-bold text-gray-800">{clientPhone || 'NÃO FORNECIDO'}</p>
                      </div>
                   </div>
                </div>

                {/* Quadro Financeiro */}
                <div className="mb-12">
                   <div className="flex items-center gap-3 mb-6">
                      <div className="w-1.5 h-4 bg-[#BF953F] rounded-full"></div>
                      <p className="text-[10px] lg:text-[11px] font-black text-gray-900 uppercase tracking-[0.2em]">Condições Estruturadas</p>
                   </div>
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="bg-gray-900 rounded-3xl p-8 flex flex-col justify-center shadow-xl">
                         <p className="text-[9px] font-black text-[#BF953F] uppercase tracking-[0.2em] mb-2">Comprometimento Mensal</p>
                         <p className="text-3xl lg:text-5xl font-black text-white tracking-tighter">
                           {simulation?.installmentValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                         </p>
                         <p className="text-[10px] font-bold text-zinc-500 uppercase mt-2 tracking-tighter">Fixas por {installments} Ciclos ({frequency})</p>
                      </div>
                      <div className="grid grid-cols-1 gap-4">
                         <div className="bg-gray-50 border border-gray-100 rounded-2xl p-6">
                            <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">Capital Liberado</p>
                            <p className="text-xl font-black text-gray-800">{amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                         </div>
                         <div className="bg-emerald-50/30 border border-emerald-100 rounded-2xl p-6">
                            <p className="text-[8px] font-black text-emerald-600/60 uppercase tracking-widest">Total Líquido Estimado</p>
                            <p className="text-xl font-black text-emerald-600">{simulation?.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                         </div>
                      </div>
                   </div>
                </div>

                {/* Tabela */}
                <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden mb-12">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[400px]">
                      <thead className="bg-gray-50 text-gray-400 text-[9px] font-black uppercase tracking-widest">
                        <tr>
                          <th className="px-8 py-5">Ciclo Ref.</th>
                          <th className="px-8 py-5">Previsão Vencimento</th>
                          <th className="px-8 py-5 text-right">Valor do Recurso</th>
                        </tr>
                      </thead>
                      <tbody className="text-[11px] lg:text-xs">
                        {simulation?.schedule.slice(0, 15).map((s, i) => (
                          <tr key={i} className="border-b border-gray-50">
                            <td className="px-8 py-4 font-bold text-gray-300"># {String(i+1).padStart(2, '0')}</td>
                            <td className="px-8 py-4 font-black text-gray-700">{s.date.split('-').reverse().join('/')}</td>
                            <td className="px-8 py-4 text-right font-black text-gray-900">{s.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Footer Documento */}
                <div className="mt-auto pt-20 grid grid-cols-2 gap-20">
                   <div className="text-center">
                      <div className="h-px bg-gray-200 mb-4"></div>
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.2em]">Chancela GR SULUTION</p>
                   </div>
                   <div className="text-center">
                      <div className="h-px bg-gray-200 mb-4"></div>
                      <p className="text-[8px] font-black text-gray-400 uppercase tracking-[0.2em]">Assinatura do Beneficiário</p>
                   </div>
                </div>
                
                <div className="mt-16 text-center space-y-2">
                   <p className="text-[8px] text-gray-300 font-black uppercase tracking-[0.5em]">AJUDANDO VOCE E SUA FAMILIA</p>
                   <p className="text-[7px] text-gray-200 font-medium">Este documento é uma simulação de crédito e não garante a aprovação imediata do recurso.</p>
                </div>
             </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const InputField: React.FC<{ label: string; placeholder: string; value: string; onChange: (v: string) => void }> = ({ label, placeholder, value, onChange }) => (
  <div className="space-y-2 text-left">
    <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">{label}</label>
    <input 
      type="text" 
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-4 py-3 bg-black border border-zinc-900 rounded-xl focus:border-[#BF953F]/50 outline-none text-zinc-300 text-[11px] font-medium transition-all"
    />
  </div>
);

const SimInput: React.FC<{ label: string; value: number; onChange: (v: number) => void }> = ({ label, value, onChange }) => (
  <div className="space-y-2 text-left">
    <label className="block text-[8px] font-black text-zinc-600 uppercase tracking-widest ml-1">{label}</label>
    <input 
      type="number" 
      value={value} 
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full px-4 py-3 bg-black border border-zinc-900 rounded-xl text-zinc-300 focus:border-[#BF953F]/50 outline-none font-bold text-[11px] transition-all"
    />
  </div>
);

export default SimulationTab;
