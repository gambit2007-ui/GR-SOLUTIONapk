import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { auth } from '../firebase';
import { reportOperationalError } from '../services/operationalLoggingService';

interface AppErrorBoundaryState {
  hasError: boolean;
}

export class AppErrorBoundary extends React.Component<React.PropsWithChildren, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error): void {
    const user = auth.currentUser;
    void reportOperationalError('react.render', error, {
      uid: user?.uid,
      email: user?.email,
      displayName: user?.displayName,
    });
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="min-h-dvh bg-black flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md bg-[#050505] border border-red-500/30 rounded-[2rem] p-8 text-center">
          <AlertTriangle size={34} className="mx-auto text-red-500" />
          <h1 className="mt-5 text-lg font-black uppercase tracking-widest">Falha inesperada</h1>
          <p className="mt-3 text-[10px] text-zinc-500 uppercase tracking-wider leading-relaxed">
            O erro foi registrado sem dados financeiros. Recarregue o aplicativo para continuar.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 px-5 py-3 border border-[#BF953F]/30 bg-[#BF953F]/10 text-[#F5D77B] rounded-xl text-[9px] font-black uppercase tracking-widest"
          >
            Recarregar aplicativo
          </button>
        </div>
      </div>
    );
  }
}
