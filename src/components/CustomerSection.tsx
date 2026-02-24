import React, { useState, useRef, useEffect } from 'react';
import { 
  Search, UserPlus, Mail, Phone, MapPin, CreditCard as IdCard, 
  Users, FileUp, FileText, XCircle, Edit3, Trash2, Eye, 
  ArrowLeft, Briefcase, TrendingUp, CheckCircle, Calendar, 
  ChevronDown, ChevronUp, Clock, AlertTriangle, Camera, 
  User as UserIcon, MessageSquare, FileImage, Maximize2, 
  Download, FileDown 
} from 'lucide-react';
import { Customer, CustomerDocument, Loan, PaymentStatus } from '../types';
import { generateContractPDF } from '../utils/contractGenerator';
// CORREÇÃO TS(2307): O caminho correto saindo de components/ para utils/
import { validateCPF } from '../utils/validation';

interface CustomerSectionProps {
  customers: Customer[];
  loans: Loan[];
  onAddCustomer: (customer: Customer) => void;
  onUpdateCustomer: (customer: Customer) => void;
  onDeleteCustomer: (id: string) => void;
}

const CustomerSection: React.FC<CustomerSectionProps> = ({ 
  customers, 
  loans,
  onAddCustomer, 
  onUpdateCustomer, 
  onDeleteCustomer 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null);
  const [previewDoc, setPreviewDoc] = useState<CustomerDocument | null>(null);
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [cpfValid, setCpfValid] = useState<boolean | null>(null);
  const closeForm = () => {
    setIsAdding(false);
    setEditingCustomer(null);
    setCpfValid(null);
    setFormData({ 
      name: '', 
      cpf: '', 
      rg: '', 
      email: '', 
      phone: '', 
      address: '',
      notes: '',
      createdAt: getTodayStr(),
      avatar: ''
    });
    setDocuments([]);
  };
  useEffect(() => {
    const handler = setTimeout(() => {
      setSearchTerm(searchInput);
    }, 400);
    return () => clearTimeout(handler);
  }, [searchInput]);

  const getTodayStr = () => new Date().toISOString().split('T')[0];

  const [formData, setFormData] = useState({
    name: '', cpf: '', rg: '', email: '', phone: '', address: '',
    notes: '', createdAt: getTodayStr(), avatar: ''
  });
  
  const [documents, setDocuments] = useState<CustomerDocument[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.cpf.includes(searchTerm)
  );

  const getCustomerLoans = (customerId: string) => {
    return loans.filter(l => l.customerId === customerId).reverse();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    
    if (name === 'cpf' || name === 'phone') {
      const numericValue = value.replace(/\D/g, ''); 
      if (numericValue.length <= 11) {
        setFormData(prev => ({ ...prev, [name]: numericValue }));
        
        if (name === 'cpf') {
          if (numericValue.length === 11) {
            // CORREÇÃO TS(2554): Passando apenas 1 argumento
            setCpfValid(validateCPF(numericValue));
          } else if (numericValue.length === 0) {
            setCpfValid(null);
          } else {
            setCpfValid(false);
          }
        }
      }
      return;
    }
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // ... (mantenha as funções startEdit, handleAvatarChange, handleFileChange, removeDocument como estão)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // CORREÇÃO TS(2554): Apenas 1 argumento aqui também
    if (!validateCPF(formData.cpf)) {
      alert("Por favor, insira um CPF válido.");
      return;
    }
    
    let selectedDate = new Date();
    if (formData.createdAt) {
      const parsed = new Date(formData.createdAt + 'T12:00:00');
      if (!isNaN(parsed.getTime())) selectedDate = parsed;
    }
    
    const finalData = { ...formData, createdAt: selectedDate.getTime() };

    if (editingCustomer) {
      onUpdateCustomer({ ...editingCustomer, ...finalData, documents: documents });
    } else {
      const newCustomer: Customer = {
        ...finalData,
        id: Math.random().toString(36).substr(2, 9),
        documents: documents
      };
      onAddCustomer(newCustomer);
    }
    closeForm();
  };

  // Funções auxiliares de UI (formatDate, getInstStatus, calculateCustomerScore, etc)
  // Devem permanecer iguais ao seu original.

  // Componente de Input Interno para evitar repetição
  const InputField = ({ label, name, value, onChange, ...props }: any) => (
    <div className="space-y-2">
      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">{label}</label>
      <input
        name={name}
        value={value}
        onChange={onChange}
        {...props}
        className={`w-full px-5 py-3.5 bg-[#050505] border ${props.isValid === false ? 'border-red-500' : 'border-zinc-800'} rounded-2xl focus:border-[#BF953F] outline-none transition-all text-sm text-zinc-200`}
      />
      {props.helperText && <span className="text-[10px] text-red-500 ml-1">{props.helperText}</span>}
    </div>
  );

  // Renderização condicional do formulário ou lista (Simplificada para o exemplo)
  return (
    <div className="p-4">
      {/* O restante do seu JSX de busca e lista aqui... */}
      {isAdding && (
         <form onSubmit={handleSubmit}>
            {/* Seus campos de formulário chamando InputField */}
         </form>
      )}
    </div>
  );
};

export default CustomerSection;