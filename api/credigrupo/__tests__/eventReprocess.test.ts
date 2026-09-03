import type { VercelRequest, VercelResponse } from '@vercel/node';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../_lib/http';
import { handleCredigrupoEventReprocess } from '../events/reprocess';

const responseDouble = () => {
  const state: { status?: number; payload?: unknown } = {};
  const response = {
    status(code: number) {
      state.status = code;
      return response;
    },
    json(payload: unknown) {
      state.payload = payload;
      return response;
    },
  } as unknown as VercelResponse;
  return { response, state };
};

const requestDouble = (body: unknown) => ({ method: 'POST', body, headers: {} }) as VercelRequest;

describe('rota ADMIN de recuperacao dos links CCB', () => {
  it('permite a acao exclusivamente para ADMIN e encaminha somente operationId', async () => {
    const recover = vi.fn().mockResolvedValue({ recovered: true, status: 'AWAITING_SIGNATURES' });
    const { response, state } = responseDouble();
    await handleCredigrupoEventReprocess(
      requestDouble({ action: 'reprocess_ccb_signing_links', operationId: 'operation-1' }),
      response,
      {
        requireActor: vi.fn().mockResolvedValue({ uid: 'admin-1', admin: true }),
        recoverCcbSigningLinks: recover,
      },
    );
    expect(state.status).toBe(200);
    expect(recover).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledWith('operation-1');
  });

  it('retorna 401 quando nao autenticado', async () => {
    const recover = vi.fn();
    const { response, state } = responseDouble();
    await handleCredigrupoEventReprocess(
      requestDouble({ action: 'reprocess_ccb_signing_links', operationId: 'operation-1' }),
      response,
      {
        requireActor: vi.fn().mockRejectedValue(new ApiError(401, 'AUTH_REQUIRED', 'Autenticacao obrigatoria.')),
        recoverCcbSigningLinks: recover,
      },
    );
    expect(state.status).toBe(401);
    expect(recover).not.toHaveBeenCalled();
  });

  it('retorna 403 para usuario sem permissao administrativa', async () => {
    const recover = vi.fn();
    const { response, state } = responseDouble();
    await handleCredigrupoEventReprocess(
      requestDouble({ action: 'reprocess_ccb_signing_links', operationId: 'operation-1' }),
      response,
      {
        requireActor: vi.fn().mockResolvedValue({ uid: 'user-1', admin: false }),
        recoverCcbSigningLinks: recover,
      },
    );
    expect(state.status).toBe(403);
    expect(recover).not.toHaveBeenCalled();
  });

  it('rejeita action desconhecida sem executar recuperacao', async () => {
    const recover = vi.fn();
    const { response, state } = responseDouble();
    await handleCredigrupoEventReprocess(
      requestDouble({ action: 'test-pay', operationId: 'operation-1' }),
      response,
      {
        requireActor: vi.fn().mockResolvedValue({ uid: 'admin-1', admin: true }),
        recoverCcbSigningLinks: recover,
      },
    );
    expect(state.status).toBe(400);
    expect(recover).not.toHaveBeenCalled();
  });
});
