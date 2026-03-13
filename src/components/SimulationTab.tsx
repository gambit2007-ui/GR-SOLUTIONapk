import React, { useState } from 'react';
import { Customer } from '../types';
import { Calculator, Percent, Calendar, Wallet, Download, MessageCircle, User, Phone } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface SimulationTabProps {
  customers: Customer[];
}

const SimulationTab: React.FC<SimulationTabProps> = ({ customers }) => {
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    amount: '',
    interestRate: '',
    interestType: 'SIMPLE' as 'SIMPLE' | 'PRICE',
    frequency: 'MONTHLY' as 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY',
    installmentsCount: ''
  });

  const amount = Number(formData.amount);
  const interestRateValue = Number(formData.interestRate);
  const rate = interestRateValue / 100;
  const count = Number(formData.installmentsCount);
  const hasValidAmount = Number.isFinite(amount) && amount > 0;
  const hasValidRate = Number.isFinite(interestRateValue) && interestRateValue >= 0;
  const hasValidCount = Number.isInteger(count) && count > 0;
  const canSimulate = hasValidAmount && hasValidRate && hasValidCount;

  const frequencyLabel: Record<'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY', string> = {
    DAILY: 'Diario',
    WEEKLY: 'Semanal',
    BIWEEKLY: 'Quinzenal',
    MONTHLY: 'Mensal',
  };

  const interestTypeLabel: Record<'SIMPLE' | 'PRICE', string> = {
    SIMPLE: 'Juros simples',
    PRICE: 'Tabela Price',
  };

  let installmentValue = 0;
  let totalWithInterest = 0;

  if (canSimulate) {
    if (formData.interestType === 'SIMPLE') {
      totalWithInterest = amount * (1 + rate);
      installmentValue = totalWithInterest / count;
    } else {
      if (rate === 0) {
        installmentValue = amount / count;
      } else {
        installmentValue = amount * (rate * Math.pow(1 + rate, count)) / (Math.pow(1 + rate, count) - 1);
      }
      totalWithInterest = installmentValue * count;
    }
  }

  const generatePDF = () => {
    if (!canSimulate) return;
    const doc = new jsPDF();
    const date = new Date().toLocaleDateString('pt-BR');

    doc.setFontSize(20);
    doc.setTextColor(191, 149, 63);
    doc.text('SIMULACAO DE EMPRESTIMO', 105, 20, { align: 'center' });

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Data: ${date}`, 105, 28, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(0);
    doc.text('DADOS DO CLIENTE', 14, 45);
    doc.setFontSize(10);
    doc.text(`Nome: ${formData.name || 'Nao informado'}`, 14, 52);
    doc.text(`Telefone: ${formData.phone || 'Nao informado'}`, 14, 58);

    doc.setFontSize(12);
    doc.text('DETALHES DA SIMULACAO', 14, 75);

    const details = [
      ['Valor Principal', `R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['Taxa de Juros', `${formData.interestRate}% (${interestTypeLabel[formData.interestType]})`],
      ['Frequencia', frequencyLabel[formData.frequency]],
      ['Numero de Parcelas', formData.installmentsCount],
      ['Valor da Parcela', `R$ ${installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
      ['Total Geral', `R$ ${totalWithInterest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`],
    ];

    autoTable(doc, {
      startY: 80,
      head: [['Descricao', 'Valor']],
      body: details,
      theme: 'striped',
      headStyles: { fillColor: [191, 149, 63] },
    });

    const finalY = (doc as any).lastAutoTable.finalY || 150;
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text('Esta e apenas uma simulacao e nao garante a efetivacao do contrato.', 105, finalY + 20, { align: 'center' });

    doc.save(`Simulacao_${formData.name || 'Cliente'}.pdf`);
  };

  const sendWhatsApp = () => {
    if (!canSimulate) return;
    const phone = formData.phone.replace(/\D/g, '');
    const message = encodeURIComponent(
      `*SIMULACAO DE EMPRESTIMO*\n\n` +
      `*Cliente:* ${formData.name || 'Nao informado'}\n` +
      `*Valor:* R$ ${amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `*Modalidade:* ${interestTypeLabel[formData.interestType]}\n` +
      `*Frequencia:* ${frequencyLabel[formData.frequency]}\n` +
      `*Parcelas:* ${formData.installmentsCount}x de R$ ${installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n` +
      `*Total Geral:* R$ ${totalWithInterest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}\n\n` +
      `_Simulacao realizada em ${new Date().toLocaleDateString('pt-BR')}_`
    );

    const url = phone ? `https://wa.me/55${phone}?text=${message}` : `https://wa.me/?text=${message}`;
    window.open(url, '_blank');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-[#0b1730] border border-zinc-900 p-5 sm:p-8 md:p-10 rounded-[3rem]">
        <div className="flex items-center gap-3 sm:gap-4 mb-8 sm:mb-10">
          <div className="p-4 bg-zinc-900 rounded-2xl border border-zinc-800">
            <Calculator size={32} className="text-[#BF953F]" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-black gold-text uppercase tracking-tighter break-words">Simulador Financeiro</h2>
            <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Projecao de parcelas e valor total</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Nome do Cliente</label>
            <div className="relative">
              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={16} />
              <input
                type="text"
                placeholder="NOME COMPLETO"
                className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 pl-12 text-white outline-none focus:border-[#BF953F] text-xs"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Telefone / WhatsApp</label>
            <div className="relative">
              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={16} />
              <input
                type="text"
                placeholder="(00) 00000-0000"
                className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 pl-12 text-white outline-none focus:border-[#BF953F] text-xs"
                value={formData.phone}
                onChange={e => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Tipo de Juros</label>
            <select
              className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
              value={formData.interestType}
              onChange={e => setFormData({ ...formData, interestType: e.target.value as 'SIMPLE' | 'PRICE' })}
            >
              <option value="SIMPLE">JUROS SIMPLES (TOTAL)</option>
              <option value="PRICE">TABELA PRICE (MENSAL)</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Frequencia</label>
            <select
              className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 text-white outline-none focus:border-[#BF953F] text-xs appearance-none"
              value={formData.frequency}
              onChange={e => setFormData({ ...formData, frequency: e.target.value as 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' })}
            >
              <option value="DAILY">DIARIO</option>
              <option value="WEEKLY">SEMANAL</option>
              <option value="BIWEEKLY">QUINZENAL</option>
              <option value="MONTHLY">MENSAL</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Valor Principal</label>
            <div className="relative">
              <Wallet className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={16} />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 pl-12 text-white outline-none focus:border-[#BF953F] text-xs"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Taxa de Juros (%)</label>
            <div className="relative">
              <Percent className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={16} />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 pl-12 text-white outline-none focus:border-[#BF953F] text-xs"
                value={formData.interestRate}
                onChange={e => setFormData({ ...formData, interestRate: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest ml-1">Numero de Parcelas</label>
            <div className="relative">
              <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" size={16} />
              <input
                type="number"
                min="1"
                step="1"
                placeholder="1"
                className="w-full bg-[#071226] border border-zinc-800 rounded-2xl p-4 pl-12 text-white outline-none focus:border-[#BF953F] text-xs"
                value={formData.installmentsCount}
                onChange={e => setFormData({ ...formData, installmentsCount: e.target.value })}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          <div className="bg-[#071226] border border-zinc-900 p-6 rounded-3xl text-center">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Valor da Parcela</p>
            <p className="text-xl font-black text-white">R$ {installmentValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
          <div className="bg-[#071226] border border-zinc-900 p-6 rounded-3xl text-center">
            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-2">Total Geral</p>
            <p className="text-xl font-black text-emerald-500">R$ {totalWithInterest.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={generatePDF}
            disabled={!canSimulate}
            className="flex-1 py-4 sm:py-5 bg-zinc-900 text-white rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-zinc-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={18} /> Baixar PDF
          </button>
          <button
            onClick={sendWhatsApp}
            disabled={!canSimulate}
            className="flex-1 py-4 sm:py-5 bg-emerald-500 text-black rounded-2xl font-black uppercase text-[10px] tracking-widest hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <MessageCircle size={18} /> Enviar para WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
};

export default SimulationTab;

