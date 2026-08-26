import { FieldValue } from 'firebase-admin/firestore';
import { parseLoan } from '../../../../src/utils/domainParsers.js';
import type { Installment, Loan } from '../../../../src/types.js';
import { adminDb } from '../../firebaseAdmin.js';
import { ApiError } from '../../http.js';
import type { CredigrupoInstallmentPixResult } from '../../../../src/lib/creditProviders/types.js';
import type { CredigrupoClient, CredigrupoExternalInstallment } from './client.js';
import { removeUndefined } from './store.js';

const allowedPixHosts = new Set(['api.woovi.com']);

export const sanitizeCredigrupoPixUrl = (value: unknown): string | undefined => {
  const raw = String(value || '').trim();
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && allowedPixHosts.has(url.hostname.toLowerCase())
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

export const assertBancarizedCredigrupoLoan = (loan: Loan): void => {
  if (loan.formalizationType !== 'BANCARIZED') {
    throw new ApiError(409, 'DIRECT_CONTRACT_NOT_ALLOWED', 'Contrato GR Direto nao utiliza a Credigrupo.');
  }
  if (loan.provider !== 'CREDIGRUPO') {
    throw new ApiError(409, 'INVALID_LOAN_PROVIDER', 'Contrato nao pertence a Credigrupo.');
  }
  if (!loan.credigrupo?.proposalId) {
    throw new ApiError(409, 'PROPOSAL_NOT_AVAILABLE', 'Proposta Credigrupo ainda nao identificada.');
  }
};

export const findRequestedInstallmentIndex = (installments: Installment[], requestedId: string): number => {
  const normalized = requestedId.trim();
  if (!normalized) return -1;
  return installments.findIndex((installment) =>
    installment.id === normalized
    || installment.credigrupo?.installmentId === normalized
    || String(installment.number) === normalized,
  );
};

const mergeExternalInstallments = (
  installments: Installment[],
  externalInstallments: CredigrupoExternalInstallment[],
  updatedAt: string,
): Installment[] => installments.map((installment) => {
  const external = externalInstallments.find((item) =>
    item.id === installment.credigrupo?.installmentId
    || item.installment_number === installment.number,
  );
  if (!external) return installment;
  return {
    ...installment,
    credigrupo: removeUndefined({
      ...installment.credigrupo,
      installmentId: external.id,
      externalStatus: external.status,
      investorPayoutStatus: external.investor_payout_status || undefined,
      updatedAt,
    }),
  };
});

export const syncCredigrupoInstallments = async (
  contractId: string,
  externalInstallments: CredigrupoExternalInstallment[],
): Promise<Loan> => {
  const loanRef = adminDb.doc(`loans/${contractId}`);
  const updatedAt = new Date().toISOString();
  return adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(loanRef);
    if (!snapshot.exists) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contrato nao encontrado.');
    const loan = parseLoan(snapshot.id, snapshot.data());
    assertBancarizedCredigrupoLoan(loan);
    const installments = mergeExternalInstallments(loan.installments, externalInstallments, updatedAt);
    transaction.update(loanRef, { installments, updatedAt: FieldValue.serverTimestamp() });
    return { ...loan, installments };
  });
};

export interface ResolvedCredigrupoInstallment {
  contractId: string;
  proposalId: string;
  externalInstallmentId: string;
  installmentIndex: number;
  loan: Loan;
}

export const resolveCredigrupoInstallment = async (
  client: CredigrupoClient,
  contractIdInput: string,
  installmentIdInput: string,
): Promise<ResolvedCredigrupoInstallment> => {
  const contractId = contractIdInput.trim();
  const installmentId = installmentIdInput.trim();
  if (!contractId || contractId.includes('/')) throw new ApiError(400, 'CONTRACT_ID_REQUIRED', 'Contrato obrigatorio.');
  if (!installmentId) throw new ApiError(400, 'INSTALLMENT_ID_REQUIRED', 'Parcela obrigatoria.');

  const snapshot = await adminDb.doc(`loans/${contractId}`).get();
  if (!snapshot.exists) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contrato nao encontrado.');
  let loan = parseLoan(snapshot.id, snapshot.data());
  assertBancarizedCredigrupoLoan(loan);
  let installmentIndex = findRequestedInstallmentIndex(loan.installments, installmentId);
  if (installmentIndex < 0) throw new ApiError(404, 'INSTALLMENT_NOT_FOUND', 'Parcela nao encontrada no contrato.');

  let externalInstallmentId = loan.installments[installmentIndex]?.credigrupo?.installmentId;
  if (!externalInstallmentId) {
    const external = await client.listInstallments(loan.credigrupo!.proposalId!);
    loan = await syncCredigrupoInstallments(contractId, external.data);
    installmentIndex = findRequestedInstallmentIndex(loan.installments, installmentId);
    externalInstallmentId = loan.installments[installmentIndex]?.credigrupo?.installmentId;
  }
  if (!externalInstallmentId) {
    throw new ApiError(409, 'EXTERNAL_INSTALLMENT_NOT_AVAILABLE', 'Parcela externa ainda nao identificada. Reconcilie a operacao.');
  }

  return {
    contractId,
    proposalId: loan.credigrupo!.proposalId!,
    externalInstallmentId,
    installmentIndex,
    loan,
  };
};

export const validateCredigrupoInstallmentPix = (value: CredigrupoInstallmentPixResult): CredigrupoInstallmentPixResult => {
  const brCode = String(value.brCode || '').trim();
  const correlationID = String(value.correlationID || '').trim();
  const qrCodeImage = sanitizeCredigrupoPixUrl(value.qrCodeImage);
  const amountCents = Number(value.amountCents);
  const totalCents = Number(value.totalCents);
  const serviceFee = Number(value.serviceFee);
  if (!brCode || !correlationID || !qrCodeImage
    || !Number.isFinite(amountCents) || amountCents <= 0
    || !Number.isFinite(totalCents) || totalCents < amountCents
    || !Number.isFinite(serviceFee) || serviceFee < 0) {
    throw new ApiError(502, 'CREDIGRUPO_PIX_RESPONSE_INVALID', 'Resposta de PIX invalida recebida da Credigrupo.');
  }
  return { brCode, correlationID, qrCodeImage, amountCents, totalCents, serviceFee };
};

export const saveCredigrupoInstallmentPix = async (
  contractId: string,
  externalInstallmentId: string,
  pix: CredigrupoInstallmentPixResult,
): Promise<void> => {
  const loanRef = adminDb.doc(`loans/${contractId}`);
  const updatedAt = new Date().toISOString();
  await adminDb.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(loanRef);
    if (!snapshot.exists) throw new ApiError(404, 'CONTRACT_NOT_FOUND', 'Contrato nao encontrado.');
    const loan = parseLoan(snapshot.id, snapshot.data());
    assertBancarizedCredigrupoLoan(loan);
    const index = loan.installments.findIndex((item) => item.credigrupo?.installmentId === externalInstallmentId);
    if (index < 0) throw new ApiError(404, 'INSTALLMENT_NOT_FOUND', 'Parcela externa nao vinculada ao contrato.');
    const installments = [...loan.installments];
    installments[index] = {
      ...installments[index],
      credigrupo: removeUndefined({
        ...installments[index].credigrupo,
        installmentId: externalInstallmentId,
        pixBrcode: pix.brCode,
        pixQrCode: pix.qrCodeImage,
        pixCorrelationId: pix.correlationID,
        amountCents: pix.amountCents,
        totalCents: pix.totalCents,
        serviceFee: pix.serviceFee,
        updatedAt,
      }),
    };
    transaction.update(loanRef, { installments, updatedAt: FieldValue.serverTimestamp() });
  });
};
