import type {
  CreateCredigrupoInvestorRequest,
  CredigrupoInvestorDocumentType,
  CredigrupoInvestorSummary,
  FundingSourceType,
} from './types';

export type CredigrupoInvestorField =
  | 'display_name'
  | 'document'
  | 'birth_date'
  | 'email'
  | 'phone'
  | 'kyc_data.address_street'
  | 'kyc_data.address_number'
  | 'kyc_data.address_neighborhood'
  | 'kyc_data.address_city'
  | 'kyc_data.address_state'
  | 'kyc_data.address_zip'
  | 'kyc_data.maritalStatus'
  | 'kyc_data.monthlyIncome'
  | 'kyc_data.bankCode'
  | 'kyc_data.bankAgency'
  | 'kyc_data.bankAccount'
  | 'kyc_data.pixKey'
  | 'kyc_data.pixKeyType'
  | 'documents.selfie'
  | 'documents.idFront'
  | 'documents.idBack'
  | 'documents.proofOfResidence';

export type CredigrupoInvestorFieldErrors = Partial<Record<CredigrupoInvestorField, string>>;

const digits = (value: unknown) => String(value || '').replace(/\D/g, '');
const text = (value: unknown) => String(value || '').trim();

export const CREDIGRUPO_DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
export const CREDIGRUPO_INVESTOR_DOCUMENT_TYPES: CredigrupoInvestorDocumentType[] = [
  'selfie',
  'idFront',
  'idBack',
  'proofOfResidence',
];

interface InvestorDocumentFile {
  name: string;
  size: number;
  type: string;
}

export type CredigrupoInvestorDocumentFiles = Partial<Record<CredigrupoInvestorDocumentType, InvestorDocumentFile | null>>;

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

export const validateCredigrupoInvestorDocuments = (
  documents: CredigrupoInvestorDocumentFiles,
  options: { requireAll?: boolean } = {},
): CredigrupoInvestorFieldErrors => {
  const errors: CredigrupoInvestorFieldErrors = {};
  const selected = CREDIGRUPO_INVESTOR_DOCUMENT_TYPES.filter((type) => documents[type]);

  if (options.requireAll && selected.length !== CREDIGRUPO_INVESTOR_DOCUMENT_TYPES.length) {
    CREDIGRUPO_INVESTOR_DOCUMENT_TYPES.forEach((type) => {
      if (!documents[type]) errors[`documents.${type}`] = 'Arquivo obrigatorio para o KYC.';
    });
  } else if (!options.requireAll && selected.length === 0) {
    errors['documents.selfie'] = 'Selecione pelo menos um arquivo.';
  }

  selected.forEach((type) => {
    const file = documents[type];
    if (!file) return;
    const allowed = imageTypes.has(file.type)
      || (type === 'proofOfResidence' && file.type === 'application/pdf');
    if (!allowed) {
      errors[`documents.${type}`] = type === 'proofOfResidence'
        ? 'Envie JPG, PNG, WEBP ou PDF.'
        : 'Envie uma imagem JPG, PNG ou WEBP.';
    } else if (file.size <= 0 || file.size > CREDIGRUPO_DOCUMENT_MAX_BYTES) {
      errors[`documents.${type}`] = 'O arquivo deve ter no maximo 8 MB.';
    }
  });

  return errors;
};

export const isValidCpf = (value: unknown): boolean => {
  const cpf = digits(value);
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  return calculateDigit(9) === Number(cpf[9]) && calculateDigit(10) === Number(cpf[10]);
};

export const normalizeCredigrupoInvestorRequest = (
  value: CreateCredigrupoInvestorRequest,
): CreateCredigrupoInvestorRequest => {
  const rawPhone = digits(value.phone);
  const phone = (rawPhone.length === 12 || rawPhone.length === 13) && rawPhone.startsWith('55')
    ? rawPhone.slice(2)
    : rawPhone;

  return {
    email: text(value.email).toLowerCase(),
    display_name: text(value.display_name).replace(/\s+/g, ' '),
    phone,
    document: digits(value.document),
    birth_date: text(value.birth_date),
    kyc_data: {
      address_street: text(value.kyc_data?.address_street),
      address_number: text(value.kyc_data?.address_number),
      address_neighborhood: text(value.kyc_data?.address_neighborhood),
      address_city: text(value.kyc_data?.address_city),
      address_state: text(value.kyc_data?.address_state).toUpperCase(),
      address_zip: digits(value.kyc_data?.address_zip),
      maritalStatus: text(value.kyc_data?.maritalStatus) as CreateCredigrupoInvestorRequest['kyc_data']['maritalStatus'],
      monthlyIncome: Number(value.kyc_data?.monthlyIncome),
      bankCode: digits(value.kyc_data?.bankCode),
      bankAgency: text(value.kyc_data?.bankAgency),
      bankAccount: text(value.kyc_data?.bankAccount),
      pixKey: text(value.kyc_data?.pixKey),
      pixKeyType: text(value.kyc_data?.pixKeyType) as CreateCredigrupoInvestorRequest['kyc_data']['pixKeyType'],
    },
  };
};

export const validateCredigrupoInvestorRequest = (
  value: CreateCredigrupoInvestorRequest,
): { payload: CreateCredigrupoInvestorRequest; errors: CredigrupoInvestorFieldErrors } => {
  const payload = normalizeCredigrupoInvestorRequest(value);
  const errors: CredigrupoInvestorFieldErrors = {};
  const kyc = payload.kyc_data;

  if (payload.display_name.length < 3) errors.display_name = 'Informe o nome completo.';
  if (!isValidCpf(payload.document)) errors.document = 'Informe um CPF valido.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.birth_date) || Number.isNaN(Date.parse(`${payload.birth_date}T12:00:00Z`))) {
    errors.birth_date = 'Informe uma data de nascimento valida.';
  } else if (payload.birth_date >= new Date().toISOString().slice(0, 10)) {
    errors.birth_date = 'A data de nascimento deve estar no passado.';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) errors.email = 'Informe um e-mail valido.';
  if (!/^\d{10,11}$/.test(payload.phone)) errors.phone = 'Informe telefone com DDD.';
  if (!kyc.address_street) errors['kyc_data.address_street'] = 'Informe a rua.';
  if (!kyc.address_number) errors['kyc_data.address_number'] = 'Informe o numero.';
  if (!kyc.address_neighborhood) errors['kyc_data.address_neighborhood'] = 'Informe o bairro.';
  if (!kyc.address_city) errors['kyc_data.address_city'] = 'Informe a cidade.';
  if (!/^[A-Z]{2}$/.test(kyc.address_state)) errors['kyc_data.address_state'] = 'Informe a UF.';
  if (!/^\d{8}$/.test(kyc.address_zip)) errors['kyc_data.address_zip'] = 'Informe um CEP valido.';
  if (!['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'].includes(kyc.maritalStatus)) {
    errors['kyc_data.maritalStatus'] = 'Selecione o estado civil.';
  }
  if (!Number.isFinite(kyc.monthlyIncome) || kyc.monthlyIncome <= 0) {
    errors['kyc_data.monthlyIncome'] = 'Informe uma renda mensal valida.';
  }
  if (!/^\d{3}$/.test(kyc.bankCode)) errors['kyc_data.bankCode'] = 'Use o codigo bancario de 3 digitos.';
  if (!kyc.bankAgency) errors['kyc_data.bankAgency'] = 'Informe a agencia.';
  if (!kyc.bankAccount) errors['kyc_data.bankAccount'] = 'Informe a conta.';
  if (!kyc.pixKey) errors['kyc_data.pixKey'] = 'Informe a chave PIX.';
  if (!['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'RANDOM'].includes(kyc.pixKeyType)) {
    errors['kyc_data.pixKeyType'] = 'Selecione o tipo da chave PIX.';
  }

  return { payload, errors };
};

export const isCredigrupoInvestorEligible = (
  investor: CredigrupoInvestorSummary,
  capitalOrigin: FundingSourceType,
) => investor.provider === 'CREDIGRUPO'
  && investor.active
  && investor.kycStatus === 'approved'
  && investor.capitalOrigin === capitalOrigin;
