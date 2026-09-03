export const CREDIGRUPO_SIGNING_HOSTS = new Set([
  'app.zapsign.com.br',
  'sandbox.app.zapsign.com.br',
]);

export type CredigrupoSigningUrlRejectionReason =
  | 'EMPTY_URL'
  | 'INVALID_URL'
  | 'HTTPS_REQUIRED'
  | 'HOST_NOT_ALLOWED'
  | 'CREDENTIALS_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED';

export interface CredigrupoSigningUrlDiagnostic {
  protocol?: string;
  hostname?: string;
  reason: CredigrupoSigningUrlRejectionReason;
}

export type CredigrupoSigningUrlValidation =
  | { valid: true; url: string; protocol: 'https:'; hostname: string }
  | { valid: false; diagnostic: CredigrupoSigningUrlDiagnostic };

export interface CredigrupoCcbSigningLinks {
  valid: boolean;
  borrower?: Extract<CredigrupoSigningUrlValidation, { valid: true }>;
  investor?: Extract<CredigrupoSigningUrlValidation, { valid: true }>;
  investorPreSigned: boolean;
  diagnostics: {
    borrower?: CredigrupoSigningUrlDiagnostic;
    investor?: CredigrupoSigningUrlDiagnostic;
  };
}

export const validateCredigrupoSigningUrl = (value: unknown): CredigrupoSigningUrlValidation => {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return { valid: false, diagnostic: { reason: 'EMPTY_URL' } };

  try {
    const url = new URL(raw);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const diagnosticBase = { protocol, hostname };

    if (protocol !== 'https:') {
      return { valid: false, diagnostic: { ...diagnosticBase, reason: 'HTTPS_REQUIRED' } };
    }
    if (url.username || url.password) {
      return { valid: false, diagnostic: { ...diagnosticBase, reason: 'CREDENTIALS_NOT_ALLOWED' } };
    }
    if (url.port) {
      return { valid: false, diagnostic: { ...diagnosticBase, reason: 'PORT_NOT_ALLOWED' } };
    }
    if (!CREDIGRUPO_SIGNING_HOSTS.has(hostname)) {
      return { valid: false, diagnostic: { ...diagnosticBase, reason: 'HOST_NOT_ALLOWED' } };
    }

    return { valid: true, url: url.toString(), protocol: 'https:', hostname };
  } catch {
    return { valid: false, diagnostic: { reason: 'INVALID_URL' } };
  }
};

export const resolveCredigrupoCcbSigningLinks = (
  borrowerSignUrl: unknown,
  investorSignUrl: unknown,
): CredigrupoCcbSigningLinks => {
  const borrower = validateCredigrupoSigningUrl(borrowerSignUrl);
  const investorPreSigned = typeof investorSignUrl === 'string' && investorSignUrl.trim() === 'pre-signed';
  const investor = investorPreSigned ? undefined : validateCredigrupoSigningUrl(investorSignUrl);
  const diagnostics = {
    borrower: borrower.valid ? undefined : borrower.diagnostic,
    investor: investorPreSigned || investor?.valid ? undefined : investor?.diagnostic,
  };

  return {
    valid: borrower.valid && (investorPreSigned || investor?.valid === true),
    borrower: borrower.valid ? borrower : undefined,
    investor: investor?.valid ? investor : undefined,
    investorPreSigned,
    diagnostics,
  };
};
