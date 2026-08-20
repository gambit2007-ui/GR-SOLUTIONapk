import { describe, expect, it } from 'vitest';
import { sanitizeFirestorePayload } from '../firestoreSanitizer';

class qB {
  readonly _methodName = 'serverTimestamp';

  isEqual(other: unknown): boolean {
    return other === this;
  }
}

describe('sanitizeFirestorePayload', () => {
  it('preserva FieldValue mesmo quando a classe foi renomeada no bundle', () => {
    const timestamp = new qB();
    const result = sanitizeFirestorePayload({
      lastOperationAt: timestamp,
      ignored: undefined,
    });

    expect(result.lastOperationAt).toBe(timestamp);
    expect('ignored' in result).toBe(false);
  });
});
