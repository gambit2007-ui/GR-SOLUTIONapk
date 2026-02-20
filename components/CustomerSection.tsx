
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Search, 
  UserPlus, 
  Mail, 
  Phone, 
  MapPin, 
  CreditCard as IdCard, 
  Users, 
  FileUp, 
  FileText, 
  XCircle, 
  Edit3, 
  Trash2, 
  Eye, 
  ArrowLeft,
  Briefcase,
  TrendingUp,
  CheckCircle,
  Calendar,
  ChevronDown,
  ChevronUp,
  Clock,
  AlertTriangle,
  Camera,
  User as UserIcon,
  MessageSquare,
  FileImage,
  Maximize2,
  Download
} from 'lucide-react';
import { Customer, CustomerDocument, Loan, PaymentStatus } from '../types';
import { validateCPF } from '../src/utils/validation';

interface CustomerSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
}

const CustomerSection: React.FC<CustomerSectionProps> = ({ 
  customers, 
  loans,
  onAddCustomer, 
  onUpdateCustomer, 
  onDeleteCustomer 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [previewDoc, setPreviewDoc] = useState<CustomerDocument | null>(null);
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [cpfValid, setCpfValid] = useState<boolean | null>(null);
  
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 400);

    return () => {
      clearTimeout(handler);
    };
  }, [searchInput]);

  const getTodayStr = () => new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    name: '', 
    cpf: '', 
    rg: '', 
    email: '', 
    phone: '', 
    address: '',
    notes: '',
    createdAt: getTodayStr(),
    avatar: ''
  });
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.cpf.includes(searchTerm)
  );

  const getCustomerLoans = (customerId: string) => {
    return loans.filter(l => l.customerId === customerId).reverse();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'cpf' || name === 'phone') {
      const numericValue = value.replace(/\D/g, ''); 
      if (numericValue.length <= 11) {
        setFormData(prev => ({ ...prev, [name]: numericValue }));
        
        if (name === 'cpf') {
          if (numericValue.length === 11) {
            setCpfValid(validateCPF(numericValue));
          } else if (numericValue.length === 0) {
            setCpfValid(null);
          } else {
            setCpfValid(false);
          }
        }
      }
      return;
    }
    
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const startEdit = (c: Customer) => {
    let dateStr = getTodayStr();
    try {
      const d = new Date(c.createdAt);
      if (!isNaN(d.getTime())) {
        dateStr = d.toISOString().split('T')[0];
      }
    } catch (e) {
      console.warn("Data de cadastro inválida detectada no cliente:", c.id);
    }

    setEditingCustomer(c);
    setCpfValid(validateCPF(c.cpf));
    setFormData({
      name: c.name,
      cpf: c.cpf,
      rg: c.rg,
      email: c.email,
      phone: c.phone,
      address: c.address,
      notes: c.notes || '',
      createdAt: dateStr,
      avatar: c.avatar || ''
    });
    setDocuments(c.documents || []);
    setIsAdding(true);
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setFormData(prev => ({ ...prev, avatar: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        setDocuments(prev => [...prev, {
          name: file.name,
          type: file.type,
          data: reader.result as string
        }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeDocument = (index: number) => {
    setDocuments(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateCPF(formData.cpf)) {
      alert("Por favor, insira um CPF válido.");
      return;
    }
    
    let selectedDate = new Date();
    if (formData.createdAt) {
      const parsed = new Date(formData.createdAt + 'T12:00:00');
      if (!isNaN(parsed.getTime())) {
        selectedDate = parsed;
      }
    }
    
    const finalData = {
      ...formData,
      createdAt: selectedDate.getTime()
    };

    if (editingCustomer) {
      onUpdateCustomer({
        ...editingCustomer,
        ...finalData,
        documents: documents
      });
    } else {
      const newCustomer: Customer = {
        ...finalData,
        id: Math.random().toString(36).substr(2, 9),
        documents: documents
      };
      onAddCustomer(newCustomer);
    }
    closeForm();
  };

  const closeForm = () => {
    setIsAdding(false);
    setEditingCustomer(null);
    setCpfValid(null);
    setFormData({ 
      name: '', 
      cpf: '', 
      rg: '', 
      email: '', 
      phone: '', 
      address: '',
      notes: '',
      createdAt: getTodayStr(),
      avatar: ''
    });
    setDocuments([]);
  };

  const formatDate = (timestamp: number) => {
    const d = new Date(timestamp);
    return isNaN(d.getTime()) ? "Data inválida" : d.toLocaleDateString('pt-BR');
  };

  const getInstStatus = (dueDate: string, currentStatus: PaymentStatus) => {
    if (currentStatus === 'PAGO') return 'PAGO';
    const today = new Date().toISOString().split('T')[0];
    if (dueDate < today) return 'ATRASADO';
    return 'PENDENTE';
  };

  const calculateCustomerScore = (customerId: string) => {
    const customerLoans = loans.filter(l => l.customerId === customerId);
    if (customerLoans.length === 0) return 500; // Pontuação inicial neutra

    let score = 500;
    let totalBorrowed = 0;
    let totalInstallments = 0;
    let paidOnTime = 0;
    let paidWithDelay = 0;
    let currentlyOverdue = 0;

    customerLoans.forEach(loan => {
      totalBorrowed += loan.amount;
      loan.installments.forEach(inst => {
        totalInstallments++;
        const status = getInstStatus(inst.dueDate, inst.status);
        
        if (inst.status === 'PAGO') {
          // Verifica se pagou após o vencimento
          const paidDate = inst.paidAt ? new Date(inst.paidAt).toISOString().split('T')[0] : '';
          if (paidDate && paidDate > inst.dueDate) {
            paidWithDelay++;
            score += 2; // Pequeno ganho por pagar mesmo com atraso
          } else {
            paidOnTime++;
            score += 15; // Ganho significativo por pontualidade
          }
        } else if (status === 'ATRASADO') {
          currentlyOverdue++;
          score -= 40; // Penalidade forte por atraso ativo
        }
      });
    });

    // Bônus por volume de crédito movimentado (1 ponto a cada R$ 2000)
    score += Math.floor(totalBorrowed / 2000);

    // Limites do Score
    return Math.max(0, Math.min(1000, score));
  };

  const getScoreColor = (score: number) => {
    if (score >= 800) return 'text-emerald-500';
    if (score >= 600) return 'text-blue-400';
    if (score >= 400) return 'text-[#BF953F]';
    return 'text-red-500';
  };

  const getScoreLabel = (score: number) => {
    if (score >= 800) return 'Excelente';
    if (score >= 600) return 'Bom';
    if (score >= 400) return 'Regular';
    return 'Crítico';
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <FileImage size={24} className="text-emerald-500" />;
    if (type.includes('pdf')) return <FileText size={24} className="text-red-500" />;
    return <FileText size={24} className="text-[#BF953F]" />;
  };

  if (viewingCustomer) {
    const customerLoans = getCustomerLoans(viewingCustomer.id);
    const hasAnyOverdue = customerLoans.some(loan => 
      loan.installments.some(inst => getInstStatus(inst.dueDate, inst.status) === 'ATRASADO')
    );
    const totalInstallments = customerLoans.reduce((acc, curr) => acc + curr.installmentCount, 0);
    const paidInstallments = customerLoans.reduce((acc, curr) => acc + curr.installments.filter(i => i.status === 'PAGO').length, 0);
    const punctualityRate = totalInstallments > 0 ? (paidInstallments / totalInstallments * 100).toFixed(0) : '0';
    const creditScore = calculateCustomerScore(viewingCustomer.id);

    return (
      <div className="space-y-8 animate-in fade-in zoom-in-95 duration-300">
        <button 
          onClick={() => {
            setViewingCustomer(null);
            setExpandedLoanId(null);
          }}
          className="flex items-center gap-2 text-zinc-500 hover:text-[#BF953F] transition-colors font-bold uppercase text-[10px] tracking-widest"
        >
          <ArrowLeft size={16} /> Voltar para lista
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 bg-[#0a0a0a] p-10 rounded-[3rem] border border-zinc-800 shadow-2xl h-fit">
            <div className="flex flex-col items-center text-center mb-10">
              <div className="w-32 h-32 gold-gradient rounded-3xl flex items-center justify-center overflow-hidden border-2 border-[#BF953F]/30 shadow-2xl mb-6 relative group">
                {viewingCustomer.avatar ? (
                  <img src={viewingCustomer.avatar} alt={viewingCustomer.name} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-black font-black text-5xl">
                    {viewingCustomer.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <h2 className="text-2xl font-black text-white mb-2">{viewingCustomer.name}</h2>
              <div className="flex items-center justify-center gap-3 mb-2">
                <p className="text-[#BF953F] font-mono text-[10px] uppercase tracking-widest">ID #{viewingCustomer.id}</p>
                <span className="w-1 h-1 bg-zinc-800 rounded-full"></span>
                <div className="flex items-center gap-1.5">
                  <TrendingUp size={12} className={getScoreColor(creditScore)} />
                  <span className={`text-[10px] font-black uppercase tracking-widest ${getScoreColor(creditScore)}`}>
                    Score: {creditScore}
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-6 pt-6 border-t border-zinc-900">
               <DetailItem label="CPF" value={viewingCustomer.cpf} />
               <DetailItem label="RG" value={viewingCustomer.rg} />
               <DetailItem label="WhatsApp" value={viewingCustomer.phone} />
               <DetailItem label="E-mail" value={viewingCustomer.email} />
               <DetailItem label="Endereço" value={viewingCustomer.address} />
               <DetailItem label="Data de Cadastro" value={formatDate(viewingCustomer.createdAt)} />
               {viewingCustomer.notes && (
                 <div className="pt-4 mt-4 border-t border-zinc-900/50">
                   <p className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                     <MessageSquare size={12} className="text-[#BF953F]" /> Observações Internas
                   </p>
                   <p className="text-[11px] text-zinc-400 leading-relaxed font-medium italic">"{viewingCustomer.notes}"</p>
                 </div>
               )}
            </div>

            <div className="mt-10 pt-10 border-t border-zinc-900">
              <h3 className="text-[10px] font-black gold-text uppercase tracking-widest mb-6">Documentos</h3>
              {viewingCustomer.documents && viewingCustomer.documents.length > 0 ? (
                <div className="grid grid-cols-2 gap-3">
                  {viewingCustomer.documents.map((doc, idx) => (
                    <div key={idx} className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center gap-3 group relative overflow-hidden transition-all hover:border-[#BF953F]/50">
                      <div className="p-3 bg-black rounded-xl border border-zinc-800">
                        {getFileIcon(doc.type)}
                      </div>
                      <span className="text-[9px] text-zinc-400 font-bold truncate w-full text-center px-1">{doc.name}</span>
                      
                      <div className="flex gap-2 mt-1">
                        <button 
                          onClick={() => setPreviewDoc(doc)}
                          className="p-1.5 bg-zinc-800 text-zinc-400 hover:text-[#BF953F] rounded-lg transition-colors"
                          title="Visualizar"
                        >
                          <Maximize2 size={12} />
                        </button>
                        <a 
                          href={doc.data} 
                          download={doc.name} 
                          className="p-1.5 bg-zinc-800 text-zinc-400 hover:text-emerald-500 rounded-lg transition-colors"
                          title="Baixar"
                        >
                          <Download size={12} />
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-zinc-700 text-[10px] italic">Sem documentos.</p>
              )}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-8">
            <div className="bg-[#0a0a0a] p-10 rounded-[3rem] border border-zinc-800 shadow-2xl">
              <div className="flex justify-between items-center mb-10">
                 <div className="flex items-center gap-4">
                    <Briefcase className="text-[#BF953F]" size={22} />
                    <h3 className="text-sm font-black text-white uppercase tracking-widest">Histórico de Contratos</h3>
                 </div>
                 <span className="px-4 py-1.5 bg-zinc-900 border border-zinc-800 rounded-full text-[10px] font-black text-zinc-400 uppercase tracking-tighter">
                   {customerLoans.length} {customerLoans.length === 1 ? 'Contrato' : 'Contratos'}
                 </span>
              </div>

              {customerLoans.length > 0 ? (
                <div className="space-y-4">
                  {customerLoans.map(loan => {
                    const isExpanded = expandedLoanId === loan.id;
                    const paid = loan.installments.filter(i => i.status === 'PAGO').length;
                    const progress = (paid / loan.installmentCount) * 100;
                    
                    return (
                      <div key={loan.id} className="bg-zinc-950 rounded-2xl border border-zinc-900 overflow-hidden hover:border-zinc-700 transition-all group">
                         <div 
                           onClick={() => setExpandedLoanId(isExpanded ? null : loan.id)}
                           className="p-6 cursor-pointer flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:bg-zinc-900/40 transition-colors"
                         >
                            <div className="flex items-center gap-4">
                               <div className={`p-2 rounded-lg ${isExpanded ? 'gold-gradient text-black' : 'bg-black text-zinc-700'}`}>
                                 {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                               </div>
                               <div>
                                  <div className="flex items-center gap-3 mb-1">
                                     <span className="text-xs font-black text-zinc-100 uppercase tracking-tighter">CONTRATO #{loan.contractNumber}</span>
                                     {progress === 100 && <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-500 text-[8px] font-black rounded-full border border-emerald-500/20 uppercase">LIQUIDADO</span>}
                                  </div>
                                  <div className="flex items-center gap-4 text-[10px] text-zinc-600 font-bold uppercase">
                                     <span>{formatDate(loan.createdAt)}</span>
                                     <span className="w-1 h-1 bg-zinc-800 rounded-full"></span>
                                     <span>{loan.interestType}</span>
                                  </div>
                               </div>
                            </div>
                            <div className="text-right">
                               <p className="text-sm font-black gold-text">{loan.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                               <p className="text-[9px] text-zinc-700 font-black uppercase">Investimento</p>
                            </div>
                         </div>
                         
                         {isExpanded && (
                           <div className="px-6 pb-6 pt-2 border-t border-zinc-900 bg-black/40 animate-in slide-in-from-top-2">
                             <div className="mb-6 flex items-center justify-between">
                                <div className="flex-1 max-w-xs">
                                   <div className="flex justify-between text-[8px] font-black text-zinc-600 uppercase mb-2">
                                      <span>Amortização</span>
                                      <span>{paid} / {loan.installmentCount} PAGAS</span>
                                   </div>
                                   <div className="h-1.5 w-full bg-black rounded-full overflow-hidden border border-zinc-900">
                                      <div className="h-full gold-gradient" style={{ width: `${progress}%` }} />
                                   </div>
                                </div>
                                <div className="text-right">
                                   <p className="text-[9px] font-black text-zinc-700 uppercase">Total de Retorno</p>
                                   <p className="text-xs font-black text-zinc-300">{loan.totalToReturn.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                </div>
                             </div>

                             <div className="overflow-x-auto rounded-xl border border-zinc-900">
                                <table className="w-full text-left text-[10px]">
                                   <thead className="bg-zinc-900 text-zinc-500 font-black uppercase">
                                      <tr>
                                         <th className="px-4 py-3">Nº</th>
                                         <th className="px-4 py-3">Vencimento</th>
                                         <th className="px-4 py-3 text-right">Valor</th>
                                         <th className="px-4 py-3 text-center">Status</th>
                                      </tr>
                                   </thead>
                                   <tbody className="divide-y divide-zinc-900">
                                      {loan.installments.map(inst => {
                                         const status = getInstStatus(inst.dueDate, inst.status);
                                         return (
                                            <tr key={inst.id} className="hover:bg-zinc-800/30 transition-colors">
                                               <td className="px-4 py-3 font-mono text-zinc-600">#{String(inst.number).padStart(2, '0')}</td>
                                               <td className="px-4 py-3 font-bold text-zinc-400">{inst.dueDate.split('-').reverse().join('/')}</td>
                                               <td className="px-4 py-3 text-right font-black text-zinc-300">{inst.value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
                                               <td className="px-4 py-3">
                                                  <div className="flex justify-center">
                                                     {status === 'PAGO' ? (
                                                        <span className="flex items-center gap-1 text-emerald-500 font-black uppercase text-[8px]"><CheckCircle size={10} /> Pago</span>
                                                     ) : status === 'ATRASADO' ? (
                                                        <span className="flex items-center gap-1 text-red-500 font-black uppercase text-[8px] animate-pulse"><AlertTriangle size={10} /> Atrasado</span>
                                                     ) : (
                                                        <span className="flex items-center gap-1 text-zinc-600 font-black uppercase text-[8px]"><Clock size={10} /> Pendente</span>
                                                     )}
                                                  </div>
                                               </td>
                                            </tr>
                                         );
                                      })}
                                   </tbody>
                                </table>
                             </div>
                           </div>
                         )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-20 text-center">
                   <Briefcase size={40} className="text-zinc-900 mx-auto mb-4" />
                   <p className="text-zinc-600 font-bold uppercase text-[10px] tracking-widest italic">Este cliente não possui contratos registrados.</p>
                </div>
              )}
            </div>

            <div className={`${hasAnyOverdue ? 'bg-red-500/10 border-red-500/20' : 'bg-emerald-500/5 border-emerald-500/10'} p-8 rounded-[2.5rem] border flex items-center gap-6 transition-all duration-500 shadow-lg`}>
                <div className={`p-4 rounded-2xl flex flex-col items-center justify-center min-w-[100px] ${hasAnyOverdue ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'}`}>
                   <span className="text-2xl font-black">{creditScore}</span>
                   <span className="text-[8px] font-black uppercase tracking-tighter opacity-70">Credit Score</span>
                </div>
                <div>
                   <h4 className={`text-xs font-black uppercase tracking-widest mb-1 ${hasAnyOverdue ? 'text-red-500' : 'text-emerald-500'}`}>
                     {hasAnyOverdue ? 'RESTRIÇÃO DE CRÉDITO DETECTADA' : `PERFIL ${getScoreLabel(creditScore).toUpperCase()}`}
                   </h4>
                   <p className="text-[11px] text-zinc-500 leading-relaxed font-bold">
                     {hasAnyOverdue ? (
                       <span className="text-red-500 font-black uppercase">
                         Atenção: Este cliente possui parcelas em aberto vencidas. Operação atualmente em status de inadimplência. Score impactado negativamente.
                       </span>
                     ) : (
                       <>
                         Baseado no histórico total de parcelas e volume de capital movimentado. O cliente apresenta uma taxa de adimplência de 
                         <span className="text-emerald-500 font-black ml-1">
                           {punctualityRate}%
                         </span>. {creditScore > 700 ? 'Excelente pagador, perfil de baixo risco.' : 'Perfil apto para operações controladas.'}
                       </>
                     )}
                   </p>
                </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-8">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
          <input
            type="text"
            placeholder="Buscar por nome ou CPF..."
            className="w-full pl-12 pr-4 py-3 bg-zinc-900 border border-zinc-800 rounded-full focus:border-[#BF953F] outline-none transition-all text-sm text-zinc-200"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <div className="flex gap-3 w-full md:w-auto">
          <button 
            onClick={() => {
              if (isAdding) closeForm();
              else setIsAdding(true);
            }}
            className={`flex-1 md:w-auto flex items-center justify-center gap-2 px-8 py-3 rounded-full text-xs font-bold uppercase tracking-widest transition-all ${
              isAdding ? 'bg-zinc-800 text-zinc-400' : 'gold-gradient text-black'
            }`}
          >
            {isAdding ? 'CANCELAR' : (
              <><UserPlus size={16} /> NOVO CADASTRO</>
            )}
          </button>
        </div>
      </div>

      {isAdding && (
        <div className="bg-[#0a0a0a] p-8 rounded-3xl border border-zinc-800 shadow-2xl animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-8">
            <h3 className="text-sm font-bold gold-text uppercase tracking-[0.3em]">
              {editingCustomer ? 'Editar Perfil do Cliente' : 'Cadastro de Novo Cliente'}
            </h3>
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="md:col-span-full flex justify-center mb-6">
               <div 
                 onClick={() => avatarInputRef.current?.click()}
                 className="relative w-32 h-32 rounded-3xl border-2 border-dashed border-zinc-800 bg-[#050505] flex items-center justify-center overflow-hidden cursor-pointer group hover:border-[#BF953F] transition-all"
               >
                 {formData.avatar ? (
                   <img src={formData.avatar} alt="Avatar Preview" className="w-full h-full object-cover group-hover:opacity-50 transition-opacity" />
                 ) : (
                   <div className="text-zinc-700 flex flex-col items-center">
                     <Camera size={32} />
                     <span className="text-[8px] font-black uppercase mt-2">Foto de Perfil</span>
                   </div>
                 )}
                 <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                    <Camera size={24} className="text-[#BF953F]" />
                 </div>
                 <input type="file" ref={avatarInputRef} onChange={handleAvatarChange} accept="image/*" className="hidden" />
               </div>
            </div>

            <InputField label="Nome Completo" name="name" value={formData.name} onChange={handleInputChange} required />
            <InputField 
              label="CPF (Apenas Números)" 
              name="cpf" 
              value={formData.cpf} 
              onChange={handleInputChange} 
              required 
              maxLength={11} 
              placeholder="Ex: 12345678901"
              isValid={cpfValid}
              helperText={cpfValid === false ? "CPF Inválido" : undefined}
            />
            <InputField label="RG" name="rg" value={formData.rg} onChange={handleInputChange} required />
            <InputField label="E-mail Corporativo" name="email" type="email" value={formData.email} onChange={handleInputChange} required />
            <InputField label="Telefone / WhatsApp (Apenas Números)" name="phone" value={formData.phone} onChange={handleInputChange} required maxLength={11} placeholder="Ex: 11999999999" />
            <InputField label="Endereço Residencial" name="address" value={formData.address} onChange={handleInputChange} required />
            
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 ml-1 flex justify-between items-center">
                 <span>Observações e Notas Extras</span>
              </label>
              <textarea 
                name="notes"
                value={formData.notes}
                onChange={handleInputChange}
                rows={3}
                placeholder="Detalhes adicionais..."
                className="w-full px-5 py-3.5 bg-[#050505] border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none transition-all text-sm text-zinc-200 placeholder:text-zinc-800 resize-none"
              ></textarea>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1 flex items-center gap-2">
                <Calendar size={12} className="text-[#BF953F]" /> Data de Cadastro Retroativa
              </label>
              <input
                type="date"
                name="createdAt"
                value={formData.createdAt}
                onChange={handleInputChange}
                className="w-full px-5 py-3.5 bg-[#050505] border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none transition-all text-sm text-zinc-200 cursor-pointer"
              />
            </div>

            <div className="md:col-span-2 lg:col-span-3">
              <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-3 ml-1">Documentos e Anexos</label>
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-8 border-2 border-dashed border-zinc-800 rounded-2xl flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#BF953F]/50 hover:bg-zinc-900/30 transition-all group"
              >
                <FileUp size={32} className="text-zinc-700 group-hover:text-[#BF953F]" />
                <p className="text-xs text-zinc-500 font-bold uppercase tracking-tighter">Clique para anexar arquivos</p>
                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" multiple />
              </div>

              {documents.length > 0 && (
                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {documents.map((doc, idx) => (
                    <div key={idx} className="relative p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col items-center gap-3 group">
                      <div className="p-2 bg-black rounded-lg border border-zinc-800">
                        {getFileIcon(doc.type)}
                      </div>
                      <span className="text-[9px] text-zinc-400 font-bold truncate w-full text-center px-1">{doc.name}</span>
                      <div className="flex gap-2">
                        <button 
                          type="button"
                          onClick={() => setPreviewDoc(doc)}
                          className="text-zinc-600 hover:text-[#BF953F] transition-colors"
                        >
                          <Maximize2 size={12} />
                        </button>
                      </div>
                      <button type="button" onClick={() => removeDocument(idx)} className="absolute -top-2 -right-2 text-zinc-600 hover:text-red-500 bg-black rounded-full shadow-lg p-0.5 border border-zinc-800">
                        <XCircle size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="md:col-span-2 lg:col-span-3 pt-6">
              <button type="submit" className="w-full gold-gradient text-black font-black py-4 rounded-2xl uppercase tracking-[0.2em] shadow-lg shadow-[#BF953F]/10">
                {editingCustomer ? 'ATUALIZAR DADOS' : 'EFETIVAR CADASTRO'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        {filteredCustomers.length > 0 ? (
          filteredCustomers.map(customer => {
            const customerLoans = getCustomerLoans(customer.id);
            const activeLoans = customerLoans.filter(l => l.installments.some(i => i.status === 'PENDENTE')).length;
            const customerOverdue = customerLoans.some(loan => loan.installments.some(inst => getInstStatus(inst.dueDate, inst.status) === 'ATRASADO'));
            const score = calculateCustomerScore(customer.id);

            return (
              <div key={customer.id} className={`bg-zinc-950 p-6 rounded-3xl border ${customerOverdue ? 'border-red-500/30' : 'border-zinc-800'} hover:border-[#BF953F]/40 transition-all group relative overflow-hidden flex flex-col shadow-lg`}>
                <div className="absolute top-0 right-0 flex">
                  <div className={`px-3 py-1.5 ${getScoreColor(score).replace('text-', 'bg-').replace('500', '500/20')} border-l border-b border-zinc-900 rounded-bl-xl flex items-center gap-2`}>
                    <TrendingUp size={10} className={getScoreColor(score)} />
                    <span className={`text-[9px] font-black uppercase tracking-tighter ${getScoreColor(score)}`}>{score}</span>
                  </div>
                  {customerOverdue && <div className="px-3 py-1.5 bg-red-500 text-white text-[8px] font-black uppercase tracking-widest rounded-bl-none shadow-lg">Inadimplente</div>}
                </div>
                <div className="flex items-start justify-between mb-6">
                  <div className="w-12 h-12 gold-gradient rounded-2xl flex items-center justify-center overflow-hidden text-black font-black text-xl shadow-lg relative border border-[#BF953F]/20">
                    {customer.avatar ? (
                      <img src={customer.avatar} alt={customer.name} className="w-full h-full object-cover" />
                    ) : (
                      customer.name.charAt(0).toUpperCase()
                    )}
                    {activeLoans > 0 && (
                      <span className={`absolute -top-1 -right-1 w-5 h-5 ${customerOverdue ? 'bg-red-500' : 'bg-black'} border border-[#BF953F]/50 rounded-full flex items-center justify-center text-[9px] font-black ${customerOverdue ? 'text-white' : 'text-[#BF953F]'} shadow-lg`}>
                        {activeLoans}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setViewingCustomer(customer)} className="p-2 bg-zinc-900 text-zinc-500 hover:text-blue-400 rounded-lg transition-colors border border-zinc-800" title="Ver Detalhes"><Eye size={14} /></button>
                    <button onClick={() => startEdit(customer)} className="p-2 bg-zinc-900 text-zinc-500 hover:text-[#BF953F] rounded-lg transition-colors border border-zinc-800" title="Editar"><Edit3 size={14} /></button>
                    <button onClick={() => onDeleteCustomer(customer.id)} className="p-2 bg-zinc-900 text-zinc-500 hover:text-red-400 rounded-lg transition-colors border border-zinc-800" title="Excluir"><Trash2 size={14} /></button>
                  </div>
                </div>
                
                <div className="mb-6">
                  <h4 className={`text-lg font-bold mb-1 transition-colors ${customerOverdue ? 'text-red-400' : 'text-zinc-100 group-hover:gold-text'}`}>{customer.name}</h4>
                  <p className="text-zinc-500 font-medium text-[11px] flex items-center gap-2">
                    <IdCard size={12} className="text-[#BF953F]" /> CPF {customer.cpf}
                  </p>
                </div>
                
                <div className="space-y-4 flex-1">
                  <div className="pt-4 border-t border-zinc-900">
                    <ContactInfo icon={<Mail size={14} />} text={customer.email} />
                    <ContactInfo icon={<Phone size={14} />} text={customer.phone} />
                  </div>
                  
                  <div className="pt-4 border-t border-zinc-900 flex justify-between items-end">
                     <div>
                       <p className="text-[8px] font-black text-zinc-700 uppercase mb-1">Cadastrado em</p>
                       <p className="text-[10px] font-bold text-zinc-400">{formatDate(customer.createdAt)}</p>
                     </div>
                     {customerLoans.length > 0 && (
                       <div className="text-right">
                         <p className="text-[8px] font-black text-zinc-700 uppercase mb-1">Volume Total</p>
                         <p className="text-[10px] font-black gold-text">
                           {customerLoans.reduce((acc, curr) => acc + curr.amount, 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                         </p>
                       </div>
                     )}
                  </div>
                </div>
                
                <button 
                  onClick={() => setViewingCustomer(customer)}
                  className={`w-full mt-6 py-2.5 rounded-xl text-[9px] font-black uppercase tracking-[0.2em] transition-all border ${customerOverdue ? 'bg-red-500/10 border-red-500/30 text-red-500 hover:bg-red-500/20' : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-500 hover:text-zinc-200'}`}
                >
                  ACESSAR PERFIL COMPLETO
                </button>
              </div>
            );
          })
        ) : (
          <div className="col-span-full py-20 text-center">
            <Users className="mx-auto text-zinc-900 mb-6" size={80} />
            <h4 className="text-sm font-bold text-zinc-700 uppercase tracking-widest">Base de dados vazia</h4>
          </div>
        )}
      </div>

      {/* Modal de Pré-visualização de Documento */}
      {previewDoc && (
        <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 md:p-10 animate-in fade-in duration-300">
          <div className="relative w-full max-w-5xl h-full max-h-[90vh] bg-[#0a0a0a] border border-zinc-800 rounded-[2.5rem] overflow-hidden flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.8)]">
            <div className="p-6 border-b border-zinc-900 flex justify-between items-center bg-zinc-900/20">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-black rounded-xl border border-zinc-800">
                  {getFileIcon(previewDoc.type)}
                </div>
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-widest">{previewDoc.name}</h3>
                  <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-tighter">{previewDoc.type}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <a 
                  href={previewDoc.data} 
                  download={previewDoc.name}
                  className="p-3 bg-zinc-900 text-zinc-400 hover:text-emerald-500 rounded-2xl border border-zinc-800 transition-all"
                  title="Baixar Arquivo"
                >
                  <Download size={18} />
                </a>
                <button 
                  onClick={() => setPreviewDoc(null)}
                  className="p-3 bg-zinc-900 text-zinc-400 hover:text-red-500 rounded-2xl border border-zinc-800 transition-all"
                  title="Fechar"
                >
                  <XCircle size={18} />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-6 flex items-center justify-center bg-black/40">
              {previewDoc.type.startsWith('image/') ? (
                <img 
                  src={previewDoc.data} 
                  alt={previewDoc.name} 
                  className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" 
                />
              ) : previewDoc.type.includes('pdf') ? (
                <iframe 
                  src={previewDoc.data} 
                  className="w-full h-full rounded-xl" 
                  title={previewDoc.name}
                />
              ) : (
                <div className="text-center space-y-4">
                  <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center mx-auto border border-zinc-800">
                    <FileText size={40} className="text-zinc-700" />
                  </div>
                  <p className="text-zinc-500 font-bold uppercase text-xs tracking-widest">Pré-visualização não disponível para este tipo de arquivo</p>
                  <a 
                    href={previewDoc.data} 
                    download={previewDoc.name}
                    className="inline-block px-8 py-3 gold-gradient text-black font-black rounded-full text-[10px] uppercase tracking-widest"
                  >
                    Baixar para Visualizar
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const DetailItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-1">{label}</p>
    <p className="text-sm font-bold text-zinc-200">{value}</p>
  </div>
);

const ContactInfo: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex items-center gap-4 text-xs text-zinc-400 mb-3 last:mb-0">
    <div className="text-[#BF953F]/60 group-hover:text-[#BF953F] transition-colors shrink-0">{icon}</div>
    <span className="line-clamp-1 group-hover:text-zinc-200 transition-colors">{text}</span>
  </div>
);

const InputField: React.FC<{ 
  label: string; 
  name: string; 
  value: string; 
  onChange: any; 
  type?: string; 
  required?: boolean; 
  maxLength?: number; 
  placeholder?: string;
  isValid?: boolean | null;
  helperText?: string;
}> = ({ label, name, value, onChange, type = 'text', required, maxLength, placeholder, isValid, helperText }) => (
  <div className="space-y-2">
    <div className="flex justify-between items-center ml-1">
      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{label}</label>
      {isValid !== null && value.length > 0 && (
        <span className={`text-[8px] font-black uppercase tracking-tighter flex items-center gap-1 ${isValid ? 'text-emerald-500' : 'text-red-500'}`}>
          {isValid ? <CheckCircle size={10} /> : <XCircle size={10} />}
          {isValid ? 'Válido' : 'Inválido'}
        </span>
      )}
    </div>
    <div className="relative">
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        required={required}
        maxLength={maxLength}
        placeholder={placeholder}
        className={`w-full px-5 py-3.5 bg-[#050505] border rounded-2xl outline-none transition-all text-sm text-zinc-200 placeholder:text-zinc-800 ${
          isValid === true ? 'border-emerald-500/50 focus:border-emerald-500' : 
          isValid === false ? 'border-red-500/50 focus:border-red-500' : 
          'border-zinc-800 focus:border-[#BF953F]'
        }`}
      />
    </div>
    {helperText && (
      <p className="text-[8px] font-bold text-red-500 uppercase tracking-widest ml-1">{helperText}</p>
    )}
  </div>
);

export default CustomerSection;
