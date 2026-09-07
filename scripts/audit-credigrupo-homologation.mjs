// Read-only preview. Uses existing Application Default Credentials, never provider credentials.
import { applicationDefault, initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const projectId = 'grsolution-8e6cb';
const app = initializeApp({ projectId, credential: applicationDefault() });
const db = getFirestore(app);
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(value) ? value : null;
const safeStatus = (value) => typeof value === 'string' && /^[a-zA-Z_]{1,80}$/.test(value) ? value : null;
const date = (value) => value?.toDate?.().toISOString() || null;
const rows = (snapshot) => snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
const fields = ['customerId', 'borrowerId', 'proposalId', 'simulationId', 'simulationExternalId',
  'usedByOperationId', 'localLoanId', 'loanId', 'operationId', 'status', 'externalStatus',
  'formalizationStatus', 'environment', 'testData', 'archived', 'createdAt', 'updatedAt'];
const summary = (item) => ({
  id: safeId(item.id), customerId: safeId(item.customerId), borrowerId: safeId(item.borrowerId),
  proposalId: safeId(item.proposalId), simulationId: safeId(item.simulationId),
  simulationExternalId: safeId(item.simulationExternalId || item.response?.externalId),
  localLoanId: safeId(item.localLoanId), usedByOperationId: safeId(item.usedByOperationId),
  status: safeStatus(item.status), externalStatus: safeStatus(item.externalStatus),
  formalizationStatus: safeStatus(item.formalizationStatus),
  environment: ['sandbox', 'production'].includes(item.environment) ? item.environment : null,
  testData: item.testData === true, archived: item.archived === true,
  createdAt: date(item.createdAt), updatedAt: date(item.updatedAt),
});

try {
  const customers = rows(await db.collection('clientes').where('name', 'in', [
    'CLIENTE TESTE CREDIGRUPO 20260831', 'Robson Leandro', 'ROBSON LEANDRO',
  ]).select('environment', 'testData', 'archived', 'createdAt', 'credigrupo.borrowerId').get());
  const candidates = [];
  for (const customer of customers) {
    const [borrowers, simulations, operations, loans] = await Promise.all([
      db.collection('creditBorrowers').where('customerId', '==', customer.id).select(...fields).get(),
      db.collection('creditSimulations').where('customerId', '==', customer.id).select(...fields, 'response.externalId').get(),
      db.collection('creditOperations').where('customerId', '==', customer.id).select(...fields).get(),
      db.collection('loans').where('customerId', '==', customer.id).select(...fields).get(),
    ]);
    const operationRows = rows(operations);
    const loanIds = new Set([...loans.docs.map((doc) => doc.id), ...operationRows.map((row) => row.localLoanId).filter(Boolean)]);
    const links = [ ['customerId', customer.id],
      ...Array.from(loanIds).map((id) => ['loanId', id]),
      ...operationRows.flatMap((row) => [['operationId', row.id], ...(row.proposalId ? [['proposalId', row.proposalId]] : [])]),
    ];
    const financial = {};
    for (const collection of ['cashMovement', 'creditInvestorLedger']) {
      const matches = new Set();
      for (const [field, id] of links) {
        const snapshot = await db.collection(collection).where(field, '==', id).select().get();
        snapshot.docs.forEach((document) => matches.add(document.id));
      }
      financial[collection] = Array.from(matches).map(safeId);
    }
    candidates.push({
      customerId: customer.id, borrowerId: safeId(customer.credigrupo?.borrowerId),
      environment: summary(customer).environment, testData: customer.testData === true,
      archived: customer.archived === true,
      borrowers: rows(borrowers).map(summary), simulations: rows(simulations).map(summary),
      operations: operationRows.map(summary), loans: rows(loans).map(summary), financial,
      archiveRequiresReview: true,
    });
  }
  console.log(JSON.stringify({ mode: 'READ_ONLY_PREVIEW', projectId, candidates, writes: 0 }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'AUDIT_UNAVAILABLE', code: typeof error.code === 'number' ? error.code : 'ADMIN_ACCESS_REQUIRED', writes: 0 }));
  process.exitCode = 1;
} finally {
  await db.terminate().catch(() => undefined);
  await deleteApp(app).catch(() => undefined);
}
