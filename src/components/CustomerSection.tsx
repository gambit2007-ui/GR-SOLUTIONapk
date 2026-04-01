import React, { useState } from 'react';
import { Plus, Search, User, Trash2, Edit2, Camera, FileText, X, Paperclip, Star, AlertTriangle } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { FirebaseError } from 'firebase/app';
import { Customer, Loan, CustomerDocument } from '../types';
import {
  effectiveLoanStatus,
  loanInstallmentsCount,
  normalizeInstallmentStatus,
} from '../utils/loanCompat';
import { auth, storage, storageAppspotFallback, storageFirebasestorageFallback } from '../firebase';

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

  const MAX_PHOTO_SIZE_BYTES = 5 * 1024 * 1024;
  const MAX_DOCUMENT_SIZE_BYTES = 10 * 1024 * 1024;
  const MAX_INLINE_FALLBACK_BYTES = 700 * 1024;
  const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
  const DEFAULT_AVATAR_DATA_URL =
    "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='128' height='128' viewBox='0 0 128 128'%3E%3Crect width='128' height='128' rx='24' fill='%23121212'/%3E%3Ccircle cx='64' cy='48' r='19' fill='%23BF953F' fill-opacity='0.85'/%3E%3Cpath d='M28 104c5-16 19-26 36-26s31 10 36 26' fill='none' stroke='%23BF953F' stroke-opacity='0.85' stroke-width='10' stroke-linecap='round'/%3E%3C/svg%3E";

  const getFileExtension = (fileName: string) => {
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex < 0) return '';
    return fileName.slice(dotIndex).toLowerCase();
  };

  const buildStorageFileName = (fileName: string) => {
    const safeBaseName = String(fileName || 'arquivo')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\w.-]/g, '_');
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${safeBaseName}`;
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Erro ao ler arquivo no fallback'));
      reader.readAsDataURL(file);
    });

  const buildPreviewDataUrl = async (file: File): Promise<string> => {
    if (!file.type.startsWith('image/')) {
      return readFileAsDataUrl(file);
    }

    const sourceDataUrl = await readFileAsDataUrl(file);

    return new Promise<string>((resolve) => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 320;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) {
          resolve(sourceDataUrl);
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        try {
          resolve(canvas.toDataURL('image/jpeg', 0.78));
        } catch {
          resolve(sourceDataUrl);
        }
      };

      image.onerror = () => resolve(sourceDataUrl);
      image.src = sourceDataUrl;
    });
  };

  const handleImageLoadError = (
    event: React.SyntheticEvent<HTMLImageElement>,
    fallbackSrc?: string,
  ) => {
    const target = event.currentTarget;
    if (fallbackSrc && target.dataset.fallbackApplied !== '1') {
      target.dataset.fallbackApplied = '1';
      target.src = fallbackSrc;
      return;
    }

    if (target.src !== DEFAULT_AVATAR_DATA_URL) {
      target.src = DEFAULT_AVATAR_DATA_URL;
    }
  };

  const extractStorageErrorCode = (error: unknown): string => {
    if (error instanceof FirebaseError) {
      return error.code || '';
    }
    if (typeof error === 'object' && error && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : '';
    }
    return '';
  };

  const uploadFileAndGetUrl = async (
    targetStorage: FirebaseStorage,
    path: string,
    file: File,
  ): Promise<string> => {
    const storageRef = ref(targetStorage, path);
    await uploadBytes(storageRef, file, { contentType: file.type || undefined });
    return getDownloadURL(storageRef);
  };

  const uploadWithBucketFallbacks = async (path: string, file: File): Promise<string> => {
    const triedBuckets = new Set<string>();
    const candidates = [storage, storageAppspotFallback, storageFirebasestorageFallback];
    let lastError: unknown = null;

    for (const targetStorage of candidates) {
      const bucket = targetStorage.app.options.storageBucket || '';
      if (bucket && triedBuckets.has(bucket)) continue;
      if (bucket) triedBuckets.add(bucket);

      try {
        return await uploadFileAndGetUrl(targetStorage, path, file);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error('FALHA_UPLOAD_STORAGE');
  };

  const calculateScore = (customerId: string) => {
    const customerLoans = loans.filter(l => l.customerId === customerId);
    if (customerLoans.length === 0) return 50;

    let score = 50;
    customerLoans.forEach(loan => {
      if (effectiveLoanStatus(loan) === 'COMPLETED') score += 15;
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
      const maxSize = type === 'PHOTO' ? MAX_PHOTO_SIZE_BYTES : MAX_DOCUMENT_SIZE_BYTES;
      if (file.size > maxSize) {
        const maxSizeMb = type === 'PHOTO' ? 5 : 10;
        alert(`Arquivo muito grande. Limite de ${maxSizeMb}MB.`);
        return;
      }

      if (type === 'DOCUMENT') {
        const extension = getFileExtension(file.name);
        if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(extension)) {
          alert('Formato invalido. Envie PDF, JPG ou PNG.');
          return;
        }
      }

      const customerToken = editingCustomer?.id || String(formData.cpf || 'novo').replace(/\W/g, '') || 'novo';
      const folder = type === 'PHOTO' ? 'photos' : 'documents';
      const fileName = buildStorageFileName(file.name);
      const storagePath = `clientes/${customerToken}/${folder}/${fileName}`;

      if (!auth.currentUser) {
        alert('Sessao expirada. Entre novamente para enviar arquivos.');
        return;
      }
      await auth.currentUser.getIdToken();
      const downloadUrl = await uploadWithBucketFallbacks(storagePath, file);

      if (type === 'PHOTO') {
        const previewDataUrl = await buildPreviewDataUrl(file);
        setFormData((prev) => ({ ...prev, photoUrl: downloadUrl, avatar: previewDataUrl || downloadUrl } as Partial<Customer>));
      } else {
        const previewDataUrl = file.type.startsWith('image/') ? await buildPreviewDataUrl(file) : undefined;
        const newDoc: CustomerDocument & { id?: string; url?: string; uploadedAt?: string } = {
          id: Math.random().toString(36).substr(2, 9),
          name: file.name,
          url: downloadUrl,
          type: file.type || 'application/octet-stream',
          data: previewDataUrl,
          uploadedAt: new Date().toISOString(),
        };
        setFormData(prev => ({
          ...prev,
          documents: [...((prev.documents || []) as any[]), newDoc]
        }));
      }
    } catch (error) {
      console.error('Falha no upload', error);
      const errorCode = extractStorageErrorCode(error);
      const canFallbackToInline = file.size <= MAX_INLINE_FALLBACK_BYTES;

      if (canFallbackToInline) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          if (type === 'PHOTO') {
            setFormData((prev) => ({ ...prev, photoUrl: dataUrl, avatar: dataUrl } as Partial<Customer>));
          } else {
            const fallbackDoc: CustomerDocument & { id?: string; uploadedAt?: string } = {
              id: Math.random().toString(36).substr(2, 9),
              name: file.name,
              type: file.type || 'application/octet-stream',
              data: dataUrl,
              uploadedAt: new Date().toISOString(),
            };
            setFormData((prev) => ({
              ...prev,
              documents: [...((prev.documents || []) as any[]), fallbackDoc],
            }));
          }

          alert('Arquivo enviado em modo compatibilidade e vinculado ao cliente.');
          return;
        } catch (fallbackError) {
          console.error('Falha no fallback de upload local', fallbackError);
        }
      }

      const detail = errorCode ? ` (${errorCode})` : '';
      if (errorCode === 'storage/unauthorized') {
        alert(`Falha ao enviar arquivo${detail}. Sem permissao no Firebase Storage para este usuario.`);
      } else if (errorCode === 'storage/bucket-not-found' || errorCode === 'storage/no-default-bucket') {
        alert(`Falha ao enviar arquivo${detail}. Bucket do Firebase Storage nao encontrado/configurado.`);
      } else {
        alert(`Falha ao enviar arquivo${detail}. Verifique permissao do Storage e tente novamente.`);
      }
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

  const filteredCustomers = [...customers]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR', { sensitivity: 'base' }))
    .filter(c =>
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.cpf?.includes(searchTerm)
    );

  const isCustomerOverdue = (customerId: string) => {
    return loans.some(loan => 
      loan.customerId === customerId && 
      effectiveLoanStatus(loan) === 'ACTIVE' && 
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
          const hasActiveLoan = customerLoans.some((loan) => effectiveLoanStatus(loan) === 'ACTIVE');
          const statusLabel = hasOverdue ? 'Atrasado' : hasActiveLoan ? 'Ativo' : 'Em dia';
          const statusClasses = hasOverdue
            ? 'bg-red-500/10 text-red-500 border-red-500/30'
            : hasActiveLoan
              ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
              : 'bg-zinc-800 text-zinc-400 border-zinc-700';

          return (
            <div 
              key={customer.id} 
              role="button"
              tabIndex={0}
              onClick={() => setViewingDetails(customer)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setViewingDetails(customer);
                }
              }}
              className={`bg-[#050505] border p-5 rounded-3xl transition-all cursor-pointer ${
                hasOverdue
                  ? 'border-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.05)]'
                  : 'border-zinc-900 hover:border-[#BF953F]/30'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-4 min-w-0">
                    <div className="w-16 h-16 bg-zinc-900 rounded-2xl border border-zinc-800 flex items-center justify-center overflow-hidden shrink-0">
                    {(customer.avatar || customer.photoUrl) ? (
                      <img
                        src={(customer.avatar || customer.photoUrl) as string}
                        alt={customer.name}
                        className="w-full h-full object-cover"
                        onError={(event) =>
                          handleImageLoadError(
                            event,
                            customer.photoUrl && customer.photoUrl !== customer.avatar ? customer.photoUrl : undefined,
                          )
                        }
                      />
                    ) : (
                      <User size={30} className="text-[#BF953F]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-black text-white uppercase truncate">{customer.name}</h3>
                    <span className={`inline-flex mt-2 text-[8px] font-black uppercase px-2.5 py-1 rounded-full border ${statusClasses}`}>
                      {statusLabel}
                    </span>
                  </div>
                </div>

                <button 
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setViewingDetails(customer);
                  }}
                  className="px-3 py-2 text-[9px] font-black text-[#BF953F] uppercase tracking-widest border border-[#BF953F]/30 rounded-xl hover:bg-[#BF953F]/10 transition-colors shrink-0"
                >
                  Detalhes
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
                      {(formData as any).avatar || (formData as any).photoUrl ? (
                        <img
                          src={((formData as any).avatar || (formData as any).photoUrl) as string}
                          alt="Pre-visualizacao"
                          className="w-full h-full object-cover"
                          onError={(event) =>
                            handleImageLoadError(
                              event,
                              (formData as any).photoUrl && (formData as any).photoUrl !== (formData as any).avatar
                                ? (formData as any).photoUrl
                                : undefined,
                            )
                          }
                        />
                      ) : (
                        <Camera size={32} className="text-zinc-700 group-hover:text-[#BF953F]" />
                      )}
                    </div>
                    <input 
                      type="file" 
                      accept="image/*" 
                      className="absolute inset-0 opacity-0 cursor-pointer" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          void handleFileUpload(file, 'PHOTO');
                        }
                        e.currentTarget.value = '';
                      }}
                    />
                    {((formData as any).avatar || (formData as any).photoUrl) && (
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
                        accept=".pdf,.jpg,.jpeg,.png,image/png,image/jpeg,application/pdf"
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            void handleFileUpload(file, 'DOCUMENT');
                          }
                          e.currentTarget.value = '';
                        }}
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
                {((viewingDetails as any).avatar || (viewingDetails as any).photoUrl) ? (
                  <img
                    src={((viewingDetails as any).avatar || (viewingDetails as any).photoUrl) as string}
                    alt={viewingDetails.name}
                    className="w-full h-full object-cover"
                    onError={(event) =>
                      handleImageLoadError(
                        event,
                        (viewingDetails as any).photoUrl && (viewingDetails as any).photoUrl !== (viewingDetails as any).avatar
                          ? (viewingDetails as any).photoUrl
                          : undefined,
                      )
                    }
                  />
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
                    <button
                      onClick={() => {
                        setDeleteConfirmation(viewingDetails.id);
                        setViewingDetails(null);
                      }}
                      className="p-2 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 hover:bg-red-500/20 transition-all"
                      title="Excluir Cliente"
                    >
                      <Trash2 size={16} />
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
                        if (effectiveLoanStatus(loan) !== 'ACTIVE') return false;
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
                              effectiveLoanStatus(loan) === 'ACTIVE'
                                ? 'bg-emerald-500/10 text-emerald-500'
                                : effectiveLoanStatus(loan) === 'COMPLETED'
                                  ? 'bg-blue-500/10 text-blue-500'
                                  : 'bg-zinc-800 text-zinc-500'
                            }`}>
                              {loanStatusLabel[effectiveLoanStatus(loan)]}
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
                        href={doc.data || doc.url || '#'} 
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







