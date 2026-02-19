
import React, { useState, useRef } from 'react';
import { Mic, MicOff, Sparkles } from 'lucide-react';
import { GoogleGenAI, Type } from '@google/genai';

interface VoiceAssistantProps {
  onResult: (data: any) => void;
  context: 'CUSTOMER' | 'LOAN' | 'NOTE';
  label?: string;
}

const VoiceAssistant: React.FC<VoiceAssistantProps> = ({ onResult, context, label }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processAudio(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      alert("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.readAsDataURL(blob);
    });
  };

  const processAudio = async (audioBlob: Blob) => {
    setIsProcessing(true);
    try {
      const base64Data = await blobToBase64(audioBlob);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      const systemInstruction = context === 'NOTE' 
        ? "Você é um transcritor profissional. Transcreva o áudio fielmente para texto."
        : `Você é um assistente de entrada de dados para a GR SOLUTION. Sua tarefa é ouvir o áudio e extrair informações estruturadas. 
           Trate CPFs e RGs com atenção: remova pontos e traços, mantendo apenas números. 
           Identifique nomes próprios, e-mails, endereços e valores financeiros.`;

      const prompt = context === 'NOTE' 
        ? "Transcreva este áudio."
        : `Extraia os dados para um formulário de ${context === 'CUSTOMER' ? 'cliente' : 'contrato'}. 
           Se for cliente, procure por: nome, cpf, rg, email, telefone, endereço. 
           Se for contrato, procure por: valor (amount), taxa (interestRate), parcelas (installmentsCount).`;

      const config: any = {
        responseMimeType: context === 'NOTE' ? 'text/plain' : 'application/json',
      };

      if (context !== 'NOTE') {
        config.responseSchema = context === 'CUSTOMER' ? {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            cpf: { type: Type.STRING, description: "Apenas os 11 dígitos do CPF" },
            rg: { type: Type.STRING },
            email: { type: Type.STRING },
            phone: { type: Type.STRING, description: "Apenas números com DDD" },
            address: { type: Type.STRING },
            notes: { type: Type.STRING, description: "Outras informações ditas" }
          }
        } : {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER },
            interestRate: { type: Type.NUMBER },
            installmentsCount: { type: Type.NUMBER },
            notes: { type: Type.STRING }
          }
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: 'audio/webm',
                  data: base64Data
                }
              }
            ]
          }
        ],
        config: {
          ...config,
          systemInstruction
        }
      });

      const resultText = response.text || "";
      
      if (context === 'NOTE') {
        onResult(resultText.trim());
      } else {
        try {
          const jsonResult = JSON.parse(resultText);
          onResult(jsonResult);
        } catch (e) {
          onResult({ notes: resultText });
        }
      }
    } catch (err) {
      console.error("Erro no processamento Gemini:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="relative inline-block">
      {isRecording && (
        <div className="fixed inset-0 z-[200] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
           <div className="relative mb-12">
              <div className="absolute inset-0 bg-[#BF953F]/20 rounded-full animate-ping scale-150"></div>
              <div className="absolute inset-0 bg-[#BF953F]/10 rounded-full animate-pulse scale-125"></div>
              <div className="w-24 h-24 rounded-full gold-gradient flex items-center justify-center shadow-[0_0_50px_rgba(191,149,63,0.4)] relative z-10">
                 <Mic size={40} className="text-black animate-bounce" />
              </div>
           </div>
           <h2 className="text-xl font-black gold-text uppercase tracking-[0.3em] mb-4">Escutando...</h2>
           <p className="text-zinc-500 text-xs font-bold uppercase tracking-widest mb-10 text-center px-10">
             {context === 'CUSTOMER' ? "Fale o nome, CPF, RG, endereço e email do cliente" : "Diga os valores e detalhes do contrato"}
           </p>
           <button 
            onClick={stopRecording}
            className="px-10 py-4 bg-zinc-900 border border-zinc-800 rounded-full text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-all active:scale-95"
           >
             Finalizar e Processar
           </button>
        </div>
      )}

      {isProcessing && (
        <div className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in">
           <div className="w-16 h-16 border-4 border-zinc-900 border-t-[#BF953F] rounded-full animate-spin mb-8"></div>
           <div className="flex items-center gap-3">
              <Sparkles className="text-[#BF953F] animate-pulse" size={18} />
              <h2 className="text-sm font-black gold-text uppercase tracking-widest text-center">IA GR SOLUTION Analisando...</h2>
           </div>
           <p className="text-[9px] text-zinc-600 font-bold uppercase mt-3 tracking-widest">Formatando dados brasileiros</p>
        </div>
      )}

      <button
        type="button"
        onClick={isRecording ? stopRecording : startRecording}
        className={`p-3 rounded-xl transition-all border flex items-center gap-2 group ${
          isRecording 
          ? 'bg-red-500 text-white border-red-400' 
          : 'bg-zinc-900 text-[#BF953F] border-zinc-800 hover:border-[#BF953F]/50'
        }`}
        title="Adicionar por Áudio"
      >
        {isRecording ? <MicOff size={16} /> : <Mic size={16} />}
        <span className="text-[9px] font-black uppercase tracking-widest hidden sm:inline">{label || "Voz Inteligente"}</span>
      </button>
    </div>
  );
};

export default VoiceAssistant;
