import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BadgeCheck,
  Ban,
  Camera,
  CircleDollarSign,
  Eye,
  FileText,
  Home,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Upload,
  UserRoundCheck,
  X,
} from 'lucide-react';
import type {
  CreateCredigrupoInvestorRequest,
  CredigrupoGrInvestorSettings,
  CredigrupoInvestorDetails,
  CredigrupoInvestorDocumentType,
  CredigrupoInvestorSummary,
} from '../lib/creditProviders/types';
import {
  CREDIGRUPO_INVESTOR_DOCUMENT_TYPES,
  type CredigrupoInvestorDocumentFiles,
  type CredigrupoInvestorField,
  type CredigrupoInvestorFieldErrors,
  validateCredigrupoInvestorDocuments,
  validateCredigrupoInvestorRequest,
} from '../lib/creditProviders/investorValidation';
import {
  createCredigrupoInvestor,
  getCredigrupoInvestor,
  getCredigrupoGrInvestorSettings,
  listCredigrupoInvestors,
  syncCredigrupoInvestors,
  updateCredigrupoInvestor,
  updateCredigrupoGrInvestorSettings,
  uploadCredigrupoInvestorDocuments,
} from '../services/credigrupoService';

interface CreditInvestorsProps {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const emptyInvestor = (): CreateCredigrupoInvestorRequest => ({
  display_name: '',
  document: '',
  birth_date: '',
  email: '',
  phone: '',
  kyc_data: {
    address_street: '',
    address_number: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    maritalStatus: 'SINGLE',
    monthlyIncome: 0,
    bankCode: '',
    bankAgency: '',
    bankAccount: '',
    pixKey: '',
    pixKeyType: 'CPF',
  },
});

type InvestorDocumentFiles = Partial<Record<CredigrupoInvestorDocumentType, File>>;

const emptyDocuments = (): InvestorDocumentFiles => ({});

const documentDefinitions: Array<{
  type: CredigrupoInvestorDocumentType;
  label: string;
  description: string;
  accept: string;
  icon: typeof Camera;
}> = [
  { type: 'selfie', label: 'Selfie real', description: 'Foto atual e nitida', accept: 'image/jpeg,image/png,image/webp', icon: Camera },
  { type: 'idFront', label: 'Documento (frente)', description: 'RG, CNH ou RNE', accept: 'image/jpeg,image/png,image/webp', icon: FileText },
  { type: 'idBack', label: 'Documento (verso)', description: 'Imagem completa do verso', accept: 'image/jpeg,image/png,image/webp', icon: FileText },
  { type: 'proofOfResidence', label: 'Comprovante de residencia', description: 'Imagem ou PDF de ate 3 meses', accept: 'image/jpeg,image/png,image/webp,application/pdf', icon: Home },
];

const inputClass = 'w-full rounded-xl border border-zinc-800 bg-black px-4 py-3 text-[10px] text-white outline-none transition-colors focus:border-[#BF953F]';
const labelClass = 'mb-1.5 block text-[8px] font-black uppercase tracking-[0.18em] text-zinc-500';

const statusPresentation = (status: string) => {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'approved') return { label: 'Aprovado', className: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' };
  if (normalized === 'rejected') return { label: 'Reprovado', className: 'border-red-500/25 bg-red-500/10 text-red-400' };
  if (normalized === 'blocked') return { label: 'Bloqueado', className: 'border-red-500/25 bg-red-500/10 text-red-400' };
  return { label: 'Aguardando KYC', className: 'border-[#BF953F]/25 bg-[#BF953F]/10 text-[#F5D77B]' };
};

const formatCurrency = (value: number) => Number(value || 0).toLocaleString('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

const formatDateTime = (value?: string) => {
  if (!value) return 'Nao informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Nao informado' : date.toLocaleString('pt-BR');
};

const FieldError = ({ errors, field }: { errors: CredigrupoInvestorFieldErrors; field: CredigrupoInvestorField }) => (
  errors[field] ? <p className="mt-1 text-[8px] font-bold text-red-400">{errors[field]}</p> : null
);

const InvestorDocumentFields = ({
  files,
  errors,
  inputPrefix,
  onChange,
}: {
  files: InvestorDocumentFiles;
  errors: CredigrupoInvestorFieldErrors;
  inputPrefix: string;
  onChange: (type: CredigrupoInvestorDocumentType, file?: File) => void;
}) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
    {documentDefinitions.map((definition) => {
      const Icon = definition.icon;
      const file = files[definition.type];
      const inputId = `${inputPrefix}-${definition.type}`;
      return (
        <div key={definition.type}>
          <label
            htmlFor={inputId}
            className={`flex min-h-36 cursor-pointer flex-col justify-between rounded-2xl border bg-black p-4 transition-colors ${file ? 'border-emerald-500/35' : errors[`documents.${definition.type}`] ? 'border-red-500/40' : 'border-zinc-800 hover:border-[#BF953F]/40'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-2.5 text-[#F5D77B]"><Icon size={16} /></div>
              {file ? <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[7px] font-black uppercase tracking-wider text-emerald-400">Selecionado</span> : <Upload size={15} className="text-zinc-700" />}
            </div>
            <div className="mt-5">
              <p className="text-[8px] font-black uppercase tracking-wider text-white">{definition.label}</p>
              <p className="mt-1 truncate text-[7px] uppercase tracking-wider text-zinc-600">{file ? file.name : definition.description}</p>
              {file && <p className="mt-1 text-[7px] text-zinc-700">{(file.size / 1024 / 1024).toFixed(2)} MB</p>}
            </div>
          </label>
          <input
            id={inputId}
            type="file"
            className="sr-only"
            accept={definition.accept}
            onChange={(event) => onChange(definition.type, event.target.files?.[0])}
          />
          <FieldError errors={errors} field={`documents.${definition.type}`} />
        </div>
      );
    })}
  </div>
);

const StatusBadge = ({ status }: { status: string }) => {
  const presentation = statusPresentation(status);
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[7px] font-black uppercase tracking-widest ${presentation.className}`}>
      {presentation.label}
    </span>
  );
};

const CreditInvestors: React.FC<CreditInvestorsProps> = ({ showToast }) => {
  const [investors, setInvestors] = useState<CredigrupoInvestorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateCredigrupoInvestorRequest>(emptyInvestor);
  const [documents, setDocuments] = useState<InvestorDocumentFiles>(emptyDocuments);
  const [createdInvestorId, setCreatedInvestorId] = useState<string | null>(null);
  const [errors, setErrors] = useState<CredigrupoInvestorFieldErrors>({});
  const [details, setDetails] = useState<CredigrupoInvestorDetails | null>(null);
  const [detailDocuments, setDetailDocuments] = useState<InvestorDocumentFiles>(emptyDocuments);
  const [detailDocumentErrors, setDetailDocumentErrors] = useState<CredigrupoInvestorFieldErrors>({});
  const [uploadingDetailDocuments, setUploadingDetailDocuments] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [grSettings, setGrSettings] = useState<CredigrupoGrInvestorSettings>({ configured: false });
  const [grInvestorSelection, setGrInvestorSelection] = useState('');
  const [savingGrInvestor, setSavingGrInvestor] = useState(false);

  const loadLocalInvestors = async () => {
    setLoading(true);
    try {
      const [loadedInvestors, loadedSettings] = await Promise.all([
        listCredigrupoInvestors(),
        getCredigrupoGrInvestorSettings(),
      ]);
      setInvestors(loadedInvestors);
      setGrSettings(loadedSettings);
      setGrInvestorSelection(loadedSettings.investorInternalId || '');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel carregar os investidores.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLocalInvestors();
  }, []);

  const patchPersonal = (fields: Partial<CreateCredigrupoInvestorRequest>) => {
    setForm((current) => ({ ...current, ...fields }));
  };

  const patchKyc = (fields: Partial<CreateCredigrupoInvestorRequest['kyc_data']>) => {
    setForm((current) => ({ ...current, kyc_data: { ...current.kyc_data, ...fields } }));
  };

  const openNewInvestorForm = () => {
    setForm(emptyInvestor());
    setDocuments(emptyDocuments());
    setCreatedInvestorId(null);
    setErrors({});
    setShowForm(true);
  };

  const patchDocument = (type: CredigrupoInvestorDocumentType, file?: File) => {
    setDocuments((current) => ({ ...current, [type]: file }));
    setErrors((current) => ({ ...current, [`documents.${type}`]: undefined }));
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const validated = validateCredigrupoInvestorRequest(form);
    const documentErrors = validateCredigrupoInvestorDocuments(documents, { requireAll: true });
    const combinedErrors = { ...validated.errors, ...documentErrors };
    setErrors(combinedErrors);
    if (Object.keys(combinedErrors).length > 0) {
      showToast('Revise os campos destacados antes de continuar.', 'error');
      return;
    }

    setSaving(true);
    let investorId = createdInvestorId;
    try {
      if (!investorId) {
        const result = await createCredigrupoInvestor(validated.payload);
        investorId = result.investor.id;
        setCreatedInvestorId(investorId);
        setInvestors((current) => [...current, result.investor].sort((left, right) => left.name.localeCompare(right.name, 'pt-BR')));
      }
      const uploaded = await uploadCredigrupoInvestorDocuments(investorId, documents);
      const submittedAt = new Date().toISOString();
      setInvestors((current) => current.map((investor) => investor.id === investorId ? {
        ...investor,
        documentsSubmitted: uploaded.documentsSubmitted,
        documentsComplete: uploaded.documentsComplete,
        documentsSubmittedAt: submittedAt,
      } : investor));
      setForm(emptyInvestor());
      setDocuments(emptyDocuments());
      setCreatedInvestorId(null);
      setErrors({});
      setShowForm(false);
      showToast('Investidor e documentos enviados. O KYC esta aguardando analise.', 'success');
    } catch (error) {
      const prefix = investorId
        ? 'O investidor foi cadastrado, mas os documentos nao foram concluidos. Tente enviar novamente.'
        : 'Nao foi possivel cadastrar o investidor.';
      showToast(error instanceof Error ? `${prefix} ${error.message}` : prefix, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const synchronized = await syncCredigrupoInvestors();
      setInvestors(synchronized);
      const loadedSettings = await getCredigrupoGrInvestorSettings();
      setGrSettings(loadedSettings);
      setGrInvestorSelection(loadedSettings.investorInternalId || '');
      showToast(`${synchronized.length} investidor(es) sincronizado(s).`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel sincronizar os investidores.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleConfigureGrInvestor = async () => {
    if (!grInvestorSelection) {
      showToast('Selecione o investidor Credigrupo que representa a GR.', 'error');
      return;
    }
    setSavingGrInvestor(true);
    try {
      const settings = await updateCredigrupoGrInvestorSettings({ investorInternalId: grInvestorSelection });
      setGrSettings(settings);
      setInvestors(await listCredigrupoInvestors());
      showToast('Investidor Credigrupo da GR configurado.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel configurar o investidor da GR.', 'error');
    } finally {
      setSavingGrInvestor(false);
    }
  };

  const openDetails = async (investor: CredigrupoInvestorSummary) => {
    setLoadingDetails(true);
    setDetailDocuments(emptyDocuments());
    setDetailDocumentErrors({});
    try {
      setDetails(await getCredigrupoInvestor(investor.id));
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel abrir o investidor.', 'error');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDetailDocuments = async () => {
    if (!details) return;
    const documentErrors = validateCredigrupoInvestorDocuments(detailDocuments);
    setDetailDocumentErrors(documentErrors);
    if (Object.keys(documentErrors).length > 0) {
      showToast('Selecione arquivos validos antes de enviar.', 'error');
      return;
    }

    setUploadingDetailDocuments(true);
    try {
      const uploaded = await uploadCredigrupoInvestorDocuments(details.id, detailDocuments);
      const documentsSubmittedAt = new Date().toISOString();
      const updated = {
        documentsSubmitted: uploaded.documentsSubmitted,
        documentsComplete: uploaded.documentsComplete,
        documentsSubmittedAt,
      };
      setDetails((current) => current ? { ...current, ...updated } : current);
      setInvestors((current) => current.map((investor) => investor.id === details.id ? { ...investor, ...updated } : investor));
      setDetailDocuments(emptyDocuments());
      setDetailDocumentErrors({});
      showToast('Documentos enviados para a Credigrupo.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel enviar os documentos.', 'error');
    } finally {
      setUploadingDetailDocuments(false);
    }
  };

  const handleAction = async (investor: CredigrupoInvestorSummary, action: 'SYNC' | 'ACTIVATE' | 'DEACTIVATE') => {
    setActionId(investor.id);
    try {
      const result = await updateCredigrupoInvestor({ id: investor.id, action });
      setInvestors((current) => current.map((item) => item.id === investor.id ? result.investor : item));
      if (details?.id === investor.id) setDetails(await getCredigrupoInvestor(investor.id));
      const message = action === 'SYNC' ? 'Investidor sincronizado.' : action === 'ACTIVATE' ? 'Investidor ativado.' : 'Investidor desativado.';
      showToast(message, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel atualizar o investidor.', 'error');
    } finally {
      setActionId(null);
    }
  };

  if (showForm) {
    return (
      <section className="mx-auto max-w-6xl pb-10">
        <button type="button" onClick={() => setShowForm(false)} className="mb-5 inline-flex items-center gap-2 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white">
          <ArrowLeft size={14} /> Voltar para investidores
        </button>
        <div className="rounded-[2rem] border border-zinc-900 bg-[#050505] p-5 sm:p-8">
          <div className="mb-8 flex items-start gap-3">
            <div className="rounded-2xl border border-[#BF953F]/25 bg-[#BF953F]/10 p-3 text-[#F5D77B]"><UserRoundCheck size={20} /></div>
            <div>
              <p className="text-[8px] font-black uppercase tracking-[0.24em] text-[#BF953F]">Credito / Investidores</p>
              <h1 className="mt-2 text-xl font-black uppercase tracking-tight text-white">Novo investidor externo</h1>
              <p className="mt-2 max-w-2xl text-[9px] uppercase leading-relaxed tracking-wider text-zinc-500">Dados enviados com seguranca ao backend da GR e encaminhados a Credigrupo Sandbox. Informacoes bancarias e KYC nao sao duplicadas no Firestore.</p>
            </div>
          </div>

          <form onSubmit={handleCreate} className="space-y-8" noValidate>
            <fieldset className="space-y-4">
              <legend className="mb-4 text-[10px] font-black uppercase tracking-[0.2em] text-[#F5D77B]">Dados pessoais</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label><span className={labelClass}>Nome completo</span><input className={inputClass} value={form.display_name} onChange={(event) => patchPersonal({ display_name: event.target.value })} autoComplete="name" /><FieldError errors={errors} field="display_name" /></label>
                <label><span className={labelClass}>CPF</span><input className={inputClass} value={form.document} onChange={(event) => patchPersonal({ document: event.target.value })} inputMode="numeric" autoComplete="off" /><FieldError errors={errors} field="document" /></label>
                <label><span className={labelClass}>Data de nascimento</span><input type="date" className={inputClass} value={form.birth_date} onChange={(event) => patchPersonal({ birth_date: event.target.value })} /><FieldError errors={errors} field="birth_date" /></label>
                <label><span className={labelClass}>E-mail</span><input type="email" className={inputClass} value={form.email} onChange={(event) => patchPersonal({ email: event.target.value })} autoComplete="email" /><FieldError errors={errors} field="email" /></label>
                <label><span className={labelClass}>Telefone com DDD</span><input className={inputClass} value={form.phone} onChange={(event) => patchPersonal({ phone: event.target.value })} inputMode="tel" autoComplete="tel" /><FieldError errors={errors} field="phone" /></label>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-zinc-900 pt-7">
              <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F5D77B]">Endereco</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <label className="md:col-span-2"><span className={labelClass}>Rua</span><input className={inputClass} value={form.kyc_data.address_street} onChange={(event) => patchKyc({ address_street: event.target.value })} /><FieldError errors={errors} field="kyc_data.address_street" /></label>
                <label><span className={labelClass}>Numero</span><input className={inputClass} value={form.kyc_data.address_number} onChange={(event) => patchKyc({ address_number: event.target.value })} /><FieldError errors={errors} field="kyc_data.address_number" /></label>
                <label><span className={labelClass}>Bairro</span><input className={inputClass} value={form.kyc_data.address_neighborhood} onChange={(event) => patchKyc({ address_neighborhood: event.target.value })} /><FieldError errors={errors} field="kyc_data.address_neighborhood" /></label>
                <label><span className={labelClass}>Cidade</span><input className={inputClass} value={form.kyc_data.address_city} onChange={(event) => patchKyc({ address_city: event.target.value })} /><FieldError errors={errors} field="kyc_data.address_city" /></label>
                <label><span className={labelClass}>UF</span><input maxLength={2} className={inputClass} value={form.kyc_data.address_state} onChange={(event) => patchKyc({ address_state: event.target.value.toUpperCase() })} /><FieldError errors={errors} field="kyc_data.address_state" /></label>
                <label><span className={labelClass}>CEP</span><input className={inputClass} value={form.kyc_data.address_zip} onChange={(event) => patchKyc({ address_zip: event.target.value })} inputMode="numeric" /><FieldError errors={errors} field="kyc_data.address_zip" /></label>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-zinc-900 pt-7">
              <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F5D77B]">KYC e dados de repasse</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label><span className={labelClass}>Estado civil</span><select className={inputClass} value={form.kyc_data.maritalStatus} onChange={(event) => patchKyc({ maritalStatus: event.target.value as CreateCredigrupoInvestorRequest['kyc_data']['maritalStatus'] })}><option value="SINGLE">Solteiro(a)</option><option value="MARRIED">Casado(a)</option><option value="DIVORCED">Divorciado(a)</option><option value="WIDOWED">Viuvo(a)</option></select><FieldError errors={errors} field="kyc_data.maritalStatus" /></label>
                <label><span className={labelClass}>Renda mensal</span><input type="number" min="0" step="0.01" className={inputClass} value={form.kyc_data.monthlyIncome || ''} onChange={(event) => patchKyc({ monthlyIncome: Number(event.target.value) })} /><FieldError errors={errors} field="kyc_data.monthlyIncome" /></label>
                <label><span className={labelClass}>Codigo do banco</span><input className={inputClass} value={form.kyc_data.bankCode} onChange={(event) => patchKyc({ bankCode: event.target.value })} inputMode="numeric" autoComplete="off" /><FieldError errors={errors} field="kyc_data.bankCode" /></label>
                <label><span className={labelClass}>Agencia</span><input className={inputClass} value={form.kyc_data.bankAgency} onChange={(event) => patchKyc({ bankAgency: event.target.value })} autoComplete="off" /><FieldError errors={errors} field="kyc_data.bankAgency" /></label>
                <label><span className={labelClass}>Conta</span><input className={inputClass} value={form.kyc_data.bankAccount} onChange={(event) => patchKyc({ bankAccount: event.target.value })} autoComplete="off" /><FieldError errors={errors} field="kyc_data.bankAccount" /></label>
                <label><span className={labelClass}>Tipo da chave PIX</span><select className={inputClass} value={form.kyc_data.pixKeyType} onChange={(event) => patchKyc({ pixKeyType: event.target.value as CreateCredigrupoInvestorRequest['kyc_data']['pixKeyType'] })}><option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="EMAIL">E-mail</option><option value="PHONE">Telefone</option><option value="RANDOM">Aleatoria</option></select><FieldError errors={errors} field="kyc_data.pixKeyType" /></label>
                <label className="md:col-span-2"><span className={labelClass}>Chave PIX</span><input className={inputClass} value={form.kyc_data.pixKey} onChange={(event) => patchKyc({ pixKey: event.target.value })} autoComplete="off" /><FieldError errors={errors} field="kyc_data.pixKey" /></label>
              </div>
            </fieldset>

            <fieldset className="space-y-4 border-t border-zinc-900 pt-7">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <legend className="text-[10px] font-black uppercase tracking-[0.2em] text-[#F5D77B]">Arquivos de verificacao</legend>
                <p className="text-[7px] uppercase tracking-wider text-zinc-600">JPG, PNG, WEBP ou PDF permitido no comprovante • maximo 8 MB</p>
              </div>
              <InvestorDocumentFields files={documents} errors={errors} inputPrefix="new-investor" onChange={patchDocument} />
              {createdInvestorId && (
                <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-[8px] font-bold uppercase tracking-wider text-amber-300">
                  Investidor ja cadastrado. O proximo envio tentara somente concluir os documentos, sem criar duplicidade.
                </p>
              )}
            </fieldset>

            <div className="flex flex-col-reverse gap-3 border-t border-zinc-900 pt-6 sm:flex-row sm:justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="rounded-xl border border-zinc-800 px-6 py-3 text-[9px] font-black uppercase tracking-widest text-zinc-400">Cancelar</button>
              <button type="submit" disabled={saving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] px-7 py-3 text-[9px] font-black uppercase tracking-widest text-black disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} {createdInvestorId ? 'Concluir documentos' : 'Cadastrar na Credigrupo'}</button>
            </div>
          </form>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6 pb-10">
      <header className="flex flex-col gap-4 rounded-[2rem] border border-zinc-900 bg-[#050505] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl border border-[#BF953F]/25 bg-[#BF953F]/10 p-3 text-[#F5D77B]"><Landmark size={20} /></div>
          <div><p className="text-[8px] font-black uppercase tracking-[0.24em] text-[#BF953F]">Credito</p><h1 className="mt-1 text-xl font-black uppercase tracking-tight text-white">Investidores</h1><p className="mt-2 text-[8px] uppercase tracking-wider text-zinc-500">Capital proprio e investidores externos Credigrupo</p></div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" onClick={() => void handleSyncAll()} disabled={syncing} className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-800 px-4 py-3 text-[8px] font-black uppercase tracking-widest text-zinc-300 disabled:opacity-50"><RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> Sincronizar</button>
          <button type="button" onClick={openNewInvestorForm} className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#BF953F] via-[#FCF6BA] to-[#B38728] px-5 py-3 text-[8px] font-black uppercase tracking-widest text-black"><Plus size={14} /> Novo investidor</button>
        </div>
      </header>

      <section className="rounded-[2rem] border border-[#BF953F]/20 bg-[#050505] p-5 sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[8px] font-black uppercase tracking-[0.22em] text-[#BF953F]">Credigrupo / Investidor da GR</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className={`rounded-full border px-3 py-1 text-[7px] font-black uppercase tracking-widest ${grSettings.configured ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/25 bg-amber-500/10 text-amber-400'}`}>
                {grSettings.configured ? 'Configurado' : 'Nao configurado'}
              </span>
              {grSettings.investorName && <strong className="text-[10px] uppercase text-white">{grSettings.investorName}</strong>}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[7px] uppercase tracking-wider text-zinc-600">
              <span>ID: {grSettings.investorIdMasked || 'Nao informado'}</span>
              <span>KYC: {grSettings.kycStatus || 'Nao informado'}</span>
              <span>Sincronizado: {formatDateTime(grSettings.syncedAt)}</span>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:flex-row lg:max-w-xl">
            <select
              value={grInvestorSelection}
              onChange={(event) => setGrInvestorSelection(event.target.value)}
              className={`${inputClass} flex-1`}
              aria-label="Investidor Credigrupo da GR"
            >
              <option value="">SELECIONE UM INVESTIDOR APROVADO</option>
              {investors.filter((investor) => investor.active && investor.kycStatus === 'approved').map((investor) => (
                <option key={investor.id} value={investor.id}>{investor.name.toUpperCase()}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleConfigureGrInvestor()}
              disabled={!grInvestorSelection || savingGrInvestor}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/10 px-5 text-[8px] font-black uppercase tracking-widest text-[#F5D77B] disabled:opacity-40"
            >
              {savingGrInvestor && <Loader2 size={13} className="animate-spin" />} Salvar vinculo
            </button>
          </div>
        </div>
      </section>

      <div className="overflow-hidden rounded-[2rem] border border-zinc-900 bg-[#050505]">
        <div className="hidden grid-cols-[minmax(180px,1.4fr)_1fr_1fr_0.8fr_auto] gap-4 border-b border-zinc-900 px-6 py-4 text-[8px] font-black uppercase tracking-widest text-zinc-600 md:grid"><span>Investidor</span><span>KYC</span><span>Origem</span><span>Situacao</span><span>Acoes</span></div>
        {loading ? (
          <div className="flex min-h-48 items-center justify-center gap-3 text-[9px] font-black uppercase tracking-widest text-zinc-500"><Loader2 size={17} className="animate-spin text-[#BF953F]" /> Carregando investidores</div>
        ) : investors.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center px-6 text-center"><CircleDollarSign size={26} className="text-zinc-700" /><p className="mt-4 text-[9px] font-black uppercase tracking-widest text-zinc-500">Nenhum investidor cadastrado</p><p className="mt-2 text-[8px] uppercase tracking-wider text-zinc-700">Cadastre um investidor externo ou sincronize a Credigrupo.</p></div>
        ) : investors.map((investor) => (
          <article key={investor.id} className="grid gap-4 border-b border-zinc-900 px-5 py-5 last:border-0 md:grid-cols-[minmax(180px,1.4fr)_1fr_1fr_0.8fr_auto] md:items-center md:px-6">
            <div><p className="text-[10px] font-black uppercase text-white">{investor.name}</p><p className="mt-1 text-[7px] uppercase tracking-wider text-zinc-600">{investor.emailMasked || 'E-mail protegido'}</p></div>
            <div><span className="mb-2 block text-[7px] font-black uppercase tracking-widest text-zinc-600 md:hidden">KYC</span><StatusBadge status={investor.kycStatus} /></div>
            <div><span className="mb-1 block text-[7px] font-black uppercase tracking-widest text-zinc-600 md:hidden">Origem</span><p className="text-[8px] font-black uppercase tracking-wider text-zinc-300">{investor.capitalOrigin === 'EXTERNAL' ? 'Externo / Credigrupo' : 'Capital GR'}</p></div>
            <div><span className="mb-1 block text-[7px] font-black uppercase tracking-widest text-zinc-600 md:hidden">Situacao</span><p className={`text-[8px] font-black uppercase tracking-wider ${investor.active ? 'text-emerald-400' : 'text-zinc-600'}`}>{investor.active ? 'Ativo' : 'Inativo'}</p></div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void openDetails(investor)} disabled={loadingDetails} title="Ver detalhes" className="rounded-xl border border-zinc-800 p-2.5 text-zinc-400 hover:border-[#BF953F]/40 hover:text-[#F5D77B]"><Eye size={14} /></button>
              <button type="button" onClick={() => void handleAction(investor, 'SYNC')} disabled={actionId === investor.id} title="Sincronizar" className="rounded-xl border border-zinc-800 p-2.5 text-zinc-400 hover:text-white"><RefreshCw size={14} className={actionId === investor.id ? 'animate-spin' : ''} /></button>
              {investor.active ? <button type="button" onClick={() => void handleAction(investor, 'DEACTIVATE')} disabled={actionId === investor.id} title="Desativar" className="rounded-xl border border-red-500/20 p-2.5 text-red-400"><Ban size={14} /></button> : <button type="button" onClick={() => void handleAction(investor, 'ACTIVATE')} disabled={actionId === investor.id || investor.kycStatus !== 'approved'} title="Ativar" className="rounded-xl border border-emerald-500/20 p-2.5 text-emerald-400 disabled:opacity-30"><BadgeCheck size={14} /></button>}
            </div>
          </article>
        ))}
      </div>

      {details && (
        <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetails(null); }}>
          <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] border border-zinc-800 bg-[#050505] p-5 sm:rounded-[2rem] sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[8px] font-black uppercase tracking-[0.22em] text-[#BF953F]">Detalhes do investidor</p><h2 className="mt-2 text-lg font-black uppercase text-white">{details.name}</h2></div><button type="button" onClick={() => setDetails(null)} className="rounded-xl border border-zinc-800 p-2 text-zinc-500"><X size={16} /></button></div>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>ID Credigrupo</p><p className="break-all text-[9px] font-bold text-zinc-300">{details.externalId}</p></div>
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>E-mail</p><p className="text-[9px] font-bold text-zinc-300">{details.emailMasked || 'Protegido'}</p></div>
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>KYC</p><StatusBadge status={details.kycStatus} /><p className="mt-2 text-[7px] uppercase tracking-wider text-zinc-600">Status externo: {details.externalStatus}</p></div>
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>Situacao</p><p className={`text-[10px] font-black uppercase ${details.active ? 'text-emerald-400' : 'text-zinc-500'}`}>{details.active ? 'Ativo' : 'Inativo'}</p></div>
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>Cadastro</p><p className="text-[9px] font-bold text-zinc-300">{formatDateTime(details.createdAt)}</p></div>
              <div className="rounded-2xl border border-zinc-900 bg-black p-4"><p className={labelClass}>Ultima sincronizacao</p><p className="text-[9px] font-bold text-zinc-300">{formatDateTime(details.syncedAt)}</p></div>
            </div>
            <div className="mt-6 border-t border-zinc-900 pt-6">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-[#F5D77B]">Documentos de KYC</p>
                  <p className="mt-1 text-[7px] uppercase tracking-wider text-zinc-600">
                    {details.documentsSubmitted?.length || 0} de {CREDIGRUPO_INVESTOR_DOCUMENT_TYPES.length} enviados • {details.documentsComplete ? 'Cadastro documental completo' : 'Envio pendente'}
                  </p>
                </div>
                {details.documentsComplete && <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[7px] font-black uppercase tracking-widest text-emerald-400">Completo</span>}
              </div>
              <InvestorDocumentFields
                files={detailDocuments}
                errors={detailDocumentErrors}
                inputPrefix={`investor-${details.id}`}
                onChange={(type, file) => {
                  setDetailDocuments((current) => ({ ...current, [type]: file }));
                  setDetailDocumentErrors((current) => ({ ...current, [`documents.${type}`]: undefined }));
                }}
              />
              <div className="mt-4 flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleDetailDocuments()}
                  disabled={uploadingDetailDocuments || Object.keys(detailDocuments).length === 0}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/10 px-5 py-3 text-[8px] font-black uppercase tracking-widest text-[#F5D77B] disabled:opacity-40"
                >
                  {uploadingDetailDocuments ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Enviar selecionados
                </button>
              </div>
            </div>
            <div className="mt-6"><p className="mb-3 text-[9px] font-black uppercase tracking-widest text-[#F5D77B]">Resumo interno</p><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{[
              ['Operacoes', details.statistics.operationsFinanced],
              ['Capital alocado', formatCurrency(details.statistics.capitalAllocated)],
              ['Ativos', details.statistics.activeContracts],
              ['Quitados', details.statistics.completedContracts],
              ['Repassado', formatCurrency(details.statistics.amountRepaid)],
            ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-zinc-900 bg-black p-3"><p className="text-[7px] font-black uppercase tracking-wider text-zinc-600">{label}</p><p className="mt-2 text-[10px] font-black text-white">{value}</p></div>)}</div></div>
          </div>
        </div>
      )}
    </section>
  );
};

export default CreditInvestors;
