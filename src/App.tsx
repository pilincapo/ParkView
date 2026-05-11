/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { auth, login, logout, db } from './lib/firebase';
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
  setDoc,
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
  Menu,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { cn, formatCurrency } from './lib/utils';
import { Vehicle, VehicleStatus, ParkingSettings, OperationType } from './types';
import { handleFirestoreError } from './lib/error-handler';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeVehicles, setActiveVehicles] = useState<Vehicle[]>([]);
  const [history, setHistory] = useState<Vehicle[]>([]);
  const [settings, setSettings] = useState<ParkingSettings | null>(null);
  const [activeView, setActiveView] = useState<'monitor' | 'entry' | 'activity' | 'history' | 'reports' | 'settings'>('monitor');
  const [plate, setPlate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const plateInputRef = useRef<HTMLInputElement>(null);

  // Filters for reports
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-01'));
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reportData, setReportData] = useState<Vehicle[]>([]);

  const [selectedSlot, setSelectedSlot] = useState<string>('');

  const handleSlotClick = (slotId: string, vehicle?: Vehicle) => {
    if (vehicle) {
      if (confirmingExitId === vehicle.id) {
        setConfirmingExitId(null);
      } else {
        setConfirmingExitId(vehicle.id || null);
        setSelectedSlot('');
        
        // On mobile, switch to activity view
        if (window.innerWidth < 768) {
          setActiveView('activity');
        }

        // Scroll sidebar item into view
        setTimeout(() => {
          const el = document.getElementById(`active-${vehicle.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    } else {
      setSelectedSlot(slotId);
      setConfirmingExitId(null);
      
      // On mobile, switch to entry view automatically
      if (window.innerWidth < 768) {
        setActiveView('entry');
      }

      setTimeout(() => plateInputRef.current?.focus(), 50);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Listen to active vehicles
  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'vehicles'),
      where('ownerId', '==', user.uid),
      where('status', '==', VehicleStatus.ACTIVE),
      orderBy('entryTime', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setActiveVehicles(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles');
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to settings
  useEffect(() => {
    if (!user) return;

    const unsubscribe = onSnapshot(doc(db, 'settings', 'parking'), (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as ParkingSettings);
      } else {
        // Initialize default settings if not exists
        const defaultSettings = {
          hourlyRate: 1000,
          totalSlots: 40,
          updatedBy: user.uid,
          updatedAt: serverTimestamp()
        };
        setDoc(snap.ref, defaultSettings);
      }
    }, (error) => {
      console.warn('Settings fetch error:', error);
      handleFirestoreError(error, OperationType.GET, 'settings/parking');
    });

    return () => unsubscribe();
  }, [user]);

  // Listen to history for the list
  useEffect(() => {
    if (!user || activeView !== 'history') return;

    const q = query(
      collection(db, 'vehicles'),
      where('ownerId', '==', user.uid),
      where('status', '==', VehicleStatus.COMPLETED),
      orderBy('exitTime', 'desc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const vehicles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Vehicle));
      setHistory(vehicles);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'vehicles');
    });

    return () => unsubscribe();
  }, [user, activeView]);

  // Fetch data for reports based on date range
  useEffect(() => {
    if (!user || activeView !== 'reports') return;

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, 'vehicles'),
      where('ownerId', '==', user.uid),
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
  }, [user, activeView, startDate, endDate]);

  const handleEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !plate.trim() || !selectedSlot) return;

    // Check if slot is already occupied
    if (activeVehicles.some(v => v.slotId === selectedSlot)) {
      alert("La cochera seleccionada ya está ocupada.");
      return;
    }

    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'vehicles'), {
        plate: plate.toUpperCase(),
        slotId: selectedSlot,
        entryTime: serverTimestamp(),
        exitTime: null,
        status: VehicleStatus.ACTIVE,
        totalAmount: 0,
        ownerId: user.uid
      });
      setPlate('');
      setSelectedSlot('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'vehicles');
    } finally {
      setIsSubmitting(false);
    }
  };

  const [confirmingExitId, setConfirmingExitId] = useState<string | null>(null);

  const calculateAmount = (v: Vehicle) => {
    if (!settings || !v.entryTime) return 0;
    const now = new Date();
    const entry = v.entryTime.toDate();
    const diffMs = now.getTime() - entry.getTime();
    const diffHours = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
    return diffHours * settings.hourlyRate;
  };

  const handleExit = async (vehicle: Vehicle) => {
    if (!user || !settings || !vehicle.id) return;
    
    if (confirmingExitId !== vehicle.id) {
      setConfirmingExitId(vehicle.id);
      return;
    }

    const amount = calculateAmount(vehicle);

    try {
      await updateDoc(doc(db, 'vehicles', vehicle.id), {
        status: VehicleStatus.COMPLETED,
        exitTime: serverTimestamp(),
        totalAmount: amount
      });
      setConfirmingExitId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `vehicles/${vehicle.id}`);
    }
  };

  const updateSettings = async (rate: number, slots: number) => {
    if (!user) return;
    try {
      await setDoc(doc(db, 'settings', 'parking'), {
        hourlyRate: rate,
        totalSlots: slots,
        updatedBy: user.uid,
        updatedAt: serverTimestamp()
      });
      setActiveView('monitor');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'settings/parking');
    }
  };

  if (loading) return (
    <div className="min-h-screen bg-[#FDFCFB] flex items-center justify-center font-sans overflow-hidden relative">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,#EEF2FF_0%,transparent_50%)]" />
      <div className="flex flex-col items-center gap-6 relative z-10">
        <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-3xl flex items-center justify-center shadow-2xl shadow-indigo-200 animate-bounce">
          <Car className="text-white w-8 h-8" />
        </div>
        <div className="flex flex-col items-center gap-2">
          <p className="text-slate-900 font-black tracking-[0.3em] text-[10px] uppercase">ParkFlow Pro</p>
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
        className="bg-white p-10 max-w-md w-full rounded-3xl border border-slate-200 shadow-xl shadow-slate-200/50"
      >
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <Car className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight leading-none">ParkFlow</h1>
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mt-1">Gestión Centralizada</p>
          </div>
        </div>
        <p className="text-slate-600 mb-8 leading-relaxed text-sm">
          Bienvenido al sistema de control de estacionamiento. Inicie sesión para gestionar ingresos, egresos y tarifas en tiempo real.
        </p>
        <button 
          onClick={login}
          className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white py-4 px-6 rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 group"
        >
          <LogIn className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
          Continuar con Google
        </button>
      </motion.div>
    </div>
  );

  return (
    <div className="h-screen flex flex-col bg-[#FDFCFB] text-slate-800 font-sans overflow-hidden">
      {/* Background gradients for Android 16 depth */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-50/50 rounded-full blur-[100px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-50/50 rounded-full blur-[100px]" />
      </div>

      {/* Header */}
      <header className="h-16 md:h-20 bg-white/70 backdrop-blur-xl border-b border-slate-100 flex items-center justify-between px-4 md:px-8 shrink-0 z-50">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-9 h-9 md:w-10 md:h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white cursor-pointer shadow-lg shadow-indigo-200" onClick={() => setActiveView('monitor')}>
            <Car className="w-5 h-5 md:w-6 md:h-6" />
          </div>
          <div>
            <h1 className="font-black text-lg md:text-xl tracking-tight text-slate-900 leading-none bg-gradient-to-r from-indigo-700 to-indigo-500 bg-clip-text text-transparent">ParkFlow Pro</h1>
            <p className="text-[9px] md:text-[10px] text-slate-500 font-extrabold uppercase tracking-widest mt-0.5">Central Alpha</p>
          </div>
        </div>

        <div className="hidden lg:flex gap-8">
          <div className="bg-slate-50 px-4 py-2 rounded-2xl border border-slate-100 flex items-center gap-3">
            <div className="text-right">
              <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest leading-none mb-1">Ocupación</p>
              <p className="text-xl font-black text-indigo-600 leading-none">
                {activeVehicles.length} <span className="text-slate-300 font-normal">/ {settings?.totalSlots || '---'}</span>
              </p>
            </div>
            <div className="w-px h-6 bg-slate-200"></div>
            <div className="text-right">
              <p className="text-[9px] text-slate-400 uppercase font-black tracking-widest leading-none mb-1">Caja Hoy</p>
              <p className="text-xl font-black text-emerald-600 leading-none">
                {formatCurrency(history.reduce((acc, v) => acc + (v.totalAmount || 0), 0))}
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 md:gap-2">
          <div className="hidden md:flex items-center gap-1">
            {[
              { id: 'monitor', icon: Activity, label: 'Monitor' },
              { id: 'history', icon: HistoryIcon, label: 'Historial' },
              { id: 'reports', icon: Search, label: 'Reportes' },
              { id: 'settings', icon: SettingsIcon, label: 'Ajustes' },
            ].map((v) => (
              <button 
                key={v.id}
                onClick={() => setActiveView(v.id as any)}
                className={cn(
                  "p-2.5 rounded-xl transition-all border group relative",
                  activeView === v.id 
                    ? "bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-100" 
                    : "bg-white border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                )}
                title={v.label}
              >
                <v.icon className={cn("w-5 h-5", activeView === v.id ? "scale-110" : "")} />
                {activeView === v.id && (
                  <motion.div layoutId="header-active" className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-white rounded-full" />
                )}
              </button>
            ))}
          </div>
          <div className="hidden md:block w-[1px] h-6 bg-slate-200 mx-2" />
          <button 
            onClick={logout}
            className="p-2 md:p-2.5 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-500 transition-all border border-transparent hover:border-red-100 group"
            title="Cerrar Sesión"
          >
            <LogOut className="w-5 h-5 group-hover:rotate-12 transition-transform" />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col md:flex-row gap-4 md:gap-6 p-3 md:p-6 overflow-hidden relative">
        {/* Left Column: Sidebar (Desktop Only) */}
        <div className="hidden md:flex w-72 flex-col gap-6 shrink-0 h-full overflow-y-auto pr-1">
          {/* Entry Form */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col gap-6 bg-gradient-to-b from-white to-slate-50/50">
            <h2 className="font-black text-slate-900 flex items-center gap-2 text-xs uppercase tracking-[0.2em]">
               Entrada
            </h2>
            <form onSubmit={handleEntry} className="flex flex-col gap-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Cochera</label>
                <div className="flex gap-2 items-center">
                  <div className={cn(
                    "flex-1 bg-white border-2 rounded-2xl px-4 py-3 font-mono text-xl flex items-center justify-center gap-2 transition-all shadow-sm",
                    selectedSlot ? "border-emerald-500 text-emerald-600" : "border-slate-100 text-slate-300"
                  )}>
                    {selectedSlot || "---"}
                  </div>
                  {selectedSlot && (
                    <button 
                      type="button"
                      onClick={() => setSelectedSlot('')}
                      className="p-3 bg-red-50 text-red-500 rounded-2xl hover:bg-red-100 transition-all"
                    >
                      <XCircle className="w-5 h-5" />
                    </button>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Patente</label>
                <input 
                  ref={plateInputRef}
                  type="text" 
                  value={plate}
                  onChange={(e) => setPlate(e.target.value.toUpperCase())}
                  placeholder="PLATE-ID" 
                  className="w-full px-5 py-4 bg-white border-2 border-slate-100 rounded-2xl font-mono text-2xl font-black text-center focus:outline-none focus:border-indigo-500 transition-all uppercase"
                />
              </div>
              <button 
                disabled={isSubmitting || !plate.trim() || !selectedSlot}
                className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl transition-all shadow-xl shadow-indigo-200 flex items-center justify-center gap-3 text-sm tracking-widest hover:scale-[1.02] active:scale-95 disabled:opacity-50"
              >
                {isSubmitting ? <Activity className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                INGRESAR
              </button>
            </form>
          </div>

          {/* Nav Actions (Desktop) */}
          <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm">
            <h2 className="font-black text-slate-900 mb-6 text-xs uppercase tracking-[0.2em]">Opciones</h2>
            <div className="grid grid-cols-2 gap-4">
              {[
                { id: 'monitor', icon: Activity, label: 'Monitor' },
                { id: 'history', icon: HistoryIcon, label: 'Historial' },
                { id: 'reports', icon: Search, label: 'Reportes' },
                { id: 'settings', icon: SettingsIcon, label: 'Ajustes' },
              ].map((v) => (
                <button 
                  key={v.id}
                  onClick={() => setActiveView(v.id as any)}
                  className={cn(
                    "flex flex-col items-center justify-center p-5 rounded-2xl border-2 transition-all gap-2 group",
                    activeView === v.id 
                      ? "bg-indigo-50 border-indigo-200 text-indigo-600 shadow-inner" 
                      : "bg-slate-50 border-transparent text-slate-400 hover:border-slate-200"
                  )}
                >
                  <v.icon className={cn("w-6 h-6", activeView === v.id ? "animate-pulse" : "group-hover:scale-110 transition-transform")} />
                  <span className="text-[9px] font-black uppercase tracking-tighter">{v.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center Content Column */}
        <div className="flex-1 bg-white rounded-[2rem] md:rounded-[3rem] border border-slate-200 shadow-xl shadow-slate-200/40 flex flex-col overflow-hidden relative">
          {/* Content Header (Mobile Context) */}
          <div className="p-5 md:p-8 border-b border-slate-100 flex justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-20">
            <div>
              <p className="text-[9px] font-black text-indigo-500 uppercase tracking-[0.3em] mb-1">
                {activeView === 'monitor' ? 'SISTEMA DE CONTROL' : activeView === 'entry' ? 'REGISTRO DE INGRESO' : 'ADMINISTRACIÓN'}
              </p>
              <h2 className="font-black text-xl md:text-2xl text-slate-900 tracking-tight">
                {activeView === 'monitor' ? 'Mapa de Cocheras' : 
                 activeView === 'entry' ? 'Nueva Entrada' : 
                 activeView === 'activity' ? 'Sesiones Activas' :
                 activeView === 'history' ? 'Historial' : 
                 activeView === 'reports' ? 'Analítica' : 'Ajustes'}
              </h2>
            </div>
            
            <div className="hidden sm:flex gap-4">
              <div className="flex items-center gap-2 text-[10px] font-black text-slate-400">
                <span className="w-3 h-3 bg-slate-100 border border-slate-200 rounded-full shadow-inner"></span> LIBRE
              </div>
              <div className="flex items-center gap-2 text-[10px] font-black text-indigo-500">
                <span className="w-3 h-3 bg-indigo-500 rounded-full shadow-lg shadow-indigo-200"></span> OCUPADO
              </div>
            </div>
          </div>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 scrollbar-hide pb-32 md:pb-8 relative">
            <AnimatePresence mode="wait">
              {activeView === 'activity' ? (
                <motion.div 
                  key="mobile-activity"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="space-y-4"
                >
                  <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl text-white mb-6">
                    <div>
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Actividad</p>
                      <p className="text-xl font-black">{activeVehicles.length} Activos</p>
                    </div>
                    <Activity className="w-8 h-8 text-indigo-400 animate-pulse" />
                  </div>
                  
                  {activeVehicles.map((v) => (
                    <motion.div 
                      key={v.id}
                      id={`active-${v.id}`}
                      layout
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      onClick={() => setConfirmingExitId(v.id || null)}
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex flex-col gap-3 group relative",
                        confirmingExitId === v.id 
                          ? "bg-indigo-600 border-indigo-400 text-white shadow-xl" 
                          : "bg-white border-slate-100 shadow-sm"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                             <span className={cn(
                               "text-[10px] font-black px-1.5 py-0.5 rounded leading-none",
                               confirmingExitId === v.id ? "bg-white text-indigo-600" : "bg-indigo-500 text-white"
                             )}>
                               {v.slotId}
                             </span>
                             <p className="font-bold text-lg tracking-wider">{v.plate}</p>
                          </div>
                          <p className={cn(
                            "text-[10px] font-bold uppercase mt-1",
                            confirmingExitId === v.id ? "text-indigo-100" : "text-slate-400"
                          )}>
                            Ingreso: {v.entryTime ? format(v.entryTime.toDate(), 'HH:mm') : '--:--'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className={cn(
                            "text-base font-bold",
                            confirmingExitId === v.id ? "text-white" : "text-slate-900"
                          )}>
                            {formatCurrency(calculateAmount(v))}
                          </p>
                          <div className="flex items-center justify-end gap-1 mt-1">
                             <Clock className={cn("w-3 h-3", confirmingExitId === v.id ? "text-indigo-200" : "text-slate-300")} />
                             <span className={cn("text-[9px] font-black tracking-tighter", confirmingExitId === v.id ? "text-indigo-200" : "text-slate-400")}>EN CURSO</span>
                          </div>
                        </div>
                      </div>

                      {confirmingExitId === v.id && (
                        <motion.button 
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          onClick={(e) => { e.stopPropagation(); handleExit(v); }}
                          className="w-full bg-white text-indigo-600 font-black py-4 rounded-xl text-xs tracking-widest shadow-xl flex items-center justify-center gap-2"
                        >
                          CONFIRMAR SALIDA Y COBRO
                        </motion.button>
                      )}
                    </motion.div>
                  ))}
                  
                  {activeVehicles.length === 0 && (
                    <div className="p-20 text-center opacity-20">
                      <Car className="w-16 h-16 mx-auto mb-4" />
                      <p className="font-black uppercase tracking-widest text-xs">Sin actividad</p>
                    </div>
                  )}
                </motion.div>
              ) : activeView === 'entry' ? (
                <motion.div 
                  key="mobile-entry"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  className="space-y-6"
                >
                  <div className={cn(
                    "p-6 rounded-3xl border transition-all",
                    selectedSlot ? "bg-emerald-50 border-emerald-100" : "bg-slate-50 border-slate-100"
                  )}>
                    <h2 className="font-black text-xs text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                       <Plus className="w-4 h-4" />
                       Nueva Entrada
                    </h2>
                    <form onSubmit={handleEntry} className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Cochera Asignada</label>
                        <div className={cn(
                          "w-full h-16 rounded-2xl flex items-center justify-center font-mono text-2xl font-black border-2 transition-all",
                          selectedSlot 
                            ? "border-emerald-500 bg-white text-emerald-600 shadow-lg shadow-emerald-500/10" 
                            : "border-dashed border-slate-200 text-slate-300"
                        )}>
                          {selectedSlot || "SELECCIONE EN MONITOR"}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block ml-1">Patente del Vehículo</label>
                        <input 
                          ref={plateInputRef}
                          type="text" 
                          value={plate}
                          onChange={(e) => setPlate(e.target.value.toUpperCase())}
                          placeholder="PATENTE" 
                          className="w-full px-6 py-5 bg-white border border-slate-200 rounded-3xl font-mono text-3xl font-black text-center focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 transition-all uppercase placeholder:text-slate-100"
                        />
                      </div>

                      <button 
                        disabled={isSubmitting || !plate.trim() || !selectedSlot}
                        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-black py-6 rounded-3xl transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 text-lg tracking-widest"
                      >
                        {isSubmitting ? <Activity className="w-6 h-6 animate-spin" /> : <Plus className="w-6 h-6" />}
                        REGISTRAR
                      </button>
                    </form>
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
                      updateSettings(Number(formData.get('rate')), Number(formData.get('slots')));
                    }} className="space-y-6">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 mb-2">Tarifa de Estacionamiento</h3>
                        <p className="text-xs text-slate-500 mb-4">Ajuste el precio por hora o fracción.</p>
                        <div className="relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-indigo-400">$</span>
                          <input 
                            name="rate"
                            type="number"
                            defaultValue={settings?.hourlyRate}
                            className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>
                      </div>

                      <div>
                        <h3 className="text-sm font-bold text-slate-900 mb-2">Capacidad del Estacionamiento</h3>
                        <p className="text-xs text-slate-500 mb-4">Número total de cocheras disponibles.</p>
                        <div className="relative">
                          <input 
                            name="slots"
                            type="number"
                            defaultValue={settings?.totalSlots}
                            className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                          />
                        </div>
                      </div>

                      <button 
                        type="submit"
                        className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-slate-800 transition-all shadow-lg"
                      >
                        GUARDAR CAMBIOS
                      </button>
                    </form>
                    
                    <div className="p-4 bg-amber-50 rounded-xl border border-amber-100 flex gap-3">
                      <div className="w-5 h-5 text-amber-600 shrink-0">⚠</div>
                      <p className="text-[11px] text-amber-900 opacity-80 leading-tight">
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
                  <div className="flex flex-col md:flex-row gap-4 items-end bg-slate-50/50 p-4 md:p-6 rounded-3xl border border-slate-100">
                    <div className="space-y-1 w-full md:w-auto">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Desde</label>
                      <input 
                        type="date" 
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="block w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 outline-none transition-all shadow-sm"
                      />
                    </div>
                    <div className="space-y-1 w-full md:w-auto">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Hasta</label>
                      <input 
                        type="date" 
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="block w-full bg-white border-2 border-transparent focus:border-indigo-500 rounded-xl px-4 py-3 text-sm font-bold text-slate-900 outline-none transition-all shadow-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 md:gap-8">
                    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-100/50 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500" />
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Caja Total</p>
                      <p className="text-3xl md:text-5xl font-black text-emerald-600 relative">
                        {formatCurrency(reportData.reduce((acc, v) => acc + (v.totalAmount || 0), 0))}
                      </p>
                    </div>
                    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-100/50 relative overflow-hidden group text-center">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-slate-50 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500" />
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Operaciones</p>
                      <p className="text-3xl md:text-5xl font-black text-slate-900 relative">{reportData.length}</p>
                    </div>
                    <div className="bg-white p-6 md:p-8 rounded-[2.5rem] border border-slate-100 shadow-xl shadow-slate-100/50 relative overflow-hidden group text-right">
                      <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50 rounded-full -mr-16 -mt-16 group-hover:scale-110 transition-transform duration-500" />
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em] mb-4 relative">Ticket Prom.</p>
                      <p className="text-3xl md:text-5xl font-black text-indigo-600 relative">
                        {reportData.length > 0 
                          ? formatCurrency(reportData.reduce((acc, v) => acc + (v.totalAmount || 0), 0) / reportData.length)
                          : '$ 0'}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white border border-slate-100 rounded-[2rem] overflow-hidden shadow-sm">
                    <div className="bg-slate-50 px-8 py-5 border-b border-slate-100 flex justify-between items-center">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Detalle de Cobros</h4>
                      <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-300">
                        <Search className="w-4 h-4" />
                      </div>
                    </div>
                    {reportData.length === 0 ? (
                      <div className="p-20 text-center text-slate-300 italic text-xs">No hay datos para el periodo seleccionado</div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {Object.entries(reportData.reduce((acc, curr) => {
                          if (!curr.exitTime || !curr.totalAmount) return acc;
                          const dateKey = format(curr.exitTime.toDate(), 'dd/MM/yyyy');
                          if (!acc[dateKey]) acc[dateKey] = { income: 0, count: 0 };
                          acc[dateKey].income += curr.totalAmount;
                          acc[dateKey].count += 1;
                          return acc;
                        }, {} as Record<string, { income: number, count: number }>)).sort().reverse().map(([date, stats]) => (
                          <div key={date} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                            <span className="font-bold text-slate-600 text-sm">{date}</span>
                            <div className="flex gap-8">
                              <div className="text-right">
                                <span className="text-[9px] font-black text-slate-300 uppercase block">Ingresos</span>
                                <span className="font-bold text-emerald-600">{formatCurrency(stats.income)}</span>
                              </div>
                              <div className="text-right w-16">
                                <span className="text-[9px] font-black text-slate-300 uppercase block">Autos</span>
                                <span className="font-bold text-slate-900">{stats.count}</span>
                              </div>
                            </div>
                          </div>
                        ))}
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
                    {history.length === 0 ? (
                      <div className="h-64 flex flex-col items-center justify-center text-slate-300 gap-3 grayscale">
                         <HistoryIcon className="w-12 h-12 opacity-20" />
                         <p className="text-[10px] font-black uppercase tracking-widest">Sin registros históricos</p>
                      </div>
                    ) : (
                      history.map((v) => {
                        if (!v.entryTime || !v.exitTime || !v.id) return null;
                        const diff = v.exitTime.toDate().getTime() - v.entryTime.toDate().getTime();
                        const h = Math.floor(diff / (1000 * 60 * 60));
                        const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                        return (
                          <div key={v.id} className="bg-white border border-slate-100 p-4 rounded-2xl flex items-center justify-between hover:border-slate-200 transition-all group">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-400 transition-all">
                                <Car className="w-6 h-6" />
                              </div>
                              <div>
                                <h4 className="font-bold text-slate-900 tracking-wider">#{v.plate}</h4>
                                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase tracking-tight">
                                  <span>{format(v.entryTime.toDate(), 'HH:mm')}</span>
                                  <span>→</span>
                                  <span>{format(v.exitTime.toDate(), 'HH:mm')}</span>
                                  <span className="text-slate-200">|</span>
                                  <span>{h}h {m}m</span>
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-black text-emerald-600 text-lg">{formatCurrency(v.totalAmount)}</p>
                              <p className="text-[10px] text-slate-300 font-bold uppercase tracking-tighter">{format(v.exitTime.toDate(), 'dd MMM')}</p>
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
                  className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4"
                >
                  {/* Grid visualization */}
                  {Array.from({ length: settings?.totalSlots || 24 }).map((_, i) => {
                    const slotNum = String(i + 1).padStart(2, '0');
                    const slotId = `S-${slotNum}`;
                    const vehicle = activeVehicles.find(v => v.slotId === slotId);
                    const isSelected = selectedSlot === slotId;
                    
                    const isOccupiedSelected = vehicle?.id === confirmingExitId;
                    
                    return (
                      <button 
                        key={slotId} 
                        onClick={() => handleSlotClick(slotId, vehicle)}
                        className={cn(
                          "aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 transition-all border font-mono text-[10px] relative overflow-hidden group hover:scale-[1.02] active:scale-95",
                          vehicle 
                            ? isOccupiedSelected 
                              ? "bg-indigo-800 border-indigo-400 text-white ring-4 ring-indigo-500/20 shadow-xl"
                              : "bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-500/20" 
                            : isSelected
                              ? "bg-emerald-50 border-emerald-500 text-emerald-600 ring-4 ring-emerald-500/10 animate-pulse"
                              : "bg-slate-50 border-slate-100 text-slate-300 hover:border-slate-300 hover:bg-white"
                        )}
                      >
                        <span className={cn(
                          "absolute top-1.5 left-2 font-black text-[8px] opacity-40",
                          vehicle ? "text-white" : "text-slate-400"
                        )}>
                          #{slotNum}
                        </span>
                        
                        {vehicle ? (
                           <>
                             <Car className="w-5 h-5 mb-0.5" />
                             <span className="font-bold leading-none tracking-tighter">{vehicle.plate}</span>
                           </>
                        ) : (
                          <div className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center transition-all",
                            isSelected ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-300 group-hover:bg-slate-200"
                          )}>
                             <Plus className="w-4 h-4" />
                          </div>
                        )}
                        
                        {vehicle && (
                          <div className="absolute inset-0 bg-indigo-500/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                            <span className="text-[8px] font-black uppercase text-white bg-indigo-700 px-1.5 py-0.5 rounded shadow-sm">Ver Sesión</span>
                          </div>
                        )}
                      </button>
                    );
                  })}
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
                   <Activity className="w-12 h-12" />
                   <p className="text-[10px] font-black uppercase tracking-widest text-center">Sin vehículos<br/>activos</p>
                </div>
              ) : (
                activeVehicles.map((v) => {
                  const isConfirming = confirmingExitId === v.id;
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
                          ? "bg-indigo-600 border-indigo-400 ring-4 ring-indigo-500/20 shadow-xl" 
                          : "bg-slate-800 border-slate-700 hover:border-slate-600 cursor-pointer"
                      )}
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                             <span className="text-[10px] font-black bg-indigo-500 text-white px-1.5 py-0.5 rounded leading-none">
                               {v.slotId}
                             </span>
                             <p className={cn("font-bold text-lg tracking-wider", isConfirming ? "text-white" : "text-indigo-400")}>{v.plate}</p>
                          </div>
                          <p className="text-[10px] text-slate-400 font-bold uppercase mt-1">Ingreso: {v.entryTime ? format(v.entryTime.toDate(), 'HH:mm') : '--:--'}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-base font-bold text-white">{formatCurrency(calculateAmount(v))}</p>
                          <p className="text-[10px] text-emerald-400 font-black">ACTIVA</p>
                        </div>
                      </div>
                      
                      <button 
                         onClick={() => handleExit(v)}
                         onMouseLeave={() => isConfirming && setConfirmingExitId(null)}
                         className={cn(
                           "w-full py-2.5 rounded-xl font-bold text-[10px] uppercase tracking-widest transition-all",
                           isConfirming 
                             ? "bg-white text-indigo-600 hover:bg-slate-50" 
                             : "bg-slate-700 text-slate-300 hover:bg-emerald-500 hover:text-slate-900"
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

      {/* Bottom Nav (Mobile Only) */}
      <nav className="md:hidden h-20 bg-white/95 backdrop-blur-xl border-t border-slate-200 fixed bottom-0 left-0 right-0 z-[60] px-3 flex items-center justify-between pb-safe shadow-[0_-8px_30px_rgb(0,0,0,0.04)]">
        {[
          { id: 'monitor', icon: Activity, label: 'Cocheras' },
          { id: 'activity', icon: Car, label: 'Sesiones' },
          { id: 'reports', icon: Search, label: 'Caja' },
          { id: 'history', icon: HistoryIcon, label: 'Pasados' },
          { id: 'settings', icon: SettingsIcon, label: 'Ajustes' },
        ].map((v) => (
          <button 
            key={v.id}
            onClick={() => setActiveView(v.id as any)}
            className={cn(
              "flex flex-col items-center justify-center gap-1.5 flex-1 transition-all relative py-2",
              activeView === v.id ? "text-indigo-600" : "text-slate-400"
            )}
          >
            <div className={cn(
              "w-12 h-8 rounded-full flex items-center justify-center transition-all duration-300",
              activeView === v.id ? "bg-indigo-100 shadow-sm" : "active:bg-slate-100"
            )}>
              <v.icon className={cn("w-5 h-5 transition-transform", activeView === v.id ? "scale-110" : "")} />
            </div>
            <span className="text-[9px] font-black uppercase tracking-tighter">{v.label}</span>
            {activeView === v.id && (
               <motion.div 
                 layoutId="active-mobile-pill"
                 className="absolute -top-1 w-8 h-1 bg-indigo-600 rounded-full"
               />
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <footer className="h-16 bg-white border-t border-slate-200 flex items-center px-8 gap-12 shrink-0">
        <div className="flex items-center gap-8">
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Tarifa Base</span>
            <div className="flex items-center gap-2">
              <span className="font-black text-slate-900">{settings ? formatCurrency(settings.hourlyRate) : '---'}</span>
              <span className="text-[9px] text-slate-400 font-bold italic">x hora</span>
            </div>
          </div>
          <div className="h-6 w-px bg-slate-200"></div>
          <div className="flex flex-col">
            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Operador</span>
            <span className="font-bold text-slate-600 text-xs truncate max-w-[150px]">{user.displayName || user.email}</span>
          </div>
        </div>
        
        <div className="flex-1 flex justify-end gap-3">
          <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-tight">Servidor Sincronizado</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
