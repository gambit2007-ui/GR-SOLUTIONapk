import React, { useState, useRef, useMemo, useEffect } from 'react';
import { 
  Search, UserPlus, Trash2, Briefcase, Eye, Camera, FileUp, Pencil, X,
  User as UserIcon, FileDown, TrendingUp, Star 
} from 'lucide-react';
import { Customer, CustomerDocument, Loan } from '../types';
import { validateCPF } from '../utils/validation';

interface CustomerSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
}

const CustomerSection: React.FC<CustomerSectionProps> = ({ 
  customers, loans, onAddCustomer, onUpdateCustomer, onDeleteCustomer 
}) => {
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<any | null>(null); // Alterado para any para evitar erro de unknown
  const [cpfValid, setCpfValid] = useState<boolean | null>(null);
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = setTimeout(() => setSearchTerm(searchInput), 400);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const getTodayStr = () => new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    name: '', cpf: '', rg: '', email: '', phone: '', address: '',
    notes: '', createdAt: getTodayStr(), avatar: ''
  });

  // Lógica de Score baseada em pagamentos
  const getCustomerStats = (customerId: string) => {
    const customerLoans = loans.filter(l => l.customerId === customerId);
    let totalInstallments = 0;
    let latePayments = 0;

    customerLoans.forEach(loan => {
      loan.installments?.forEach(inst => {
        totalInstallments++;
        if (inst.status === 'PAGO' && inst.paymentDate) {
          if (new Date(inst.paymentDate) > new Date(inst.dueDate)) latePayments++;
        }
      });
    });

    const score = totalInstallments === 0 ? 5 : Math.max(1, Math.min(5, 5 - (latePayments / totalInstallments * 5)));
    return { score: Math.round(score), loans: customerLoans };
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'cpf' || name === 'phone') {
      const numeric = value.replace(/\D/g, '');
      if (numeric.length <= 11) {
        setFormData(prev => ({ ...prev, [name]: numeric }));
        if (name === 'cpf') setCpfValid(numeric.length === 11 ? validateCPF(numeric) : null);
      }
      return;
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result as string;
        if (base64) setFormData(prev => ({ ...prev, avatar: base64 }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList) return;
    const filesArray = Array.from(fileList);
    filesArray.forEach((file: File) => {
      const reader = new FileReader();
      reader.onloadend = (event: ProgressEvent<FileReader>) => {
        const result = event.target?.result;
        if (typeof result === 'string') {
          setDocuments(prev => [...prev, { name: file.name, type: file.type, data: result }]);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    const dateStr = new Date(customer.createdAt).toISOString().split('T')[0];
    setFormData({
      name: customer.name, cpf: customer.cpf, rg: customer.rg || '',
      email: customer.email || '', phone: customer.phone || '',
      address: customer.address || '', notes: customer.notes || '',
      createdAt: dateStr, avatar: customer.avatar || ''
    });
    setDocuments(customer.documents || []);
    setIsAdding(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCPF(formData.cpf)) return alert("CPF Inválido");
    const timestamp = new Date(`${formData.createdAt}T12:00:00`).getTime();
    const finalData = {
      ...formData,
      id: editingCustomer?.id || Math.random().toString(36).substr(2, 9),
      createdAt: timestamp,
      documents
    };
    editingCustomer ? onUpdateCustomer(finalData as Customer) : onAddCustomer(finalData as Customer);
    closeForm();
  };

  const closeForm = () => {
    setIsAdding(false);
    setEditingCustomer(null);
    setFormData({ 
      name: '', cpf: '', rg: '', email: '', phone: '', address: '', 
      notes: '', createdAt: getTodayStr(), avatar: '' 
    });
    setDocuments([]);
  };

  const filteredCustomers = useMemo(() => 
    customers.filter(c => 
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
      c.cpf.includes(searchTerm)
    ), [customers, searchTerm]
  );

  return (
    <div className="p-2 space-y-6">
      {/* HEADER */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-center mb-8">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
          <input
            type="text" placeholder="Buscar cliente..."
            className="w-full pl-12 pr-4 py-3 bg-[#111] border border-zinc-800 rounded-full outline-none text-sm text-zinc-200 focus:border-[#BF953F] transition-all"
            value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          />
        </div>
        <button
          onClick={() => { setEditingCustomer(null); setIsAdding(true); }}
          className="px-6 py-3 bg-gradient-to-r from-[#BF953F] to-[#8A6E2F] text-black rounded-full text-xs font-black uppercase hover:scale-105 transition-all flex items-center gap-2"
        >
          <UserPlus size={16} /> NOVO CADASTRO
        </button>
      </div>

      {/* FORMULÁRIO (Mantido do original) */}
      {isAdding && (
        <div className="bg-[#0a0a0a] border border-[#BF953F]/40 p-8 rounded-[2.5rem] mb-10 shadow-2xl animate-in fade-in zoom-in-95">
          <h3 className="text-[#BF953F] font-black uppercase text-[10px] tracking-widest mb-6">
            {editingCustomer ? `Editando: ${editingCustomer.name}` : 'Novo Cadastro de Cliente'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-8">
            <div className="flex flex-col lg:flex-row gap-8">
              <div className="flex flex-col items-center gap-4">
                <div onClick={() => avatarInputRef.current?.click()} className="w-32 h-32 rounded-3xl bg-zinc-900 border-2 border-dashed border-zinc-800 flex flex-col items-center justify-center cursor-pointer overflow-hidden relative group">
                  {formData.avatar ? <img src={formData.avatar} className="w-full h-full object-cover" alt="Avatar" /> : <Camera className="text-zinc-600" size={32} />}
                  <input type="file" ref={avatarInputRef} hidden accept="image/*" onChange={handleAvatarChange} />
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="w-full py-3 bg-zinc-900 border border-zinc-800 rounded-xl text-[9px] font-black text-zinc-400 uppercase flex items-center justify-center gap-2 hover:bg-zinc-800 transition-colors">
                  <FileUp size={14} /> Importar Docs
                </button>
                <input type="file" ref={fileInputRef} hidden multiple onChange={handleFileChange} />
                <div className="text-[8px] text-zinc-600 uppercase font-black">{documents.length} arquivos anexados</div>
              </div>

              <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">Nome Completo</label>
                  <input name="name" required value={formData.name} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white focus:border-[#BF953F] outline-none transition-all" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">CPF</label>
                  <input name="cpf" required value={formData.cpf} onChange={handleInputChange} className={`w-full bg-black border p-3 rounded-xl text-sm text-white outline-none transition-all ${cpfValid === false ? 'border-red-500' : 'border-zinc-800 focus:border-[#BF953F]'}`} />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">RG</label>
                  <input name="rg" value={formData.rg} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white focus:border-[#BF953F] outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">WhatsApp</label>
                  <input name="phone" value={formData.phone} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white focus:border-[#BF953F] outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">E-mail</label>
                  <input name="email" type="email" value={formData.email} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white focus:border-[#BF953F] outline-none" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">Data de Cadastro</label>
                  <input name="createdAt" type="date" value={formData.createdAt} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none text-zinc-400" />
                </div>
                <div className="md:col-span-2 space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">Endereço</label>
                  <input name="address" value={formData.address} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none focus:border-[#BF953F]" />
                </div>
                <div className="md:col-span-1 space-y-1">
                  <label className="text-[9px] text-zinc-500 uppercase font-black ml-1">Notas</label>
                  <textarea name="notes" value={formData.notes} onChange={handleInputChange} className="w-full bg-black border border-zinc-800 p-3 rounded-xl text-sm text-white outline-none h-[46px] resize-none focus:border-[#BF953F]" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-4 pt-6 border-t border-zinc-900">
              <button type="button" onClick={closeForm} className="text-zinc-600 text-[10px] font-black uppercase hover:text-white transition-colors">Descartar</button>
              <button type="submit" className="px-12 py-3 bg-gradient-to-r from-[#BF953F] to-[#8A6E2F] text-black rounded-xl text-[10px] font-black uppercase hover:scale-105 transition-all">
                {editingCustomer ? 'Salvar Alterações' : 'Salvar Cadastro'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* GRID DE CLIENTES COM SCORE */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCustomers.map(customer => {
          const { score } = getCustomerStats(customer.id);
          return (
            <div key={customer.id} className="bg-[#0D0D0D] border border-zinc-800/50 p-6 rounded-[2.5rem] hover:border-[#BF953F]/40 transition-all group relative overflow-hidden">
              <div className="flex justify-between items-start mb-4">
                <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center border border-zinc-800 overflow-hidden">
                  {customer.avatar ? (
                    <img src={customer.avatar} className="w-full h-full object-cover" alt={customer.name} />
                  ) : (
                    <span className="text-[#BF953F] font-black text-xl">{customer.name[0]}</span>
                  )}
                </div>
                <div className="flex gap-1 relative z-10">
                  <button onClick={() => setViewingCustomer(customer)} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all">
                    <Eye size={16}/>
                  </button>
                  <button onClick={() => handleEdit(customer)} className="p-2 text-zinc-500 hover:text-[#BF953F] hover:bg-zinc-800 rounded-lg transition-all">
                    <Pencil size={16}/>
                  </button>
                  <button onClick={() => onDeleteCustomer(customer.id)} className="p-2 text-zinc-500 hover:text-red-500 hover:bg-zinc-800 rounded-lg transition-all">
                    <Trash2 size={16}/>
                  </button>
                </div>
              </div>
              <h3 className="text-white font-bold text-base leading-tight">{customer.name}</h3>
              {/* Estrelas de Score no Card */}
              <div className="flex gap-0.5 mt-2">
                {[...Array(5)].map((_, i) => (
                  <Star key={i} size={10} fill={i < score ? "#BF953F" : "transparent"} className={i < score ? "text-[#BF953F]" : "text-zinc-800"} />
                ))}
              </div>
              <p className="text-zinc-600 text-[10px] font-black uppercase tracking-widest mt-3">{customer.cpf}</p>
            </div>
          );
        })}
      </div>

      {/* MODAL DE VISUALIZAÇÃO APRIMORADO - SIMPLIFICADO */}
      {viewingCustomer && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-[#0a0a0a] border border-[#BF953F]/20 w-full max-w-3xl rounded-[3rem] overflow-hidden shadow-2xl">
            <div className="relative h-40 bg-gradient-to-br from-[#BF953F]/30 via-zinc-900 to-black border-b border-zinc-800/50">
              <button onClick={() => setViewingCustomer(null)} className="absolute top-6 right-6 p-2.5 bg-black/60 text-white rounded-full hover:bg-red-500 transition-all z-20 group">
                <X size={20} className="group-hover:rotate-90 transition-transform" />
              </button>
              <div className="absolute -bottom-12 left-10 flex items-end gap-6">
                <div className="w-32 h-32 rounded-[2.5rem] bg-zinc-900 border-4 border-[#0a0a0a] overflow-hidden shadow-2xl">
                  {viewingCustomer.avatar ? (
                    <img src={viewingCustomer.avatar} className="w-full h-full object-cover" alt="Avatar" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[#BF953F] text-4xl font-black bg-zinc-800">{viewingCustomer.name?.[0]}</div>
                  )}
                </div>
                <div className="pb-4 text-white">
                  <h2 className="text-3xl font-black tracking-tight">{viewingCustomer.name}</h2>
                  <div className="flex items-center gap-3">
                    <div className="flex gap-1">
                      {[...Array(5)].map((_, i) => (
                        <Star key={i} size={14} fill={i < getCustomerStats(viewingCustomer.id).score ? "#BF953F" : "transparent"} className="text-[#BF953F]" />
                      ))}
                    </div>
                    <span className="px-2 py-0.5 bg-[#BF953F]/10 text-[#BF953F] text-[8px] font-black uppercase rounded-full border border-[#BF953F]/20">Score do Cliente</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-10 pt-16 grid grid-cols-1 lg:grid-cols-3 gap-10">
              <div className="lg:col-span-2 space-y-8">
                {/* RESUMO FINANCEIRO SIMPLIFICADO */}
                <div>
                  <h4 className="text-[10px] text-[#BF953F] font-black uppercase tracking-widest mb-4 flex items-center gap-2">
                    <TrendingUp size={14} /> Resumo de Contratos
                  </h4>
                  <div className="space-y-3">
                    {loans.filter(l => l.customerId === viewingCustomer.id).map((loan: any) => (
                      <div key={loan.id} className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl flex justify-between items-center">
                        <div>
                          <p className="text-zinc-500 text-[8px] font-black uppercase">Valor que Pegou</p>
                          <p className="text-white font-black text-lg">R$ {Number(loan.amount).toLocaleString('pt-BR')}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-zinc-500 text-[8px] font-black uppercase">Total a Pagar</p>
                          <p className="text-[#BF953F] font-black text-lg">R$ {Number(loan.totalToReturn).toLocaleString('pt-BR')}</p>
                        </div>
                      </div>
                    ))}
                    {loans.filter(l => l.customerId === viewingCustomer.id).length === 0 && (
                      <p className="text-zinc-600 text-[10px] uppercase font-bold text-center py-4 bg-zinc-900/30 rounded-2xl border border-dashed border-zinc-800">Nenhum contrato ativo</p>
                    )}
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-900">
                  <h4 className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-4 flex items-center gap-2"><UserIcon size={12} className="text-[#BF953F]" /> Contato</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="bg-zinc-900/30 p-3 rounded-xl border border-zinc-800/50">
                      <span className="text-[8px] text-zinc-600 font-black uppercase">WhatsApp</span>
                      <p className="text-zinc-200 text-sm font-medium">{viewingCustomer.phone || 'N/A'}</p>
                    </div>
                    <div className="bg-zinc-900/30 p-3 rounded-xl border border-zinc-800/50">
                      <span className="text-[8px] text-zinc-600 font-black uppercase">CPF</span>
                      <p className="text-zinc-200 text-sm font-medium">{viewingCustomer.cpf}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* COLUNA LATERAL - DOCUMENTOS E NOTAS */}
              <div className="space-y-8">
                <div>
                  <h4 className="text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-4">Documentação</h4>
                  <div className="flex flex-col gap-2">
                    {viewingCustomer.documents?.map((doc: any, idx: number) => (
                      <a key={idx} href={doc.data} download={doc.name} className="p-3 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center gap-3 group hover:border-[#BF953F]/50 transition-all">
                        <div className="p-2 bg-black rounded-lg text-[#BF953F]"><FileDown size={14} /></div>
                        <div className="flex-1 overflow-hidden text-white">
                          <p className="text-[10px] font-bold truncate">{doc.name}</p>
                          <p className="text-[8px] text-zinc-600 uppercase">Baixar Arquivo</p>
                        </div>
                      </a>
                    ))}
                    {(!viewingCustomer.documents || viewingCustomer.documents.length === 0) && <p className="text-[9px] text-zinc-700 font-black uppercase text-center">Sem anexos</p>}
                  </div>
                </div>
                <div className="p-5 bg-[#BF953F]/5 border border-[#BF953F]/10 rounded-3xl text-zinc-400">
                  <h4 className="text-[9px] text-[#BF953F] font-black uppercase mb-2">Observações</h4>
                  <p className="text-xs italic leading-relaxed">{viewingCustomer.notes || "Sem observações internas."}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerSection;