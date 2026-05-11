import React, { useState } from 'react';
import { motion } from 'motion/react';
import { collection, addDoc, updateDoc, doc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { auth, db, createStaffUser } from '../lib/firebase';
import { Establishment, OperationType } from '../types';
import { handleFirestoreError } from '../lib/error-handler';
import { Building2, Plus, Users, Trash2, ShieldCheck, Mail, Lock, AlertCircle } from 'lucide-react';
import { StylizedLetterA } from './Icons';
import { cn } from '../lib/utils';
import { User as FirebaseUser } from 'firebase/auth';

interface EstablishmentsViewProps {
  user: FirebaseUser;
  isSuperAdmin: boolean;
  establishments: Establishment[];
  isDarkMode: boolean;
}

export const EstablishmentsView: React.FC<EstablishmentsViewProps> = ({ user, isSuperAdmin, establishments, isDarkMode }) => {
  const [newEstName, setNewEstName] = useState('');
  const [newEstAddress, setNewEstAddress] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [managingMembersId, setManagingMembersId] = useState<string | null>(null);
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberPassword, setNewMemberPassword] = useState('');
  const [isAddingMember, setIsAddingMember] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);

  const currentManagingEst = establishments.find(e => e.id === managingMembersId);

  const handleCreateEstablishment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEstName || !newEstAddress) return;

    setIsCreating(true);
    try {
      const defaultSettings = {
        hourlyRate: 1000,
        motoHourlyRate: 500,
        monthlyRate: 25000,
        motoMonthlyRate: 12000,
        carSlots: 40,
        motoSlots: 20,
        totalSlots: 60,
        updatedBy: user.uid,
        updatedAt: new Date(),
      };

      await addDoc(collection(db, 'establishments'), {
        name: newEstName,
        address: newEstAddress,
        ownerId: user.uid,
        members: [user.uid],
        settings: defaultSettings,
      });

      setNewEstName('');
      setNewEstAddress('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'establishments');
    } finally {
      setIsCreating(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!managingMembersId || !newMemberEmail || !newMemberPassword) return;

    setIsAddingMember(true);
    setMemberError(null);
    try {
      // 1. Create the user in Firebase Auth using the secondary app tool
      const newUser = await createStaffUser(newMemberEmail, newMemberPassword);
      
      // 2. Add the UID to the establishment's members list
      await updateDoc(doc(db, 'establishments', managingMembersId), {
        members: arrayUnion(newUser.uid)
      });
      
      setNewMemberEmail('');
      setNewMemberPassword('');
    } catch (error: any) {
      console.error(error);
      setMemberError(error.message || 'Error al crear usuario');
    } finally {
      setIsAddingMember(false);
    }
  };

  const handleRemoveMember = async (memberUid: string) => {
    if (!managingMembersId || memberUid === user.uid) return;

    try {
      await updateDoc(doc(db, 'establishments', managingMembersId), {
        members: arrayRemove(memberUid)
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `establishments/${managingMembersId}`);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-black bg-gradient-to-r from-indigo-600 to-blue-500 bg-clip-text text-transparent">Cocheras</h2>
          <p className="text-slate-500 font-medium">Administra tus establecimientos y personal.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Create Form (Super Admin or any user if enabled) */}
        <div className={cn(
          "p-8 rounded-[2.5rem] border shadow-xl h-fit",
          isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
        )}>
          <div className="flex items-center gap-3 mb-6">
             <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                <Plus className="w-6 h-6" />
             </div>
             <h3 className="font-black text-xs uppercase tracking-widest text-slate-400">Nueva Cochera</h3>
          </div>
          
          <form onSubmit={handleCreateEstablishment} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Nombre</label>
              <input 
                value={newEstName}
                onChange={(e) => setNewEstName(e.target.value)}
                placeholder="Ej. Cochera Central"
                className={cn(
                  "w-full px-5 py-4 rounded-2xl border-2 font-bold focus:outline-none focus:border-indigo-500 transition-all",
                  isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                )}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Dirección</label>
              <input 
                value={newEstAddress}
                onChange={(e) => setNewEstAddress(e.target.value)}
                placeholder="Ej. Av. Corrientes 1234"
                className={cn(
                  "w-full px-5 py-4 rounded-2xl border-2 font-bold focus:outline-none focus:border-indigo-500 transition-all",
                  isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                )}
              />
            </div>
            <button 
              disabled={isCreating || !newEstName || !newEstAddress}
              className="w-full bg-indigo-600 text-white font-black py-5 rounded-3xl transition-all shadow-xl shadow-indigo-100 hover:scale-[1.02] active:scale-95 text-xs tracking-widest disabled:opacity-50"
            >
              CREAR ESTABLECIMIENTO
            </button>
          </form>
        </div>

        {/* Establishments List */}
        <div className="xl:col-span-2 space-y-4">
          <h3 className="font-black text-xs uppercase tracking-widest px-2 text-slate-500">Tus Cocheras ({establishments.length})</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {establishments.map(est => (
              <div 
                key={est.id}
                className={cn(
                  "p-6 rounded-3xl border flex flex-col gap-6 shadow-sm hover:shadow-md transition-all group",
                  isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
                )}
              >
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center text-white shadow-lg overflow-hidden relative">
                      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.2),transparent)]" />
                      <StylizedLetterA className="w-8 h-8" />
                    </div>
                    <div>
                      <h4 className="font-black text-xl tracking-tight leading-none mb-1">{est.name}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{est.address}</p>
                    </div>
                  </div>
                  {est.ownerId === user.uid && (
                    <span className="bg-indigo-500/10 text-indigo-500 text-[8px] font-black uppercase px-2 py-1 rounded-lg border border-indigo-500/20 shadow-sm">Propietario</span>
                  )}
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="flex items-center gap-2">
                    <div className="flex -space-x-2">
                      {est.members.slice(0, 3).map((m, i) => (
                        <div key={i} className="w-7 h-7 rounded-full border-2 border-white dark:border-slate-900 bg-slate-200 flex items-center justify-center text-[8px] font-bold">
                          {m.slice(0, 2).toUpperCase()}
                        </div>
                      ))}
                      {est.members.length > 3 && (
                        <div className="w-7 h-7 rounded-full border-2 border-white dark:border-slate-900 bg-slate-100 flex items-center justify-center text-[8px] font-bold text-slate-400">
                          +{est.members.length - 3}
                        </div>
                      )}
                    </div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Personal</p>
                  </div>
                  
                  <button 
                    onClick={() => setManagingMembersId(est.id || null)}
                    className="flex items-center gap-2 text-[10px] font-black text-indigo-600 hover:text-indigo-500 uppercase tracking-widest transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Gestionar Usuarios
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Members Modal */}
      {managingMembersId && currentManagingEst && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            onClick={() => setManagingMembersId(null)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className={cn(
              "relative w-full max-w-lg rounded-[2.5rem] border shadow-2xl p-8 md:p-10",
              isDarkMode ? "bg-slate-900 border-slate-800" : "bg-white border-slate-100"
            )}
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <h3 className="text-2xl font-black mb-1">Personal de {currentManagingEst.name}</h3>
                <p className="text-slate-500 text-sm">Gestiona quién puede operar esta cochera.</p>
              </div>
              <button 
                onClick={() => setManagingMembersId(null)}
                className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 transition-colors"
              >
                <Plus className="w-6 h-6 rotate-45" />
              </button>
            </div>

            <div className="space-y-6">
              <form onSubmit={handleAddMember} className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email del Personal</label>
                <div className="relative">
                  <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="email"
                    value={newMemberEmail}
                    onChange={(e) => setNewMemberEmail(e.target.value)}
                    placeholder="empleado@cochera.com"
                    required
                    className={cn(
                      "w-full pl-11 pr-4 py-3 rounded-xl border-2 font-bold text-sm focus:outline-none focus:border-indigo-500 transition-all",
                      isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                    )}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Contraseña Provisoria</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input 
                    type="password"
                    value={newMemberPassword}
                    onChange={(e) => setNewMemberPassword(e.target.value)}
                    placeholder="Min. 6 caracteres"
                    required
                    minLength={6}
                    className={cn(
                      "w-full pl-11 pr-4 py-3 rounded-xl border-2 font-bold text-sm focus:outline-none focus:border-indigo-500 transition-all",
                      isDarkMode ? "bg-slate-950 border-slate-800 text-white" : "bg-slate-50 border-slate-100"
                    )}
                  />
                </div>
              </div>

              {memberError && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-[10px] font-bold uppercase">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {memberError}
                </div>
              )}

              <button 
                type="submit"
                disabled={isAddingMember || !newMemberEmail || !newMemberPassword}
                className="w-full bg-indigo-600 text-white px-6 py-4 rounded-xl font-black text-[10px] uppercase tracking-widest shadow-lg shadow-indigo-100 disabled:opacity-50 transition-all"
              >
                {isAddingMember ? 'CREANDO...' : 'REGISTRAR Y AÑADIR'}
              </button>
              <p className="text-[9px] text-slate-500 dark:text-slate-600 text-center px-4">
                El usuario será creado en el sistema y añadido a esta cochera.
                <br />Recuerde habilitar el proveedor "Correo electrónico" en Firebase.
              </p>
              </form>

              <div className="space-y-3 max-h-64 overflow-y-auto">
                {currentManagingEst.members.map(memberUid => (
                  <div 
                    key={memberUid}
                    className={cn(
                      "p-4 rounded-2xl border flex items-center justify-between",
                      isDarkMode ? "bg-slate-950 border-slate-800" : "bg-slate-50 border-slate-100"
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center text-indigo-500 text-[10px] font-black">
                        {memberUid === user.uid ? <ShieldCheck className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
                      </div>
                      <span className="font-mono text-xs text-slate-600 dark:text-slate-400">{memberUid.slice(0, 15)}...</span>
                      {memberUid === user.uid && <span className="text-[8px] font-black uppercase text-indigo-500 bg-indigo-500/10 px-1.5 py-0.5 rounded">Tú</span>}
                    </div>
                    {memberUid !== user.uid && (
                      <button 
                        onClick={() => handleRemoveMember(memberUid)}
                        className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            <button 
              onClick={() => setManagingMembersId(null)}
              className="w-full mt-10 bg-slate-900 dark:bg-slate-800 text-white font-black py-4 rounded-2xl tracking-widest text-xs"
            >
              LISTO
            </button>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
};
