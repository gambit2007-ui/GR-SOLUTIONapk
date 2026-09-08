import { describe, expect, it } from 'vitest';
import type { CreateCredigrupoInvestorRequest, CredigrupoInvestorSummary } from '../types';
import {
  CREDIGRUPO_DOCUMENT_MAX_BYTES,
  isCredigrupoInvestorEligible,
  isValidCpf,
  validateCredigrupoInvestorDocuments,
  validateCredigrupoInvestorRequest,
} from '../investorValidation';

const validPayload = (): CreateCredigrupoInvestorRequest => ({
  display_name: 'Joao da Silva',
  document: '529.982.247-25',
  birth_date: '1990-01-15',
  email: ' JOAO@EXAMPLE.COM ',
  phone: '+55 (21) 99999-9999',
  kyc_data: {
    address_street: 'Rua Um',
    address_number: '10',
    address_neighborhood: 'Centro',
    address_city: 'Rio de Janeiro',
    address_state: 'rj',
    address_zip: '20000-000',
    maritalStatus: 'SINGLE',
    monthlyIncome: 5000,
    bankCode: '001',
    bankAgency: '1234',
    bankAccount: '12345-6',
    pixKey: '52998224725',
    pixKeyType: 'CPF',
  },
});

const investor = (overrides: Partial<CredigrupoInvestorSummary> = {}): CredigrupoInvestorSummary => ({
  id: 'local-investor',
  externalId: 'external-investor',
  name: 'Investidor',
  kycStatus: 'approved',
  externalStatus: 'approved',
  provider: 'CREDIGRUPO',
  capitalOrigin: 'EXTERNAL',
  active: true,
  ...overrides,
});

describe('validacao de investidor Credigrupo', () => {
  it('normaliza e aceita o schema oficial completo', () => {
    const result = validateCredigrupoInvestorRequest(validPayload());
    expect(result.errors).toEqual({});
    expect(result.payload).toMatchObject({
      email: 'joao@example.com',
      phone: '21999999999',
      document: '52998224725',
      kyc_data: { address_state: 'RJ', address_zip: '20000000' },
    });
  });

  it('recusa formulario incompleto antes de chamar o backend', () => {
    const payload = validPayload();
    payload.display_name = '';
    payload.kyc_data.bankAccount = '';
    const result = validateCredigrupoInvestorRequest(payload);
    expect(result.errors.display_name).toBeTruthy();
    expect(result.errors['kyc_data.bankAccount']).toBeTruthy();
  });

  it('valida os digitos verificadores do CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf('529.982.247-24')).toBe(false);
  });

  it('seleciona apenas investidor aprovado, ativo e da origem escolhida', () => {
    expect(isCredigrupoInvestorEligible(investor(), 'EXTERNAL')).toBe(true);
    expect(isCredigrupoInvestorEligible(investor({ active: false }), 'EXTERNAL')).toBe(false);
    expect(isCredigrupoInvestorEligible(investor({ kycStatus: 'pending_approval' }), 'EXTERNAL')).toBe(false);
    expect(isCredigrupoInvestorEligible(investor(), 'GR')).toBe(false);
  });

  it('exige os quatro documentos oficiais no cadastro inicial', () => {
    const validImage = { name: 'arquivo.jpg', size: 1024, type: 'image/jpeg' };
    expect(validateCredigrupoInvestorDocuments({
      selfie: validImage,
      idFront: validImage,
      idBack: validImage,
      proofOfResidence: { name: 'comprovante.pdf', size: 2048, type: 'application/pdf' },
    }, { requireAll: true })).toEqual({});

    const missing = validateCredigrupoInvestorDocuments({ selfie: validImage }, { requireAll: true });
    expect(missing['documents.idFront']).toBeTruthy();
    expect(missing['documents.idBack']).toBeTruthy();
    expect(missing['documents.proofOfResidence']).toBeTruthy();
  });

  it('recusa tipo invalido e arquivo maior que 8 MB', () => {
    const result = validateCredigrupoInvestorDocuments({
      idFront: { name: 'frente.pdf', size: 1024, type: 'application/pdf' },
      idBack: { name: 'verso.heic', size: 1024, type: 'image/heic' },
      selfie: { name: 'selfie.jpg', size: CREDIGRUPO_DOCUMENT_MAX_BYTES + 1, type: 'image/jpeg' },
    });
    expect(result['documents.idFront']).toBeUndefined();
    expect(result['documents.idBack']).toContain('JPG, PNG, WEBP ou PDF');
    expect(result['documents.selfie']).toContain('8 MB');
  });
});
