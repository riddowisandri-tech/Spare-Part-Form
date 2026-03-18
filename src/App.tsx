import React, { useState, useEffect, useRef } from 'react';
import { 
  doc, 
  getDoc, 
  setDoc, 
  collection, 
  addDoc, 
  serverTimestamp, 
  query, 
  orderBy, 
  limit, 
  onSnapshot,
  getDocs,
  deleteDoc,
  updateDoc
} from 'firebase/firestore';
import { db } from './firebase';
import { Html5QrcodeScanner } from 'html5-qrcode';
import * as XLSX from 'xlsx';
import { 
  Scan, 
  Package, 
  History, 
  Plus, 
  ArrowRightLeft, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronLeft,
  Settings,
  TrendingUp,
  Box,
  User as UserIcon,
  Clock,
  Search,
  X
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface SparePart {
  barcode: string;
  name: string;
  description: string;
  stock: number;
  location?: string;
  model?: string;
  vendor?: string;
}

interface Transaction {
  id: string;
  partBarcode: string;
  technicianName: string;
  action: 'take' | 'return';
  quantity: number;
  notes: string;
  timestamp: any;
}

// --- Components ---

const Logo = () => (
  <div className="flex items-center gap-3">
    <div className="shrink-0">
      <svg width="120" height="48" viewBox="0 0 140 55" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-10 w-auto">
        {/* S */}
        <text x="0" y="35" fontFamily="Arial, sans-serif" fontSize="42" fill="white">S</text>
        {/* First i */}
        <rect x="28" y="15" width="7" height="22" fill="white"/>
        <circle cx="31.5" cy="8" r="5" fill="#1E5BB0"/>
        {/* Second i */}
        <rect x="42" y="15" width="7" height="22" fill="white"/>
        <circle cx="45.5" cy="44" r="5" fill="#F7941D"/>
        {/* X */}
        <text x="56" y="35" fontFamily="Arial, sans-serif" fontSize="42" fill="white">X</text>
        {/* We care. */}
        <text x="60" y="52" fontFamily="Arial, sans-serif" fontSize="14" fontStyle="italic" fontWeight="bold" fill="white">We care.</text>
      </svg>
    </div>
    <div className="flex flex-col gap-1 border-l border-white/10 pl-3 shrink-0">
      <span className="font-black tracking-tighter text-lg text-white uppercase leading-none">Spare Part</span>
      <span className="font-black tracking-tighter text-lg text-white uppercase leading-none">Form</span>
    </div>
  </div>
);

export default function App() {
  const [view, setView] = useState<'home' | 'scan' | 'form' | 'history'>('home');
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [currentPart, setCurrentPart] = useState<SparePart | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [stats, setStats] = useState({ totalParts: 0, todayTxs: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'history' | 'parts', title: string, message: string } | null>(null);

  const usbInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus USB input when in scan view
  useEffect(() => {
    if (view === 'scan' && usbInputRef.current) {
      usbInputRef.current.focus();
    }
  }, [view]);

  // Transactions & Stats Listener
  useEffect(() => {
    const q = query(collection(db, 'transactions'), orderBy('timestamp', 'desc'), limit(30));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
      
      // Calculate today's stats
      const today = new Date().setHours(0,0,0,0);
      const todayCount = txs.filter(t => t.timestamp?.toDate().getTime() > today).length;
      setStats(prev => ({ ...prev, todayTxs: todayCount }));
    });

    // Get total parts count
    getDocs(collection(db, 'spareparts')).then(snap => {
      setStats(prev => ({ ...prev, totalParts: snap.size }));
    });

    return () => unsubscribe();
  }, []);

  const executeClearHistory = async () => {
    setIsClearing(true);
    try {
      const snap = await getDocs(collection(db, 'transactions'));
      const deletes = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletes);
      setMessage({ type: 'success', text: "All history has been cleared." });
      setShowSettings(false);
      setConfirmAction(null);
    } catch (e) {
      console.error("Clear history error:", e);
      setMessage({ type: 'error', text: "Failed to clear history." });
    } finally {
      setIsClearing(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const executeClearParts = async () => {
    setIsClearing(true);
    try {
      const snap = await getDocs(collection(db, 'spareparts'));
      const deletes = snap.docs.map(d => deleteDoc(d.ref));
      await Promise.all(deletes);
      setMessage({ type: 'success', text: "All parts data has been cleared." });
      setStats(prev => ({ ...prev, totalParts: 0 }));
      setShowSettings(false);
      setConfirmAction(null);
    } catch (e) {
      console.error("Clear parts error:", e);
      setMessage({ type: 'error', text: "Failed to clear parts data." });
    } finally {
      setIsClearing(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsClearing(true);
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        // Skip header row (index 0 is title, index 1 is headers)
        // Based on image: Row 1: INVENTORY LIST, Row 2: empty, Row 3: Headers, Row 4: Data
        // Actually, looking at the image, Row 1 is "INVENTORY LIST", Row 2 is empty, Row 3 is Headers.
        // Data starts at Row 4 (index 3).
        const rows = data.slice(3);

        let importedCount = 0;
        for (const row of rows) {
          const barcode = String(row[0] || '').trim();
          const name = String(row[1] || '').trim();
          const location = String(row[2] || '').trim();
          const model = String(row[3] || '').trim();
          const vendor = String(row[4] || '').trim();

          if (barcode && name) {
            const partRef = doc(db, 'spareparts', barcode);
            // We use merge: true to avoid overwriting stock if it already exists
            await setDoc(partRef, {
              barcode,
              name,
              location,
              model,
              vendor,
              description: '',
              // Only set stock to 0 if it doesn't exist yet
            }, { merge: true });
            
            // If it's a new part, we should ensure stock is initialized
            const partSnap = await getDoc(partRef);
            if (!partSnap.exists() || partSnap.data()?.stock === undefined) {
              await updateDoc(partRef, { stock: 0 });
            }
            
            importedCount++;
          }
        }

        setMessage({ type: 'success', text: `Successfully imported ${importedCount} spare parts.` });
        const snap = await getDocs(collection(db, 'spareparts'));
        setStats(prev => ({ ...prev, totalParts: snap.size }));
        setShowSettings(false);
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error("Import error:", err);
      setMessage({ type: 'error', text: "Failed to import Excel file." });
    } finally {
      setIsClearing(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const onScanSuccess = async (decodedText: string) => {
    setScannedBarcode(decodedText);
    setView('form');
    
    const partRef = doc(db, 'spareparts', decodedText);
    const partSnap = await getDoc(partRef);
    
    if (partSnap.exists()) {
      setCurrentPart(partSnap.data() as SparePart);
    } else {
      setCurrentPart(null);
    }
  };

  const handleUsbScan = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && manualBarcode) {
      onScanSuccess(manualBarcode);
      setManualBarcode('');
    }
  };

  const handleTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scannedBarcode) return;

    setIsSubmitting(true);
    const formData = new FormData(e.currentTarget);
    const technicianName = formData.get('technicianName') as string;
    const action = 'take';
    const quantity = parseInt(formData.get('quantity') as string) || 1;
    const notes = formData.get('notes') as string;
    const partName = formData.get('name') as string || currentPart?.name;

    if (!technicianName) {
      setMessage({ type: 'error', text: "Please enter your name." });
      setIsSubmitting(false);
      return;
    }

    try {
      const partRef = doc(db, 'spareparts', scannedBarcode);
      if (!currentPart) {
        await setDoc(partRef, {
          barcode: scannedBarcode,
          name: partName,
          description: '',
          stock: 0
        });
        setStats(prev => ({ ...prev, totalParts: prev.totalParts + 1 }));
      } else {
        // Update existing stock
        const newStock = Math.max(0, (currentPart.stock || 0) - quantity);
        
        await updateDoc(partRef, { stock: newStock });
      }

      await addDoc(collection(db, 'transactions'), {
        partBarcode: scannedBarcode,
        partName: partName,
        technicianName: technicianName,
        action,
        quantity,
        notes,
        timestamp: serverTimestamp()
      });

      setMessage({ type: 'success', text: `Successfully recorded taking ${quantity}x ${partName || scannedBarcode}` });
      setView('home');
      setScannedBarcode(null);
      setCurrentPart(null);
    } catch (error) {
      console.error("Transaction failed", error);
      setMessage({ type: 'error', text: "Failed to save data. Please try again." });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-stone-300 font-sans flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-brand-border bg-brand-surface sticky top-0 h-screen">
        <div className="p-6 mb-4">
          <Logo />
        </div>
        
        <nav className="flex-1 px-4 space-y-2">
          <button 
            onClick={() => setView('home')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
              view === 'home' ? "bg-brand-accent/10 text-brand-accent" : "text-stone-500 hover:text-stone-300 hover:bg-white/5"
            )}
          >
            <Box className="w-5 h-5" />
            Dashboard
          </button>
          <button 
            onClick={() => setView('scan')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
              view === 'scan' ? "bg-brand-accent/10 text-brand-accent" : "text-stone-500 hover:text-stone-300 hover:bg-white/5"
            )}
          >
            <Scan className="w-5 h-5" />
            Scan Part
          </button>
          <button 
            onClick={() => setView('history')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
              view === 'history' ? "bg-brand-accent/10 text-brand-accent" : "text-stone-500 hover:text-stone-300 hover:bg-white/5"
            )}
          >
            <History className="w-5 h-5" />
            History
          </button>
        </nav>

        <div className="p-4 border-t border-brand-border space-y-2">
          <button 
            onClick={() => setShowSettings(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-stone-500 hover:text-stone-300 hover:bg-white/5 transition-all font-medium"
          >
            <Settings className="w-5 h-5" />
            Settings
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="bg-brand-surface/80 backdrop-blur-md border-b border-brand-border px-6 py-4 sticky top-0 z-30 flex items-center justify-between">
          <div className="lg:hidden">
            <Logo />
          </div>
          <div className="hidden lg:block relative max-w-md w-full">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-600" />
            <input 
              placeholder="Search parts, transactions..."
              className="w-full bg-brand-bg border border-brand-border rounded-xl pl-11 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-accent/50 transition-all"
            />
          </div>
          
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-brand-accent/20 rounded-xl flex items-center justify-center border border-brand-accent/20">
              <UserIcon className="w-5 h-5 text-brand-accent" />
            </div>
            <button 
              onClick={() => setShowSettings(true)}
              className="lg:hidden p-2 bg-white/5 rounded-xl text-stone-400"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8 overflow-x-hidden">
        <AnimatePresence mode="wait">
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/80 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-md glass-panel p-8 shadow-2xl"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-2xl font-black text-white uppercase tracking-tighter italic">Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 bg-white/5 rounded-xl text-stone-400 hover:text-white transition-all">
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <button 
                    onClick={() => setConfirmAction({ 
                      type: 'history', 
                      title: 'Clear History', 
                      message: 'Are you sure you want to delete all transaction logs? This cannot be undone.' 
                    })}
                    disabled={isClearing}
                    className="w-full p-5 bg-white/5 rounded-2xl flex items-center gap-4 hover:bg-white/10 transition-all border border-white/5 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center">
                      <History className="w-5 h-5 text-orange-500" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-white">Clear All History</p>
                      <p className="text-xs text-stone-500">Delete all transaction logs</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => setConfirmAction({ 
                      type: 'parts', 
                      title: 'Clear Parts Data', 
                      message: 'Are you sure you want to delete all parts? All stock and names will be lost.' 
                    })}
                    disabled={isClearing}
                    className="w-full p-5 bg-white/5 rounded-2xl flex items-center gap-4 hover:bg-white/10 transition-all border border-white/5 disabled:opacity-50"
                  >
                    <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center">
                      <Box className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-white">Clear All Parts Data</p>
                      <p className="text-xs text-stone-500">Total reset of spare parts list</p>
                    </div>
                  </button>

                  <div className="pt-4 border-t border-white/10">
                    <label className="block w-full p-5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/20 transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Plus className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="text-left">
                          <p className="font-bold text-emerald-400">Import from Excel</p>
                          <p className="text-xs text-emerald-500/70">Upload your inventory list (.xlsx)</p>
                        </div>
                      </div>
                      <input 
                        type="file" 
                        accept=".xlsx, .xls" 
                        className="hidden" 
                        onChange={handleImportExcel}
                        disabled={isClearing}
                      />
                    </label>
                  </div>
                </div>

                <button 
                  onClick={() => setShowSettings(false)}
                  className="w-full mt-8 py-4 bg-white/5 text-stone-400 rounded-2xl font-bold hover:text-white transition-all"
                >
                  Close
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {confirmAction && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/90 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-sm glass-panel p-8 text-center"
              >
                <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                  <AlertCircle className="w-8 h-8 text-red-500" />
                </div>
                <h3 className="text-xl font-black text-white mb-2 uppercase tracking-tighter italic">{confirmAction.title}</h3>
                <p className="text-stone-400 text-sm mb-8 leading-relaxed">{confirmAction.message}</p>
                
                <div className="flex flex-col gap-3">
                  <button 
                    onClick={confirmAction.type === 'history' ? executeClearHistory : executeClearParts}
                    disabled={isClearing}
                    className="w-full py-4 bg-red-500 text-white rounded-xl font-bold hover:bg-red-400 transition-all flex items-center justify-center gap-2"
                  >
                    {isClearing && <Loader2 className="w-4 h-4 animate-spin" />}
                    Confirm Delete
                  </button>
                  <button 
                    onClick={() => setConfirmAction(null)}
                    className="w-full py-4 bg-white/5 text-stone-400 rounded-xl font-bold hover:text-white transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence mode="wait">
          {message && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className={cn(
                "mb-6 p-5 rounded-2xl flex items-center gap-4 border overflow-hidden",
                message.type === 'success' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-red-500/10 text-red-400 border-red-500/20"
              )}
            >
              {message.type === 'success' ? <CheckCircle2 className="w-6 h-6 shrink-0" /> : <AlertCircle className="w-6 h-6 shrink-0" />}
              <p className="text-sm font-semibold">{message.text}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {view === 'home' && (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              {/* Stats Overview */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#1A1D23] p-6 rounded-[2rem] border border-white/5">
                  <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center mb-4">
                    <Box className="w-5 h-5 text-blue-500" />
                  </div>
                  <p className="text-stone-500 text-xs font-bold uppercase tracking-widest mb-1">Total Parts</p>
                  <p className="text-3xl font-bold text-white">{stats.totalParts}</p>
                </div>
                <div className="bg-[#1A1D23] p-6 rounded-[2rem] border border-white/5">
                  <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center mb-4">
                    <TrendingUp className="w-5 h-5 text-orange-500" />
                  </div>
                  <p className="text-stone-500 text-xs font-bold uppercase tracking-widest mb-1">Activity's Log</p>
                  <p className="text-3xl font-bold text-white">{stats.todayTxs}</p>
                </div>
              </div>

              {/* Action Grid */}
              <div className="grid grid-cols-1 gap-4">
                <button 
                  onClick={() => setView('scan')}
                  className="relative overflow-hidden bg-emerald-500 text-[#0F1115] rounded-[2rem] p-8 flex items-center justify-between group active:scale-[0.98] transition-all shadow-xl shadow-emerald-500/10"
                >
                  <div className="relative z-10">
                    <h3 className="text-2xl font-black uppercase italic leading-none mb-2">Start Scan</h3>
                    <p className="text-emerald-900/60 font-bold text-sm">Use USB Scanner or Camera</p>
                  </div>
                  <div className="w-16 h-16 bg-[#0F1115] rounded-2xl flex items-center justify-center relative z-10 group-hover:rotate-12 transition-transform">
                    <Scan className="w-8 h-8 text-emerald-500" />
                  </div>
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
                </button>
              </div>

              {/* Recent Activity Section */}
              <div className="glass-panel overflow-hidden">
                <div className="p-6 border-b border-brand-border flex items-center justify-between">
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Clock className="w-5 h-5 text-brand-accent" />
                    Recent Activity
                  </h3>
                  <button 
                    onClick={() => setView('history')} 
                    className="text-xs font-bold text-brand-accent hover:underline"
                  >
                    View All
                  </button>
                </div>
                
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/2">
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Barcode</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Technician</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Qty</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Remark</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border">
                      {transactions.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-6 py-12 text-center text-stone-600 italic">
                            No activity today
                          </td>
                        </tr>
                      ) : (
                        transactions.slice(0, 10).map((tx) => (
                          <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors group">
                            <td className="px-6 py-4 font-mono text-sm text-white font-bold">{tx.partBarcode}</td>
                            <td className="px-6 py-4 text-sm font-medium">{tx.technicianName}</td>
                            <td className="px-6 py-4 text-sm font-bold text-white">{tx.quantity || 1}</td>
                            <td className="px-6 py-4 text-xs text-stone-400 max-w-[150px] truncate" title={tx.notes}>{tx.notes || '-'}</td>
                            <td className="px-6 py-4 text-xs text-stone-500">
                              {tx.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div 
              key="scan"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-xl mx-auto space-y-8"
            >
              <div className="text-center space-y-2">
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter italic">Scan Spare Part</h2>
                <p className="text-stone-500">Position the barcode within the frame</p>
              </div>
              
              <div className="glass-panel p-4 aspect-square relative overflow-hidden">
                <Scanner onScanSuccess={onScanSuccess} />
                <div className="absolute inset-0 border-[40px] border-brand-bg/50 pointer-events-none"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-48 border-2 border-brand-accent rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.2)] pointer-events-none">
                  <div className="absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 border-brand-accent rounded-tl-lg"></div>
                  <div className="absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 border-brand-accent rounded-tr-lg"></div>
                  <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 border-brand-accent rounded-bl-lg"></div>
                  <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 border-brand-accent rounded-br-lg"></div>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-500" />
                  <input 
                    ref={usbInputRef}
                    type="text"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    onKeyDown={handleUsbScan}
                    placeholder="Or type barcode manually..."
                    className="w-full bg-brand-surface border border-brand-border rounded-2xl pl-12 pr-4 py-5 text-white font-bold outline-none focus:ring-2 focus:ring-brand-accent transition-all"
                    autoFocus
                  />
                </div>
                <button 
                  onClick={() => setView('home')}
                  className="w-full py-5 bg-white/5 text-stone-400 rounded-2xl font-bold hover:text-white transition-all"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}

          {view === 'form' && scannedBarcode && (
            <motion.div 
              key="form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('scan')} className="flex items-center gap-2 text-stone-500 hover:text-white transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                  <span className="font-bold uppercase tracking-widest text-xs">Back to Scan</span>
                </button>
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">Part Details</h2>
              </div>

              <form onSubmit={handleTransaction} className="glass-panel p-8 space-y-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-500">Barcode ID</label>
                    <div className="bg-brand-bg border border-brand-border rounded-xl px-6 py-4 text-white font-mono font-bold text-xl">
                      {scannedBarcode}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-500">Part Name</label>
                    {currentPart ? (
                      <div className="p-5 bg-brand-bg border border-brand-border rounded-xl space-y-2">
                        <p className="text-xl font-bold text-white">{currentPart.name}</p>
                        {(currentPart.location || currentPart.model || currentPart.vendor) && (
                          <div className="flex flex-wrap gap-2 pt-2 border-t border-white/5">
                            {currentPart.location && <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-stone-400 uppercase tracking-widest">Loc: {currentPart.location}</span>}
                            {currentPart.model && <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-stone-400 uppercase tracking-widest">Model: {currentPart.model}</span>}
                            {currentPart.vendor && <span className="text-[10px] bg-white/5 px-2 py-1 rounded text-stone-400 uppercase tracking-widest">Vendor: {currentPart.vendor}</span>}
                          </div>
                        )}
                      </div>
                    ) : (
                      <input 
                        name="name"
                        required
                        placeholder="Enter new part name..."
                        className="w-full input-field"
                      />
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-500">Technician Name</label>
                    <input 
                      name="technicianName"
                      required
                      placeholder="Enter your name..."
                      className="w-full input-field"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-500">Quantity</label>
                    <input 
                      type="number"
                      name="quantity"
                      required
                      min="1"
                      defaultValue="1"
                      className="w-full input-field"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black uppercase tracking-widest text-stone-500">Additional Notes</label>
                    <textarea 
                      name="notes"
                      placeholder="Example: Used for Machine A..."
                      rows={3}
                      className="w-full input-field resize-none"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full btn-primary py-5 text-lg uppercase tracking-widest italic flex items-center justify-center gap-3 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-6 h-6 animate-spin" /> : <CheckCircle2 className="w-6 h-6" />}
                  Save Transaction
                </button>
              </form>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('home')} className="flex items-center gap-2 text-stone-500 hover:text-white transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                  <span className="font-bold uppercase tracking-widest text-xs">Back to Dashboard</span>
                </button>
                <h2 className="text-2xl font-black text-white uppercase tracking-tighter italic">Transaction History</h2>
              </div>

              <div className="glass-panel overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-white/2">
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Barcode</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Technician</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Qty</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Remark</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-stone-500">Date & Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-border">
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="px-6 py-4 font-mono text-sm text-white font-bold">{tx.partBarcode}</td>
                          <td className="px-6 py-4 text-sm font-medium">{tx.technicianName}</td>
                          <td className="px-6 py-4 text-sm font-bold text-white">{tx.quantity || 1}</td>
                          <td className="px-6 py-4 text-xs text-stone-400 max-w-[200px] truncate" title={tx.notes}>{tx.notes || '-'}</td>
                          <td className="px-6 py-4 text-xs text-stone-500">
                            {tx.timestamp?.toDate().toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Bottom Navigation - Mobile Only */}
      <nav className="lg:hidden fixed bottom-6 left-6 right-6 h-20 bg-brand-surface/90 backdrop-blur-xl border border-white/10 rounded-[2.5rem] flex items-center justify-around px-4 z-40 shadow-2xl">
        <button 
          onClick={() => setView('home')} 
          className={cn(
            "flex flex-col items-center gap-1 transition-all duration-300 px-6 py-2 rounded-2xl",
            view === 'home' ? "text-brand-accent bg-brand-accent/10" : "text-stone-600 hover:text-stone-400"
          )}
        >
          <Box className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">Home</span>
        </button>
        
        <button 
          onClick={() => setView('scan')} 
          className="w-16 h-16 bg-brand-accent text-brand-bg rounded-2xl flex items-center justify-center -mt-12 shadow-xl shadow-brand-accent/30 active:scale-90 transition-all hover:scale-105"
        >
          <Scan className="w-8 h-8" />
        </button>
        
        <button 
          onClick={() => setView('history')} 
          className={cn(
            "flex flex-col items-center gap-1 transition-all duration-300 px-6 py-2 rounded-2xl",
            view === 'history' ? "text-brand-accent bg-brand-accent/10" : "text-stone-600 hover:text-stone-400"
          )}
        >
          <History className="w-6 h-6" />
          <span className="text-[10px] font-black uppercase tracking-tighter">History</span>
        </button>
      </nav>
    </div>
  </div>
);
}

// --- Scanner Component ---
function Scanner({ onScanSuccess }: { onScanSuccess: (text: string) => void }) {
  const scannerRef = useRef<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    scannerRef.current = new Html5QrcodeScanner(
      "reader",
      { 
        fps: 20, 
        qrbox: { width: 280, height: 280 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true
      },
      /* verbose= */ false
    );

    scannerRef.current.render(onScanSuccess, (error) => {});

    return () => {
      if (scannerRef.current) {
        scannerRef.current.clear().catch(err => console.error("Failed to clear scanner", err));
      }
    };
  }, [onScanSuccess]);

  return <div id="reader" className="w-full h-full"></div>;
}
