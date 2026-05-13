/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { auth, login, loginWithEmail, logout, db } from './lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  serverTimestamp,
  getDoc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  Timestamp,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  Plus, 
  Settings as SettingsIcon, 
  Clock, 
  Car, 
  History as HistoryIcon,
  LogOut,
  LogIn,
  Search,
  CheckCircle2,
  XCircle,
  Activity,
  Sun,
  Moon,
  ChevronDown,
  Building2,
  Users,
  AlertCircle,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn, formatCurrency } from './lib/utils';
import { Establishment, Vehicle, VehicleStatus, ParkingSettings, OperationType } from './types';
import { handleFirestoreError } from './lib/error-handler';
import { EstablishmentsView } from './components/EstablishmentsView';
import { ParkingIcon, MotorcycleIcon } from './components/Icons';

// Super admin email - user can manage all establishments
const SUPER_ADMIN_EMAIL = 'pilin123@gmail.com';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  
  // Establishments state
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [selectedEstId, setSelectedEstId] = useState<string | null>(localStorage.getItem('selectedEstId'));
  const currentEst = establishments.find(e => e.id === selectedEstId) || null;

  const [activeVehicles, setActiveVehicles] = useState<Vehicle[]>([]);
  const [history, setHistory] = useState<Vehicle[]>([]);
  const [settings, setSettings] = useState<ParkingSettings | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('darkMode') === 'true';
    }
    return false;
  });
  const [activeView, setActiveView] = useState<'monitor' | 'activity' | 'history' | 'reports' | 'settings' | 'monthly' | 'establishments'>('monitor');
  const [plate, setPlate] = useState('');
  const [selectedVehicleType, setSelectedVehicleType] = useState<'car' | 'motorcycle'>('car');
  const [selectedEntryType, setSelectedEntryType] = useState<'daily' | 'monthly'>('daily');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allHistoricalPlates, setAllHistoricalPlates] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [duplicateVehicleAlert, setDuplicateVehicleAlert] = useState<{ plate: string; type: 'active' | 'monthly' } | null>(null);
  const [confirmingExitVehicle, setConfirmingExitVehicle] = useState<Vehicle | null>(null);
  const [editableAmount, setEditableAmount] = useState<number>(0);
  const [historySearchTerm, setHistorySearchTerm] = useState('');
  const [monthlyPasses, setMonthlyPasses] = useState<any[]>([]);
  const [selectedHistoryVehicle, setSelectedHistoryVehicle] = useState<Vehicle | null>(null);
  const plateInputRef = useRef<HTMLInputElement>(null);

  // Auto-detect monthly pass when typing plate
  useEffect(() => {
    if (selectedEntryType === 'daily' && plate.length >= 3) {
      const pass = monthlyPasses.find(p => p.plate.toUpperCase() === plate.toUpperCase());
      if (pass) {
        setSelectedEntryType('monthly');
        setSelectedVehicleType(pass.vehicleType);
      }
    }
  }, [plate, monthlyPasses, selectedEntryType]);

  // Filters for reports
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reportData, setReportData] = useState<Vehicle[]>([]);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmail || !loginPassword) return;
    setLoginLoading(true);
    setLoginError(null);
    try {
      await loginWithEmail(loginEmail, loginPassword);
    } catch (error: any) {
      setLoginError('Credenciales incorrectas');
    } finally {
      setLoginLoading(false);
    }
  };

  const [selectedSlot, setSelectedSlot] = useState<string>('');

  const handleSlotClick = (slotId: string, vehicle?: Vehicle) => {
    if (vehicle) {
      setEditableAmount(calculateAmount(vehicle));
      setConfirmingExitVehicle(vehicle);
    } else {
      setSelectedSlot(slotId);
      setConfirmingExitId(null);
      
      setTimeout(() => plateInputRef.current?.focus(), 50);
    }
  };

  useEffect(() => {
    localStorage.setItem('darkMode', String(isDarkMode));
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        setIsSuperAdmin(u.email === SUPER_ADMIN_EMAIL);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Test connection to Firestore
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'establishments', 'connection-test'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    if (user) testConnection();
  }, [user]);

  // Listen to establishments where user is a member
  useEffect(() => {
    if (!user) return;

    const q = isSuperAdmin 
      ? collection(db, 'establishments')
      : query(
          collection(db, 'establishments'),
          where('members', 'array-contains', user.uid)
        );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ests = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Establishment));
      setEstablishments(ests);
      
      // Auto-select first establishment if none selected
      if (ests.length > 0 && !selectedEstId) {
        setSelectedEstId(ests[0].id || null);
        localStorage.setItem('selectedEstId', ests[0].id || '');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'establishments');
    });

    return () => unsubscribe();
  }, [user, isSuperAdmin]);

  // Listen to active vehicles
  useEffect(() => {
    if (!user || !selectedEstId) return;

    const q = query(
      collection(db, 'vehicles'),
      where('establishmentId', '==', selectedEstId),
      where('status', '==', VehicleStatus.ACTIVE),
      orderBy('entryTime', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setActiveVehicles(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `vehicles (est: ${selectedEstId})`);
    });

    return () => unsubscribe();
  }, [user, selectedEstId]);

  // Listen to settings for the selected establishment
  useEffect(() => {
    if (!user || !selectedEstId) return;

    const current = establishments.find(e => e.id === selectedEstId);
    if (current?.settings) {
      setSettings(current.settings);
    }
  }, [selectedEstId, establishments]);

  // Listen to history for the list
  useEffect(() => {
    if (!user || !selectedEstId || activeView !== 'history') return;

    const q = query(
      collection(db, 'vehicles'),
      where('establishmentId', '==', selectedEstId),
      where('status', '==', VehicleStatus.COMPLETED),
      orderBy('exitTime', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setHistory(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles history');
    });

    return () => unsubscribe();
  }, [user, selectedEstId, activeView]);

  // Fetch data for reports based on date range
  useEffect(() => {
    if (!user || !selectedEstId || activeView !== 'reports') return;

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, 'vehicles'),
      where('establishmentId', '==', selectedEstId),
      where('status', '==', VehicleStatus.COMPLETED),
      where('exitTime', '>=', Timestamp.fromDate(start)),
      where('exitTime', '<=', Timestamp.fromDate(end))
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setReportData(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reports');
    });

    return () => unsubscribe();
  }, [user, selectedEstId, activeView, startDate, endDate]);

  // Listen to monthly passes
  useEffect(() => {
    if (!user || !selectedEstId) return;

    const q = query(
      collection(db, 'monthlyPasses'),
      where('establishmentId', '==', selectedEstId),
      where('status', '==', 'active')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const passes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setMonthlyPasses(passes);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'monthlyPasses');
    });

    return () => unsubscribe();
  }, [user, selectedEstId]);

  // Fetch historical plates for autocomplete
  useEffect(() => {
    if (!user || !selectedEstId) return;

    // Fetch the last 200 vehicles to build a suggestion list
    const q = query(
      collection(db, 'vehicles'),
      where('establishmentId', '==', selectedEstId),
      orderBy('entryTime', 'desc'),
      limit(200)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const plates = new Set<string>();
      // Use existing history and current fetch
      snapshot.docs.forEach(doc => {
        const data = doc.data();
        if (data.plate) plates.add(data.plate);
      });
      // Add monthly passes to the set
      monthlyPasses.forEach(p => plates.add(p.plate));
      
      setAllHistoricalPlates(Array.from(plates).sort());
    }, (error) => {
      console.warn("Autocomplete fetch failed:", error);
    });

    return () => unsubscribe();
  }, [user, selectedEstId, monthlyPasses]);

  const handleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !plate.trim() || !selectedSlot || !selectedEstId) return;

    // Check if slot is already occupied
    const occupiedVehicle = activeVehicles.find(v => v.slotId === selectedSlot);
    if (occupiedVehicle) {
      setEditableAmount(calculateAmount(occupiedVehicle));
      setConfirmingExitVehicle(occupiedVehicle);
      return;
    }

    // Check if vehicle plate is already registered and active
    if (activeVehicles.some(v => v.plate === plate.toUpperCase())) {
      setDuplicateVehicleAlert({ plate: plate.toUpperCase(), type: 'active' });
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'vehicles'), {
        plate: plate.toUpperCase(),
        slotId: selectedSlot,
        vehicleType: selectedVehicleType,
        entryType: selectedEntryType,
        entryTime: serverTimestamp(),
        exitTime: null,
        status: VehicleStatus.ACTIVE,
        totalAmount: 0,
        ownerId: user.uid,
        establishmentId: selectedEstId
      });
      setPlate('');
      setSelectedSlot('');
      setSelectedEntryType('daily');
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'vehicles');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [confirmingExitId, setConfirmingExitId] = useState<string | null>(null);

  const handleAddMonthlyPass = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !selectedEstId) return;
    const formData = new FormData(e.currentTarget as HTMLFormElement);
    const plateVal = formData.get('plate')?.toString().toUpperCase();
    const type = formData.get('vehicleType')?.toString() as 'car' | 'motorcycle';
    const amount = Number(formData.get('amount'));
    
    if (!plateVal || !type) return;

    // Check if vehicle already has an active monthly pass
    if (monthlyPasses.some(p => p.plate === plateVal)) {
      setDuplicateVehicleAlert({ plate: plateVal, type: 'monthly' });
      return;
    }

    try {
      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(now.getMonth() + 1);

      await addDoc(collection(db, 'monthlyPasses'), {
        plate: plateVal,
        vehicleType: type,
        startDate: serverTimestamp(),
        endDate: Timestamp.fromDate(nextMonth),
        amount,
        status: 'active',
        ownerId: user.uid,
        establishmentId: selectedEstId
      });
      (e.target as HTMLFormElement).reset();
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'monthlyPasses');
    }
  };

  const calculateAmount = (v: Vehicle) => {
    if (!settings || !v.entryTime) return 0;
    if (v.entryType === 'monthly') return 0;
    
    const now = new Date();
    const entry = v.entryTime.toDate();
    const diffMs = now.getTime() - entry.getTime();
    const diffMinutes = Math.max(1, Math.ceil(diffMs / (1000 * 60)));

    if (v.vehicleType === 'motorcycle') {
      return settings.motoDailyRate || 500;
    }

    const hourlyRate = settings.hourlyRate || 1000;
    const halfHourRate = settings.carHalfHourRate || Math.ceil(hourlyRate / 2);
    
    // Primera hora siempre completa
    if (diffMinutes <= 60) {
      return hourlyRate;
    }

    // Más de una hora: primera hora + excedente
    let total = hourlyRate; 
    const extraMinutes = diffMinutes - 60;
    const extraFullHours = Math.floor(extraMinutes / 60);
    const remainingExtraMinutes = extraMinutes % 60;
    
    total += extraFullHours * hourlyRate;
    
    if (remainingExtraMinutes > 30) {
      total += hourlyRate;
    } else if (remainingExtraMinutes > 0) {
      total += halfHourRate;
    }
    
    return total;
  };

  const handleExit = async (vehicle: Vehicle) => {
    if (!user || !settings || !vehicle.id) return;
    
    const calculated = calculateAmount(vehicle);
    setEditableAmount(calculated);
    setConfirmingExitVehicle(vehicle);
  };

  const confirmExit = async () => {
    if (!user || !settings || !confirmingExitVehicle?.id) return;
    
    setIsSubmitting(true);

    try {
      await updateDoc(doc(db, 'vehicles', confirmingExitVehicle.id), {
        status: VehicleStatus.COMPLETED,
        exitTime: serverTimestamp(),
        totalAmount: editableAmount
      });
      setConfirmingExitVehicle(null);
      setConfirmingExitId(null);
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `vehicles/${confirmingExitVehicle.id}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteHistory = async (id: string) => {
    console.log('Solicitando eliminar registro history:', id);
    try {
      // Optimistic locally
      setHistory(prev => prev.filter(v => v.id !== id));
      await deleteDoc(doc(db, 'vehicles', id));
      console.log('Registro eliminado exitosamente:', id);
      setConfirmDeleteId(null);
    } catch (error) {
      console.error('Error al eliminar registro:', error);
      handleFirestoreError(error, OperationType.DELETE, `vehicles/${id}`);
    }
  };

  const updateSettings = async (
    carRate: number, 
    carHalfHourRate: number,
    motoDailyRate: number, 
    carSlots: number, 
    motoSlots: number, 
    monthlyRate: number, 
    motoMonthlyRate: number
  ) => {
    if (!user || !selectedEstId || !currentEst) return;
    try {
      const newSettings = {
        hourlyRate: carRate,
        carHalfHourRate,
        motoDailyRate,
        motoHourlyRate: motoDailyRate, // keep for compat
        monthlyRate,
        motoMonthlyRate,
        carSlots: carSlots,
        motoSlots: motoSlots,
        totalSlots: carSlots + motoSlots,
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'establishments', selectedEstId), {
        settings: newSettings
      });
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `establishments/${selectedEstId}`);
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center font-sans overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#EEF2FF_0%,transparent_50%)]" />
      <div className="flex flex-col items-center gap-6 relative z-10">
        <div className={cn("w-20 h-20 bg-gradient-to-br from-blue-500 to-indigo-700 flex items-center justify-center shadow-[0_20px_50px_rgba(59,130,246,0.3)] animate-pulse rounded-lg")}>
          <ParkingIcon className="text-white w-10 h-10" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-slate-900 font-black tracking-[0.4em] text-[12px] uppercase">CocheraFlow AR</p>
          <div className="h-1 w-24 bg-slate-100 rounded-full overflow-hidden">
            <motion.div 
              initial={{ width: "0%" }}
              animate={{ width: "100%" }}
              transition={{ duration: 2, repeat: Infinity }}
              className="h-full bg-indigo-600"
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (!user) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("bg-white p-10 max-w-md w-full border border-slate-200 shadow-xl shadow-slate-200/50 rounded-xl")}
      >
        <div className="flex items-center gap-3 mb-8">
          <div className={cn("w-14 h-14 bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xl shadow-blue-200/50 rounded-sm")}>
            <ParkingIcon className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 tracking-tighter leading-none">Cochera AR</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Sistemas Profesionales</p>
          </div>
        </div>
        
        <p className="text-slate-600 mb-8 leading-relaxed text-sm">
          Bienvenido al sistema de control de estacionamiento. Inicie sesión para gestionar su cochera.
        </p>

        <form onSubmit={handleEmailLogin} className="space-y-4 mb-8 border-b pb-8 border-slate-100">
          <div className="space-y-1">
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email</label>
             <input 
               type="email"
               value={loginEmail}
               onChange={(e) => setLoginEmail(e.target.value)}
               className={cn("w-full px-5 py-3 border border-slate-100 bg-slate-50 font-bold rounded-md")}
               placeholder="nombre@ejemplo.com"
               required
             />
          </div>
          <div className="space-y-1">
             <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contraseña</label>
             <input 
               type="password"
               value={loginPassword}
               onChange={(e) => setLoginPassword(e.target.value)}
               className="w-full px-5 py-3 rounded-xl border border-slate-100 bg-slate-50 font-bold"
               placeholder="••••••••"
               required
             />
          </div>

          {loginError && (
             <p className="text-red-500 text-[10px] font-bold uppercase text-center">{loginError}</p>
          )}

          <button 
            type="submit"
            disabled={loginLoading}
            className={cn("w-full bg-slate-900 text-white py-4 font-black text-xs tracking-widest hover:bg-black transition-all disabled:opacity-50 rounded-md")}
          >
            {loginLoading ? 'INGRESANDO...' : 'INICIAR SESIÓN'}
          </button>
        </form>

        <button 
          onClick={login}
          className={cn("w-full flex items-center justify-center gap-2 bg-white border border-slate-200 text-slate-600 py-4 px-6 font-bold hover:bg-slate-50 transition-all group rounded-md")}
        >
          <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          Acceder con Google
        </button>
      </motion.div>
    </div>
  );

  const currentTheme = isDarkMode ? 'dark' : 'light';

  return (
    <div className={cn(
      "h-screen flex flex-col lg:flex-row font-sans overflow-hidden transition-colors duration-500",
      isDarkMode ? "bg-slate-950 text-slate-100" : "bg-[#FDFCFB] text-slate-800"
    )}>
      {/* Background gradients for Android 16 depth */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className={cn(
          "absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full blur-[100px] transition-colors duration-1000",
          isDarkMode ? "bg-indigo-900/20" : "bg-indigo-50/50"
        )} />
        <div className={cn(
          "absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full blur-[100px] transition-colors duration-1000",
          isDarkMode ? "bg-emerald-900/20" : "bg-emerald-50/50"
        )} />
      </div>

      {/* Desktop Lateral Sidebar */}
      <aside className={cn(
        "hidden lg:flex w-64 xl:w-72 flex-col border-r shrink-0 z-50 transition-all duration-500",
        isDarkMode ? "bg-slate-900/40 border-slate-800" : "bg-white border-slate-100"
      )}>
        <div className="p-8 flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center text-white shadow-lg">
            <ParkingIcon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="font-black text-lg tracking-tighter leading-none relative">
              Cochera <span className="bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">Pro</span>
              <svg className="absolute -bottom-2 lg:-bottom-3 left-0 w-full h-1 overflow-visible" viewBox="0 0 100 4" preserveAspectRatio="none">
                <path d="M0 2 C 20 0, 40 4, 60 2 S 100 0, 100 2" stroke="url(#line-gradient-sidebar)" strokeWidth="2" fill="none" />
                <defs>
                  <linearGradient id="line-gradient-sidebar" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#6366f1" />
                  </linearGradient>
                </defs>
              </svg>
            </h1>
            <p className="text-[10px] text-slate-500 font-extrabold uppercase tracking-widest mt-0.5">Gestión de Playa</p>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 overflow-y-auto py-2">
          {[
            { id: 'monitor', icon: Activity, label: 'Panel Principal' },
            { id: 'history', icon: HistoryIcon, label: 'Historial' },
            { id: 'monthly', icon: CheckCircle2, label: 'Abonados' },
            { id: 'reports', icon: Search, label: 'Reportes y Caja' },
            { id: 'settings', icon: SettingsIcon, label: 'Configuración' },
            ...(isSuperAdmin ? [{ id: 'establishments', icon: Building2, label: 'Mis Cocheras' }] : []),
          ].map((v) => (
            <button 
              key={v.id}
              onClick={() => setActiveView(v.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3.5 transition-all group relative",
                "rounded-xl",
                activeView === v.id 
                  ? (isDarkMode ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm" : "bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm") 
                  : (isDarkMode ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50")
              )}
            >
              <v.icon className={cn("w-5 h-5", activeView === v.id ? "scale-110" : "group-hover:scale-110 transition-transform")} />
              <span className="text-sm font-bold tracking-tight">{v.label}</span>
              {activeView === v.id && (
                <motion.div layoutId="sidebar-indicator" className="absolute left-0 w-1 h-6 bg-indigo-500 rounded-full" />
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 mt-auto">
          <div className={cn(
            "p-5 rounded-2xl border mb-4 space-y-4",
            isDarkMode ? "bg-slate-800/50 border-slate-700" : "bg-slate-50 border-slate-100"
          )}>
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-slate-400 uppercase font-black tracking-widest">Ocupación</span>
              <span className={cn("text-xs font-black", isDarkMode ? "text-indigo-400" : "text-indigo-600")}>
                {activeVehicles.length}/{ (settings?.carSlots || 0) + (settings?.motoSlots || 0) }
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (activeVehicles.length / ((settings?.carSlots || 0) + (settings?.motoSlots || 0) || 1)) * 100)}%` }}
                className={cn(
                  "h-full rounded-full",
                  (activeVehicles.length / ((settings?.carSlots || 0) + (settings?.motoSlots || 0) || 1)) > 0.9 ? "bg-rose-500" : "bg-indigo-500"
                )}
              />
            </div>
          </div>

          <button 
            onClick={logout}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 transition-all group",
              "rounded-xl",
              isDarkMode ? "text-slate-500 hover:text-red-400 hover:bg-red-950/20" : "text-slate-400 hover:text-red-500 hover:bg-red-50"
            )}
          >
            <LogOut className="w-5 h-5 group-hover:rotate-12 transition-transform" />
            <span className="text-sm font-bold">Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header / TopBar */}
        <header className={cn(
          "h-16 md:h-20 lg:h-16 backdrop-blur-2xl border-b flex items-center justify-between px-4 md:px-8 shrink-0 z-40 transition-all duration-500",
          isDarkMode ? "bg-slate-900/40 border-slate-800 shadow-[0_4px_30px_rgba(0,0,0,0.1)]" : "bg-white/40 border-slate-100 shadow-[0_4px_30px_rgba(0,0,0,0.02)]"
        )}>
          <div className="flex items-center gap-2 lg:hidden">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-blue-800 rounded-xl flex items-center justify-center text-white" onClick={() => setActiveView('monitor')}>
              <ParkingIcon className="w-6 h-6" />
            </div>
            <h1 className="font-black text-xl tracking-tighter lg:hidden relative">
              Cochera <span className="text-blue-500">Pro</span>
              <svg className="absolute -bottom-1 left-0 w-full h-1 overflow-visible" viewBox="0 0 100 4" preserveAspectRatio="none">
                <path d="M0 2 C 20 0, 40 4, 60 2 S 100 0, 100 2" stroke="#3b82f6" strokeWidth="2" fill="none" />
              </svg>
            </h1>
          </div>

          <div className="hidden lg:flex items-center gap-4">
            {(isSuperAdmin && establishments.length > 0) && (
              <div className="relative group">
                <select
                  value={selectedEstId || ''}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedEstId(id);
                    localStorage.setItem('selectedEstId', id);
                    setActiveView('monitor');
                  }}
                  className={cn(
                    "appearance-none bg-transparent pl-4 pr-10 py-2 rounded-xl border font-bold text-sm focus:outline-none transition-all cursor-pointer",
                    isDarkMode 
                      ? "border-slate-800 text-slate-300 hover:bg-slate-800" 
                      : "border-slate-100 text-slate-600 hover:bg-slate-50 shadow-sm"
                  )}
                >
                  {establishments.map(est => (
                    <option key={est.id} value={est.id} className={isDarkMode ? "bg-slate-900 text-white" : "bg-white text-slate-900"}>
                      {est.name}
                    </option>
                  ))}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-40">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            )}
            <div className={cn("px-4 py-2 rounded-xl border flex items-center gap-4", isDarkMode ? "bg-slate-800/30 border-slate-800" : "bg-slate-50/50 border-slate-100")}>
              <div className="flex flex-col">
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Cochera Seleccionada</span>
                <span className="text-sm font-bold">{currentEst?.name || 'Ninguna'}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            <div className="hidden sm:flex flex-col items-right text-right mr-2">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Operador</span>
              <span className="text-xs font-bold block">{user?.displayName || user?.email?.split('@')[0]}</span>
            </div>

            <button
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={cn(
                "p-2.5 rounded-xl transition-all border group relative",
                isDarkMode 
                  ? "bg-slate-800 border-slate-700 text-amber-400" 
                  : "bg-white border-slate-100 text-slate-400 hover:bg-slate-50 hover:text-slate-600 shadow-sm"
              )}
            >
              {isDarkMode ? <Sun className="w-5 h-5 fill-amber-400/20" /> : <Moon className="w-5 h-5" />}
            </button>
            
            <button 
              onClick={logout}
              className={cn(
                "lg:hidden p-2.5 transition-all border border-transparent rounded-xl",
                isDarkMode ? "hover:bg-red-950 text-slate-500 hover:text-red-400" : "hover:bg-red-50 text-slate-400 hover:text-red-500"
              )}
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6 lg:p-8 overflow-hidden relative">
          {/* Center Content Column */}

        {/* Center Content Column */}
        <div className={cn(
          "flex-1 border shadow-xl shadow-slate-200/40 flex flex-col overflow-hidden relative transition-colors duration-500",
          "rounded-xl",
          isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
        )}>
          {/* Content Header (Mobile Context) */}
          <div className={cn(
            "p-5 md:p-8 border-b flex justify-between items-center backdrop-blur-md sticky top-0 z-20 transition-colors duration-500",
            isDarkMode ? "bg-slate-900/80 border-slate-800" : "bg-white/80 border-slate-100"
          )}>
            <div>
              <p className={cn(
                "text-[9px] font-black uppercase tracking-[0.3em] mb-1",
                isDarkMode ? "text-indigo-400" : "text-indigo-500"
              )}>
                {activeView === 'monitor' ? 'SISTEMA DE CONTROL' : 'ADMINISTRACIÓN'}
              </p>
              <h2 className={cn("font-black text-xl md:text-2xl tracking-tight transition-colors duration-500 flex items-center gap-2 relative", isDarkMode ? "text-white" : "text-slate-900")}>
                {activeView === 'monitor' ? <><Building2 className="w-6 h-6 text-indigo-500" /> Mapa de Cocheras</> : 
                 activeView === 'activity' ? <><Activity className="w-6 h-6 text-indigo-500" /> Sesiones Activas</> :
                 activeView === 'history' ? <><HistoryIcon className="w-6 h-6 text-indigo-500" /> Historial</> : 
                 activeView === 'reports' ? <><Search className="w-6 h-6 text-indigo-500" /> Analítica</> : <><SettingsIcon className="w-6 h-6 text-indigo-500" /> Ajustes</>}
                <svg className="absolute -bottom-1 left-0 w-full h-1 overflow-visible opacity-50" viewBox="0 0 100 4" preserveAspectRatio="none">
                  <path d="M0 2 Q 25 4, 50 2 T 100 2" stroke="url(#line-gradient-content)" strokeWidth="2" fill="none" />
                  <defs>
                    <linearGradient id="line-gradient-content" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#6366f1" />
                      <stop offset="100%" stopColor="#3b82f6" />
                    </linearGradient>
                  </defs>
                </svg>
              </h2>
            </div>
            
              <div className="flex items-center gap-1">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all",
                  isDarkMode ? "bg-slate-800 border-slate-700" : "bg-slate-50 border-slate-100"
                )}>
                  <Search className="w-3.5 h-3.5 text-slate-400" />
                  <input 
                    type="text"
                    value={historySearchTerm}
                    onChange={(e) => setHistorySearchTerm(e.target.value.toUpperCase())}
                    placeholder="BUSCAR PATENTE..."
                    className="bg-transparent border-none outline-none text-[10px] font-black w-24 text-slate-500 placeholder:text-slate-300"
                  />
                  {historySearchTerm && (
                    <button onClick={() => setHistorySearchTerm('')}>
                      <XCircle className="w-3.5 h-3.5 text-slate-300 hover:text-red-400" />
                    </button>
                  )}
                </div>
              </div>
              <div className="hidden sm:flex gap-4 ml-auto">
              <div className="flex items-center gap-2 text-[10px] font-black text-slate-400">
                <span className={cn("w-3 h-3 border rounded-full shadow-inner", isDarkMode ? "bg-slate-800 border-slate-700" : "bg-slate-100 border-slate-200")}></span> LIBRE
              </div>
              <div className="flex items-center gap-2 text-[10px] font-black text-blue-500">
                <span className={cn("w-3 h-3 rounded-full shadow-lg transition-colors duration-500", isDarkMode ? "bg-blue-400 shadow-blue-400/20" : "bg-blue-500 shadow-blue-200")}></span> DIARIO
              </div>
              <div className="flex items-center gap-2 text-[10px] font-black text-emerald-500">
                <span className={cn("w-3 h-3 rounded-full shadow-lg transition-colors duration-500", isDarkMode ? "bg-emerald-400 shadow-emerald-400/20" : "bg-emerald-500 shadow-emerald-200")}></span> ABONO
              </div>
            </div>
          </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar-hide pb-32 md:pb-8 relative">
          <AnimatePresence mode="wait">
              { activeView === 'monitor' && !selectedEstId ? (
                <motion.div 
                  key="no-establishment"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="h-full flex items-center justify-center"
                >
                  <div className="text-center p-8">
                    <Building2 className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h2 className="text-xl font-black mb-2">No hay cocheras seleccionadas</h2>
                    <p className="text-slate-500 mb-6 max-w-xs mx-auto">Selecciona una cochera o crea una nueva para comenzar a operar.</p>
                    {isSuperAdmin && (
                      <button 
                        onClick={() => setActiveView('establishments')}
                        className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all"
                      >
                        Gestionar Cocheras
                      </button>
                    )}
                  </div>
                </motion.div>
              ) : activeView === 'establishments' ? (
                <EstablishmentsView 
                  user={user} 
                  isSuperAdmin={isSuperAdmin} 
                  establishments={establishments} 
                  isDarkMode={isDarkMode}
                  theme={currentTheme}
                />
              ) : activeView === 'activity' ? (
                <motion.div 
                  key="mobile-activity"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className={cn(
                    "flex justify-between items-center p-4 rounded-xl text-white mb-6",
                    isDarkMode ? "bg-slate-800 border border-slate-700" : "bg-slate-900"
                  )}>
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Actividad</p>
                      <p className="text-xl font-black">{activeVehicles.length} Activos</p>
                    </div>
                    <Activity className="w-8 h-8 text-indigo-400 animate-pulse" />
                  </div>
                              {activeVehicles.map((v) => {
                     const isConfirming = confirmingExitId === v.id;
                     const isMonthly = v.entryType === 'monthly';
                     return (
                       <motion.div 
                         key={v.id}
                         id={`active-${v.id}`}
                         layout
                         initial={{ opacity: 0, scale: 0.95 }}
                         animate={{ opacity: 1, scale: 1 }}
                         onClick={() => setConfirmingExitId(v.id || null)}
                         className={cn(
                           "p-4 rounded-2xl border transition-all flex flex-col gap-3 group relative",
                           isConfirming 
                             ? (isMonthly ? "bg-emerald-600 border-emerald-400 text-white shadow-xl" : "bg-blue-600 border-blue-400 text-white shadow-xl")
                             : (isDarkMode ? "bg-slate-900 border-slate-800 shadow-none" : "bg-white border-slate-100 shadow-sm")
                         )}
                       >
                         <div className="flex justify-between items-start">
                           <div>
                             <div className="flex items-center gap-2">
                                <span className={cn(
                                  "text-[10px] font-black px-1.5 py-0.5 rounded leading-none",
                                  isConfirming 
                                    ? "bg-white/20 text-white" 
                                    : (isMonthly ? "bg-emerald-500 text-white" : "bg-blue-500 text-white")
                                )}>
                                  {v.slotId}
                                </span>
                                {v.vehicleType === 'motorcycle' ? <MotorcycleIcon className={cn("w-4 h-4 text-indigo-400", isConfirming ? "text-white" : (isMonthly ? "text-emerald-400" : "text-blue-400"))} /> : <Car className={cn("w-4 h-4 text-indigo-400", isConfirming ? "text-white" : (isMonthly ? "text-emerald-400" : "text-blue-400"))} />}
                                <p className={cn("font-bold text-lg tracking-wider", isConfirming ? "text-white" : (isDarkMode ? (isMonthly ? "text-emerald-400" : "text-blue-400") : (isMonthly ? "text-emerald-600" : "text-blue-600")))}>{v.plate}</p>
                                {isMonthly && (
                                  <span className={cn("text-[8px] border px-1.5 py-0.5 rounded font-black uppercase tracking-widest leading-none", isConfirming ? "bg-white/20 border-white/30 text-white" : "bg-emerald-500/20 text-emerald-400 border-emerald-500/30")}>Abono</span>
                                )}
                             </div>
                             <p className={cn(
                               "text-[10px] font-bold uppercase mt-1",
                               isConfirming ? "text-white/60" : "text-slate-400"
                             )}>
                               Ingreso: {v.entryTime ? format(v.entryTime.toDate(), 'HH:mm') : '--:--'}
                             </p>
                           </div>
                           <div className="text-right">
                             <p className={cn(
                               "text-base font-bold",
                               isConfirming ? "text-white" : (isDarkMode ? "text-slate-100" : "text-slate-900")
                             )}>
                               {formatCurrency(calculateAmount(v))}
                             </p>
                             <div className="flex items-center justify-end gap-1 mt-1">
                                <Clock className={cn("w-3 h-3", isConfirming ? "text-white/40" : (isMonthly ? "text-emerald-300" : "text-blue-300"))} />
                                <span className={cn("text-[9px] font-black tracking-tighter", isConfirming ? "text-white/60" : (isMonthly ? "text-emerald-400" : "text-blue-400"))}>{isMonthly ? "ABONADO" : "EN CURSO"}</span>
                             </div>
                           </div>
                         </div>
   
                         {isConfirming && (
                           <motion.button 
                             initial={{ opacity: 0, y: 10 }}
                             animate={{ opacity: 1, y: 0 }}
                             onClick={(e) => { e.stopPropagation(); handleExit(v); }}
                             className="w-full bg-white text-slate-900 font-black py-4 rounded-xl text-xs tracking-widest shadow-xl flex items-center justify-center gap-2"
                           >
                             CONFIRMAR SALIDA Y COBRO
                           </motion.button>
                         )}
                       </motion.div>
                     );
                   })}
                  
                  {activeVehicles.length === 0 && (
                    <div className="p-20 text-center opacity-20">
                      <div className="flex justify-center gap-4 mb-4">
                        <Car className="w-12 h-12" />
                        <MotorcycleIcon className="w-12 h-12" />
                      </div>
                      <p className="font-black uppercase tracking-widest text-xs">Sin actividad</p>
                    </div>
                  )}
                </motion.div>
              ) : activeView === 'monthly' ? (
                <motion.div 
                  key="monthly"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="space-y-8"
                >
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Add Monthly Pass Form */}
                    <div className={cn(
                      "p-8 border shadow-xl transition-colors duration-500",
                      "rounded-lg",
                      isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
                    )}>
                      <h3 className="font-black text-xs uppercase tracking-[0.2em] mb-6 text-emerald-500">Nuevo Abono Mensual</h3>
                      <form onSubmit={handleAddMonthlyPass} className="space-y-6">
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Patente</label>
                          <input 
                            name="plate"
                            type="text" 
                            required
                            placeholder="ABC-123" 
                            className={cn(
                              "w-full px-5 py-4 border-2 rounded-2xl font-mono text-xl font-black focus:outline-none focus:border-emerald-500 transition-all uppercase",
                              isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                            )}
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo de Vehículo</label>
                          <select 
                            name="vehicleType"
                            className={cn(
                              "w-full px-5 py-4 border-2 rounded-2xl font-bold text-sm focus:outline-none focus:border-emerald-500 transition-all",
                              isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                            )}
                          >
                            <option value="car">Auto</option>
                            <option value="motorcycle">Moto</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Costo Mensual</label>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-emerald-400">$</span>
                            <input 
                              name="amount"
                              type="number" 
                              step="1"
                              required
                              placeholder="0" 
                              className={cn(
                                "w-full pl-10 pr-5 py-4 border-2 font-bold text-xl focus:outline-none focus:border-emerald-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                              )}
                            />
                          </div>
                        </div>
                        <button 
                          type="submit"
                          className={cn(
                            "w-full bg-emerald-600 text-white font-black py-5 transition-all shadow-xl shadow-emerald-100 hover:scale-[1.02] active:scale-95 text-sm tracking-widest",
                            "rounded-md"
                          )}
                        >
                          ACTIVAR ABONO
                        </button>
                      </form>
                    </div>

                    {/* Active Monthly Passes List */}
                    <div className="space-y-4">
                      <h3 className="font-black text-xs uppercase tracking-[0.2em] px-2 text-slate-500">Abonados Activos ({monthlyPasses.length})</h3>
                      <div className="space-y-3">
                        {monthlyPasses.length === 0 ? (
                           <div className="h-64 flex flex-col items-center justify-center opacity-20 filter grayscale">
                              <CheckCircle2 className="w-12 h-12 mb-4" />
                              <p className="font-black text-[10px] uppercase tracking-widest">No hay abonos activos</p>
                           </div>
                        ) : (
                          monthlyPasses.map(pass => (
                            <div 
                              key={pass.id}
                              className={cn(
                                "p-5 border flex items-center justify-between group hover:border-emerald-500/50 transition-all",
                                "rounded-lg",
                                isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100 shadow-sm"
                              )}
                            >
                                  <div className="flex items-center gap-4">
                                     <div className={cn(
                                       "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500",
                                       isDarkMode ? "bg-slate-800 text-emerald-400 group-hover:bg-emerald-900/30" : "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100"
                                     )}>
                                        {pass.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-6 h-6" /> : <Car className="w-6 h-6" />}
                                     </div>
                                     <div className="text-left">
                                        <h4 className="font-black text-lg tracking-wider bg-gradient-to-r from-emerald-500 to-emerald-400 bg-clip-text text-transparent">{pass.plate}</h4>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                                          <HistoryIcon className="w-3 h-3" />
                                          Vence: {pass.endDate ? format(pass.endDate.toDate(), 'dd MMM yyyy', { locale: es }) : '---'}
                                        </p>
                                     </div>
                                  </div>
                                  <div className="flex items-center gap-6">
                                     <div className="text-right">
                                        <p className="font-black text-emerald-500 mb-1">{formatCurrency(pass.amount)}</p>
                                        <div className="flex items-center gap-1 justify-end">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">Activo</span>
                                        </div>
                                     </div>
                                     <button 
                                       onClick={async () => {
                                         if (confirm('¿Eliminar este abono mensual?')) {
                                           try {
                                             await deleteDoc(doc(db, 'monthlyPasses', pass.id));
                                           } catch (error) {
                                             handleFirestoreError(error, OperationType.DELETE, `monthlyPasses/${pass.id}`);
                                           }
                                         }
                                       }}
                                       className="p-2 rounded-lg hover:bg-red-500/10 text-slate-300 hover:text-red-500 transition-colors"
                                     >
                                        <XCircle className="w-5 h-5" />
                                     </button>
                                  </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : activeView === 'settings' ? (
                <motion.div 
                  key="settings"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="max-w-md"
                >
                  <div className="space-y-8">
                    <form onSubmit={(e) => {
                      e.preventDefault();
                      const formData = new FormData(e.currentTarget);
                      updateSettings(
                        Number(formData.get('carRate')), 
                        Number(formData.get('carHalfHourRate')), 
                        Number(formData.get('motoDailyRate')),
                        Number(formData.get('carSlots')),
                        Number(formData.get('motoSlots')),
                        Number(formData.get('monthlyRate')),
                        Number(formData.get('motoMonthlyRate'))
                      );
                    }} className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Tarifa Auto (Hora)</h3>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                            <input 
                              name="carRate"
                              type="number"
                              step="1"
                              defaultValue={settings?.hourlyRate}
                              className={cn(
                                "w-full pl-10 pr-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Tarifa Auto (1/2 Hora)</h3>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                            <input 
                              name="carHalfHourRate"
                              type="number"
                              step="1"
                              defaultValue={settings?.carHalfHourRate || Math.ceil((settings?.hourlyRate || 1000) / 2)}
                              className={cn(
                                "w-full pl-10 pr-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 gap-4">
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Tarifa Diaria Moto</h3>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                            <input 
                              name="motoDailyRate"
                              type="number"
                              step="1"
                              defaultValue={settings?.motoDailyRate || settings?.motoHourlyRate}
                              className={cn(
                                "w-full pl-10 pr-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Tarifa Mensual Auto</h3>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                            <input 
                              name="monthlyRate"
                              type="number"
                              step="1"
                              defaultValue={settings?.monthlyRate}
                              className={cn(
                                "w-full pl-10 pr-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Tarifa Mensual Moto</h3>
                          <div className="relative">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                            <input 
                              name="motoMonthlyRate"
                              type="number"
                              step="1"
                              defaultValue={settings?.motoMonthlyRate}
                              className={cn(
                                "w-full pl-10 pr-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Cocheras Autos</h3>
                          <div className="relative">
                            <input 
                              name="carSlots"
                              type="number"
                              step="1"
                              defaultValue={settings?.carSlots}
                              className={cn(
                                "w-full px-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                        <div className="space-y-2">
                          <h3 className={cn("text-[10px] font-black uppercase text-slate-400 tracking-widest")}>Cocheras Motos</h3>
                          <div className="relative">
                            <input 
                              name="motoSlots"
                              type="number"
                              step="1"
                              defaultValue={settings?.motoSlots}
                              className={cn(
                                "w-full px-4 py-4 border font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                                "rounded-md",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-white" : "bg-slate-50 border-slate-200 text-slate-900"
                              )}
                            />
                          </div>
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className={cn(
                          "w-full font-bold py-4 transition-all shadow-lg rounded-md",
                          isDarkMode ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-slate-900 text-white hover:bg-slate-800"
                        )}
                      >
                        GUARDAR CAMBIOS
                      </button>
                    </form>
                    
                    <div className={cn(
                      "p-4 rounded-xl border flex gap-3",
                      isDarkMode ? "bg-amber-900/20 border-amber-800/30" : "bg-amber-50 border-amber-100"
                    )}>
                      <div className="w-5 h-5 text-amber-600 shrink-0">⚠</div>
                      <p className={cn("text-[11px] leading-tight", isDarkMode ? "text-amber-200 opacity-60" : "text-amber-900 opacity-80")}>
                        Modificar las tarifas o capacidad durante la operación requiere atención para evitar discrepancias en los registros activos.
                      </p>
                    </div>
                  </div>
                </motion.div>
              ) : activeView === 'reports' ? (
                <motion.div 
                  key="reports"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-8"
                >
                  <div className="flex flex-col md:flex-row gap-4 items-end bg-slate-50/50 dark:bg-slate-800/30 p-4 md:p-6 rounded-3xl border border-slate-100 dark:border-slate-800">
                      <div className="space-y-1 w-full md:w-auto">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desde</label>
                        <input 
                          type="date" 
                          value={startDate}
                          onChange={(e) => setStartDate(e.target.value)}
                          className={cn(
                            "block w-full border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-3 text-sm font-bold outline-none transition-all shadow-sm",
                            isDarkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"
                          )}
                        />
                      </div>
                      <div className="space-y-1 w-full md:w-auto">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hasta</label>
                        <input 
                          type="date" 
                          value={endDate}
                          onChange={(e) => setEndDate(e.target.value)}
                          className={cn(
                            "block w-full border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-3 text-sm font-bold outline-none transition-all shadow-sm",
                            isDarkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"
                          )}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-8">
                      <div className={cn(
                        "p-6 md:p-8 rounded-[2.5rem] border shadow-xl relative overflow-hidden group",
                        isDarkMode ? "bg-slate-900 border-slate-800 shadow-none" : "bg-white border-slate-100 shadow-slate-100/50"
                      )}>
                        <div className={cn(
                          "absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500",
                          isDarkMode ? "bg-emerald-900/20" : "bg-emerald-50"
                        )} />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Caja Total</p>
                        <p className={cn(
                          "text-3xl md:text-5xl font-black relative",
                          isDarkMode ? "text-emerald-400" : "text-emerald-600"
                        )}>
                          {formatCurrency(reportData.reduce((acc, v) => acc + (v.totalAmount || 0), 0))}
                        </p>
                      </div>
                      <div className={cn(
                        "p-6 md:p-8 rounded-[2.5rem] border shadow-xl relative overflow-hidden group text-center",
                        isDarkMode ? "bg-slate-900 border-slate-800 shadow-none" : "bg-white border-slate-100 shadow-slate-100/50"
                      )}>
                        <div className={cn(
                          "absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500",
                          isDarkMode ? "bg-slate-800/50" : "bg-slate-50"
                        )} />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Operaciones</p>
                        <p className={cn(
                          "text-3xl md:text-5xl font-black relative",
                          isDarkMode ? "text-white" : "text-slate-900"
                        )}>{reportData.length}</p>
                      </div>
                      <div className={cn(
                        "p-6 md:p-8 rounded-[2.5rem] border shadow-xl relative overflow-hidden group text-right",
                        isDarkMode ? "bg-slate-900 border-slate-800 shadow-none" : "bg-white border-slate-100 shadow-slate-100/50"
                      )}>
                        <div className={cn(
                          "absolute top-0 right-0 w-32 h-32 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500",
                          isDarkMode ? "bg-indigo-900/20" : "bg-indigo-50"
                        )} />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Ticket Prom.</p>
                        <p className={cn(
                          "text-3xl md:text-5xl font-black relative",
                          isDarkMode ? "text-indigo-400" : "text-indigo-600"
                        )}>
                          {reportData.length > 0 
                            ? formatCurrency(reportData.reduce((acc, v) => acc + (v.totalAmount || 0), 0) / reportData.length)
                            : '$ 0'}
                        </p>
                      </div>
                    </div>

                    <div className={cn(
                      "border rounded-[2rem] overflow-hidden shadow-sm",
                      isDarkMode ? "bg-slate-900/50 border-slate-800" : "bg-white border-slate-100"
                    )}>
                      <div className={cn(
                        "px-8 py-5 border-b flex justify-between items-center",
                        isDarkMode ? "bg-slate-800/50 border-slate-800" : "bg-slate-50 border-slate-100"
                      )}>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Detalle de Cobros</h4>
                        <div className={cn(
                          "w-8 h-8 rounded-full border flex items-center justify-center transition-colors duration-500",
                          isDarkMode ? "bg-slate-800 border-slate-700 text-slate-600" : "bg-white border-slate-200 text-slate-300"
                        )}>
                          <Search className="w-4 h-4" />
                        </div>
                      </div>
                      {reportData.length === 0 ? (
                        <div className="p-20 text-center text-slate-300 italic text-xs">No hay datos para el periodo seleccionado</div>
                      ) : (
                        <div className={cn("divide-y", isDarkMode ? "divide-slate-800" : "divide-slate-50")}>
                          {Object.entries(reportData.reduce((acc, curr) => {
                            if (!curr.exitTime || !curr.totalAmount) return acc;
                            const dateKey = format(curr.exitTime.toDate(), 'dd/MM/yyyy');
                            if (!acc[dateKey]) acc[dateKey] = { income: 0, count: 0 };
                            acc[dateKey].income += curr.totalAmount;
                            acc[dateKey].count += 1;
                            return acc;
                          }, {} as Record<string, { income: number, count: number }>)).sort().reverse().map(([date, stats]) => {
                            const s = stats as { income: number, count: number };
                            return (
                              <div key={date} className={cn("px-6 py-4 flex items-center justify-between transition-colors", isDarkMode ? "hover:bg-slate-800/40" : "hover:bg-slate-50")}>
                                <span className={cn("font-bold text-sm", isDarkMode ? "text-slate-400" : "text-slate-600")}>{date}</span>
                                <div className="flex gap-8">
                                <div className="text-right">
                                  <span className="text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase block">Recaudación</span>
                                  <span className={cn("font-bold", isDarkMode ? "text-emerald-400" : "text-emerald-600")}>{formatCurrency(s.income)}</span>
                                </div>
                                <div className="text-right w-16">
                                  <span className="text-[9px] font-black text-slate-300 dark:text-slate-600 uppercase block">Vehículos</span>
                                  <span className={cn("font-bold", isDarkMode ? "text-slate-100" : "text-slate-900")}>{s.count}</span>
                                </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                </motion.div>
              ) : activeView === 'history' ? (
                <motion.div 
                  key="history"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <div className="space-y-4">
                    {historySearchTerm && (
                      <div className={cn(
                        "p-4 rounded-2xl border flex items-center justify-between mb-4 rounded-lg",
                        isDarkMode ? "bg-indigo-900/20 border-indigo-500/30 text-indigo-300" : "bg-indigo-50 border-indigo-100 text-indigo-600"
                      )}>
                        <div className="flex items-center gap-3">
                          <Search className="w-5 h-5" />
                          <p className="text-sm font-bold uppercase tracking-tight">Mostrando historial para: <span className="font-black">#{historySearchTerm}</span></p>
                        </div>
                        <button 
                          onClick={() => setHistorySearchTerm('')}
                          className="bg-white/20 hover:bg-white/40 px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                        >
                          Limpiar
                        </button>
                      </div>
                    )}
                    {history.filter(v => v.plate.includes(historySearchTerm)).length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center text-slate-300 gap-3 grayscale">
                         <HistoryIcon className="w-12 h-12 opacity-20" />
                         <p className="text-[10px] font-black uppercase tracking-widest">Sin registros que coincidan</p>
                      </div>
                    ) : (
                      history.filter(v => v.plate.includes(historySearchTerm)).map((v) => {
                        if (!v.entryTime || !v.exitTime || !v.id) return null;
                        const diff = v.exitTime.toDate().getTime() - v.entryTime.toDate().getTime();
                        const h = Math.floor(diff / (1000 * 60 * 60));
                        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                        const isMonthly = v.entryType === 'monthly';

                        return (
                          <div 
                            key={v.id} 
                            onClick={() => setSelectedHistoryVehicle(v)}
                            className={cn(
                              "border p-3 flex items-center justify-between transition-all group cursor-pointer",
                              "rounded-lg",
                              isDarkMode ? "bg-slate-900 border-slate-800 hover:border-slate-700" : "bg-white border-slate-100 hover:border-slate-200 shadow-sm"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                                isDarkMode 
                                  ? (isMonthly ? "bg-emerald-900/20 text-emerald-400" : "bg-blue-900/20 text-blue-400") 
                                  : (isMonthly ? "bg-emerald-50 text-emerald-600" : "bg-blue-50 text-blue-600")
                              )}>
                                {v.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-5 h-5" /> : <Car className="w-5 h-5" />}
                              </div>
                              <div>
                                <div className="flex items-center gap-2 mb-0.5">
                                  <h4 className={cn(
                                    "font-black tracking-widest text-xs relative px-2 py-0.5 rounded shadow-sm inline-block border overflow-hidden transition-colors",
                                    isDarkMode 
                                      ? (isMonthly ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-400" : "bg-blue-950/40 border-blue-800/50 text-blue-400") 
                                      : (isMonthly ? "bg-emerald-50 border-emerald-100 text-emerald-700" : "bg-blue-50 border-blue-100 text-blue-700")
                                  )}>
                                    <span className="relative z-10">{v.plate}</span>
                                  </h4>
                                  <span className={cn(
                                    "text-[6px] font-black uppercase tracking-widest px-1 py-0.5 rounded border-none",
                                    isMonthly ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
                                  )}>
                                    {isMonthly ? 'Abono' : 'Diario'}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 text-[9px] text-slate-400 font-bold uppercase tracking-tight">
                                  <span>{format(v.entryTime.toDate(), 'HH:mm')}</span>
                                  <span>→</span>
                                  <span>{format(v.exitTime.toDate(), 'HH:mm')}</span>
                                  <span className={isDarkMode ? "text-slate-800" : "text-slate-200"}>|</span>
                                  <span>{h}h {m}m</span>
                                </div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <p className={cn("font-black text-base", isMonthly ? (isDarkMode ? "text-emerald-400" : "text-emerald-600") : (isDarkMode ? "text-blue-400" : "text-blue-600"))}>{formatCurrency(v.totalAmount)}</p>
                                <p className="text-[9px] text-slate-300 dark:text-slate-600 font-bold uppercase tracking-tighter">{format(v.exitTime.toDate(), 'dd MMM')}</p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!v.id) return;
                                  if (confirmDeleteId === v.id) {
                                    handleDeleteHistory(v.id);
                                  } else {
                                    setConfirmDeleteId(v.id);
                                    setTimeout(() => setConfirmDeleteId(null), 5000);
                                  }
                                }}
                                className={cn(
                                  "p-2 transition-all rounded-full relative z-[200] flex items-center gap-1",
                                  confirmDeleteId === v.id 
                                    ? "bg-rose-500 text-white px-3" 
                                    : (isDarkMode ? "text-slate-500 hover:text-rose-400 hover:bg-slate-800" : "text-slate-400 hover:text-rose-500 hover:bg-rose-50")
                                )}
                                title={confirmDeleteId === v.id ? "Confirmar eliminación" : "Eliminar registro"}
                              >
                                {confirmDeleteId === v.id ? (
                                  <span className="text-[9px] font-black uppercase tracking-widest whitespace-nowrap">¿Borrar?</span>
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="dashboard"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="space-y-12"
                >
                  <section>
                    <div className="flex items-center gap-3 mb-6 relative">
                       <Car className="w-[26px] h-[26px] text-blue-500" />
                       <h3 className="font-black text-xs uppercase tracking-[0.2em] text-slate-500">Cocheras de Autos</h3>
                       <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                       <svg className="absolute -bottom-1 left-0 w-8 h-px text-blue-500/50" viewBox="0 0 40 1">
                         <line x1="0" y1="0.5" x2="40" y2="0.5" stroke="currentColor" strokeWidth="1" />
                       </svg>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                      {Array.from({ length: settings?.carSlots || 40 }).map((_, i) => {
                        const slotNum = String(i + 1).padStart(2, '0');
                        const slotId = `A-${slotNum}`;
                        const vehicle = activeVehicles.find(v => v.slotId === slotId);
                        const isSelected = selectedSlot === slotId;
                        const isOccupiedSelected = vehicle?.id === confirmingExitId;
                        
                        return (
                          <button 
                            key={slotId} 
                            onClick={() => {
                              setSelectedVehicleType('car');
                              handleSlotClick(slotId, vehicle);
                            }}
                            className={cn(
                              "aspect-[3/4] flex flex-col items-center justify-center gap-1 transition-all border font-mono text-[10px] relative overflow-hidden group hover:scale-[1.02] active:scale-95",
                              "rounded-sm",
                              vehicle 
                                ? isOccupiedSelected 
                                  ? (vehicle.entryType === 'monthly' ? "bg-emerald-600 border-emerald-400 text-white ring-4 ring-emerald-500/20 shadow-xl" : "bg-blue-600 border-blue-400 text-white ring-4 ring-blue-500/20 shadow-xl")
                                  : (isDarkMode 
                                      ? (vehicle.entryType === 'monthly' ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-100 shadow-lg" : "bg-blue-950/40 border-blue-800/50 text-blue-100 shadow-lg") 
                                      : (vehicle.entryType === 'monthly' ? "bg-white border-emerald-200 text-emerald-600 shadow-sm" : "bg-white border-blue-200 text-blue-600 shadow-sm")
                                    )
                                : isSelected
                                  ? (isDarkMode ? "bg-slate-800 border-slate-600 text-slate-400 ring-4 ring-slate-500/10 animate-pulse" : "bg-slate-50 border-slate-300 text-slate-600 ring-4 ring-slate-500/10 animate-pulse")
                                  : (isDarkMode ? "bg-slate-950 border-slate-800 text-slate-700 hover:border-slate-700 hover:bg-slate-900" : "bg-slate-50 border-slate-100 text-slate-300 hover:border-slate-300 hover:bg-white")
                            )}
                          >
                            {!vehicle && <div className={cn("absolute inset-0 border-x-[1px] border-dashed opacity-20 pointer-events-none", isDarkMode ? "border-slate-700" : "border-slate-300")} />}
                            <span className={cn("absolute top-1 left-1.5 font-black text-[20px] leading-[21.5px] tracking-tighter z-10", vehicle ? (isOccupiedSelected ? "text-white/20" : (vehicle.entryType === 'monthly' ? "text-emerald-400/30" : "text-blue-400/30")) : "text-slate-400")}>#{slotNum}</span>
                            {vehicle ? (
                               <div className="relative w-full h-full p-2 flex flex-col items-center justify-center">
                                 <motion.div layoutId={`car-body-${vehicle.id}`} className={cn("absolute inset-x-2 inset-y-2 shadow-lg transition-all duration-500 flex items-center justify-center overflow-hidden", 
                                   "rounded-lg",
                                   isOccupiedSelected 
                                     ? "bg-gradient-to-br from-white to-slate-200"
                                     : (isDarkMode 
                                         ? (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-400 to-emerald-600" : "bg-gradient-to-br from-blue-400 to-blue-600") 
                                         : (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : "bg-gradient-to-br from-blue-500 to-blue-700"))
                                 )}>
                                   <ParkingIcon className={cn("w-full h-full p-2.5 opacity-80", isOccupiedSelected ? "text-blue-600" : "text-white/20")} />
                                   <div className="absolute top-1 right-1 opacity-40">
                                      <Car className="w-2.5 h-2.5 text-white" />
                                   </div>
                                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
                                 </motion.div>
                                 <div className="relative z-10 flex flex-col items-center">
                                   <span className={cn("font-black text-[10px] tracking-tight transition-colors drop-shadow-sm", isOccupiedSelected ? "text-blue-900" : "text-white")}>{vehicle.plate}</span>
                                   {vehicle.entryType === 'monthly' && (
                                     <div className="w-1.5 h-1.5 bg-white rounded-full mt-1 animate-pulse shadow-sm" title="Abonado" />
                                   )}
                                 </div>
                               </div>
                            ) : (
                              <div className={cn("w-7 h-7 rounded-full flex items-center justify-center transition-all", isSelected ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-slate-100 dark:bg-slate-900 text-slate-300 dark:text-slate-800")}>
                                 <Plus className="w-3.5 h-3.5" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="flex items-center gap-3 mb-6 relative">
                       <MotorcycleIcon className="w-[26px] h-[26px] text-blue-500" />
                       <h3 className="font-black text-xs uppercase tracking-[0.2em] text-slate-500">Cocheras de Motos</h3>
                       <div className="h-px flex-1 bg-slate-100 dark:bg-slate-800" />
                       <svg className="absolute -bottom-1 left-0 w-8 h-px text-blue-500/50" viewBox="0 0 40 1">
                         <line x1="0" y1="0.5" x2="40" y2="0.5" stroke="currentColor" strokeWidth="1" />
                       </svg>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                      {Array.from({ length: settings?.motoSlots || 20 }).map((_, i) => {
                        const slotNum = String(i + 1).padStart(2, '0');
                        const slotId = `M-${slotNum}`;
                        const vehicle = activeVehicles.find(v => v.slotId === slotId);
                        const isSelected = selectedSlot === slotId;
                        const isOccupiedSelected = vehicle?.id === confirmingExitId;
                        
                        return (
                          <button 
                            key={slotId} 
                            onClick={() => {
                              setSelectedVehicleType('motorcycle');
                              handleSlotClick(slotId, vehicle);
                            }}
                            className={cn(
                              "aspect-[3/4] flex flex-col items-center justify-center gap-1 transition-all border font-mono text-[10px] relative overflow-hidden group hover:scale-[1.02] active:scale-95",
                              "rounded-sm",
                              vehicle 
                                ? isOccupiedSelected 
                                  ? (vehicle.entryType === 'monthly' ? "bg-emerald-600 border-emerald-400 text-white ring-4 ring-emerald-500/20 shadow-xl" : "bg-blue-600 border-blue-400 text-white ring-4 ring-blue-500/20 shadow-xl")
                                  : (isDarkMode 
                                      ? (vehicle.entryType === 'monthly' ? "bg-emerald-950/40 border-emerald-800/50 text-emerald-300 shadow-lg" : "bg-blue-950/40 border-blue-800/50 text-blue-300 shadow-lg") 
                                      : (vehicle.entryType === 'monthly' ? "bg-white border-emerald-200 text-emerald-600 shadow-sm" : "bg-white border-blue-200 text-blue-600 shadow-sm")
                                    )
                                : isSelected
                                  ? (isDarkMode ? "bg-slate-800 border-slate-600 text-slate-400 ring-4 ring-slate-500/10 animate-pulse" : "bg-slate-50 border-slate-300 text-slate-600 ring-4 ring-slate-500/10 animate-pulse")
                                  : (isDarkMode ? "bg-slate-950 border-slate-800 text-slate-700 hover:border-slate-700 hover:bg-slate-900" : "bg-slate-50 border-slate-100 text-slate-300 hover:border-slate-300 hover:bg-white")
                            )}
                          >
                            {!vehicle && <div className={cn("absolute inset-0 border-x-[1px] border-dashed opacity-20 pointer-events-none", isDarkMode ? "border-slate-700" : "border-slate-300")} />}
                            <span className={cn("absolute top-1 left-1.5 font-black text-[20px] leading-[21.5px] tracking-tighter z-10", vehicle ? (isOccupiedSelected ? "text-white/20" : (vehicle.entryType === 'monthly' ? "text-emerald-400/30" : "text-blue-400/30")) : "text-slate-400")}>#{slotNum}</span>
                            {vehicle ? (
                               <div className="relative w-full h-full p-2 flex flex-col items-center justify-center">
                                 {/* Moto Body Shape */}
                                 <motion.div 
                                   layoutId={`car-body-${vehicle.id}`}
                                   className={cn(
                                     "absolute w-8 h-5 shadow-lg transition-all duration-500 flex items-center justify-center overflow-hidden",
                                     "rounded-lg",
                                     isOccupiedSelected 
                                       ? "bg-gradient-to-br from-white to-slate-200"
                                       : (isDarkMode 
                                           ? (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-violet-400 to-violet-600" : "bg-gradient-to-br from-indigo-400 to-indigo-600") 
                                           : (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-violet-500 to-violet-700" : "bg-gradient-to-br from-indigo-500 to-indigo-700"))
                                   )}
                                 >
                                   <ParkingIcon className={cn("w-full h-full p-3 opacity-80", isOccupiedSelected ? "text-indigo-600" : "text-white/20")} />
                                   <div className="absolute top-0.5 right-1 opacity-40">
                                      <MotorcycleIcon className="w-2.5 h-2.5 text-white" />
                                   </div>
                                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
                                 </motion.div>
                                 <div className="relative z-10 flex flex-col items-center mt-8">
                                   <span className={cn("font-black text-[9px] tracking-tight drop-shadow-sm", isOccupiedSelected ? "text-blue-900" : "text-white")}>{vehicle.plate}</span>
                                   {vehicle.entryType === 'monthly' && (
                                     <div className="w-1.5 h-1.5 bg-white rounded-full mt-0.5 animate-pulse shadow-sm" title="Abonado" />
                                   )}
                                 </div>
                               </div>
                            ) : (
                              <div className={cn("w-6 h-6 rounded-full flex items-center justify-center transition-all", isSelected ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-slate-100 dark:bg-slate-900 text-slate-300 dark:text-slate-800")}>
                                 <Plus className="w-3 h-3" />
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Column: Active Sessions (Hidden by default for 'Actividad sin vivo') */}
        <div className="hidden 2xl:flex w-80 bg-slate-900 rounded-[32px] shadow-2xl flex-col p-6 text-white shrink-0 h-full overflow-hidden">
          <div className="flex justify-between items-center mb-6">
            <h2 className="font-bold text-sm tracking-tight">Actividad en Vivo</h2>
            <span className="text-[9px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full font-black uppercase tracking-widest">
              Online
            </span>
          </div>

          <div className="flex-1 flex flex-col gap-3 overflow-y-auto scrollbar-hide">
            <AnimatePresence initial={false}>
              {activeVehicles.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center opacity-20 gap-4">
                   <Clock className="w-12 h-12" />
                   <p className="text-[10px] font-black uppercase tracking-widest text-center">Sin vehículos<br/>activos</p>
                </div>
              ) : (
                activeVehicles.map((v) => {
                  const isConfirming = confirmingExitId === v.id;
                  const isMonthly = v.entryType === 'monthly';
                  return (
                    <motion.div 
                      key={v.id}
                      id={`active-${v.id}`}
                      layout
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => !isConfirming && setConfirmingExitId(v.id || null)}
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex flex-col gap-3 group relative",
                        isConfirming 
                          ? (isMonthly ? "bg-emerald-600 border-emerald-400 ring-4 ring-emerald-500/20 shadow-xl" : "bg-blue-600 border-blue-400 ring-4 ring-blue-500/20 shadow-xl")
                          : (isDarkMode ? "bg-slate-800 border-slate-700 hover:border-slate-600 cursor-pointer" : "bg-white border-slate-100 hover:border-slate-200 cursor-pointer shadow-sm")
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                             <span className={cn(
                               "text-[10px] font-black text-white px-1.5 py-0.5 rounded leading-none",
                               isConfirming ? "bg-white/20" : (isMonthly ? "bg-emerald-500" : "bg-blue-500")
                             )}>
                               {v.slotId}
                             </span>
                             {v.vehicleType === 'motorcycle' ? <MotorcycleIcon className={cn("w-4 h-4", isConfirming ? "text-white" : (isMonthly ? "text-emerald-400" : "text-blue-400"))} /> : <Car className={cn("w-4 h-4", isConfirming ? "text-white" : (isMonthly ? "text-emerald-400" : "text-blue-400"))} />}
                             <p className={cn("font-bold text-lg tracking-wider", isConfirming ? "text-white" : (isDarkMode ? (isMonthly ? "text-emerald-400" : "text-blue-400") : (isMonthly ? "text-emerald-600" : "text-blue-600")))}>{v.plate}</p>
                          </div>
                          <p className={cn("text-[10px] font-bold uppercase mt-1", isConfirming ? "text-white/60" : "text-slate-400")}>Ingreso: {v.entryTime ? format(v.entryTime.toDate(), 'HH:mm') : '--:--'}</p>
                        </div>
                        <div className="text-right">
                          <p className={cn("text-base font-bold", isConfirming ? "text-white" : (isDarkMode ? "text-white" : "text-slate-900"))}>{formatCurrency(calculateAmount(v))}</p>
                          <p className={cn("text-[10px] font-black", isMonthly ? "text-emerald-400" : "text-blue-400")}>{isMonthly ? "ABONO" : "DIARIO"}</p>
                        </div>
                      </div>
                      
                      <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           handleExit(v);
                         }}
                         className={cn(
                           "w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all",
                           isConfirming 
                             ? "bg-white text-slate-900 hover:bg-slate-50" 
                             : (isDarkMode ? "bg-slate-700 text-slate-300 hover:bg-slate-600" : "bg-slate-50 text-slate-500 hover:bg-slate-100")
                         )}
                      >
                         {isConfirming ? "CONFIRMAR COBRO" : "CERRAR ESTADÍA"}
                      </button>
                    </motion.div>
                  );
                })
              )}
            </AnimatePresence>
          </div>

          <div className="mt-6 pt-6 border-t border-slate-800">
             <div className="flex justify-between items-center mb-4 text-[11px] font-bold">
                <span className="text-slate-400 uppercase tracking-widest">Total en Playa</span>
                <span className="text-white bg-slate-800 px-3 py-1 rounded-lg">
                  {formatCurrency(activeVehicles.reduce((acc, v) => acc + calculateAmount(v), 0))}
                </span>
             </div>
             <button 
               className="w-full bg-slate-800 text-slate-400 text-[10px] font-bold py-3 rounded-xl cursor-not-allowed opacity-50 flex items-center justify-center gap-2"
             >
               GENERAR ARCHEO DE CAJA
             </button>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {duplicateVehicleAlert && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] w-full max-w-sm px-4">
            <motion.div 
              initial={{ opacity: 0, y: -50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -20, scale: 0.9 }}
              className={cn(
                "w-full rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.15)] p-6 border-2 flex items-center gap-4 relative overflow-hidden",
                isDarkMode ? "bg-slate-900 border-rose-500/30 text-white" : "bg-white border-rose-500/20 text-slate-900"
              )}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-rose-500/5 to-transparent pointer-events-none" />
              <div className="w-12 h-12 bg-rose-500/10 rounded-2xl flex items-center justify-center text-rose-500 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <h4 className="font-black text-rose-500 text-sm uppercase tracking-wider mb-0.5">¡Atención!</h4>
                <p className="text-xs font-bold text-slate-400 leading-tight">
                  {duplicateVehicleAlert.type === 'active' && `El vehículo ${duplicateVehicleAlert.plate} ya tiene una estadía activa.`}
                  {duplicateVehicleAlert.type === 'monthly' && `El vehículo ${duplicateVehicleAlert.plate} ya tiene un abono activo.`}
                </p>
              </div>
              <button 
                onClick={() => setDuplicateVehicleAlert(null)}
                className="w-10 h-10 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center transition-colors shrink-0"
              >
                <XCircle className="w-5 h-5 text-slate-400" />
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile Bottom Nav */}
      <div className="md:hidden fixed bottom-6 left-6 right-6 z-[60] flex items-center justify-between p-2 bg-slate-900/90 dark:bg-slate-800/90 backdrop-blur-xl border border-white/10 shadow-2xl rounded-2xl">
        {[
          { id: 'monitor', icon: Activity, label: 'Inicio' },
          { id: 'history', icon: HistoryIcon, label: 'Historial' },
          { id: 'settings', icon: SettingsIcon, label: 'Ajustes' },
        ].map((v) => (
          <button 
            key={v.id}
            onClick={() => setActiveView(v.id as any)}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-2 transition-all gap-1",
              activeView === v.id ? "text-indigo-400" : "text-slate-500"
            )}
          >
            <v.icon className={cn("w-5 h-5", activeView === v.id ? "scale-110" : "")} />
            <span className="text-[7px] font-black uppercase tracking-widest">{v.label}</span>
          </button>
        ))}
      </div>

      {/* Entry Modal */}
      <AnimatePresence>
        {selectedSlot && !confirmingExitVehicle && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedSlot("")}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-sm shadow-2xl overflow-hidden transition-colors duration-500 max-h-[95vh] flex flex-col rounded-xl",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-indigo-500 to-blue-500" />
              
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                <div className="flex flex-col items-center text-center gap-4">
                  <div className="w-16 h-16 bg-blue-50 dark:bg-blue-900/30 rounded-3xl flex items-center justify-center">
                    <Plus className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="text-xl font-black tracking-tight uppercase flex items-center gap-2 justify-center">
                      Nueva Entrada
                      <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                        <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </h3>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Cochera Asignada: <span className={isDarkMode ? "text-blue-400" : "text-blue-600"}>{selectedSlot}</span></p>
                  </div>
                </div>

                <form onSubmit={handleEntry} className="space-y-6">
                  {/* Vehicle Type Selection */}
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      type="button"
                      onClick={() => setSelectedVehicleType('car')}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all group",
                        selectedVehicleType === 'car' 
                          ? (isDarkMode ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-blue-50 border-blue-500 text-blue-600")
                          : (isDarkMode ? "bg-slate-800 border-transparent text-slate-500" : "bg-slate-100 border-transparent text-slate-400")
                      )}
                    >
                      <Car className={cn("w-6 h-6 transition-transform group-active:scale-90", selectedVehicleType === 'car' ? "animate-pulse" : "")} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Auto</span>
                    </button>
                    <button 
                      type="button"
                      onClick={() => setSelectedVehicleType('motorcycle')}
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all group",
                        selectedVehicleType === 'motorcycle' 
                          ? (isDarkMode ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-blue-50 border-blue-500 text-blue-600")
                          : (isDarkMode ? "bg-slate-800 border-transparent text-slate-500" : "bg-slate-100 border-transparent text-slate-400")
                      )}
                    >
                      <MotorcycleIcon className={cn("w-6 h-6 transition-transform group-active:scale-90", selectedVehicleType === 'motorcycle' ? "animate-pulse" : "")} />
                      <span className="text-[10px] font-black uppercase tracking-widest">Moto</span>
                    </button>
                  </div>

                  {/* Entry Type Toggle */}
                  <div className="flex p-1 bg-slate-100 dark:bg-slate-800 rounded-[1.25rem] gap-1">
                    <button 
                      type="button"
                      onClick={() => setSelectedEntryType('daily')}
                      className={cn(
                        "flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                        selectedEntryType === 'daily' 
                          ? "bg-blue-600 text-white shadow-lg" 
                          : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      DIARIO
                    </button>
                    <button 
                      type="button"
                      onClick={() => setSelectedEntryType('monthly')}
                      className={cn(
                        "flex-1 py-3 px-4 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                        selectedEntryType === 'monthly' 
                          ? "bg-emerald-600 text-white shadow-lg" 
                          : "text-slate-400 hover:text-slate-600"
                      )}
                    >
                      ABONADO
                    </button>
                  </div>

                  {selectedEntryType === 'monthly' && (
                    <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                      <div className="flex items-center justify-between ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
                        <span>Abonado</span>
                        <button 
                          type="button" 
                          onClick={() => {
                            setActiveView('monthly');
                            setSelectedSlot('');
                          }}
                          className="text-emerald-500 hover:underline"
                        >
                          + Nuevo
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 max-h-40 overflow-y-auto pr-1 scrollbar-hide">
                        {monthlyPasses.length > 0 ? (
                          monthlyPasses.map(pass => (
                            <button
                              key={pass.id}
                              type="button"
                              onClick={() => {
                                setPlate(pass.plate);
                                setSelectedVehicleType(pass.vehicleType);
                              }}
                              className={cn(
                                "flex items-center justify-between p-4 rounded-2xl border-2 transition-all",
                                plate === pass.plate 
                                  ? "bg-emerald-500/10 border-emerald-500 text-emerald-400" 
                                  : (isDarkMode ? "bg-slate-800 border-transparent text-slate-400" : "bg-slate-50 border-transparent text-slate-500")
                              )}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono font-black text-lg">{pass.plate}</span>
                              </div>
                              <CheckCircle2 className={cn("w-5 h-5 transition-opacity", plate === pass.plate ? "opacity-100" : "opacity-0")} />
                            </button>
                          ))
                        ) : (
                          <div className="p-4 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl text-center opacity-40">
                            <p className="text-[10px] font-black uppercase tracking-widest">No hay abonados</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Plate Input */}
                  <div className="space-y-2 relative">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Patente</label>
                    <div className="relative">
                      <input 
                        ref={plateInputRef}
                        type="text" 
                        value={plate}
                        onChange={(e) => {
                          setPlate(e.target.value.toUpperCase());
                          setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        placeholder="PATENTE" 
                        className={cn(
                          "w-full px-6 py-5 border font-mono text-3xl font-black text-center focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all uppercase",
                          "rounded-md",
                          isDarkMode 
                            ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-700" 
                            : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-200"
                        )}
                      />
                      {showSuggestions && plate.length >= 2 && (
                        <div className={cn(
                          "absolute left-0 right-0 top-full mt-1 z-[100] rounded-2xl shadow-2xl border overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-40 overflow-y-auto",
                          isDarkMode ? "bg-slate-700 border-slate-600" : "bg-white border-slate-200"
                        )}>
                          {allHistoricalPlates
                            .filter(p => p.toUpperCase().includes(plate.toUpperCase()) && p.toUpperCase() !== plate.toUpperCase())
                            .slice(0, 5)
                            .map(s => (
                              <button
                                key={s}
                                type="button"
                                onClick={() => {
                                  setPlate(s);
                                  setShowSuggestions(false);
                                }}
                                className={cn(
                                  "w-full px-6 py-4 text-left font-mono font-black text-xl border-b last:border-b-0 transition-colors uppercase",
                                  isDarkMode ? "border-slate-600 hover:bg-slate-600 text-white" : "border-slate-50 hover:bg-slate-50 text-slate-900"
                                )}
                              >
                                {s}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                </form>
              </div>

              <div className="p-6 pt-0 space-y-2">
                <button 
                  disabled={isSubmitting || !plate.trim() || !selectedSlot}
                  onClick={handleEntry}
                  className={cn(
                    "w-full py-5 text-white font-black uppercase tracking-widest shadow-xl transition-all disabled:opacity-50 active:scale-95 flex items-center justify-center gap-3",
                    "rounded-md",
                    selectedEntryType === 'monthly'
                      ? "bg-emerald-500 shadow-emerald-500/20 hover:bg-emerald-600"
                      : "bg-blue-600 shadow-blue-600/20 hover:bg-blue-700"
                  )}
                >
                  {isSubmitting ? "REGISTRANDO..." : (
                    <>
                      <Plus className="w-5 h-5" />
                      Ingresar Vehículo
                    </>
                  )}
                </button>
                <button 
                  disabled={isSubmitting}
                  onClick={() => setSelectedSlot("")}
                  className="w-full py-3 text-slate-400 dark:text-slate-500 font-bold text-[10px] uppercase tracking-widest hover:text-rose-500 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmingExitVehicle && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmingExitVehicle(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-sm shadow-2xl overflow-hidden transition-colors duration-500 max-h-[95vh] flex flex-col rounded-xl",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-emerald-500 via-indigo-500 to-emerald-500" />
              
              <div className="p-6 flex-1 overflow-y-auto space-y-6">
                <div className="flex flex-col items-center text-center gap-4 h-[121px] mb-5">
                  <div className="w-[58px] h-[51px] bg-emerald-50 dark:bg-emerald-900/30 rounded-3xl flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  
                  <div className="space-y-1">
                    <h3 className="text-lg font-black tracking-tight uppercase mb-[2px]">Confirmar Cobro</h3>
                    <p className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">Finalizar sesión de parking</p>
                  </div>
                </div>
                
                <div className={cn(
                  "w-full px-6 pt-[18px] pb-5 rounded-3xl space-y-5 h-[304px]",
                  isDarkMode ? "bg-slate-800" : "bg-slate-50 border border-slate-100"
                )}>
                  <div className="space-y-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Patente</span>
                      <div className={cn(
                        "h-[60px] p-4 rounded-2xl border flex items-center justify-center",
                        isDarkMode ? "bg-slate-900/50 border-slate-700" : "bg-white border-slate-200 shadow-sm"
                      )}>
                        <span className="text-3xl font-black font-mono tracking-wider">{confirmingExitVehicle.plate}</span>
                      </div>
                    </div>
                    
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Importe a Cobrar</span>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-emerald-500 text-xl">$</span>
                        <input 
                          type="number"
                          step="1"
                          value={editableAmount}
                          onChange={(e) => setEditableAmount(Number(e.target.value))}
                          className={cn(
                            "w-full h-[60px] pl-10 pr-4 py-4 rounded-2xl border-2 text-right text-4xl font-black focus:outline-none transition-all",
                            isDarkMode 
                              ? "bg-slate-900 border-slate-700 text-emerald-400 focus:border-emerald-500/50" 
                              : "bg-white border-slate-200 text-emerald-600 focus:border-emerald-500/50"
                          )}
                        />
                      </div>
                      <p className="text-[10px] text-slate-400 font-bold uppercase text-right opacity-60">Sugerido: {formatCurrency(calculateAmount(confirmingExitVehicle))}</p>
                    </div>

                    <div className="pt-4 border-t border-dashed border-slate-200 dark:border-slate-700 grid grid-cols-3 gap-2">
                      <div className="flex flex-col items-center">
                        <span className="text-[8px] font-black text-slate-400 uppercase">Ingreso</span>
                        <span className="text-[15px] font-black text-slate-600 dark:text-slate-300">
                          {confirmingExitVehicle.entryTime ? format(confirmingExitVehicle.entryTime.toDate(), 'HH:mm') : '--:--'}
                        </span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[8px] font-black text-slate-400 uppercase">Salida</span>
                        <span className="text-[15px] font-black text-slate-600 dark:text-slate-300">
                          {format(new Date(), 'HH:mm')}
                        </span>
                      </div>
                      <div className="flex flex-col items-center p-1 rounded-lg bg-emerald-500/5">
                        <span className="text-[8px] font-black text-emerald-500 uppercase">Total</span>
                        <span className="text-[15px] font-black text-[#fad947]">
                          {(() => {
                            const now = new Date();
                            const entry = confirmingExitVehicle.entryTime?.toDate();
                            if (!entry) return '--';
                            const diffMs = now.getTime() - entry.getTime();
                            const diffHrs = Math.floor(diffMs / 3600000);
                            const diffMins = Math.floor((diffMs % 3600000) / 60000);
                            return `${diffHrs}h ${diffMins}m`;
                          })()}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-6 pt-0 space-y-2">
                <button 
                  disabled={isSubmitting}
                  onClick={confirmExit}
                  className={cn(
                    "w-full py-5 bg-emerald-500 text-white font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 hover:bg-emerald-600 transition-all disabled:opacity-50 active:scale-95",
                    "rounded-md"
                  )}
                >
                  {isSubmitting ? "PROCESANDO..." : "COBRAR AHORA"}
                </button>
                <button 
                  disabled={isSubmitting}
                  onClick={() => setConfirmingExitVehicle(null)}
                  className="w-full py-3 text-slate-400 dark:text-slate-500 font-bold text-[10px] uppercase tracking-widest hover:text-rose-500 transition-colors"
                >
                  Cancelar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {selectedHistoryVehicle && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedHistoryVehicle(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-md shadow-2xl overflow-hidden transition-colors duration-500 rounded-2xl flex flex-col",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-indigo-600 to-emerald-500" />
              
              <div className="p-8 space-y-8">
                <div className="flex flex-col items-center gap-6 min-h-[160px]">
                  <div className={cn(
                    "w-20 h-20 rounded-3xl flex items-center justify-center shadow-lg",
                    isDarkMode ? "bg-slate-800 text-indigo-400" : "bg-indigo-50 text-indigo-600"
                  )}>
                    {selectedHistoryVehicle.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-10 h-10" /> : <Car className="w-10 h-10" />}
                  </div>
                  
                  <div className="text-center space-y-2">
                    <h3 className={cn(
                      "text-5xl font-black font-mono tracking-tighter uppercase px-6 py-3 rounded-2xl border-4",
                      isDarkMode 
                        ? "bg-slate-950 border-slate-800 text-white" 
                        : "bg-slate-50 border-slate-100 text-slate-900 shadow-inner"
                    )}>
                      {selectedHistoryVehicle.plate}
                    </h3>
                    <div className="flex items-center justify-center gap-2">
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest px-2 py-1 rounded-lg",
                        selectedHistoryVehicle.entryType === 'monthly' ? "bg-emerald-500/10 text-emerald-500" : "bg-blue-500/10 text-blue-500"
                      )}>
                        {selectedHistoryVehicle.entryType === 'monthly' ? 'Abonado' : 'Diario'}
                      </span>
                      <span className={cn("w-1.5 h-1.5 rounded-full", isDarkMode ? "bg-slate-800" : "bg-slate-200")} />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {selectedHistoryVehicle.vehicleType === 'car' ? 'Automóvil' : 'Motocicleta'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className={cn("p-4 rounded-2xl border", isDarkMode ? "bg-slate-800/40 border-slate-800" : "bg-slate-50 border-slate-100/50")}>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Entrada</p>
                    <p className="text-lg font-black">{selectedHistoryVehicle.entryTime ? format(selectedHistoryVehicle.entryTime.toDate(), 'HH:mm') : '--:--'}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">{selectedHistoryVehicle.entryTime ? format(selectedHistoryVehicle.entryTime.toDate(), 'dd MMM yyyy', { locale: es }) : ''}</p>
                  </div>
                  <div className={cn("p-4 rounded-2xl border", isDarkMode ? "bg-slate-800/40 border-slate-800" : "bg-slate-50 border-slate-100/50")}>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Salida</p>
                    <p className="text-lg font-black">{selectedHistoryVehicle.exitTime ? format(selectedHistoryVehicle.exitTime.toDate(), 'HH:mm') : '--:--'}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase">{selectedHistoryVehicle.exitTime ? format(selectedHistoryVehicle.exitTime.toDate(), 'dd MMM yyyy', { locale: es }) : ''}</p>
                  </div>
                  <div className={cn("p-4 rounded-2xl border", isDarkMode ? "bg-slate-800/40 border-slate-800" : "bg-slate-50 border-slate-100/50")}>
                    <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1">Duración</p>
                    <p className="text-lg font-black">
                      {(() => {
                        if (!selectedHistoryVehicle.entryTime || !selectedHistoryVehicle.exitTime) return '--';
                        const diff = selectedHistoryVehicle.exitTime.toDate().getTime() - selectedHistoryVehicle.entryTime.toDate().getTime();
                        const h = Math.floor(diff / (3600000));
                        const m = Math.floor((diff % 3600000) / 60000);
                        return `${h}h ${m}m`;
                      })()}
                    </p>
                  </div>
                  <div className={cn("p-4 rounded-2xl border flex flex-col justify-center transition-colors shadow-lg shadow-emerald-500/5", isDarkMode ? "bg-emerald-950/20 border-emerald-900/40" : "bg-emerald-50 border-emerald-100")}>
                    <p className="text-[9px] font-black text-emerald-500 uppercase tracking-widest mb-1">Total Pagado</p>
                    <p className="text-2xl font-black text-emerald-500">{formatCurrency(selectedHistoryVehicle.totalAmount)}</p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    onClick={() => {
                      setHistorySearchTerm(selectedHistoryVehicle.plate);
                      setActiveView('history');
                      setSelectedHistoryVehicle(null);
                    }}
                    className={cn(
                      "w-full py-5 bg-indigo-600 text-white font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-500/20 hover:bg-indigo-700 transition-all flex items-center justify-center gap-3",
                      "rounded-xl"
                    )}
                  >
                    <HistoryIcon className="w-5 h-5" />
                    Ver historial completo
                  </button>
                  <button 
                    onClick={() => setSelectedHistoryVehicle(null)}
                    className="w-full py-4 text-slate-400 hover:text-slate-600 font-bold text-[10px] uppercase tracking-widest transition-colors"
                  >
                    Cerrar Detalle
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bottom Nav (Mobile Only) */}
      <nav className={cn(
        "md:hidden h-20 border-t fixed bottom-0 left-0 right-0 z-[60] px-3 flex items-center justify-between pb-safe shadow-[0_-8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl transition-colors duration-500",
        isDarkMode ? "bg-slate-900/95 border-slate-800" : "bg-white/95 border-slate-200"
      )}>
        {[
          { id: 'monitor', icon: Activity, label: 'Panel' },
          { id: 'reports', icon: Search, label: 'Reportes' },
          { id: 'history', icon: HistoryIcon, label: 'Historial' },
          { id: 'settings', icon: SettingsIcon, label: 'Ajustes' },
        ].map((v) => (
          <button 
            key={v.id}
            onClick={() => setActiveView(v.id as any)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 flex-1 transition-all relative py-2",
              activeView === v.id 
                ? (isDarkMode ? "text-indigo-400" : "text-indigo-600") 
                : (isDarkMode ? "text-slate-600" : "text-slate-400")
            )}
          >
            <div className={cn(
              "w-12 h-8 rounded-full flex items-center justify-center transition-all duration-300",
              activeView === v.id 
                ? (isDarkMode ? "bg-indigo-900/40 shadow-sm" : "bg-indigo-100 shadow-sm") 
                : (isDarkMode ? "active:bg-slate-800" : "active:bg-slate-100")
            )}>
              <v.icon className={cn("w-5 h-5 transition-transform", activeView === v.id ? "scale-110" : "")} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-tighter">{v.label}</span>
            {activeView === v.id && (
               <motion.div 
                 layoutId="active-mobile-pill"
                 className={cn("absolute -top-1 w-8 h-1 rounded-full", isDarkMode ? "bg-indigo-400" : "bg-indigo-600")}
               />
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <footer className={cn(
        "lg:hidden h-16 border-t flex items-center px-8 gap-12 shrink-0 transition-colors duration-500",
        isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200"
      )}>
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tarifa Base</span>
            <div className="flex items-center gap-2">
              <span className={cn("font-black", isDarkMode ? "text-slate-100" : "text-slate-900")}>{settings ? formatCurrency(settings.hourlyRate) : '---'}</span>
              <span className="text-[9px] text-slate-400 font-bold italic">x hora</span>
            </div>
          </div>
          <div className={cn("h-6 w-px transition-colors duration-500", isDarkMode ? "bg-slate-800" : "bg-slate-200")}></div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Operador</span>
            <span className={cn("font-bold text-xs truncate max-w-[150px]", isDarkMode ? "text-slate-400" : "text-slate-600")}>{user.displayName || user.email}</span>
          </div>
        </div>
        
        <div className="flex-1 flex justify-end gap-3">
          <div className={cn(
            "flex items-center gap-2 px-4 py-2 rounded-xl border transition-colors duration-500",
            isDarkMode ? "bg-slate-800/50 border-slate-800" : "bg-slate-50 border-slate-100"
          )}>
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">Servidor Sincronizado</span>
          </div>
        </div>
      </footer>
    </div>
    </div>
  );
}
