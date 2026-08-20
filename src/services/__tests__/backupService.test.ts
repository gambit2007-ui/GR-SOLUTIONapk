import { describe, expect, it } from 'vitest';
import {
  createBackupPayloadWithIntegrity,
  validateBackupPayload,
  type BackupPayloadWithoutIntegrity,
} from '../backupService';

const content: BackupPayloadWithoutIntegrity = {
  schemaVersion: 2,
  generatedAt: '2026-08-20T12:00:00.000Z',
  customers: [{ id: 'customer-1', name: 'Cliente Teste' }],
  loans: [{ id: 'loan-1', amount: 100 }],
  cashMovement: [],
  settings: [],
  monthlySnapshots: [],
  migrationRuns: [],
  assetSummary: {
    embeddedCustomerPhotos: 0,
    embeddedCustomerDocuments: 0,
    failedAssets: 0,
  },
};

describe('backupService integrity', () => {
  it('valida um backup sem alteracoes', async () => {
    const payload = await createBackupPayloadWithIntegrity(content);
    await expect(validateBackupPayload(payload)).resolves.toBe(true);
  });

  it('detecta adulteracao depois da geracao', async () => {
    const payload = await createBackupPayloadWithIntegrity(content);
    payload.loans[0].amount = 999;
    await expect(validateBackupPayload(payload)).resolves.toBe(false);
  });
});
