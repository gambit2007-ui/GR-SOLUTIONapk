import React, { useState } from 'react';
import { CheckCircle, Loader2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { Customer, FundingSourceType } from '../../types';
import type {
  CredigrupoBorrowerState,
  CredigrupoInvestorSummary,
  CredigrupoKycData,
  CredigrupoSimulationResult,
} from '../../lib/creditProviders/types';
import {
  ensureCredigrupoBorrower,
  simulateCredigrupoLoan,
  syncCredigrupoInvestors,
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
  fundingSource: FundingSourceType;
  investorId: string;
  investorName: string;
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
  investorId: '',
  investorName: '',
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
}

const inputClass = 'w-full bg-black border border-zinc-800 rounded-xl p-3 text-white outline-none focus:border-[#BF953F] text-[10px]';
const labelClass = 'text-[8px] font-black text-zinc-500 uppercase tracking-widest ml-1';

const currencyFromCents = (value: number) =>
  (Number(value || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const BancarizationFields: React.FC<BancarizationFieldsProps> = ({ customer, terms, value, onChange, showToast }) => {
  const [investors, setInvestors] = useState<CredigrupoInvestorSummary[]>([]);
  const [loadingInvestors, setLoadingInvestors] = useState(false);
  const [syncingBorrower, setSyncingBorrower] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const patch = (fields: Partial<BancarizationDraft>) => onChange({ ...value, ...fields });
  const patchKyc = (fields: Partial<CredigrupoKycData>) => patch({ kycData: { ...value.kycData, ...fields }, simulation: undefined });

  const loadInvestors = async () => {
    setLoadingInvestors(true);
    try {
      const result = await syncCredigrupoInvestors();
      setInvestors(result);
      showToast(`${result.length} investidor(es) sincronizado(s)`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Nao foi possivel carregar investidores', 'error');
    } finally {
      setLoadingInvestors(false);
    }
  };

  React.useEffect(() => {
    void loadInvestors();
  }, []);

  const handleBorrowerSync = async () => {
    if (!customer || !value.investorId) {
      showToast('Selecione o cliente e o investidor', 'error');
      return;
    }
    setSyncingBorrower(true);
    try {
      const borrower = await ensureCredigrupoBorrower({
        customerId: customer.id,
        investorId: value.investorId,
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

  const handleSimulation = async () => {
    if (!customer || !value.investorId || value.borrower?.kycStatus !== 'approved') {
      showToast('O KYC do tomador precisa estar aprovado', 'error');
      return;
    }
    if (value.borrower.ccbEligible === false) {
      showToast(value.borrower.eligibilityErrors?.join(' ') || 'Tomador nao elegivel para CCB', 'error');
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
        investorId: value.investorId,
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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-[#BF953F]" />
          <div>
            <p className="text-[9px] font-black text-[#F5D77B] uppercase tracking-widest">Credigrupo - Sandbox</p>
            <p className="text-[7px] text-zinc-500 uppercase mt-1">Nenhuma operacao real sera executada</p>
          </div>
        </div>
        <button type="button" onClick={() => void loadInvestors()} disabled={loadingInvestors} className="p-2 rounded-lg border border-zinc-800 text-zinc-400 disabled:opacity-50" title="Sincronizar investidores">
          <RefreshCw size={13} className={loadingInvestors ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={labelClass}>Origem do capital</label>
          <select value={value.fundingSource} onChange={(event) => patch({ fundingSource: event.target.value as FundingSourceType, simulation: undefined })} className={inputClass}>
            <option value="GR">GR SOLUTION</option>
            <option value="EXTERNAL">INVESTIDOR EXTERNO</option>
          </select>
        </div>
        <div className="space-y-1">
          <label className={labelClass}>Investidor</label>
          <select
            required
            value={value.investorId}
            onChange={(event) => {
              const investor = investors.find((item) => item.id === event.target.value);
              patch({ investorId: event.target.value, investorName: investor?.name || '', borrower: undefined, simulation: undefined });
            }}
            className={inputClass}
          >
            <option value="">SELECIONE</option>
            {investors.map((investor) => (
              <option key={investor.id} value={investor.id} disabled={investor.kycStatus !== 'approved'}>
                {investor.name.toUpperCase()} - {investor.kycStatus.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="pt-3 border-t border-zinc-800">
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
      </div>

      <button type="button" onClick={() => void handleBorrowerSync()} disabled={syncingBorrower || !value.investorId} className="w-full py-3 rounded-xl border border-[#BF953F]/30 text-[#F5D77B] text-[8px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
        {syncingBorrower && <Loader2 size={12} className="animate-spin" />}
        {value.borrower ? 'Atualizar status e elegibilidade' : 'Cadastrar tomador e iniciar KYC'}
      </button>

      {value.borrower && (
        <div className="rounded-xl border border-zinc-800 bg-black/50 p-3 flex items-center justify-between gap-3">
          <div><p className="text-[8px] font-black text-zinc-400 uppercase">KYC: {value.borrower.kycStatus}</p><p className="text-[7px] text-zinc-600 mt-1 break-all">ID: {value.borrower.borrowerId}</p></div>
          {value.borrower.kycStatus === 'approved' && <CheckCircle size={17} className="text-emerald-500" />}
        </div>
      )}

      <button type="button" onClick={() => void handleSimulation()} disabled={simulating || value.borrower?.kycStatus !== 'approved'} className="w-full py-3 rounded-xl bg-[#BF953F]/15 border border-[#BF953F]/30 text-[#F5D77B] text-[8px] font-black uppercase tracking-widest disabled:opacity-40 flex items-center justify-center gap-2">
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
