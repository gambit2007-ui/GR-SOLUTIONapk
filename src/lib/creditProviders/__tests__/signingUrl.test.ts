import { describe, expect, it } from 'vitest';
import {
  CREDIGRUPO_SIGNING_HOSTS,
  resolveCredigrupoCcbSigningLinks,
  validateCredigrupoSigningUrl,
} from '../signingUrl';

describe('links de assinatura Credigrupo', () => {
  it.each([
    ['producao', 'https://app.zapsign.com.br/verificar/borrower-token', 'app.zapsign.com.br'],
    ['sandbox', 'https://sandbox.app.zapsign.com.br/verificar/investor-token', 'sandbox.app.zapsign.com.br'],
  ])('aceita host oficial de %s', (_name, value, hostname) => {
    expect(validateCredigrupoSigningUrl(value)).toEqual({
      valid: true,
      url: value,
      protocol: 'https:',
      hostname,
    });
  });

  it.each([
    ['HTTP', 'http://app.zapsign.com.br/verificar/token', 'HTTPS_REQUIRED'],
    ['dominio semelhante', 'https://app.zapsign.com.br.evil.example/verificar/token', 'HOST_NOT_ALLOWED'],
    ['sufixo malicioso', 'https://zapsign.com.br.attacker.example/verificar/token', 'HOST_NOT_ALLOWED'],
    ['subdominio nao autorizado', 'https://sign.app.zapsign.com.br/verificar/token', 'HOST_NOT_ALLOWED'],
    ['credenciais', 'https://usuario:senha@app.zapsign.com.br/verificar/token', 'CREDENTIALS_NOT_ALLOWED'],
    ['porta', 'https://app.zapsign.com.br:444/verificar/token', 'PORT_NOT_ALLOWED'],
    ['URL invalida', 'nao e uma url', 'INVALID_URL'],
  ])('rejeita %s', (_name, value, reason) => {
    const result = validateCredigrupoSigningUrl(value);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.diagnostic.reason).toBe(reason);
  });

  it('mantem allowlist explicita sem wildcard', () => {
    expect([...CREDIGRUPO_SIGNING_HOSTS]).toEqual([
      'app.zapsign.com.br',
      'sandbox.app.zapsign.com.br',
    ]);
  });

  it('diagnostico rejeitado nao contem token, caminho, query ou fragmento', () => {
    const secretUrl = 'https://evil.example/verificar/TOKEN-SECRETO?auth=SEGREDO#FRAGMENTO';
    const result = validateCredigrupoSigningUrl(secretUrl);
    expect(result.valid).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('evil.example');
    expect(serialized).not.toContain('TOKEN-SECRETO');
    expect(serialized).not.toContain('SEGREDO');
    expect(serialized).not.toContain('FRAGMENTO');
    expect(serialized).not.toContain('/verificar/');
  });

  it('aceita investidor pre-assinado sem transformar o marcador em URL', () => {
    const result = resolveCredigrupoCcbSigningLinks(
      'https://app.zapsign.com.br/verificar/borrower-token',
      'pre-signed',
    );
    expect(result).toMatchObject({ valid: true, investorPreSigned: true });
    expect(result.investor).toBeUndefined();
  });
});
