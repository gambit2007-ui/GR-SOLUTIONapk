import React, { useState } from 'react';
import { Plus, Search, User, Phone, Mail, Trash2, Edit2, Camera, FileText, X, Paperclip, Star, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Customer, Loan, CustomerDocument } from '../types';
import {
  loanInstallmentsCount,
  normalizeInstallmentStatus,
  normalizeLoanStatus,
} from '../utils/loanCompat';

interface CustomerSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddCustomer: (c: Customer) => void;
  onUpdateCustomer: (c: Customer) => void;
  onDeleteCustomer: (id: string) => void;
}

const CustomerSection: React.FC<CustomerSectionProps> = ({
  customers, loans, onAddCustomer, onUpdateCustomer, onDeleteCustomer
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState<Partial<Customer>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [viewingDetails, setViewingDetails] = useState<Customer | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
      reader.readAsDataURL(file);
    });

  const calculateScore = (customerId: string) => {
    const customerLoans = loans.filter(l => l.customerId === customerId);
    if (customerLoans.length === 0) return 50;

    let score = 50;
    customerLoans.forEach(loan => {
      if (normalizeLoanStatus(loan.status) === 'COMPLETED') score += 15;
      loan.installments.forEach(inst => {
        const normalizedStatus = normalizeInstallmentStatus(inst.status);
        if (normalizedStatus === 'PAID') score += 2;
        if (normalizedStatus === 'OVERDUE') score -= 10;
        
        // Verifica pendencia vencida
        const dueDate = new Date(inst.dueDate + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (normalizedStatus !== 'PAID' && dueDate < today) {
          score -= 15;
        }
      });
    });

    return Math.min(100, Math.max(0, score));
  };

  const handleFileUpload = async (file: File, type: 'PHOTO' | 'DOCUMENT') => {
    setIsUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      if (type === 'PHOTO') {
        setFormData(prev => ({ ...prev, photoUrl: dataUrl, avatar: dataUrl } as Partial<Customer>));
      } else {
        const newDoc: CustomerDocument & { id?: string; url?: string; uploadedAt?: string } = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: dataUrl,
          type: file.type,
          data: dataUrl,
          uploadedAt: new Date().toISOString(),
        };
        setFormData(prev => ({
          ...prev,
          documents: [...((prev.documents || []) as any[]), newDoc]
        }));
      }
    } catch (error) {
      console.error('Falha no upload', error);
    } finally {
      setIsUploading(false);
    }
  };

  const removeDocument = (id: string) => {
    setFormData(prev => ({
      ...prev,
      documents: ((prev.documents || []) as any[]).filter((d: any) => d.id !== id && d.name !== id)
    }));
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cpf?.includes(searchTerm)
  );

  const isCustomerOverdue = (customerId: string) => {
    return loans.some(loan => 
      loan.customerId === customerId && 
      normalizeLoanStatus(loan.status) === 'ACTIVE' && 
      loan.installments.some(inst => {
        const dueDate = new Date(inst.dueDate + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return normalizeInstallmentStatus(inst.status) !== 'PAID' && dueDate < today;
      })
    );
  };

  const loanStatusLabel: Record<string, string> = {
    ACTIVE: 'Ativo',
    COMPLETED: 'Concluido',
    CANCELLED: 'Cancelado',
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Validacao de CPF/CNPJ (11 ou 14 digitos numericos)
    const cleanDocument = (formData.cpf || '').replace(/\D/g, '');
    if (cleanDocument.length !== 11 && cleanDocument.length !== 14) {
      alert('Informe um CPF (11 digitos) ou CNPJ (14 digitos).');
      return;
    }

    // Verificar documento duplicado
    const isDocumentDuplicate = customers.some(c => 
      c.cpf?.replace(/\D/g, '') === cleanDocument && c.id !== editingCustomer?.id
    );
    if (isDocumentDuplicate) {
      alert('Este CPF/CNPJ ja esta cadastrado para outro cliente.');
      return;
    }

    // Validacao de Telefone (11 digitos numericos)
    const cleanPhone = (formData.phone || '').replace(/\D/g, '');
    if (cleanPhone.length !== 11) {
      alert('O telefone deve conter exatamente 11 digitos numericos (DDD + Numero).');
      return;
    }

    const payload = {
      ...formData,
      cpf: cleanDocument,
      phone: cleanPhone,
      notes: (formData as any).notes ?? (formData as any).observations ?? '',
      observations: (formData as any).observations ?? (formData as any).notes ?? '',
      avatar: (formData as any).avatar ?? (formData as any).photoUrl ?? '',
      photoUrl: (formData as any).photoUrl ?? (formData as any).avatar ?? '',
      documents: (formData.documents || []) as any,
    } as any;

    if (editingCustomer) {
      onUpdateCustomer({ ...editingCustomer, ...payload } as Customer);
    } else {
      onAddCustomer(payload as Customer);
    }
    setIsModalOpen(false);
    setEditingCustomer(null);
    setFormData({});
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="BUSCAR CLIENTE..."
            className="w-full bg-[#050505] border border-zinc-900 rounded-2xl py-4 pl-12 pr-4 text-xs text-white outline-none focus:border-[#BF953F] transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <button
          onClick={() => { setEditingCustomer(null); setFormData({}); setIsModalOpen(true); }}
          className="w-full sm:w-auto px-8 py-4 gold-gradient text-black rounded-2xl font-black text-[10px] tracking-widest uppercase flex items-center justify-center gap-2"
        >
          <Plus size={16} /> Novo Cliente
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredCustomers.map(customer => {
          const customerLoans = loans.filter(l => l.customerId === customer.id);
          const hasOverdue = isCustomerOverdue(customer.id);
          return (
            <div 
              key={customer.id} 
              className={`bg-[#050505] border p-6 rounded-3xl group transition-all ${
                hasOverdue ? 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.05)]' : 'border-zinc-900 hover:border-[#BF953F]/30'
              }`}
            >
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center overflow-hidden">
                    {((customer as any).photoUrl || customer.avatar) ? (
                      <img src={((customer as any).photoUrl || customer.avatar) as string} alt={customer.name} className="w-full h-full object-cover" />
                    ) : (
                      <User size={32} className="text-[#BF953F]" />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-black text-white uppercase break-words">{customer.name}</h3>
                      {hasOverdue && (
                        <span className="text-[7px] bg-red-500 text-white px-1.5 py-0.5 rounded font-black uppercase">Atrasado</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <Star size={10} className="text-[#BF953F]" />
                      <span className="text-[10px] font-black gold-text">{calculateScore(customer.id)} PTS</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
                  <button onClick={() => { setEditingCustomer(customer); setFormData(customer); setIsModalOpen(true); }} className="p-2 hover:bg-zinc-900 rounded-xl text-zinc-400 hover:text-white">
                    <Edit2 size={16} />
                  </button>
                  <button onClick={() => setDeleteConfirmation(customer.id)} className="p-2 hover:bg-red-500/10 rounded-xl text-zinc-400 hover:text-red-500">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 text-zinc-500">
                  <Phone size={14} /> <span className="text-[10px] tracking-widest break-all">{customer.phone || 'Nao informado'}</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-500">
                  <Mail size={14} /> <span className="text-[10px] tracking-widest break-all">{customer.email || 'Nao informado'}</span>
                </div>
                {((customer as any).observations || customer.notes) && (
                  <div className="mt-4 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
                    <p className="text-[8px] text-zinc-500 uppercase tracking-widest mb-1">Observacoes</p>
                    <p className="text-[10px] text-zinc-400 line-clamp-2 italic">{(customer as any).observations || customer.notes}</p>
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-zinc-900 flex justify-between items-center">
                <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{customerLoans.length} CONTRATOS</span>
                <button 
                  onClick={() => setViewingDetails(customer)}
                  className="text-[9px] font-black text-[#BF953F] uppercase tracking-widest hover:underline"
                >
                  VER DETALHES
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-[#000000]/80 backdrop-blur-sm overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-2xl rounded-[2.5rem] p-5 sm:p-8 relative my-4 sm:my-8 max-h-[92dvh] overflow-y-auto">
            <button onClick={() => setIsModalOpen(false)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <X size={24} />
            </button>
            <h2 className="text-xl font-black gold-text uppercase tracking-tighter mb-8">
              {editingCustomer ? 'Editar Cliente' : 'Novo Cliente'}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="flex flex-col md:flex-row gap-8">
                {/* Photo Upload */}
                <div className="flex flex-col items-center gap-4">
                  <div className="relative group">
                    <div className="w-32 h-32 bg-zinc-900 rounded-3xl border-2 border-dashed border-zinc-800 flex items-center justify-center overflow-hidden group-hover:border-[#BF953F] transition-all">
                      {(formData as any).photoUrl || (formData as any).avatar ? (
                        <img src={((formData as any).photoUrl || (formData as any).avatar) as string} alt="Pre-visualizacao" className="w-full h-full object-cover" />
                      ) : (
                        <Camera size={32} className="text-zinc-700 group-hover:text-[#BF953F]" />
                      )}
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                      onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'PHOTO')}
                    />
                    {((formData as any).photoUrl || (formData as any).avatar) && (
                      <button 
                        type="button"
                        onClick={() => setFormData({ ...formData, photoUrl: undefined, avatar: undefined } as any)}
                        className="absolute -top-2 -right-2 p-1.5 bg-red-500 text-white rounded-full shadow-lg"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                  <span className="text-[8px] font-black text-zinc-500 uppercase tracking-widest">Foto de Perfil</span>
                </div>

                <div className="flex-1 space-y-4">
                  <input
                    type="text" placeholder="NOME COMPLETO" required
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.name || ''}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <input
                      type="text" placeholder="CPF OU CNPJ (SO NUMEROS)" required
                      maxLength={14}
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={formData.cpf || ''}
                      onChange={e => {
                        const value = e.target.value.replace(/\D/g, '');
                        if (value.length <= 14) {
                          setFormData({ ...formData, cpf: value });
                        }
                      }}
                    />
                    <input
                      type="text" placeholder="RG"
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={formData.rg || ''}
                      onChange={e => setFormData({ ...formData, rg: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <input
                      type="date" placeholder="DATA DE NASCIMENTO"
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={(formData as any).birthDate || ''}
                      onChange={e => setFormData({ ...formData, birthDate: e.target.value } as any)}
                    />
                    <input
                      type="text" placeholder="TELEFONE (SO NUMEROS)" required
                      className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                      value={formData.phone || ''}
                      onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    />
                  </div>
                  <input
                    type="email" placeholder="E-MAIL"
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.email || ''}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                  <input
                    type="text" placeholder="ENDERECO"
                    className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs"
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-4">
                <textarea
                  placeholder="OBSERVACOES"
                  rows={3}
                  className="w-full bg-[#000000] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs resize-none"
                  value={(formData as any).observations ?? formData.notes ?? ''}
                  onChange={e => setFormData({ ...formData, observations: e.target.value, notes: e.target.value } as any)}
                />

                <div className="space-y-2">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Documentos (PDF, JPG, PNG)</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {((formData.documents || []) as any[]).map((doc: any) => (
                      <div key={doc.id || doc.name} className="flex items-center justify-between p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                        <div className="flex items-center gap-2 overflow-hidden">
                          <FileText size={14} className="text-[#BF953F] shrink-0" />
                          <span className="text-[10px] text-zinc-400 truncate">{doc.name}</span>
                        </div>
                        <button type="button" onClick={() => removeDocument(doc.id || doc.name)} className="text-zinc-600 hover:text-red-500">
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <label className="flex items-center justify-center gap-2 p-3 bg-[#000000] border-2 border-dashed border-zinc-800 rounded-xl cursor-pointer hover:border-[#BF953F] transition-all group">
                      <Paperclip size={14} className="text-zinc-600 group-hover:text-[#BF953F]" />
                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest group-hover:text-[#BF953F]">Anexar Arquivo</span>
                      <input 
                        type="file" 
                        className="hidden" 
                        onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0], 'DOCUMENT')}
                      />
                    </label>
                  </div>
                </div>
              </div>

              <button 
                disabled={isUploading}
                className={`w-full py-5 gold-gradient text-black rounded-2xl font-black uppercase text-[10px] tracking-widest mt-4 flex items-center justify-center gap-2 ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isUploading ? 'Enviando Arquivos...' : (editingCustomer ? 'Salvar Alteracoes' : 'Cadastrar Cliente')}
              </button>
            </form>
          </div>
        </div>
      )}
      {viewingDetails && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-3 sm:p-4 bg-[#000000]/90 backdrop-blur-md overflow-y-auto">
          <div className="bg-[#050505] border border-zinc-900 w-full max-w-4xl rounded-[2.5rem] p-5 sm:p-8 relative my-4 sm:my-8 max-h-[92dvh] overflow-y-auto">
            <button onClick={() => setViewingDetails(null)} className="absolute top-6 right-6 text-zinc-500 hover:text-white">
              <X size={24} />
            </button>
            
            <div className="flex flex-col md:flex-row gap-8 mb-12">
              <div className="w-32 h-32 bg-zinc-900 rounded-[2rem] border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                {((viewingDetails as any).photoUrl || (viewingDetails as any).avatar) ? (
                  <img src={((viewingDetails as any).photoUrl || (viewingDetails as any).avatar) as string} alt={viewingDetails.name} className="w-full h-full object-cover" />
                ) : (
                  <User size={48} className="text-[#BF953F]" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-4 mb-2">
                  <h2 className="text-2xl font-black text-white uppercase tracking-tighter break-words">{viewingDetails.name}</h2>
                  <div className="flex items-center gap-2">
                    <div className="px-4 py-1 bg-[#BF953F]/10 border border-[#BF953F]/20 rounded-full flex items-center gap-2">
                      <Star size={12} className="text-[#BF953F]" />
                      <span className="text-xs font-black gold-text">{calculateScore(viewingDetails.id)} PONTUACAO</span>
                    </div>
                    <button 
                      onClick={() => {
                        setEditingCustomer(viewingDetails);
                        setFormData(viewingDetails);
                        setViewingDetails(null);
                        setIsModalOpen(true);
                      }}
                      className="p-2 bg-zinc-900 border border-zinc-800 rounded-xl text-zinc-400 hover:text-[#BF953F] transition-all"
                      title="Editar Cadastro"
                    >
                      <Edit2 size={16} />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-zinc-500 uppercase tracking-[0.2em] mb-6 break-all">{viewingDetails.cpf || 'SEM CPF/CNPJ CADASTRADO'}</p>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Telefone</p>
                    <p className="text-[10px] text-white font-bold break-all">{viewingDetails.phone || 'Nao informado'}</p>
                  </div>
                  <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">RG</p>
                    <p className="text-[10px] text-white font-bold break-all">{viewingDetails.rg || 'Nao informado'}</p>
                  </div>
                  <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Nascimento</p>
                    <p className="text-[10px] text-white font-bold">
                      {(viewingDetails as any).birthDate ? new Date((viewingDetails as any).birthDate + 'T12:00:00').toLocaleDateString('pt-BR') : 'Nao informado'}
                    </p>
                  </div>
                  <div className="p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                    <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">E-mail</p>
                    <p className="text-[10px] text-white font-bold break-all">{viewingDetails.email || 'Nao informado'}</p>
                  </div>
                </div>
                <div className="mt-4 p-4 bg-zinc-900/30 rounded-2xl border border-zinc-800/50">
                  <p className="text-[8px] font-black text-zinc-500 uppercase tracking-widest mb-1">Endereco</p>
                  <p className="text-[10px] text-white font-bold break-words">{viewingDetails.address || 'Nao informado'}</p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div>
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4 flex items-center gap-2">
                  <FileText size={14} /> Contratos do Cliente
                </h3>
                <div className="space-y-3">
                  {loans.filter(l => l.customerId === viewingDetails.id).length === 0 ? (
                    <p className="text-[10px] text-zinc-600 italic uppercase">Nenhum contrato encontrado</p>
                  ) : (
                    loans.filter(l => l.customerId === viewingDetails.id).map(loan => {
                      const overdueCount = loan.installments.filter(i => {
                        const dueDate = new Date(i.dueDate + 'T00:00:00');
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);
                        return normalizeInstallmentStatus(i.status) !== 'PAID' && dueDate < today;
                      }).length;

                      return (
                        <div key={loan.id} className="p-4 bg-[#000000] border border-zinc-900 rounded-2xl flex items-center justify-between">
                          <div>
                            <p className="text-[10px] font-black text-white uppercase">Contrato {loan.id}</p>
                            <p className="text-[9px] text-zinc-500 mt-1">R$ {loan.amount.toLocaleString('pt-BR')}  -  {loanInstallmentsCount(loan)} Parc.</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {overdueCount > 0 && (
                              <div className="flex items-center gap-1 text-red-500">
                                <AlertTriangle size={12} />
                                <span className="text-[8px] font-black">{overdueCount} ATRASADAS</span>
                              </div>
                            )}
                            <span className={`text-[8px] font-black px-2 py-1 rounded-full ${
                              normalizeLoanStatus(loan.status) === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : normalizeLoanStatus(loan.status) === 'COMPLETED'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : 'bg-zinc-800 text-zinc-500'
                            }`}>
                              {loanStatusLabel[normalizeLoanStatus(loan.status)]}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4">Documentos Anexados</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {((viewingDetails.documents || []) as any[]).map((doc: any) => (
                      <a 
                        key={doc.id || doc.name} 
                        href={doc.url || doc.data || '#'} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-zinc-900/30 border border-zinc-800 rounded-xl hover:border-[#BF953F]/50 transition-all"
                      >
                        <FileText size={16} className="text-[#BF953F]" />
                        <span className="text-[9px] text-zinc-400 truncate">{doc.name}</span>
                      </a>
                    ))}
                  </div>
                </div>
                
                {((viewingDetails as any).observations || viewingDetails.notes) && (
                  <div>
                    <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] mb-4">Observacoes Internas</h3>
                    <div className="p-4 bg-zinc-900/30 border border-zinc-800 rounded-2xl">
                      <p className="text-[10px] text-zinc-400 italic leading-relaxed">{(viewingDetails as any).observations || viewingDetails.notes}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteConfirmation && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-[#000000]/90 backdrop-blur-md">
          <div className="bg-[#050505] border border-red-500/30 w-full max-w-sm rounded-[2.5rem] p-8 text-center">
            <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} className="text-red-500" />
            </div>
            <h3 className="text-lg font-black text-white uppercase tracking-tighter mb-2">Excluir Cliente?</h3>
            <p className="text-[10px] text-zinc-500 uppercase tracking-widest leading-relaxed mb-8">
              Esta acao e irreversivel. Todos os contratos e movimentacoes vinculados a este cliente serao <span className="text-red-500">apagados permanentemente</span>.
            </p>
            <div className="flex gap-4">
              <button 
                onClick={() => setDeleteConfirmation(null)}
                className="flex-1 py-4 bg-zinc-900 text-zinc-500 rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={() => {
                  onDeleteCustomer(deleteConfirmation);
                  setDeleteConfirmation(null);
                }}
                className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CustomerSection;







