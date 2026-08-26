import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAuthorizedActor } from '../../_lib/auth';
import { CredigrupoClient } from '../../_lib/credit-providers/credigrupo/client';
import {
  resolveCredigrupoInstallment,
  saveCredigrupoInstallmentPix,
  validateCredigrupoInstallmentPix,
} from '../../_lib/credit-providers/credigrupo/installments';
import { ApiError, handleApiError, parseJsonBody, sendJson } from '../../_lib/http';

export default async function handler(request: VercelRequest, response: VercelResponse) {
  try {
    if (request.method !== 'POST') return sendJson(response, 405, { error: 'METHOD_NOT_ALLOWED' });
    const actor = await requireAuthorizedActor(request);
    if (!actor.admin) throw new ApiError(403, 'ADMIN_REQUIRED', 'Somente administradores podem gerar PIX de parcela.');
    const input = parseJsonBody<{ contractId?: string; installmentId?: string }>(request);
    const client = new CredigrupoClient();
    const context = await resolveCredigrupoInstallment(
      client,
      String(input.contractId || ''),
      String(input.installmentId || ''),
    );
    const pix = validateCredigrupoInstallmentPix(
      await client.createInstallmentPix(context.proposalId, context.externalInstallmentId),
    );
    await saveCredigrupoInstallmentPix(context.contractId, context.externalInstallmentId, pix);
    return sendJson(response, 200, pix);
  } catch (error) {
    return handleApiError(response, error);
  }
}
