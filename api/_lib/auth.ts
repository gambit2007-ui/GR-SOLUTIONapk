import type { VercelRequest } from '@vercel/node';
import { adminAuth, adminDb } from './firebaseAdmin';
import { ApiError, AuthorizedActor } from './http';

export const requireAuthorizedActor = async (request: VercelRequest): Promise<AuthorizedActor> => {
  const authorization = String(request.headers.authorization || '').trim();
  if (!authorization.startsWith('Bearer ')) {
    throw new ApiError(401, 'AUTH_REQUIRED', 'Autenticacao obrigatoria.');
  }

  let token;
  try {
    token = await adminAuth.verifyIdToken(authorization.slice(7));
  } catch {
    throw new ApiError(401, 'INVALID_AUTH_TOKEN', 'Sessao invalida ou expirada.');
  }

  const [accessControlSnapshot, authorizedUserSnapshot] = await Promise.all([
    adminDb.doc('settings/accessControl').get(),
    adminDb.doc(`authorizedUsers/${token.uid}`).get(),
  ]);
  const accessControlEnforced = accessControlSnapshot.exists && accessControlSnapshot.data()?.enforced === true;
  const role = String(authorizedUserSnapshot.data()?.role || '').toUpperCase();
  const isAdmin = token.admin === true || role === 'ADMIN';

  if (accessControlEnforced && !authorizedUserSnapshot.exists && token.admin !== true) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Usuario nao autorizado.');
  }

  return {
    uid: token.uid,
    email: token.email,
    name: typeof token.name === 'string' ? token.name : undefined,
    admin: isAdmin,
  };
};
