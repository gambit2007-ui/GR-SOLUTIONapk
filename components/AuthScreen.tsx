
import React, { useState } from 'react';
import { ShieldCheck, Mail, Lock, User, ArrowRight, LogIn } from 'lucide-react';
import { AuthUser } from '../types';

interface AuthScreenProps {
  onLogin: (user: AuthUser) => void;
}

const AuthScreen: React.FC<AuthScreenProps> = ({ onLogin }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const users = JSON.parse(localStorage.getItem('gr_solution_users') || '[]');

    if (isLogin) {
      const user = users.find((u: AuthUser) => u.email === formData.email && u.password === formData.password);
      if (user) {
        onLogin(user);
      } else {
        setError('E-mail ou senha inválidos.');
      }
    } else {
      if (users.find((u: AuthUser) => u.email === formData.email)) {
        setError('Este e-mail já está cadastrado.');
        return;
      }
      const newUser: AuthUser = {
        id: Math.random().toString(36).substr(2, 9),
        name: formData.name,
        email: formData.email,
        password: formData.password,
        createdAt: Date.now()
      };
      const updatedUsers = [...users, newUser];
      localStorage.setItem('gr_solution_users', JSON.stringify(updatedUsers));
      onLogin(newUser);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorative Elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-[#BF953F]/10 blur-[120px] rounded-full"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-[#BF953F]/5 blur-[120px] rounded-full"></div>

      <div className="w-full max-w-md z-10 animate-in fade-in zoom-in duration-500">
        <div className="text-center mb-10">
          <div className="w-20 h-20 gold-gradient rounded-full mx-auto mb-6 flex items-center justify-center shadow-[0_0_30px_rgba(191,149,63,0.3)] border border-[#FCF6BA]/30">
             <img 
               src="https://i.ibb.co/L6WvFhH/gr-logo.jpg" 
               alt="Logo" 
               className="w-16 h-16 rounded-full object-cover"
               onError={(e) => (e.currentTarget.style.display = 'none')}
             />
          </div>
          <h1 className="text-3xl font-black gold-text tracking-tighter mb-2">GR SOLUTION</h1>
          <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.4em]">Wealth Management System</p>
        </div>

        <div className="bg-[#0a0a0a] border border-zinc-800 p-8 rounded-[2.5rem] shadow-2xl backdrop-blur-xl">
          <div className="flex gap-4 p-1.5 bg-black rounded-2xl border border-zinc-900 mb-8">
            <button 
              onClick={() => setIsLogin(true)}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isLogin ? 'gold-gradient text-black' : 'text-zinc-600'}`}
            >
              ENTRAR
            </button>
            <button 
              onClick={() => setIsLogin(false)}
              className={`flex-1 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${!isLogin ? 'gold-gradient text-black' : 'text-zinc-600'}`}
            >
              CADASTRAR
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {!isLogin && (
              <AuthInput 
                icon={<User size={18} />} 
                placeholder="Nome Completo" 
                type="text" 
                value={formData.name}
                onChange={(v) => setFormData({...formData, name: v})}
                required
              />
            )}
            <AuthInput 
              icon={<Mail size={18} />} 
              placeholder="E-mail Corporativo" 
              type="email" 
              value={formData.email}
              onChange={(v) => setFormData({...formData, email: v})}
              required
            />
            <AuthInput 
              icon={<Lock size={18} />} 
              placeholder="Senha de Acesso" 
              type="password" 
              value={formData.password}
              onChange={(v) => setFormData({...formData, password: v})}
              required
            />

            {error && <p className="text-red-500 text-[10px] font-bold text-center uppercase tracking-tighter animate-pulse">{error}</p>}

            <button 
              type="submit" 
              className="w-full gold-gradient py-4 rounded-2xl text-black font-black text-xs uppercase tracking-[0.3em] flex items-center justify-center gap-3 shadow-xl hover:scale-[1.02] active:scale-95 transition-all mt-4"
            >
              {isLogin ? <LogIn size={18} /> : <ArrowRight size={18} />}
              {isLogin ? 'ACESSAR PAINEL' : 'FINALIZAR CADASTRO'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-zinc-900 flex items-center justify-center gap-2 text-zinc-600">
             <ShieldCheck size={14} className="text-[#BF953F]" />
             <span className="text-[9px] font-bold uppercase tracking-widest">Sessão Segura e Criptografada</span>
          </div>
        </div>
      </div>
    </div>
  );
};

const AuthInput: React.FC<{ icon: React.ReactNode, placeholder: string, type: string, value: string, onChange: (v: string) => void, required?: boolean }> = ({ icon, placeholder, type, value, onChange, required }) => (
  <div className="relative group">
    <div className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-700 group-focus-within:text-[#BF953F] transition-colors">
      {icon}
    </div>
    <input 
      type={type} 
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className="w-full pl-14 pr-6 py-4 bg-black border border-zinc-800 rounded-2xl focus:border-[#BF953F] outline-none text-zinc-200 text-sm font-medium transition-all placeholder:text-zinc-800"
    />
  </div>
);

export default AuthScreen;
