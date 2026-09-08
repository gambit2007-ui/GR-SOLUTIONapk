import React, { useState } from 'react';
import { isCredigrupoCustomerAllowed } from '../../lib/creditProviders/dataScope';
import { CheckCircle, FileText, Loader2, ShieldCheck, Upload } from 'lucide-react';
import type { Customer } from '../../types';
import type {
  CredigrupoBorrowerState,
  CredigrupoBorrowerDocumentType,
  CredigrupoEnvironment,
  CredigrupoKycData,
  CredigrupoSimulationResult,
} from '../../lib/creditProviders/types';
import { getBorrowerEligibilityPresentation } from '../../lib/creditProviders/borrowerEligibility';
import {
  CREDIGRUPO_KYC_DOCUMENT_TYPES,
  type CredigrupoInvestorFieldErrors,
  validateCredigrupoInvestorDocuments,
} from '../../lib/creditProviders/investorValidation';
import {
  CredigrupoServiceError,
  ensureCredigrupoBorrower,
  getStoredCredigrupoBorrower,
  simulateCredigrupoLoan,
  uploadCredigrupoBorrowerDocuments,
} from '../../services/credigrupoService';

export interface BancarizationTerms {
  amount: string;
  installments: string;
  interestRate: string;
  firstPaymentDate: string;
  frequency: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  interestType: 'SIMPLE' | 'PRICE' | 'SPLIT';
}

export interface BancarizationDraft {
  fundingSource: 'GR';
  email: string;
  phone: string;
  document: string;
  birthDate: string;
  kycData: CredigrupoKycData;
  borrower?: CredigrupoBorrowerState;
  simulation?: CredigrupoSimulationResult;
}

export const createDefaultBancarizationDraft = (customer?: Customer): BancarizationDraft => ({
  fundingSource: 'GR',
  email: customer?.email || '',
  phone: customer?.phone || '',
  document: customer?.cpf || '',
  birthDate: customer?.birthDate || '',
  kycData: {
    address_street: customer?.address || '',
    address_number: '',
    address_neighborhood: '',
    address_city: '',
    address_state: '',
    address_zip: '',
    maritalStatus: 'SINGLE',
    monthlyIncome: 0,
    documentType: 'RG',
    documentNumber: customer?.rg || '',
    issueDate: '',
    issuingEntity: 'SSP',
    issuingState: '',
    bankCode: '',
    bankAgency: '',
    bankAccount: '',
    bankAccountType: 'CHECKING',
    pixKey: customer?.cpf || '',
    pixKeyType: 'CPF',
  },
});

interface BancarizationFieldsProps {
  customer?: Customer;
  terms: BancarizationTerms;
  value: BancarizationDraft;
  onChange: (value: BancarizationDraft) => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
  environment: CredigrupoEnvironment;
  isAdmin: boolean;
}

const inputClass = 'w-full bg-black border border-zinc-800 rounded-xl p-3 text-white outline-none focus:border-[#BF953F] text-[10px]';
const labelClass = 'text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1';
const documentDefinitions: Array<{ type: CredigrupoBorrowerDocumentType; label: string; accept: string }> = [
  { type: 'selfie', label: 'Selfie', accept: 'image/jpeg,image/png,image/webp,application/pdf' },
  { type: 'idFront', label: 'Documento (frente)', accept: 'image/jpeg,image/png,image/webp,application/pdf' },
  { type: 'idBack', label: 'Documento (verso)', accept: 'image/jpeg,image/png,image/webp,application/pdf' },
  { type: 'proofOfResidence', label: 'Comprovante de residencia', accept: 'image/jpeg,image/png,image/webp,application/pdf' },
];

const currencyFromCents = (value: number) =>
  (Number(value || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BancarizationFields: React.FC<BancarizationFieldsProps> = ({ customer, terms, value, onChange, showToast, environment, isAdmin }) => {
  const customerAllowed = Boolean(customer && isCredigrupoCustomerAllowed(customer, environment));
  const isSandbox = environment === 'sandbox';
  const [loadingBorrower, setLoadingBorrower] = useState(false);
  const [syncingBorrower, setSyncingBorrower] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [documents, setDocuments] = useState<Partial<Record<CredigrupoBorrowerDocumentType, File>>>({});
  const [documentErrors, setDocumentErrors] = useState<CredigrupoInvestorFieldErrors>({});
  const [uploadingDocuments, setUploadingDocuments] = useState(false);

  const patch = (fields: Partial<BancarizationDraft>) => onChange({ ...value, ...fields });
  const patchKyc = (fields: Partial<CredigrupoKycData>) => patch({ kycData: { ...value.kycData, ...fields }, simulation: undefined });
  const eligibility = getBorrowerEligibilityPresentation(value.borrower);

  React.useEffect(() => {
    let cancelled = false;
    if (!customer) return () => { cancelled = true; };
    setLoadingBorrower(true);
    void getStoredCredigrupoBorrower(customer.id)
      .then((borrower) => {
        if (!cancelled) onChange({ ...value, borrower, simulation: undefined });
      })
      .catch((error) => {
        if (!cancelled && (!(error instanceof CredigrupoServiceError) || error.code !== 'BORROWER_NOT_SYNCED')) {
          showToast(error instanceof Error ? error.message : 'Nao foi possivel carregar o tomador', 'error');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingBorrower(false);
      });
    return () => { cancelled = true; };
  }, [customer?.id]);

  const handleBorrowerSync = async () => {
    if (!customerAllowed) return;
    if (!customer) {
      showToast('Selecione o cliente', 'error');
      return;
    }
    setSyncingBorrower(true);
    try {
      const borrower = await ensureCredigrupoBorrower({
        customerId: customer.id,
        fundingSource: 'GR',
        email: value.email,
        displayName: customer.name,
        phone: value.phone,
        document: value.document,
        birthDate: value.birthDate,
        kycData: value.kycData,
      });
      patch({ borrower, simulation: undefined });
      showToast(
        borrower.kycStatus === 'approved' ? 'Tomador aprovado e sincronizado' : `KYC: ${borrower.kycStatus}`,
        borrower.kycStatus === 'approved' ? 'success' : undefined,
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel sincronizar o tomador', 'error');
    } finally {
      setSyncingBorrower(false);
    }
  };

  const handleBorrowerDocuments = async () => {
    if (!customer || !value.borrower || !isAdmin) return;
    const errors = validateCredigrupoInvestorDocuments(documents);
    setDocumentErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setUploadingDocuments(true);
    try {
      const result = await uploadCredigrupoBorrowerDocuments(customer.id, documents);
      patch({
        borrower: {
          ...value.borrower,
          documentsSubmitted: result.documentsSubmitted,
          documentsComplete: result.documentsComplete,
          documentsSubmittedAt: new Date().toISOString(),
        },
        simulation: undefined,
      });
      setDocuments({});
      setDocumentErrors({});
      showToast('Documentos enviados para a Credigrupo.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel enviar os documentos.', 'error');
    } finally {
      setUploadingDocuments(false);
    }
  };

  const handleSimulation = async () => {
    if (!customerAllowed) return;
    if (!customer || value.borrower?.kycStatus !== 'approved') {
      showToast('O KYC do tomador precisa estar aprovado', 'error');
      return;
    }
    if (!eligibility.canSimulate) {
      showToast(eligibility.details.join(' ') || eligibility.title, 'error');
      return;
    }
    if (terms.frequency !== 'MONTHLY' && terms.frequency !== 'WEEKLY') {
      showToast('A Credigrupo aceita apenas frequencia mensal ou semanal', 'error');
      return;
    }
    if (terms.interestType === 'SPLIT') {
      showToast('Juros divididos nao sao suportados no modo bancarizado', 'error');
      return;
    }
    setSimulating(true);
    try {
      const simulation = await simulateCredigrupoLoan({
        customerId: customer.id,
        fundingSource: 'GR',
        amountCents: Math.round(Number(terms.amount || 0) * 100),
        installments: Math.trunc(Number(terms.installments || 0)),
        interestRate: Number(terms.interestRate || 0),
        firstPaymentDate: terms.firstPaymentDate,
        frequency: terms.frequency === 'WEEKLY' ? 'weekly' : 'monthly',
        interestType: terms.interestType === 'PRICE' ? 'compound' : 'simple',
      });
      patch({ simulation });
      showToast('Simulacao oficial recebida', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao simular', 'error');
    } finally {
      setSimulating(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[#BF953F]/25 bg-[#BF953F]/5 p-4">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[#BF953F]" />
          <div>
            <p className="text-[9px] font-black text-[#F5D77B] uppercase tracking-widest">Credigrupo - {isSandbox ? 'Sandbox' : 'Producao'}</p>
            <p className="text-[9px] text-amber-300 mt-1">{isSandbox ? 'Ambiente de teste. Não utilizar dados ou operações reais.' : 'Ambiente de producao. Confira os dados antes de confirmar.'}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
          <p className={labelClass}>Investidor</p>
          <p className="mt-2 text-[9px] font-black uppercase tracking-wider text-emerald-400">GR SOLUTION</p>
        </div>
        <div className="rounded-xl border border-[#BF953F]/25 bg-black/40 p-3">
          <p className={labelClass}>Origem</p>
          <p className="mt-2 text-[9px] font-black uppercase tracking-wider text-[#F5D77B]">Capital proprio</p>
        </div>
      </div>

      {!customerAllowed && <p role="alert" className="text-[10px] text-amber-300">{isSandbox ? 'Selecione um cliente de teste ativo, identificado para sandbox pelo administrador.' : 'Cliente de teste ou arquivado nao pode ser usado em producao.'}</p>}
      <fieldset disabled={!customerAllowed} className="pt-3 border-t border-zinc-800 disabled:opacity-40">
        <p className="text-[8px] font-black text-zinc-400 uppercase tracking-widest mb-3">Dados adicionais do tomador</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <input className={inputClass} placeholder="E-MAIL" value={value.email} onChange={(e) => patch({ email: e.target.value, borrower: undefined, simulation: undefined })} />
          <input className={inputClass} placeholder="TELEFONE" value={value.phone} onChange={(e) => patch({ phone: e.target.value, borrower: undefined, simulation: undefined })} />
          <input className={inputClass} placeholder="CPF" value={value.document} onChange={(e) => patch({ document: e.target.value, borrower: undefined, simulation: undefined })} />
          <input type="date" className={inputClass} value={value.birthDate} onChange={(e) => patch({ birthDate: e.target.value, borrower: undefined, simulation: undefined })} />
          <input className={inputClass} placeholder="RUA" value={value.kycData.address_street} onChange={(e) => patchKyc({ address_street: e.target.value })} />
          <input className={inputClass} placeholder="NUMERO" value={value.kycData.address_number} onChange={(e) => patchKyc({ address_number: e.target.value })} />
          <input className={inputClass} placeholder="BAIRRO" value={value.kycData.address_neighborhood} onChange={(e) => patchKyc({ address_neighborhood: e.target.value })} />
          <input className={inputClass} placeholder="CIDADE" value={value.kycData.address_city} onChange={(e) => patchKyc({ address_city: e.target.value })} />
          <input className={inputClass} placeholder="UF" maxLength={2} value={value.kycData.address_state} onChange={(e) => patchKyc({ address_state: e.target.value.toUpperCase() })} />
          <input className={inputClass} placeholder="CEP" value={value.kycData.address_zip} onChange={(e) => patchKyc({ address_zip: e.target.value })} />
          <select className={inputClass} value={value.kycData.maritalStatus} onChange={(e) => patchKyc({ maritalStatus: e.target.value as CredigrupoKycData['maritalStatus'] })}>
            <option value="SINGLE">SOLTEIRO(A)</option><option value="MARRIED">CASADO(A)</option><option value="DIVORCED">DIVORCIADO(A)</option><option value="WIDOWED">VIUVO(A)</option>
          </select>
          <input type="number" className={inputClass} placeholder="RENDA MENSAL" value={value.kycData.monthlyIncome || ''} onChange={(e) => patchKyc({ monthlyIncome: Number(e.target.value) })} />
          <select className={inputClass} value={value.kycData.documentType} onChange={(e) => patchKyc({ documentType: e.target.value as CredigrupoKycData['documentType'] })}>
            <option value="RG">RG</option><option value="CNH">CNH</option><option value="RNE">RNE</option>
          </select>
          <input className={inputClass} placeholder="NUMERO DO DOCUMENTO" value={value.kycData.documentNumber} onChange={(e) => patchKyc({ documentNumber: e.target.value })} />
          <input type="date" className={inputClass} title="Data de emissao do documento" value={value.kycData.issueDate} onChange={(e) => patchKyc({ issueDate: e.target.value })} />
          <input className={inputClass} placeholder="ORGAO EMISSOR" value={value.kycData.issuingEntity || ''} onChange={(e) => patchKyc({ issuingEntity: e.target.value })} />
          <input className={inputClass} placeholder="BANCO (3 DIGITOS)" value={value.kycData.bankCode} onChange={(e) => patchKyc({ bankCode: e.target.value })} />
          <input className={inputClass} placeholder="AGENCIA" value={value.kycData.bankAgency} onChange={(e) => patchKyc({ bankAgency: e.target.value })} />
          <input className={inputClass} placeholder="CONTA" value={value.kycData.bankAccount} onChange={(e) => patchKyc({ bankAccount: e.target.value })} />
          <select className={inputClass} value={value.kycData.bankAccountType} onChange={(e) => patchKyc({ bankAccountType: e.target.value as CredigrupoKycData['bankAccountType'] })}>
            <option value="CHECKING">CONTA CORRENTE</option><option value="SAVINGS">POUPANCA</option>
          </select>
          <input className={inputClass} placeholder="CHAVE PIX" value={value.kycData.pixKey} onChange={(e) => patchKyc({ pixKey: e.target.value })} />
          <select className={inputClass} value={value.kycData.pixKeyType} onChange={(e) => patchKyc({ pixKeyType: e.target.value as CredigrupoKycData['pixKeyType'] })}>
            <option value="CPF">CPF</option><option value="CNPJ">CNPJ</option><option value="EMAIL">E-MAIL</option><option value="PHONE">TELEFONE</option><option value="RANDOM">ALEATORIA</option>
          </select>
        </div>
      </fieldset>

      <button type="button" onClick={() => void handleBorrowerSync()} disabled={!customerAllowed || loadingBorrower || syncingBorrower || !customer} className="w-full py-3 rounded-xl border border-[#BF953F]/30 text-[#F5D77B] text-[8px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
        {(loadingBorrower || syncingBorrower) && <Loader2 size={12} className="animate-spin" />}
        {loadingBorrower ? 'Carregando tomador existente' : value.borrower ? 'Atualizar status e elegibilidade' : 'Cadastrar tomador e iniciar KYC'}
      </button>

      {value.borrower && (
        <div className="space-y-3">
          <div className="rounded-xl border border-zinc-800 bg-black/50 p-3 flex items-center justify-between gap-3">
            <div><p className="text-[8px] font-black text-zinc-400 uppercase">KYC: {value.borrower.kycStatus}</p><p className="text-[7px] text-zinc-600 mt-1 break-all">ID: {value.borrower.borrowerId}</p></div>
            {value.borrower.kycStatus === 'approved' && <CheckCircle size={17} className="text-emerald-500" />}
          </div>
          <div className="rounded-xl border border-[#BF953F]/25 bg-black/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="flex items-center gap-2 text-[8px] font-black uppercase tracking-widest text-[#F5D77B]"><FileText size={13} /> Documentos de KYC</p>
                <p className="mt-1 text-[7px] uppercase tracking-wider text-zinc-600">
                  {value.borrower.documentsSubmitted?.length || 0} de {CREDIGRUPO_KYC_DOCUMENT_TYPES.length} enviados. JPG, PNG, WEBP ou PDF, ate 8 MB por arquivo.
                </p>
              </div>
              {value.borrower.documentsComplete && <span className="rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[7px] font-black uppercase tracking-widest text-emerald-400">Completo</span>}
            </div>
            {isAdmin ? <>
              <p className="mt-3 text-[8px] leading-relaxed text-zinc-400">Envie um ou mais arquivos. A Credigrupo preserva documentos anteriores e substitui somente o tipo reenviado.</p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {documentDefinitions.map((definition) => {
                  const file = documents[definition.type];
                  const error = documentErrors[`documents.${definition.type}`];
                  return (
                    <label key={definition.type} className={`cursor-pointer rounded-xl border p-3 ${error ? 'border-red-500/40' : file ? 'border-emerald-500/35' : 'border-zinc-800 hover:border-[#BF953F]/40'}`}>
                      <span className="block text-[8px] font-black uppercase tracking-widest text-zinc-300">{definition.label}</span>
                      <span className="mt-1 block truncate text-[7px] text-zinc-600">{file ? file.name : 'Selecionar arquivo'}</span>
                      <input
                        className="sr-only"
                        type="file"
                        accept={definition.accept}
                        onChange={(event) => {
                          const selected = event.target.files?.[0];
                          setDocuments((current) => ({ ...current, [definition.type]: selected }));
                          setDocumentErrors((current) => ({ ...current, [`documents.${definition.type}`]: undefined }));
                        }}
                      />
                      {error && <span className="mt-2 block text-[7px] text-red-400">{error}</span>}
                    </label>
                  );
                })}
              </div>
              <button type="button" onClick={() => void handleBorrowerDocuments()} disabled={uploadingDocuments || Object.keys(documents).length === 0} className="mt-3 inline-flex items-center gap-2 rounded-xl border border-[#BF953F]/30 bg-[#BF953F]/10 px-4 py-2.5 text-[8px] font-black uppercase tracking-widest text-[#F5D77B] disabled:opacity-40">
                {uploadingDocuments ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Enviar documentos selecionados
              </button>
            </> : (
              <p className="mt-3 text-[8px] text-amber-300">Somente administradores podem enviar documentos de KYC.</p>
            )}
          </div>
          <div className={`rounded-xl border p-3 ${
            eligibility.status === 'ELIGIBLE'
              ? 'border-emerald-500/25 bg-emerald-500/5'
              : eligibility.status === 'INELIGIBLE'
                ? 'border-red-500/25 bg-red-500/5'
                : 'border-amber-500/25 bg-amber-500/5'
          }`}>
            <p className={`text-[8px] font-black uppercase tracking-widest ${
              eligibility.status === 'ELIGIBLE'
                ? 'text-emerald-400'
                : eligibility.status === 'INELIGIBLE'
                  ? 'text-red-400'
                  : 'text-amber-400'
            }`}>{eligibility.title}</p>
            {eligibility.details.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[7px] font-black uppercase text-zinc-500">Motivos:</p>
                {eligibility.details.map((message) => (
                  <p key={message} className="text-[8px] leading-relaxed text-zinc-400">- {message}</p>
                ))}
              </div>
            )}
            {value.borrower.eligibilityCachedAt && (
              <p className="mt-2 text-[7px] uppercase text-zinc-600">Consulta: {value.borrower.eligibilityCachedAt}</p>
            )}
          </div>
        </div>
      )}

      <button type="button" onClick={() => void handleSimulation()} disabled={!customerAllowed || simulating || !eligibility.canSimulate} className="w-full py-3 rounded-xl bg-[#BF953F]/15 border border-[#BF953F]/30 text-[#F5D77B] text-[8px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
        {simulating && <Loader2 size={12} className="animate-spin" />} Simular oficialmente
      </button>

      {value.simulation && (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-[8px] font-black text-emerald-400 uppercase tracking-widest mb-3">Simulacao confirmada pela Credigrupo</p>
          <div className="grid grid-cols-2 gap-3 text-[9px]">
            <p className="text-zinc-500">Cliente recebe<br /><strong className="text-white">{currencyFromCents(value.simulation.simulation.netAmount)}</strong></p>
            <p className="text-zinc-500">Valor financiado<br /><strong className="text-white">{currencyFromCents(value.simulation.simulation.grossAmount)}</strong></p>
            <p className="text-zinc-500">IOF<br /><strong className="text-white">{currencyFromCents(value.simulation.simulation.totalIof)}</strong></p>
            <p className="text-zinc-500">Tarifa<br /><strong className="text-white">{currencyFromCents(value.simulation.simulation.totalFee)}</strong></p>
            <p className="text-zinc-500">Juros<br /><strong className="text-white">{currencyFromCents(value.simulation.simulation.totalInterest)}</strong></p>
            <p className="text-zinc-500">Total<br /><strong className="text-emerald-400">{currencyFromCents(value.simulation.simulation.totalAmount)}</strong></p>
          </div>
        </div>
      )}
    </div>
  );
};

export default BancarizationFields;
