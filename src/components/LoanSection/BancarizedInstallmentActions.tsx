import React, { useEffect, useState } from 'react';
import { Copy, FlaskConical, Loader2, QrCode, RefreshCw } from 'lucide-react';
import type { CredigrupoInstallmentPixResult } from '../../lib/creditProviders/types';
import {
  createCredigrupoInstallmentPix,
  testPayCredigrupoSandbox,
} from '../../services/credigrupoService';
import type { Installment } from '../../types';
import { normalizeInstallmentStatus } from '../../utils/loanCompat';

interface BancarizedInstallmentActionsProps {
  contractId: string;
  installment: Installment;
  isAdmin: boolean;
  isSandbox: boolean;
  showToast: (message: string, type?: 'success' | 'error') => void;
}

const toStoredPix = (installment: Installment): CredigrupoInstallmentPixResult | null => {
  const data = installment.credigrupo;
  if (!data?.pixBrcode || !data.pixQrCode) return null;
  return {
    brCode: data.pixBrcode,
    qrCodeImage: data.pixQrCode,
    correlationID: data.pixCorrelationId || '',
    amountCents: Number(data.amountCents || 0),
    totalCents: Number(data.totalCents || 0),
    serviceFee: Number(data.serviceFee || 0),
  };
};

const BancarizedInstallmentActions: React.FC<BancarizedInstallmentActionsProps> = ({
  contractId,
  installment,
  isAdmin,
  isSandbox,
  showToast,
}) => {
  const [processing, setProcessing] = useState<'PIX' | 'TEST_PAY' | null>(null);
  const [pix, setPix] = useState<CredigrupoInstallmentPixResult | null>(() => toStoredPix(installment));
  const [showQrCode, setShowQrCode] = useState(false);
  const installmentId = installment.id || String(installment.number);
  const isPaid = normalizeInstallmentStatus(installment.status) === 'PAID';

  useEffect(() => {
    setPix(toStoredPix(installment));
  }, [installment.credigrupo?.pixBrcode, installment.credigrupo?.pixQrCode]);

  if (!isAdmin || !isSandbox || isPaid) return null;

  const handlePix = async () => {
    if (processing) return;
    setProcessing('PIX');
    try {
      const generated = await createCredigrupoInstallmentPix({ contractId, installmentId });
      setPix(generated);
      showToast('PIX da parcela gerado', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao gerar PIX da parcela', 'error');
    } finally {
      setProcessing(null);
    }
  };

  const copyPix = async () => {
    if (!pix?.brCode) return;
    try {
      await navigator.clipboard.writeText(pix.brCode);
      showToast('PIX copia e cola copiado', 'success');
    } catch {
      showToast('Nao foi possivel copiar o PIX', 'error');
    }
  };

  const handleTestPay = async () => {
    if (processing || !window.confirm('Simular o pagamento desta parcela no sandbox?')) return;
    setProcessing('TEST_PAY');
    try {
      await testPayCredigrupoSandbox({ contractId, installmentId });
      showToast('Pagamento simulado. Aguarde o webhook ou reconcilie a operacao.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Falha ao simular pagamento', 'error');
    } finally {
      setProcessing(null);
    }
  };

  return (
    <div className="rounded-xl border border-[#BF953F]/15 bg-[#BF953F]/[0.03] p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[7px] font-black uppercase tracking-widest text-[#BF953F]">Cobranca Credigrupo</span>
        {pix && <span className="text-[7px] font-black uppercase text-emerald-500">PIX gerado</span>}
      </div>
      {pix?.totalCents ? (
        <p className="text-[8px] text-zinc-500">
          Total PIX: <strong className="text-white">{(pix.totalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {!pix ? (
          <button type="button" onClick={() => void handlePix()} disabled={Boolean(processing)} className="px-3 py-2 rounded-lg bg-[#BF953F]/15 text-[#F5D77B] text-[7px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
            {processing === 'PIX' ? <Loader2 size={10} className="animate-spin" /> : <QrCode size={10} />}
            {processing === 'PIX' ? 'Gerando PIX...' : 'Gerar PIX'}
          </button>
        ) : (
          <>
            <button type="button" onClick={() => void copyPix()} className="px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-400 text-[7px] font-black uppercase flex items-center gap-1"><Copy size={10} /> Copiar PIX</button>
            <button type="button" onClick={() => setShowQrCode((current) => !current)} className="px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 text-[7px] font-black uppercase flex items-center gap-1"><QrCode size={10} /> {showQrCode ? 'Ocultar QR' : 'Mostrar QR'}</button>
            <button type="button" onClick={() => void handlePix()} disabled={Boolean(processing)} className="px-3 py-2 rounded-lg border border-zinc-800 text-zinc-500 text-[7px] font-black uppercase flex items-center gap-1 disabled:opacity-50" title="A Credigrupo reutiliza o QR valido e renova somente quando expirado"><RefreshCw size={10} className={processing === 'PIX' ? 'animate-spin' : ''} /> Atualizar PIX</button>
          </>
        )}
        <button type="button" onClick={() => void handleTestPay()} disabled={Boolean(processing)} className="px-3 py-2 rounded-lg bg-amber-500/10 text-amber-400 text-[7px] font-black uppercase flex items-center gap-1 disabled:opacity-50">
          {processing === 'TEST_PAY' ? <Loader2 size={10} className="animate-spin" /> : <FlaskConical size={10} />}
          {processing === 'TEST_PAY' ? 'Simulando...' : 'Simular pagamento'}
        </button>
      </div>
      {showQrCode && pix?.qrCodeImage && (
        <div className="rounded-xl bg-white p-2 w-fit">
          <img src={pix.qrCodeImage} alt={`QR Code PIX da parcela ${installment.number}`} className="w-32 h-32 object-contain" loading="lazy" />
        </div>
      )}
    </div>
  );
};

export default BancarizedInstallmentActions;
