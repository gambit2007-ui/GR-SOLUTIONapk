import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { adminDb } from '../../firebaseAdmin';
import { ApiError, AuthorizedActor } from '../../http';
import type {
  CreateBancarizedLoanRequest,
  CredigrupoOperationSummary,
  CredigrupoSimulationRequest,
  CredigrupoSimulationResult,
  FundingSourceType,
} from '../../../../src/lib/creditProviders/types';

export interface StoredCredigrupoOperation {
  customerId: string;
  customerName: string;
  customerPhone?: string;
  borrowerId: string;
  investorId: string;
  investorName: string;
  fundingSource: FundingSourceType;
  amountCents: number;
  installments: number;
  interestRate: number;
  firstPaymentDate: string;
  frequency: 'monthly' | 'weekly';
  interestType: 'simple' | 'compound';
  simulation: CredigrupoSimulationResult['simulation'];
  simulationExternalId: string;
  status: string;
  externalStatus?: string;
  proposalId?: string;
  requestId?: string;
  localLoanId?: string;
  pix?: Record<string, unknown>;
  borrowerSignUrl?: string;
  investorSignUrl?: string;
  ccbUrl?: string;
  createdByUid: string;
  createdByEmail?: string;
  createdByName?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

export interface StoredCredigrupoSimulation {
  customerId: string;
  customerName: string;
  customerPhone?: string;
  borrowerId: string;
  investorId: string;
  request: CredigrupoSimulationRequest;
  response: Omit<CredigrupoSimulationResult, 'simulationId'>;
  createdByUid: string;
  usedByOperationId?: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export const removeUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((item) => removeUndefined(item)) as T;
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Timestamp) && !(value instanceof FieldValue)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, removeUndefined(item)]),
    ) as T;
  }
  return value;
};

export const borrowerLinkId = (customerId: string, investorId: string) =>
  `${customerId}__${investorId}`.replace(/[^a-zA-Z0-9_-]/g, '_');

export const findOperationByProposalId = async (proposalId: string) => {
  const snapshot = await adminDb.collection('creditOperations').where('proposalId', '==', proposalId).limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0];
};

export const loadSimulationForCreation = async (
  simulationId: string,
  actor: AuthorizedActor,
): Promise<StoredCredigrupoSimulation> => {
  const snapshot = await adminDb.doc(`creditSimulations/${simulationId}`).get();
  if (!snapshot.exists) throw new ApiError(404, 'SIMULATION_NOT_FOUND', 'Simulacao nao encontrada.');
  const simulation = snapshot.data() as StoredCredigrupoSimulation;
  if (simulation.createdByUid !== actor.uid && !actor.admin) {
    throw new ApiError(403, 'SIMULATION_ACCESS_DENIED', 'Simulacao pertence a outro usuario.');
  }
  if (simulation.usedByOperationId) {
    throw new ApiError(409, 'SIMULATION_ALREADY_USED', 'Esta simulacao ja foi utilizada.');
  }
  if (simulation.expiresAt.toMillis() < Date.now()) {
    throw new ApiError(409, 'SIMULATION_EXPIRED', 'A simulacao expirou. Gere uma nova.');
  }
  return simulation;
};

export const reserveCredigrupoOperation = async (
  request: CreateBancarizedLoanRequest,
  actor: AuthorizedActor,
): Promise<{ duplicate: boolean; operation: StoredCredigrupoOperation }> => {
  const operationRef = adminDb.doc(`creditOperations/${request.operationId}`);
  const simulationRef = adminDb.doc(`creditSimulations/${request.simulationId}`);

  return adminDb.runTransaction(async (transaction) => {
    const [existingOperation, simulationSnapshot] = await Promise.all([
      transaction.get(operationRef),
      transaction.get(simulationRef),
    ]);

    if (existingOperation.exists) {
      return { duplicate: true, operation: existingOperation.data() as StoredCredigrupoOperation };
    }
    if (!simulationSnapshot.exists) throw new ApiError(404, 'SIMULATION_NOT_FOUND', 'Simulacao nao encontrada.');

    const simulation = simulationSnapshot.data() as StoredCredigrupoSimulation;
    if (simulation.createdByUid !== actor.uid && !actor.admin) {
      throw new ApiError(403, 'SIMULATION_ACCESS_DENIED', 'Simulacao pertence a outro usuario.');
    }
    if (simulation.usedByOperationId) throw new ApiError(409, 'SIMULATION_ALREADY_USED', 'Simulacao ja utilizada.');
    if (simulation.expiresAt.toMillis() < Date.now()) throw new ApiError(409, 'SIMULATION_EXPIRED', 'A simulacao expirou.');
    const investorSnapshot = await transaction.get(adminDb.doc(`creditInvestors/${simulation.investorId}`));
    if (!investorSnapshot.exists || investorSnapshot.data()?.kycStatus !== 'approved') {
      throw new ApiError(409, 'INVESTOR_NOT_APPROVED', 'Investidor nao encontrado ou ainda nao aprovado.');
    }
    const investorName = String(investorSnapshot.data()?.name || '').trim();
    if (!investorName) throw new ApiError(409, 'INVESTOR_NAME_UNAVAILABLE', 'Nome do investidor indisponivel. Sincronize novamente.');

    const operation: StoredCredigrupoOperation = {
      customerId: simulation.customerId,
      customerName: simulation.customerName,
      customerPhone: simulation.customerPhone,
      borrowerId: simulation.borrowerId,
      investorId: simulation.investorId,
      investorName,
      fundingSource: request.fundingSource,
      amountCents: simulation.request.amountCents,
      installments: simulation.request.installments,
      interestRate: simulation.request.interestRate,
      firstPaymentDate: simulation.request.firstPaymentDate,
      frequency: simulation.request.frequency,
      interestType: simulation.request.interestType,
      simulation: simulation.response.simulation,
      simulationExternalId: simulation.response.externalId,
      status: 'CREATING',
      createdByUid: actor.uid,
      createdByEmail: actor.email,
      createdByName: actor.name,
    };

    transaction.create(operationRef, removeUndefined({
      ...operation,
      formalizationType: 'BANCARIZED',
      provider: 'CREDIGRUPO',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }));
    transaction.update(simulationRef, {
      usedByOperationId: request.operationId,
      usedAt: FieldValue.serverTimestamp(),
    });
    return { duplicate: false, operation };
  });
};

export const toOperationSummary = (id: string, operation: StoredCredigrupoOperation): CredigrupoOperationSummary => ({
  id,
  customerId: operation.customerId,
  customerName: operation.customerName,
  investorId: operation.investorId,
  investorName: operation.investorName,
  fundingSource: operation.fundingSource,
  proposalId: operation.proposalId,
  localLoanId: operation.localLoanId,
  status: operation.status,
  externalStatus: operation.externalStatus,
  amountCents: operation.amountCents,
  installments: operation.installments,
  createdAt: operation.createdAt?.toDate().toISOString(),
  pix: operation.pix as CredigrupoOperationSummary['pix'],
  borrowerSignUrl: operation.borrowerSignUrl,
  investorSignUrl: operation.investorSignUrl,
  ccbUrl: operation.ccbUrl,
});
