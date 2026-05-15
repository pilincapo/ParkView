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
  ChevronRight,
  Building2,
  Users,
  AlertCircle,
  AlertTriangle,
  HelpCircle,
  MousePointer2,
  Trash2,
  CreditCard,
  TrendingUp,
  Smartphone
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
  const [activeView, setActiveView] = useState<'monitor' | 'activity' | 'history' | 'reports' | 'settings' | 'monthly' | 'establishments' | 'help'>('monitor');
  const [plate, setPlate] = useState('');
  const [plateError, setPlateError] = useState<string | null>(null);
  const [plateErrorMonthly, setPlateErrorMonthly] = useState<string | null>(null);
  const [selectedVehicleType, setSelectedVehicleType] = useState<'car' | 'motorcycle'>('car');
  const [selectedEntryType, setSelectedEntryType] = useState<'daily' | 'monthly'>('daily');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [allHistoricalPlates, setAllHistoricalPlates] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [duplicateVehicleAlert, setDuplicateVehicleAlert] = useState<{ plate: string; type: 'active' | 'monthly' } | null>(null);
  const [confirmingExitVehicle, setConfirmingExitVehicle] = useState<Vehicle | null>(null);
  const [editableAmount, setEditableAmount] = useState<number>(0);
  const [monthlyPasses, setMonthlyPasses] = useState<any[]>([]);
  const [selectedHistoryVehicle, setSelectedHistoryVehicle] = useState<Vehicle | null>(null);
  const [selectedMonthlyPass, setSelectedMonthlyPass] = useState<any | null>(null);
  const [isConfirmingDeletePass, setIsConfirmingDeletePass] = useState(false);
  const [isAddingMonthlyPass, setIsAddingMonthlyPass] = useState(false);
  const [monthlyVehicleType, setMonthlyVehicleType] = useState<'car' | 'motorcycle'>('car');
  const [monthlyAmountState, setMonthlyAmountState] = useState<number>(0);
  const [historyVehicleToDelete, setHistoryVehicleToDelete] = useState<Vehicle | null>(null);
  const [isDeletingHistory, setIsDeletingHistory] = useState(false);
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
  const [reportPlate, setReportPlate] = useState('');
  const [showReportSuggestions, setShowReportSuggestions] = useState(false);
  const [reportOperator, setReportOperator] = useState('all');

  // History filters and pagination
  const [historyPage, setHistoryPage] = useState(1);
  const [historyDate, setHistoryDate] = useState('');
  const [historyType, setHistoryType] = useState<'all' | 'car' | 'motorcycle'>('all');
  const [historyEntryType, setHistoryEntryType] = useState<'all' | 'daily' | 'monthly'>('all');
  const [historyPlate, setHistoryPlate] = useState('');
  const [showHistorySuggestions, setShowHistorySuggestions] = useState(false);
  const PAGE_SIZE = 15;

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

    if (settings) {
      setMonthlyAmountState(monthlyVehicleType === 'car' ? settings.monthlyRate : settings.motoMonthlyRate);
    }
  }, [monthlyVehicleType, settings]);

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
      setHistoryPage(1); // Reset pagination on new data
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

    const constraints = [
      where('establishmentId', '==', selectedEstId),
      where('status', '==', VehicleStatus.COMPLETED),
      where('exitTime', '>=', Timestamp.fromDate(start)),
      where('exitTime', '<=', Timestamp.fromDate(end))
    ];

    if (reportOperator !== 'all') {
      constraints.push(where('ownerId', '==', reportOperator));
    }

    const q = query(
      collection(db, 'vehicles'),
      ...constraints
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setReportData(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'reports');
    });

    return () => unsubscribe();
  }, [user, selectedEstId, activeView, startDate, endDate, reportOperator]);

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

    // Validation: Plate length between 6 and 8
    const cleanPlate = plate.trim().toUpperCase();
    if (cleanPlate.length < 6 || cleanPlate.length > 8) {
      setPlateError('La patente debe tener entre 6 y 8 caracteres');
      return;
    }
    setPlateError(null);

    // Rule: Motorcycle slots (M-) only allow motorcycles
    if (selectedSlot.startsWith('M-') && selectedVehicleType !== 'motorcycle') {
      setPlateError('En cocheras de motos solo se permiten motos');
      return;
    }

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
    const plateVal = formData.get('plate')?.toString().toUpperCase() || '';
    const type = formData.get('vehicleType')?.toString() as 'car' | 'motorcycle';
    const amount = Number(formData.get('amount'));
    
    if (!plateVal || !type) return;

    // Validation: Plate length between 6 and 8
    if (plateVal.length < 6 || plateVal.length > 8) {
      setPlateErrorMonthly('La patente debe tener entre 6 y 8 caracteres');
      return;
    }
    setPlateErrorMonthly(null);

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
      setMonthlyVehicleType('car');
      setMonthlyAmountState(settings?.monthlyRate || 0);
      setIsAddingMonthlyPass(false);
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'monthlyPasses');
    }
  };

  const safeToDate = (date: any) => {
    if (!date) return new Date();
    if (typeof date.toDate === 'function') return date.toDate();
    if (date instanceof Date) return date;
    if (typeof date === 'string' || typeof date === 'number') return new Date(date);
    return new Date();
  };

  const handleRenewPass = async (passId: string, currentEndDate: any) => {
    try {
      const current = safeToDate(currentEndDate);
      const now = new Date();
      // Si ya venció, renovamos desde hoy. Si no venció, extendemos un mes desde el vencimiento.
      const baseDate = current > now ? current : now;
      
      const newEndDate = new Date(baseDate);
      newEndDate.setMonth(baseDate.getMonth() + 1);
      
      await updateDoc(doc(db, 'monthlyPasses', passId), {
        endDate: Timestamp.fromDate(newEndDate),
        updatedAt: serverTimestamp()
      });
      setSelectedMonthlyPass(null);
      setIsConfirmingDeletePass(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `monthlyPasses/${passId}`);
    }
  };

  const handleDeletePass = async (passId: string) => {
    try {
      await deleteDoc(doc(db, 'monthlyPasses', passId));
      setSelectedMonthlyPass(null);
      setIsConfirmingDeletePass(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `monthlyPasses/${passId}`);
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

  const handleDeleteHistory = async (id: string) => {
    if (isDeletingHistory) return;
    setIsDeletingHistory(true);
    console.log('Solicitando eliminar registro history:', id);
    try {
      // Optimistic locally
      setHistory(prev => prev.filter(v => v.id !== id));
      await deleteDoc(doc(db, 'vehicles', id));
      console.log('Registro eliminado exitosamente:', id);
      setHistoryVehicleToDelete(null);
    } catch (error) {
      console.error('Error al eliminar registro:', error);
      handleFirestoreError(error, OperationType.DELETE, `history/${id}`);
    } finally {
      setIsDeletingHistory(false);
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
            { id: 'help', icon: HelpCircle, label: 'Ayuda y Soporte' },
            { id: 'settings', icon: SettingsIcon, label: 'Configuración' },
            ...(isSuperAdmin ? [{ id: 'establishments', icon: Building2, label: 'Mis Cocheras' }] : []),
          ].map((v) => (
            <button 
              key={v.id}
              onClick={() => setActiveView(v.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2.5 transition-all group relative",
                "rounded-xl",
                activeView === v.id 
                  ? (isDarkMode ? "bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm" : "bg-indigo-50 text-indigo-600 border border-indigo-100 shadow-sm") 
                  : (isDarkMode ? "text-slate-500 hover:text-slate-300 hover:bg-slate-800/50" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50")
              )}
            >
              <v.icon className={cn("w-4.5 h-4.5", activeView === v.id ? "scale-110" : "group-hover:scale-110 transition-transform")} />
              <span className="text-[13px] font-bold tracking-tight">{v.label}</span>
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
              onClick={() => setActiveView('help')}
              className={cn(
                "p-2.5 rounded-xl transition-all border group relative",
                activeView === 'help'
                  ? (isDarkMode ? "bg-indigo-600/20 border-indigo-500/50 text-indigo-400" : "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-sm")
                  : (isDarkMode ? "bg-slate-800 border-slate-700 text-slate-400 hover:text-indigo-400" : "bg-white border-slate-100 text-slate-400 hover:text-indigo-600 shadow-sm")
              )}
              title="Guía de Ayuda"
            >
              <HelpCircle className="w-5 h-5" />
            </button>

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
                {activeView === 'monitor' ? <><Building2 className="w-6 h-6 text-indigo-500" /> Cocheras</> : 
                 activeView === 'activity' ? <><Activity className="w-6 h-6 text-indigo-500" /> Sesiones Activas</> :
                 activeView === 'history' ? <><HistoryIcon className="w-6 h-6 text-indigo-500" /> Historial</> : 
                 activeView === 'reports' ? <><Activity className="w-6 h-6 text-indigo-500" /> Analítica</> : 
                 activeView === 'help' ? <><HelpCircle className="w-6 h-6 text-indigo-500" /> Guía de Ayuda</> :
                 activeView === 'settings' ? <><SettingsIcon className="w-6 h-6 text-indigo-500" /> Ajustes</> : <><Users className="w-6 h-6 text-indigo-500" /> Administración</>}
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
                                {v.vehicleType === 'motorcycle' ? (
                                   <div className={cn("p-1.5 rounded-lg", isConfirming ? "bg-white/20" : "bg-indigo-500/10")}>
                                     <MotorcycleIcon className={cn("w-5 h-5", isConfirming ? "text-white" : "text-indigo-400")} />
                                   </div>
                                 ) : (
                                   <div className={cn("p-1.5 rounded-lg", isConfirming ? "bg-white/20" : "bg-blue-500/10")}>
                                     <Car className={cn("w-5 h-5", isConfirming ? "text-white" : "text-blue-400")} />
                                   </div>
                                 )}
                                <p className={cn("font-bold text-lg tracking-wider", isConfirming ? "text-white" : (isDarkMode ? (isMonthly ? "text-emerald-400" : (v.vehicleType === 'motorcycle' ? "text-indigo-400" : "text-blue-400")) : (isMonthly ? "text-emerald-600" : (v.vehicleType === 'motorcycle' ? "text-indigo-600" : "text-blue-600"))))}>{v.plate}</p>
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
                    <div className="lg:hidden px-2">
                       <button 
                         onClick={() => setIsAddingMonthlyPass(true)}
                         className="w-full py-6 bg-emerald-600 text-white font-black rounded-2xl flex items-center justify-center gap-4 shadow-xl shadow-emerald-500/20 active:scale-95 transition-all text-sm tracking-[0.2em] uppercase"
                       >
                         <Plus className="w-6 h-6" />
                         Nuevo Abonado
                       </button>
                    </div>

                    {/* Add Monthly Pass Form */}
                    <div className={cn(
                      "hidden lg:block p-8 border shadow-xl transition-colors duration-500",
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
                            onChange={(e) => {
                              if (e.target.value.length >= 6 && e.target.value.length <= 8) {
                                setPlateErrorMonthly(null);
                              }
                            }}
                            className={cn(
                              "w-full px-5 py-4 border-2 rounded-2xl font-mono text-xl font-black focus:outline-none transition-all uppercase",
                              plateErrorMonthly 
                                ? "border-rose-500" 
                                : "focus:border-emerald-500",
                              isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                            )}
                          />
                          {plateErrorMonthly && (
                            <p className="text-rose-500 text-[10px] font-black uppercase tracking-widest mt-1 ml-1">
                              {plateErrorMonthly}
                            </p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo de Vehículo</label>
                          <select 
                            name="vehicleType"
                            value={monthlyVehicleType}
                            onChange={(e) => setMonthlyVehicleType(e.target.value as 'car' | 'motorcycle')}
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
                              value={monthlyAmountState}
                              onChange={(e) => setMonthlyAmountState(Number(e.target.value))}
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
                            <button 
                              key={pass.id}
                              onClick={() => setSelectedMonthlyPass(pass)}
                              className={cn(
                                "w-full p-5 border flex items-center justify-between group hover:border-emerald-500/50 transition-all text-left",
                                "rounded-lg",
                                isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100 shadow-sm"
                              )}
                            >
                                  <div className="flex items-center gap-4">
                                     <div className={cn(
                                       "w-12 h-12 rounded-xl flex items-center justify-center transition-all duration-500",
                                       isDarkMode ? "bg-slate-800 text-emerald-400 group-hover:bg-emerald-900/30" : "bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100"
                                     )}>
                                        {pass.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-7 h-7" /> : <Car className="w-7 h-7" />}
                                     </div>
                                     <div className="text-left">
                                        <h4 className="font-black text-lg tracking-wider bg-gradient-to-r from-emerald-500 to-emerald-400 bg-clip-text text-transparent">{pass.plate}</h4>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight flex items-center gap-1.5">
                                          <Clock className="w-3 h-3" />
                                          Vence: {pass.endDate ? format(safeToDate(pass.endDate), 'dd MMM yyyy', { locale: es }) : '---'}
                                        </p>
                                     </div>
                                  </div>
                                  <div className="flex items-center gap-6">
                                     <div className="text-right">
                                        <p className="font-black text-emerald-500 mb-1">{formatCurrency(pass.amount)}</p>
                                        <div className="flex items-center gap-1 justify-end">
                                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                          <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">Abonado</span>
                                        </div>
                                     </div>
                                     <ChevronRight className="w-5 h-5 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </div>
                            </button>
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
                  <div className="flex flex-col gap-6 bg-slate-50/50 dark:bg-slate-800/30 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-slate-800">
                    <div className="flex flex-col md:flex-row gap-4 items-end">
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
                      <div className="space-y-1 w-full md:w-auto flex-1">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Buscar Patente</label>
                        <div className="relative">
                          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input 
                            type="text" 
                            placeholder="FILTRAR POR PATENTE..."
                            value={reportPlate}
                            onChange={(e) => {
                              setReportPlate(e.target.value.toUpperCase());
                              setShowReportSuggestions(true);
                            }}
                            onFocus={() => setShowReportSuggestions(true)}
                            onBlur={() => setTimeout(() => setShowReportSuggestions(false), 200)}
                            className={cn(
                              "block w-full border-2 border-transparent focus:border-indigo-500 rounded-xl pl-10 pr-4 py-3 text-xs font-black outline-none transition-all shadow-sm uppercase tracking-widest",
                              isDarkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"
                            )}
                          />
                          {showReportSuggestions && reportPlate.length >= 1 && (
                            <div className={cn(
                              "absolute left-0 right-0 top-full mt-2 z-[100] rounded-xl shadow-xl border overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-48 overflow-y-auto",
                              isDarkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-100"
                            )}>
                              {Array.from(new Set(reportData.map(v => v.plate)))
                                .filter((p: string) => p.toUpperCase().includes(reportPlate.toUpperCase()) && p.toUpperCase() !== reportPlate.toUpperCase())
                                .slice(0, 8)
                                .map(s => (
                                  <button
                                    key={s}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setReportPlate(s);
                                      setShowReportSuggestions(false);
                                    }}
                                    className={cn(
                                      "w-full px-4 py-3 text-left font-mono font-bold text-sm border-b last:border-b-0 transition-colors flex items-center justify-between group",
                                      isDarkMode ? "border-slate-700/50 hover:bg-slate-700 text-slate-300" : "border-slate-100 hover:bg-slate-50 text-slate-700"
                                    )}
                                  >
                                    <span>{s}</span>
                                    <span className={cn(
                                      "text-[9px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
                                      isDarkMode ? "bg-indigo-500/20 text-indigo-300" : "bg-indigo-50 text-indigo-600"
                                    )}>Seleccionar</span>
                                  </button>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1 w-full md:w-auto min-w-[200px]">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Operador</label>
                        <select 
                          value={reportOperator}
                          onChange={(e) => setReportOperator(e.target.value)}
                          className={cn(
                            "block w-full border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-3 text-sm font-bold outline-none transition-all shadow-sm",
                            isDarkMode ? "bg-slate-800 text-slate-100" : "bg-white text-slate-900"
                          )}
                        >
                          <option value="all">TODOS LOS OPERADORES</option>
                          {/* If establishments has members, we could theoretically map them if we had names. 
                              For now, we'll keep it simple or allow entry of ID if we have a list. 
                              Actually, we can use the current user as an option. */}
                          <option value={user.uid}>MIS OPERACIONES</option>
                        </select>
                      </div>
                    </div>
                  </div>

                    {(() => {
                      const filteredData = reportData.filter(v => v.plate.includes(reportPlate));
                      const totalCaja = filteredData.reduce((acc, v) => acc + (v.totalAmount || 0), 0);
                      const opsCount = filteredData.length;
                      const ticketProm = opsCount > 0 ? totalCaja / opsCount : 0;

                      return (
                        <>
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
                                {formatCurrency(totalCaja)}
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
                              )}>{opsCount}</p>
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
                                {formatCurrency(ticketProm)}
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
                              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Detalle de Cobros {reportPlate && `(${reportPlate})`}</h4>
                              <div className={cn(
                                "w-8 h-8 rounded-full border flex items-center justify-center transition-colors duration-500",
                                isDarkMode ? "bg-slate-800 border-slate-700 text-slate-600" : "bg-white border-slate-200 text-slate-300"
                              )}>
                                <Activity className="w-4 h-4" />
                              </div>
                            </div>
                            {filteredData.length === 0 ? (
                              <div className="p-20 text-center text-slate-300 italic text-xs">No hay datos para los filtros seleccionados</div>
                            ) : (
                              <div className={cn("divide-y", isDarkMode ? "divide-slate-800" : "divide-slate-50")}>
                                {Object.entries(filteredData.reduce((acc, curr) => {
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
                        </>
                      );
                    })()}
                </motion.div>
              ) : activeView === 'help' ? (
                <motion.div 
                  key="help"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-8 pb-32"
                >
                  {/* Header de Ayuda */}
                  <div className="text-center space-y-2 mb-12">
                    <h2 className={cn("text-3xl font-black uppercase tracking-tight", isDarkMode ? "text-white" : "text-slate-900")}>Centro de Ayuda CocheraFlow</h2>
                    <p className="text-slate-500 font-medium max-w-lg mx-auto">Domina todas las herramientas del sistema profesional de gestión de estacionamientos.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Guía 1: Ingreso */}
                    <div className={cn(
                      "group p-8 rounded-[2.5rem] border overflow-hidden relative transition-all duration-500 hover:shadow-2xl",
                      isDarkMode ? "bg-slate-900 border-slate-800 hover:border-indigo-500/50" : "bg-white border-slate-100 hover:border-indigo-200 shadow-xl shadow-slate-200/20"
                    )}>
                      <div className="relative z-10 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-indigo-500 text-white flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-110 transition-transform">
                          <LogIn className="w-7 h-7" />
                        </div>
                        <h3 className={cn("text-2xl font-black", isDarkMode ? "text-white" : "text-slate-900")}>Ingreso de Vehículos</h3>
                        <p className="text-sm text-slate-500 font-medium leading-relaxed">
                          En el <b>Monitor de Cocheras</b>, haz clic en un espacio libre. Recuerda que las <b>cocheras de motos</b> son exclusivas para motos, mientras que las de <b>autos</b> son mixtas (permiten autos y motos). Al guardar, el espacio se ocupará y el cronómetro iniciará automáticamente.
                        </p>
                      </div>
                      <div className="mt-8 rounded-2xl border border-slate-200/10 overflow-hidden bg-slate-950/50 p-4">
                        <div className="aspect-video flex items-center justify-center bg-slate-800 rounded-xl relative">
                           <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-transparent" />
                           <svg className="w-full h-full p-4" viewBox="0 0 200 120">
                             <rect x="10" y="10" width="180" height="100" rx="4" fill="currentColor" className="text-slate-900" />
                             <g opacity="0.3">
                               {[0, 1, 2].map(r => [0, 1, 2, 3].map(c => (
                                 <rect key={`${r}-${c}`} x={25 + c*40} y={25 + r*30} width="30" height="20" rx="2" fill="currentColor" className="text-slate-700" />
                               )))}
                             </g>
                             <motion.rect 
                               initial={{ opacity: 0.3 }}
                               animate={{ opacity: [0.3, 1, 0.3] }}
                               transition={{ duration: 2, repeat: Infinity }}
                               x="65" y="55" width="30" height="20" rx="2" fill="currentColor" className="text-indigo-500" 
                             />
                             <motion.g
                               animate={{ x: [20, 75, 20], y: [20, 60, 20] }}
                               transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                             >
                               <MousePointer2 className="w-8 h-8 text-white drop-shadow-lg" />
                             </motion.g>
                           </svg>
                        </div>
                      </div>
                    </div>

                    {/* Guía 2: Salida */}
                    <div className={cn(
                      "group p-8 rounded-[2.5rem] border overflow-hidden relative transition-all duration-500 hover:shadow-2xl",
                      isDarkMode ? "bg-slate-900 border-slate-800 hover:border-rose-500/50" : "bg-white border-slate-100 hover:border-rose-200 shadow-xl shadow-slate-200/20"
                    )}>
                      <div className="relative z-10 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/20 group-hover:scale-110 transition-transform">
                          <LogOut className="w-7 h-7" />
                        </div>
                        <h3 className={cn("text-2xl font-black", isDarkMode ? "text-white" : "text-slate-900")}>Salida y Cobro</h3>
                        <p className="text-sm text-slate-500 font-medium leading-relaxed">
                          Haz clic en una cochera ocupada (Roja). Verás el tiempo transcurrido y el monto calculado según tu configuración de tarifas. Confirma el cobro para liberar el lugar y pasar el registro al historial.
                        </p>
                      </div>
                      <div className="mt-8 rounded-2xl border border-slate-200/10 overflow-hidden bg-slate-950/50 p-4">
                        <div className="aspect-video flex items-center justify-center bg-slate-800 rounded-xl relative">
                           <div className="absolute inset-0 bg-gradient-to-br from-rose-500/20 to-transparent" />
                           <svg className="w-full h-full p-4" viewBox="0 0 200 120">
                             <rect x="10" y="10" width="180" height="100" rx="4" fill="currentColor" className="text-slate-900" />
                             <motion.g
                               initial={{ opacity: 0, y: 10 }}
                               animate={{ opacity: 1, y: 0 }}
                               transition={{ duration: 1.5, repeat: Infinity, repeatType: "reverse" }}
                             >
                               <rect x="50" y="25" width="100" height="70" rx="6" fill="currentColor" className="text-slate-800" stroke={isDarkMode ? "#334155" : "#f1f5f9"} strokeWidth="1" />
                               <circle cx="100" cy="50" r="8" fill="#10b981" fillOpacity="0.2" />
                               <text x="100" y="52" fontSize="6" fontWeight="bold" textAnchor="middle" fill="#10b981" className="font-mono">OK</text>
                               <rect x="65" y="70" width="70" height="10" rx="2" fill="#10b981" />
                             </motion.g>
                           </svg>
                        </div>
                      </div>
                    </div>

                    {/* Guía 3: Abonados Mensuales */}
                    <div className={cn(
                      "group p-8 rounded-[2.5rem] border overflow-hidden relative transition-all duration-500 hover:shadow-2xl",
                      isDarkMode ? "bg-slate-900 border-slate-800 hover:border-emerald-500/50" : "bg-white border-slate-100 hover:border-emerald-200 shadow-xl shadow-slate-200/20"
                    )}>
                      <div className="relative z-10 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/20 group-hover:scale-110 transition-transform">
                          <CreditCard className="w-7 h-7" />
                        </div>
                        <h3 className={cn("text-2xl font-black", isDarkMode ? "text-white" : "text-slate-900")}>Gestión de Abonados</h3>
                        <p className="text-sm text-slate-500 font-medium leading-relaxed">
                          En la pestaña de <b>Abonados</b>, puedes registrar vehículos mensuales. Al ingresar un abonado, el sistema no le cobrará por tiempo, permitiendo un control separado de los clientes fijos del establecimiento.
                        </p>
                      </div>
                      <div className="mt-8 rounded-2xl border border-slate-200/10 overflow-hidden bg-slate-950/50 p-4">
                        <div className="aspect-video flex items-center justify-center bg-slate-800 rounded-xl relative">
                           <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent" />
                           <svg className="w-full h-full p-4" viewBox="0 0 200 120">
                             <rect x="50" y="20" width="100" height="80" rx="10" fill="#10b981" fillOpacity="0.1" stroke="#10b981" strokeWidth="1" strokeDasharray="4 2" />
                             <rect x="65" y="40" width="70" height="40" rx="4" fill="currentColor" className="text-slate-900" />
                             <rect x="75" y="55" width="50" height="10" rx="2" fill="#10b981" />
                             <path d="M100 35 v-10 M95 30 h10" stroke="#10b981" strokeWidth="2" />
                           </svg>
                        </div>
                      </div>
                    </div>

                    {/* Guía 4: Reportes y Caja */}
                    <div className={cn(
                      "group p-8 rounded-[2.5rem] border overflow-hidden relative transition-all duration-500 hover:shadow-2xl",
                      isDarkMode ? "bg-slate-900 border-slate-800 hover:border-orange-500/50" : "bg-white border-slate-100 hover:border-orange-200 shadow-xl shadow-slate-200/20"
                    )}>
                      <div className="relative z-10 space-y-4">
                        <div className="w-14 h-14 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/20 group-hover:scale-110 transition-transform">
                          <TrendingUp className="w-7 h-7" />
                        </div>
                        <h3 className={cn("text-2xl font-black", isDarkMode ? "text-white" : "text-slate-900")}>Reportes y Analítica</h3>
                        <p className="text-sm text-slate-500 font-medium leading-relaxed">
                          Consulta la recaudación total, operarios activos y flujo de vehículos. Utiliza los filtros avanzados para ver el rendimiento por fecha o por un operario específico, ayudando al cierre de caja diario.
                        </p>
                      </div>
                      <div className="mt-8 rounded-2xl border border-slate-200/10 overflow-hidden bg-slate-950/50 p-4">
                        <div className="aspect-video flex items-center justify-center bg-slate-800 rounded-xl relative">
                           <div className="absolute inset-0 bg-gradient-to-br from-orange-500/20 to-transparent" />
                           <svg className="w-full h-full p-4" viewBox="0 0 200 120">
                             <motion.path 
                               d="M30 90 L60 70 L90 80 L120 40 L150 50 L170 20" 
                               fill="none" 
                               stroke="#f97316" 
                               strokeWidth="3" 
                               strokeLinecap="round"
                               initial={{ pathLength: 0 }}
                               animate={{ pathLength: 1 }}
                               transition={{ duration: 2, repeat: Infinity }}
                             />
                             <line x1="30" y1="90" x2="170" y2="90" stroke="currentColor" className="text-slate-700" strokeWidth="1" />
                           </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sección de Soporte */}
                  <div className={cn(
                    "p-10 rounded-[3rem] border overflow-hidden relative group",
                    isDarkMode ? "bg-indigo-900/10 border-indigo-500/20" : "bg-indigo-50/50 border-indigo-100"
                  )}>
                    <div className="absolute top-0 right-0 -mr-16 -mt-16 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl group-hover:bg-indigo-500/20 transition-colors" />
                    
                    <div className="relative z-10 flex flex-col md:flex-row items-center gap-10">
                      <div className="w-24 h-24 bg-indigo-600 text-white rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-500/40 shrink-0 rotate-3 group-hover:rotate-0 transition-transform duration-500">
                        <Smartphone className="w-12 h-12" />
                      </div>
                      
                      <div className="flex-1 text-center md:text-left space-y-4">
                        <h3 className={cn("text-3xl font-black tracking-tight", isDarkMode ? "text-white" : "text-slate-900")}>¿Aún tienes dudas?</h3>
                        <p className="text-slate-500 font-medium leading-relaxed max-w-xl">
                          Nuestro equipo está disponible para ayudarte a configurar tus tarifas complejas (fraccionamiento, estadías largas) o para cualquier duda técnica sobre la integración con impresoras de tickets.
                        </p>
                        <div className="flex flex-wrap justify-center md:justify-start gap-4 mt-6">
                           <a 
                             href="https://wa.me/543426111121"
                             target="_blank"
                             rel="noopener noreferrer"
                             className="px-8 py-4 bg-emerald-600 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] shadow-lg shadow-emerald-500/30 hover:bg-emerald-700 transition-all active:scale-95 flex items-center gap-2"
                           >
                             Contactar vía WhatsApp
                           </a>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ) : activeView === 'history' ? (
                <motion.div 
                  key="history"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                   <div className="space-y-6">
                    {/* Filtros de Historial */}
                    <div className={cn(
                      "p-4 rounded-2xl border flex flex-col md:flex-row gap-4 items-center transition-all",
                      isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100 shadow-sm"
                    )}>
                      <div className="relative flex-1 w-full z-20">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input 
                          type="text"
                          placeholder="BUSCAR PATENTE EN HISTORIAL..."
                          value={historyPlate}
                          onChange={(e) => {
                            setHistoryPlate(e.target.value.toUpperCase());
                            setShowHistorySuggestions(true);
                          }}
                          onFocus={() => setShowHistorySuggestions(true)}
                          onBlur={() => setTimeout(() => setShowHistorySuggestions(false), 200)}
                          className={cn(
                            "w-full pl-10 pr-4 py-2.5 rounded-xl text-xs font-black outline-none border-2 border-transparent transition-all",
                            isDarkMode ? "bg-slate-800 text-white focus:border-indigo-500" : "bg-slate-50 text-slate-900 focus:border-indigo-500"
                          )}
                        />
                        {showHistorySuggestions && historyPlate.length >= 1 && (
                          <div className={cn(
                            "absolute left-0 right-0 top-full mt-2 z-[100] rounded-xl shadow-xl border overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-48 overflow-y-auto",
                            isDarkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-100"
                          )}>
                            {Array.from(new Set(history.map(v => v.plate)))
                              .filter((p: string) => p.toUpperCase().includes(historyPlate.toUpperCase()) && p.toUpperCase() !== historyPlate.toUpperCase())
                              .slice(0, 8)
                              .map(s => (
                                <button
                                  key={s}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setHistoryPlate(s);
                                    setShowHistorySuggestions(false);
                                  }}
                                  className={cn(
                                    "w-full px-4 py-3 text-left font-mono font-bold text-sm border-b last:border-b-0 transition-colors flex items-center justify-between group",
                                    isDarkMode ? "border-slate-700/50 hover:bg-slate-700 text-slate-300" : "border-slate-100 hover:bg-slate-50 text-slate-700"
                                  )}
                                >
                                  <span>{s}</span>
                                  <span className={cn(
                                    "text-[9px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity",
                                    isDarkMode ? "bg-indigo-500/20 text-indigo-300" : "bg-indigo-50 text-indigo-600"
                                  )}>Seleccionar</span>
                                </button>
                              ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 w-full md:w-auto">
                        <select 
                          value={historyType}
                          onChange={(e) => setHistoryType(e.target.value as any)}
                          className={cn(
                            "px-3 py-2.5 rounded-xl text-[10px] font-black uppercase outline-none border-2 border-transparent flex-1 md:flex-none",
                            isDarkMode ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-900"
                          )}
                        >
                          <option value="all">TODOS LOS VEHÍCULOS</option>
                          <option value="car">AUTOS</option>
                          <option value="motorcycle">MOTOS</option>
                        </select>
                        <select 
                          value={historyEntryType}
                          onChange={(e) => setHistoryEntryType(e.target.value as any)}
                          className={cn(
                            "px-3 py-2.5 rounded-xl text-[10px] font-black uppercase outline-none border-2 border-transparent flex-1 md:flex-none",
                            isDarkMode ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-900"
                          )}
                        >
                          <option value="all">TODOS LOS TIPOS</option>
                          <option value="daily">DIARIO</option>
                          <option value="monthly">ABONADO</option>
                        </select>
                      </div>
                      <input 
                        type="date"
                        value={historyDate}
                        onChange={(e) => setHistoryDate(e.target.value)}
                        className={cn(
                          "px-3 py-2.5 rounded-xl text-[10px] font-black uppercase outline-none border-2 border-transparent w-full md:w-auto",
                          isDarkMode ? "bg-slate-800 text-white" : "bg-slate-50 text-slate-900"
                        )}
                      />
                    </div>

                    {(() => {
                      const filteredHistory = history.filter(v => {
                        const matchesPlate = v.plate.includes(historyPlate);
                        const matchesType = historyType === 'all' || v.vehicleType === historyType;
                        const matchesEntryType = historyEntryType === 'all' || v.entryType === historyEntryType;
                        const matchesDate = !historyDate || (v.exitTime && format(v.exitTime.toDate(), 'yyyy-MM-dd') === historyDate);
                        return matchesPlate && matchesType && matchesEntryType && matchesDate;
                      });

                      const totalPages = Math.ceil(filteredHistory.length / PAGE_SIZE);
                      const paginatedHistory = filteredHistory.slice((historyPage - 1) * PAGE_SIZE, historyPage * PAGE_SIZE);

                      return (
                        <>
                          <div className="space-y-3">
                            {paginatedHistory.length === 0 ? (
                              <div className="h-64 flex flex-col items-center justify-center text-slate-300 gap-3 grayscale">
                                 <HistoryIcon className="w-12 h-12 opacity-20" />
                                 <p className="text-[10px] font-black uppercase tracking-widest">Sin registros que coincidan</p>
                              </div>
                            ) : (
                              paginatedHistory.map((v) => {
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
                                      "border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-all group cursor-pointer hover:scale-[1.01]",
                                      "rounded-2xl relative overflow-hidden",
                                      isDarkMode ? "bg-slate-900 border-slate-800 hover:border-slate-700" : "bg-white border-slate-100 hover:border-slate-200 shadow-sm"
                                    )}
                                  >
                                    <div className="absolute top-0 left-0 bottom-0 w-1 opacity-20" 
                                      style={{ backgroundColor: isMonthly ? '#10b981' : '#3b82f6' }} 
                                    />
                                    
                                    <div className="flex items-center gap-5">
                                      <div className={cn(
                                        "w-14 h-14 rounded-2xl flex items-center justify-center transition-all shadow-md group-hover:rotate-3",
                                        isDarkMode 
                                          ? (isMonthly ? "bg-emerald-500/10 text-emerald-400" : (v.vehicleType === 'motorcycle' ? "bg-indigo-500/10 text-indigo-400" : "bg-blue-500/10 text-blue-400")) 
                                          : (isMonthly ? "bg-emerald-50 text-emerald-600" : (v.vehicleType === 'motorcycle' ? "bg-indigo-50 text-indigo-600" : "bg-blue-50 text-blue-600"))
                                      )}>
                                        {v.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-8 h-8" /> : <Car className="w-8 h-8" />}
                                      </div>
                                      
                                      <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                          <h4 className={cn(
                                            "font-black tracking-tight text-xl font-mono uppercase",
                                            isDarkMode ? "text-white" : "text-slate-900"
                                          )}>
                                            {v.plate}
                                          </h4>
                                          <span className={cn(
                                            "text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border shadow-sm flex items-center gap-1",
                                            isMonthly ? "bg-emerald-500 text-white border-emerald-500" : "bg-slate-100 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400"
                                          )}>
                                            {isMonthly ? <CheckCircle2 className="w-2.5 h-2.5" /> : null}
                                            {isMonthly ? 'Socio' : 'Ticket'}
                                          </span>
                                        </div>
                                        <div className="flex items-center gap-3">
                                          <div className={cn(
                                            "flex items-center gap-1.5 px-2 py-1 rounded-lg border",
                                            isDarkMode ? "bg-slate-950/40 border-slate-800 text-slate-400" : "bg-slate-50 border-slate-100 text-slate-500"
                                          )}>
                                            <Clock className="w-3.5 h-3.5 text-indigo-500" />
                                            <div className="flex items-center gap-1 text-[11px] font-bold">
                                              <span>{format(v.entryTime.toDate(), 'HH:mm')}</span>
                                              <span className="opacity-30">→</span>
                                              <span>{format(v.exitTime.toDate(), 'HH:mm')}</span>
                                            </div>
                                          </div>
                                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 dark:bg-slate-800/50 px-2 py-1 rounded-md">
                                            {h > 0 && `${h}h `}{m}m
                                          </span>
                                        </div>
                                      </div>
                                    </div>

                                    <div className="flex items-center justify-between sm:justify-end gap-6 sm:pl-0 pl-16">
                                      <div className="text-left sm:text-right">
                                        <p className={cn(
                                          "font-black text-2xl tracking-tighter leading-none",
                                          isMonthly ? (isDarkMode ? "text-emerald-400" : "text-emerald-600") : (isDarkMode ? "text-blue-400" : "text-blue-600")
                                        )}>
                                          {formatCurrency(v.totalAmount)}
                                        </p>
                                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                                          {format(v.exitTime.toDate(), 'dd MMM yyyy', { locale: es })}
                                        </p>
                                      </div>
                                      
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          if (!v.id) return;
                                          setHistoryVehicleToDelete(v);
                                        }}
                                        className={cn(
                                          "w-10 h-10 transition-all rounded-xl relative z-10 flex items-center justify-center border",
                                          isDarkMode 
                                            ? "text-slate-500 border-slate-800 hover:text-rose-400 hover:bg-rose-400/10 hover:border-rose-400/30" 
                                            : "text-slate-300 border-slate-100 hover:text-rose-500 hover:bg-rose-50 hover:border-rose-200"
                                        )}
                                        title="Eliminar registro"
                                      >
                                        <Trash2 className="w-5 h-5" />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>

                          {/* Controles de Paginación */}
                          {totalPages > 1 && (
                            <div className="flex items-center justify-center gap-4 mt-8 pb-12">
                              <button 
                                disabled={historyPage === 1}
                                onClick={() => setHistoryPage(p => Math.max(1, p - 1))}
                                className={cn(
                                  "px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border",
                                  historyPage === 1 
                                    ? "opacity-50 cursor-not-allowed grayscale" 
                                    : "hover:bg-indigo-600 hover:text-white cursor-pointer",
                                  isDarkMode ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-600"
                                )}
                              >
                                Anterior
                              </button>
                              <div className="flex items-center gap-2">
                                {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                                  // Show pages around current page
                                  let pageNum = i + 1;
                                  if (totalPages > 5 && historyPage > 3) {
                                    pageNum = historyPage - 3 + i + 1;
                                    if (pageNum > totalPages) pageNum = totalPages - (4 - i);
                                  }
                                  
                                  return (
                                    <button 
                                      key={pageNum}
                                      onClick={() => setHistoryPage(pageNum)}
                                      className={cn(
                                        "w-8 h-8 rounded-lg font-black text-xs transition-all",
                                        historyPage === pageNum 
                                          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-600/20" 
                                          : (isDarkMode ? "bg-slate-800 text-slate-500 hover:text-white" : "bg-white text-slate-400 hover:text-indigo-600 border border-slate-100")
                                      )}
                                    >
                                      {pageNum}
                                    </button>
                                  );
                                })}
                              </div>
                              <button 
                                disabled={historyPage === totalPages}
                                onClick={() => setHistoryPage(p => Math.min(totalPages, p + 1))}
                                className={cn(
                                  "px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all border",
                                  historyPage === totalPages 
                                    ? "opacity-50 cursor-not-allowed grayscale" 
                                    : "hover:bg-indigo-600 hover:text-white cursor-pointer",
                                  isDarkMode ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-600"
                                )}
                              >
                                Siguiente
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
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
                       <div className="flex items-center gap-2">
                         <Car className="w-[26px] h-[26px] text-blue-500" />
                         <MotorcycleIcon className="w-[18px] h-[18px] text-indigo-400 opacity-60" />
                       </div>
                       <h3 className="font-black text-xs uppercase tracking-[0.2em] text-slate-500">Cocheras de Autos / Mixtas</h3>
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
                              // Solo pre-seleccionar si no hay vehículo en el slot
                              if (!vehicle) {
                                setSelectedVehicleType('car');
                              }
                              handleSlotClick(slotId, vehicle);
                            }}
                            className={cn(
                              "aspect-[3/4] flex flex-col items-center justify-center gap-1 transition-all border font-mono text-[10px] relative overflow-hidden group hover:scale-[1.02] active:scale-95",
                              "rounded-lg shadow-md",
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
                                 <motion.div 
                                   layoutId={`vehicle-body-${vehicle.id}`} 
                                   className={cn(
                                     "absolute transition-all duration-500 flex items-center justify-center overflow-hidden shadow-lg", 
                                     "rounded-lg",
                                     vehicle.vehicleType === 'motorcycle' ? "inset-x-4 inset-y-4" : "inset-x-2 inset-y-2",
                                     isOccupiedSelected 
                                       ? "bg-gradient-to-br from-white to-slate-200"
                                       : (isDarkMode 
                                           ? (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-400 to-emerald-600" : (vehicle.vehicleType === 'motorcycle' ? "bg-gradient-to-br from-indigo-400 to-indigo-600" : "bg-gradient-to-br from-blue-400 to-blue-600")) 
                                           : (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : (vehicle.vehicleType === 'motorcycle' ? "bg-gradient-to-br from-indigo-500 to-indigo-700" : "bg-gradient-to-br from-blue-500 to-blue-700")))
                                   )}
                                 >
                                   <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                      <ParkingIcon className="w-full h-full p-2" />
                                   </div>
                                   <div className={cn(
                                     "relative z-10 transition-transform duration-500 group-hover:scale-110",
                                     isOccupiedSelected ? "text-indigo-600" : "text-white"
                                   )}>
                                      {vehicle.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-6 h-6" /> : <Car className="w-7 h-7" />}
                                   </div>
                                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
                                 </motion.div>
                                 <div className="relative z-10 flex flex-col items-center mt-12 w-full px-1">
                                   <span className={cn(
                                     "font-black text-[9px] tracking-tight transition-colors drop-shadow-sm px-2 py-0.5 rounded-lg shadow-lg border",
                                     isOccupiedSelected 
                                       ? "bg-white text-blue-600 border-blue-100" 
                                       : (isDarkMode ? "bg-slate-950/80 border-slate-700/50 text-white" : "bg-white border-slate-200 text-slate-900")
                                   )}>
                                     {vehicle.plate}
                                   </span>
                                   {vehicle.entryType === 'monthly' && (
                                     <div className="w-1.5 h-1.5 bg-white rounded-full mt-1.5 animate-pulse shadow-sm" title="Abonado" />
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
                       <h3 className="font-black text-xs uppercase tracking-[0.2em] text-slate-500">Solo Motos</h3>
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
                              if (!vehicle) {
                                setSelectedVehicleType('motorcycle');
                              }
                              handleSlotClick(slotId, vehicle);
                            }}
                            className={cn(
                              "aspect-[3/4] flex flex-col items-center justify-center gap-1 transition-all border font-mono text-[10px] relative overflow-hidden group hover:scale-[1.02] active:scale-95",
                              "rounded-lg shadow-md",
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
                                   layoutId={`vehicle-body-${vehicle.id}`} 
                                   className={cn(
                                     "absolute transition-all duration-500 flex items-center justify-center overflow-hidden shadow-lg", 
                                     "rounded-lg",
                                     "inset-x-4 inset-y-4",
                                     isOccupiedSelected 
                                       ? "bg-gradient-to-br from-white to-slate-200"
                                       : (isDarkMode 
                                           ? (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-400 to-emerald-600" : "bg-gradient-to-br from-indigo-400 to-indigo-600") 
                                           : (vehicle.entryType === 'monthly' ? "bg-gradient-to-br from-emerald-500 to-emerald-700" : "bg-gradient-to-br from-indigo-500 to-indigo-700")))
                                   }
                                 >
                                   <div className="absolute inset-0 flex items-center justify-center opacity-20">
                                      <ParkingIcon className="w-full h-full p-1.5" />
                                   </div>
                                   <div className={cn(
                                     "relative z-10 transition-transform duration-500 group-hover:scale-110",
                                     isOccupiedSelected ? "text-indigo-600" : "text-white"
                                   )}>
                                      <MotorcycleIcon className="w-6 h-6" />
                                   </div>
                                   <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.4)_0%,transparent_50%)]" />
                                 </motion.div>
                                 <div className="relative z-10 flex flex-col items-center mt-12 w-full px-1">
                                   <span className={cn(
                                     "font-black text-[9px] tracking-tight transition-colors drop-shadow-sm px-2 py-0.5 rounded-lg shadow-lg border",
                                     isOccupiedSelected 
                                       ? "bg-white text-indigo-600 border-indigo-100" 
                                       : (isDarkMode ? "bg-slate-950/80 border-slate-700/50 text-white" : "bg-white border-slate-200 text-slate-900")
                                   )}>
                                     {vehicle.plate}
                                   </span>
                                   {vehicle.entryType === 'monthly' && (
                                     <div className="w-1.5 h-1.5 bg-white rounded-full mt-1.5 animate-pulse shadow-sm" title="Abonado" />
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
                             {v.vehicleType === 'motorcycle' ? (
                               <div className={cn("p-1.5 rounded-lg", isConfirming ? "bg-white/20" : "bg-indigo-500/10")}>
                                 <MotorcycleIcon className={cn("w-5 h-5", isConfirming ? "text-white" : "text-indigo-400")} />
                               </div>
                             ) : (
                               <div className={cn("p-1.5 rounded-lg", isConfirming ? "bg-white/20" : "bg-blue-500/10")}>
                                 <Car className={cn("w-5 h-5", isConfirming ? "text-white" : "text-blue-400")} />
                               </div>
                             )}
                             <p className={cn("font-bold text-lg tracking-wider", isConfirming ? "text-white" : (isDarkMode ? (isMonthly ? "text-emerald-400" : (v.vehicleType === 'motorcycle' ? "text-indigo-400" : "text-blue-400")) : (isMonthly ? "text-emerald-600" : (v.vehicleType === 'motorcycle' ? "text-indigo-600" : "text-blue-600"))))}>{v.plate}</p>
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
                  <div className="space-y-4">
                    <div className={cn(
                      "p-3 rounded-2xl border text-center flex items-center justify-center gap-2",
                      selectedSlot.startsWith('M-') 
                        ? (isDarkMode ? "bg-amber-900/20 border-amber-500/50 text-amber-200" : "bg-amber-50 border-amber-200 text-amber-700")
                        : (isDarkMode ? "bg-indigo-900/20 border-indigo-500/50 text-indigo-200" : "bg-indigo-50 border-indigo-200 text-indigo-700")
                    )}>
                      {selectedSlot.startsWith('M-') ? (
                        <>
                          <AlertTriangle className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest">SÓLO MOTOS EN ESTA COCHERA</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4" />
                          <span className="text-[10px] font-black uppercase tracking-widest">COCHERA MIXTA (AUTOS Y MOTOS)</span>
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <button 
                        type="button"
                        disabled={selectedSlot.startsWith('M-')}
                        onClick={() => setSelectedVehicleType('car')}
                        className={cn(
                          "flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border-2 transition-all group",
                          selectedVehicleType === 'car' 
                            ? (isDarkMode ? "bg-blue-500/10 border-blue-500 text-blue-400" : "bg-blue-50 border-blue-500 text-blue-600")
                            : (isDarkMode ? "bg-slate-800 border-transparent text-slate-500" : "bg-slate-100 border-transparent text-slate-400"),
                          selectedSlot.startsWith('M-') && "opacity-30 grayscale cursor-not-allowed"
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
                          const val = e.target.value.toUpperCase();
                          if (val.length <= 8) {
                            setPlate(val);
                            if (val.length >= 6 && val.length <= 8) setPlateError(null);
                          }
                          setShowSuggestions(true);
                        }}
                        onFocus={() => setShowSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                        placeholder="PATENTE" 
                        className={cn(
                          "w-full px-6 py-5 border font-mono text-3xl font-black text-center focus:outline-none focus:ring-4 transition-all uppercase",
                          "rounded-md",
                          plateError 
                            ? "border-rose-500 ring-rose-500/10" 
                            : "focus:ring-blue-500/10 focus:border-blue-500",
                          isDarkMode 
                            ? "bg-slate-800 border-slate-700 text-white placeholder:text-slate-700" 
                            : "bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-200"
                        )}
                      />
                      {plateError && (
                        <p className="text-rose-500 text-[10px] font-black uppercase tracking-widest mt-2 text-center animate-in fade-in slide-in-from-top-1">
                          {plateError}
                        </p>
                      )}
                      {showSuggestions && plate.length >= 2 && (
                        <div className={cn(
                          "absolute left-0 right-0 top-full mt-2 z-[100] rounded-xl shadow-2xl border overflow-hidden animate-in fade-in slide-in-from-top-2 max-h-48 overflow-y-auto",
                          isDarkMode ? "bg-slate-800 border-slate-700" : "bg-white border-slate-100"
                        )}>
                          {allHistoricalPlates
                            .filter(p => p.toUpperCase().includes(plate.toUpperCase()) && p.toUpperCase() !== plate.toUpperCase())
                            .slice(0, 5)
                            .map(s => (
                              <button
                                key={s}
                                type="button"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  setPlate(s);
                                  setShowSuggestions(false);
                                }}
                                className={cn(
                                  "w-full px-6 py-4 text-left font-mono font-black text-xl border-b last:border-b-0 transition-colors uppercase group flex items-center justify-between",
                                  isDarkMode ? "border-slate-700/50 hover:bg-slate-700 text-slate-300" : "border-slate-100 hover:bg-slate-50 text-slate-700"
                                )}
                              >
                                <span>{s}</span>
                                <span className={cn(
                                  "text-[10px] px-3 py-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity font-sans tracking-widest",
                                  isDarkMode ? "bg-slate-800 text-indigo-300" : "bg-white text-indigo-600 shadow-sm"
                                )}>Seleccionar</span>
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

        {historyVehicleToDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isDeletingHistory && setHistoryVehicleToDelete(null)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-sm shadow-2xl overflow-hidden rounded-3xl",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="p-8 text-center space-y-6">
                <div className="w-20 h-20 bg-rose-500/10 text-rose-500 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-10 h-10" />
                </div>
                
                <div className="space-y-3">
                  <h3 className={cn("text-xl font-black", isDarkMode ? "text-white" : "text-slate-900")}>
                    ¿Confirmar eliminación?
                  </h3>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed">
                    Estás por borrar permanentemente el registro de la patente:
                  </p>
                  <div className={cn(
                    "inline-block px-4 py-2 mt-2 rounded-xl font-mono text-2xl font-black uppercase border-2",
                    isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100 text-slate-900"
                  )}>
                    {historyVehicleToDelete.plate}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    disabled={isDeletingHistory}
                    onClick={() => setHistoryVehicleToDelete(null)}
                    className={cn(
                      "py-4 font-black text-[10px] uppercase tracking-widest transition-all",
                      "rounded-xl border",
                      isDarkMode ? "bg-slate-800 border-slate-700 text-slate-400 hover:text-white" : "bg-white border-slate-200 text-slate-400 hover:text-slate-600"
                    )}
                  >
                    No, volver
                  </button>
                  <button
                    disabled={isDeletingHistory}
                    onClick={() => historyVehicleToDelete.id && handleDeleteHistory(historyVehicleToDelete.id)}
                    className={cn(
                      "py-4 bg-rose-600 text-white font-black text-[10px] uppercase tracking-widest shadow-xl shadow-rose-500/20 hover:bg-rose-700 transition-all flex items-center justify-center gap-2",
                      "rounded-xl",
                      isDeletingHistory && "opacity-50"
                    )}
                  >
                    {isDeletingHistory ? <Activity className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    Si, eliminar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {selectedMonthlyPass && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setSelectedMonthlyPass(null);
                setIsConfirmingDeletePass(false);
              }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-sm shadow-2xl overflow-hidden rounded-3xl",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500" />
              <div className="p-8 space-y-8">
                <div className="flex flex-col items-center gap-4">
                  <div className={cn(
                    "w-16 h-16 rounded-full flex items-center justify-center",
                    isDarkMode ? "bg-emerald-950/30 text-emerald-400" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {selectedMonthlyPass.vehicleType === 'motorcycle' ? <MotorcycleIcon className="w-8 h-8" /> : <Car className="w-8 h-8" />}
                  </div>
                  <div className="text-center">
                    <h3 className="text-3xl font-black font-mono tracking-wider mb-1 uppercase">{selectedMonthlyPass.plate}</h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Gestión de Abono</p>
                  </div>
                </div>

                <div className={cn("p-4 rounded-2xl border text-center space-y-1", isDarkMode ? "bg-slate-800/40 border-slate-800" : "bg-slate-50 border-slate-100")}>
                  <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Vencimiento actual</p>
                  <p className="text-sm font-bold text-emerald-500 flex items-center justify-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    {selectedMonthlyPass.endDate ? format(safeToDate(selectedMonthlyPass.endDate), 'dd/MM/yyyy', { locale: es }) : '---'}
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {!isConfirmingDeletePass ? (
                    <>
                      <button
                        onClick={() => handleRenewPass(selectedMonthlyPass.id, selectedMonthlyPass.endDate)}
                        className="w-full py-5 bg-emerald-600 text-white font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-emerald-500/20 hover:bg-emerald-700 transition-all flex items-center justify-center gap-3 rounded-xl"
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        Renovar por 30 días
                      </button>
                      
                      <button
                        onClick={() => setIsConfirmingDeletePass(true)}
                        className={cn(
                          "w-full py-4 font-black text-[10px] uppercase tracking-[0.2em] transition-all flex items-center justify-center gap-3 rounded-xl border-2",
                          isDarkMode 
                            ? "bg-rose-600/10 border-rose-500/20 text-rose-500 hover:bg-rose-600 hover:text-white hover:border-rose-600" 
                            : "bg-rose-50 border-rose-100 text-rose-600 hover:bg-rose-600 hover:text-white hover:border-rose-600"
                        )}
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar abono
                      </button>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[10px] font-black uppercase text-center text-rose-500 tracking-widest mb-4">¿Confirmas la eliminación definitiva?</p>
                      <button
                        onClick={() => {
                          handleDeletePass(selectedMonthlyPass.id);
                          setIsConfirmingDeletePass(false);
                        }}
                        className="w-full py-4 bg-rose-600 text-white font-black text-xs uppercase tracking-[0.2em] shadow-xl shadow-rose-500/20 hover:bg-rose-700 transition-all flex items-center justify-center gap-3 rounded-xl"
                      >
                        <Trash2 className="w-5 h-5" />
                        Confirmar Eliminación
                      </button>
                      <button
                        onClick={() => setIsConfirmingDeletePass(false)}
                        className="w-full py-3 text-slate-400 font-bold text-[10px] uppercase tracking-widest"
                      >
                        Volver atrás
                      </button>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => {
                    setSelectedMonthlyPass(null);
                    setIsConfirmingDeletePass(false);
                  }}
                  className="w-full text-slate-400 hover:text-slate-600 font-bold text-[10px] uppercase tracking-widest transition-colors flex items-center justify-center"
                >
                  Cerrar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isAddingMonthlyPass && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingMonthlyPass(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={cn(
                "relative w-full max-w-sm shadow-2xl overflow-hidden rounded-3xl",
                isDarkMode ? "bg-slate-900 border border-slate-800" : "bg-white border border-slate-100"
              )}
            >
              <div className="absolute top-0 left-0 w-full h-1.5 bg-emerald-500" />
              <div className="p-8 space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black uppercase tracking-widest text-emerald-500">Nuevo Abonado</h3>
                  <button onClick={() => setIsAddingMonthlyPass(false)} className="text-slate-400 hover:text-slate-600 transition-colors">
                    <XCircle className="w-6 h-6" />
                  </button>
                </div>

                <form onSubmit={handleAddMonthlyPass} className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Patente</label>
                    <input 
                      name="plate"
                      type="text" 
                      required
                      placeholder="ABC-123" 
                      onChange={(e) => {
                        if (e.target.value.length >= 6 && e.target.value.length <= 8) {
                          setPlateErrorMonthly(null);
                        }
                      }}
                      className={cn(
                        "w-full px-5 py-4 border-2 rounded-2xl font-mono text-xl font-black focus:outline-none transition-all uppercase",
                        plateErrorMonthly ? "border-rose-500" : "focus:border-emerald-500",
                        isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                      )}
                    />
                    {plateErrorMonthly && (
                      <p className="text-rose-500 text-[10px] font-black uppercase tracking-widest mt-1 ml-1">{plateErrorMonthly}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipo de Vehículo</label>
                    <select 
                      name="vehicleType"
                      value={monthlyVehicleType}
                      onChange={(e) => setMonthlyVehicleType(e.target.value as 'car' | 'motorcycle')}
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
                        value={monthlyAmountState}
                        onChange={(e) => setMonthlyAmountState(Number(e.target.value))}
                        placeholder="0" 
                        className={cn(
                          "w-full pl-10 pr-5 py-4 border-2 rounded-2xl font-bold text-xl focus:outline-none focus:border-emerald-500 transition-all",
                          isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                        )}
                      />
                    </div>
                  </div>
                  <button 
                    type="submit"
                    className="w-full bg-emerald-600 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-emerald-500/20 hover:scale-[1.02] active:scale-95 text-sm tracking-widest"
                  >
                    ACTIVAR ABONO
                  </button>
                </form>
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
          { id: 'history', icon: HistoryIcon, label: 'Historial' },
          { id: 'monthly', icon: CheckCircle2, label: 'Abonados' },
          { id: 'reports', icon: Search, label: 'Reportes' },
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
              "w-10 h-7 rounded-full flex items-center justify-center transition-all duration-300",
              activeView === v.id 
                ? (isDarkMode ? "bg-indigo-900/40 shadow-sm" : "bg-indigo-100 shadow-sm") 
                : (isDarkMode ? "active:bg-slate-800" : "active:bg-slate-100")
            )}>
              <v.icon className={cn("w-4.5 h-4.5 transition-transform", activeView === v.id ? "scale-110" : "")} />
            </div>
            <span className="text-[8.5px] font-black uppercase tracking-tighter">{v.label}</span>
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
