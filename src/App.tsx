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
  X,
  Camera,
  Zap,
  LayoutDashboard
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
  <div className="w-full flex items-center justify-center py-2">
    <svg viewBox="0 0 240 110" className="w-full h-auto max-h-20 drop-shadow-[0_0_8px_rgba(255,255,255,0.1)]">
      {/* SIIX Text - White as per reference */}
      <text x="10" y="75" fontFamily="'Arial Black', 'Arial', sans-serif" fontSize="85" fontWeight="900" fill="white" letterSpacing="-6">
        siix
      </text>
      {/* Light Blue Dot - Above first 'i' */}
      <circle cx="82" cy="18" r="13" fill="#72B1E1" />
      {/* Orange Dot - Below second 'i' */}
      <circle cx="128" cy="95" r="13" fill="#F58220" />
      {/* We care. Text - White, Italic, Bold */}
      <text x="145" y="105" fontFamily="Georgia, serif" fontSize="22" fontStyle="italic" fontWeight="bold" fill="white">
        W e   c a r e .
      </text>
    </svg>
  </div>
);

export default function App() {
  const [view, setView] = useState<'home' | 'scan' | 'form' | 'history'>('home');
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [currentPart, setCurrentPart] = useState<SparePart | null>(null);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [stats, setStats] = useState({ totalParts: 0, todayTxs: 0 });
  const [showSettings, setShowSettings] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'history' | 'parts', title: string, message: string } | null>(null);
  const [pendingTransaction, setPendingTransaction] = useState<{
    barcode: string;
    partName: string;
    technicianName: string;
    quantity: number;
    notes: string;
    isNewPart: boolean;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());

  // Clock Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

    // Get total parts count & parts list
    const unsubscribeParts = onSnapshot(collection(db, 'spareparts'), (snap) => {
      setStats(prev => ({ ...prev, totalParts: snap.size }));
      setParts(snap.docs.map(d => ({ id: d.id, ...d.data() } as any)));
    });

    return () => {
      unsubscribe();
      unsubscribeParts();
    };
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

  const handleTransaction = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!scannedBarcode) return;

    const formData = new FormData(e.currentTarget);
    const technicianName = formData.get('technicianName') as string;
    const quantity = parseInt(formData.get('quantity') as string) || 1;
    const notes = formData.get('notes') as string;
    const partName = (formData.get('name') as string || currentPart?.name || scannedBarcode) as string;

    if (!technicianName) {
      setMessage({ type: 'error', text: "Please enter your name." });
      return;
    }

    setPendingTransaction({
      barcode: scannedBarcode,
      partName,
      technicianName,
      quantity,
      notes,
      isNewPart: !currentPart
    });
  };

  const executeTransaction = async () => {
    if (!pendingTransaction) return;
    
    setIsSubmitting(true);
    const { barcode, partName, technicianName, quantity, notes, isNewPart } = pendingTransaction;

    try {
      const partRef = doc(db, 'spareparts', barcode);
      if (isNewPart) {
        await setDoc(partRef, {
          barcode,
          name: partName,
          description: '',
          stock: 0
        });
        setStats(prev => ({ ...prev, totalParts: prev.totalParts + 1 }));
      } else {
        // Update existing stock
        const newStock = Math.max(0, (currentPart?.stock || 0) - quantity);
        await updateDoc(partRef, { stock: newStock });
      }

      await addDoc(collection(db, 'transactions'), {
        partBarcode: barcode,
        partName,
        technicianName,
        action: 'take',
        quantity,
        notes,
        timestamp: serverTimestamp()
      });

      setMessage({ type: 'success', text: `Successfully recorded taking ${quantity}x ${partName}` });
      setView('home');
      setScannedBarcode(null);
      setCurrentPart(null);
      setPendingTransaction(null);
    } catch (error) {
      console.error("Transaction failed", error);
      setMessage({ type: 'error', text: "Failed to save data. Please try again." });
    } finally {
      setIsSubmitting(false);
      setTimeout(() => setMessage(null), 5000);
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg text-slate-300 font-sans flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-28 flex-col bg-black sticky top-0 h-screen py-8 items-center">
        <div className="flex flex-col items-center gap-12 w-full px-4">
          <Logo />
          
          <nav className="w-full flex flex-col items-center gap-4">
            <button 
              onClick={() => setView('home')}
              className={cn("sidebar-item", view === 'home' && "active")}
              title="Dashboard"
            >
              <LayoutDashboard className="w-6 h-6" />
            </button>
            
            <button 
              onClick={() => setView('scan')}
              className={cn("sidebar-item", view === 'scan' && "active")}
              title="Scan Barcode"
            >
              <Scan className="w-6 h-6" />
            </button>
            
            <button 
              onClick={() => setView('history')}
              className={cn("sidebar-item", view === 'history' && "active")}
              title="Transaction History"
            >
              <History className="w-6 h-6" />
            </button>

            <button 
              onClick={() => setShowSettings(true)}
              className="sidebar-item"
              title="Settings"
            >
              <Settings className="w-6 h-6" />
            </button>
          </nav>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="px-8 py-6 flex items-center justify-between">
          <div className="lg:hidden">
            <div className="w-24">
              <Logo />
            </div>
          </div>
          <div className="hidden lg:block">
            <h1 className="text-sm font-bold text-slate-400 uppercase tracking-[0.2em]">Spare Parts Form System</h1>
          </div>
        </header>

        <main className="flex-1 p-8 lg:p-12 overflow-y-auto relative">
          <AnimatePresence mode="wait">
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl border border-brand-border"
              >
                <div className="flex items-center justify-between mb-8">
                  <h3 className="text-xl font-bold text-slate-900">System Settings</h3>
                  <button onClick={() => setShowSettings(false)} className="p-2 hover:bg-slate-50 rounded-lg text-slate-400 hover:text-slate-900 transition-all">
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
                    className="w-full p-4 bg-slate-50 rounded-2xl flex items-center gap-4 hover:bg-slate-100 transition-all border border-brand-border disabled:opacity-50 group"
                  >
                    <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center group-hover:bg-orange-500/20 transition-colors">
                      <History className="w-5 h-5 text-orange-500" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-900 text-sm">Clear All History</p>
                      <p className="text-xs text-slate-500">Delete all transaction logs</p>
                    </div>
                  </button>

                  <button 
                    onClick={() => setConfirmAction({ 
                      type: 'parts', 
                      title: 'Clear Parts Data', 
                      message: 'Are you sure you want to delete all parts? All stock and names will be lost.' 
                    })}
                    disabled={isClearing}
                    className="w-full p-4 bg-slate-50 rounded-2xl flex items-center gap-4 hover:bg-slate-100 transition-all border border-brand-border disabled:opacity-50 group"
                  >
                    <div className="w-10 h-10 bg-red-500/10 rounded-xl flex items-center justify-center group-hover:bg-red-500/20 transition-colors">
                      <Box className="w-5 h-5 text-red-500" />
                    </div>
                    <div className="text-left">
                      <p className="font-bold text-slate-900 text-sm">Clear All Parts Data</p>
                      <p className="text-xs text-slate-500">Total reset of spare parts list</p>
                    </div>
                  </button>

                  <div className="pt-4 border-t border-brand-border">
                    <label className="block w-full p-5 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/10 transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-emerald-500/10 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Plus className="w-5 h-5 text-emerald-500" />
                        </div>
                        <div className="text-left">
                          <p className="font-bold text-emerald-600">Import from Excel</p>
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
                  className="w-full mt-8 py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold hover:text-slate-900 transition-all border border-brand-border"
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
              className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-brand-border overflow-hidden"
              >
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <AlertCircle className="w-8 h-8 text-red-500" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">{confirmAction.title}</h3>
                  <p className="text-slate-500 text-sm mb-8 leading-relaxed">{confirmAction.message}</p>
                  
                  <div className="flex flex-col gap-3">
                    <button 
                      onClick={confirmAction.type === 'history' ? executeClearHistory : executeClearParts}
                      disabled={isClearing}
                      className="w-full py-4 bg-red-500 text-white rounded-2xl font-bold hover:bg-red-600 transition-all flex items-center justify-center gap-2 shadow-lg shadow-red-500/20"
                    >
                      {isClearing && <Loader2 className="w-4 h-4 animate-spin" />}
                      Confirm Delete
                    </button>
                    <button 
                      onClick={() => setConfirmAction(null)}
                      className="w-full py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold hover:text-slate-900 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {pendingTransaction && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-md bg-white rounded-3xl shadow-2xl border border-brand-border overflow-hidden"
              >
                <div className="p-8">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-brand-accent/10 rounded-2xl flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-brand-accent" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-slate-900">Confirm Transaction</h3>
                      <p className="text-xs text-slate-500 font-medium">Please review the details below</p>
                    </div>
                  </div>

                  <div className="space-y-4 bg-slate-50 rounded-2xl p-6 mb-8 border border-brand-border">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Part Name</p>
                        <p className="text-sm font-bold text-slate-900">{pendingTransaction.partName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Quantity</p>
                        <p className="text-sm font-bold text-slate-900">{pendingTransaction.quantity} Units</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Technician</p>
                        <p className="text-sm font-bold text-slate-900">{pendingTransaction.technicianName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Barcode</p>
                        <p className="text-sm font-mono text-slate-500">{pendingTransaction.barcode}</p>
                      </div>
                    </div>
                    {pendingTransaction.notes && (
                      <div className="pt-4 border-t border-brand-border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
                        <p className="text-sm text-slate-500 italic">"{pendingTransaction.notes}"</p>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-3">
                    <button 
                      onClick={() => setPendingTransaction(null)}
                      className="flex-1 py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold hover:text-slate-900 transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={executeTransaction}
                      disabled={isSubmitting}
                      className="flex-[2] py-4 bg-brand-accent text-white rounded-2xl font-bold hover:bg-brand-accent/90 transition-all flex items-center justify-center gap-2 shadow-lg shadow-brand-accent/20"
                    >
                      {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                      Confirm & Save
                    </button>
                  </div>
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
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Left Column: Hero, Trending, Analytics */}
              <div className="lg:col-span-8 space-y-8">
                {/* Hero Section */}
                <div className="bg-white rounded-[40px] p-10 flex flex-col md:flex-row items-center justify-between relative overflow-hidden shadow-sm">
                  <div className="relative z-10 max-w-md">
                    <h2 className="text-4xl font-bold text-slate-900 mb-4 tracking-tight">Hi Engineering Team.</h2>
                    <p className="text-slate-500 text-sm leading-relaxed mb-8">
                      Please complete this spare parts form whenever you take any spare parts. Thank you for your cooperation.
                    </p>
                  </div>
                  <div className="relative mt-8 md:mt-0">
                    <img 
                      src="https://img.freepik.com/free-vector/flat-design-character-working-from-home_23-2148856693.jpg" 
                      alt="Illustration" 
                      className="w-64 h-auto rounded-3xl"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                </div>

                {/* Trending Section -> Recent Parts */}
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-900">Recent Parts</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {parts.slice(0, 3).map((part, i) => (
                      <div key={part.id} className={cn("rounded-[32px] p-6 shadow-sm flex flex-col justify-between min-h-[220px]", i === 1 ? "bg-black text-white" : "bg-white")}>
                        <div>
                          <div className="flex items-center justify-between mb-4">
                            <h4 className="font-bold truncate pr-2">{part.name}</h4>
                            <div className={cn("w-2 h-2 rounded-full", part.stock < 10 ? "bg-red-500" : "bg-green-500")}></div>
                          </div>
                          <p className={cn("text-xs leading-relaxed opacity-70 font-mono", i === 1 ? 'text-white' : 'text-slate-500')}>
                            {part.barcode}
                          </p>
                          <p className={cn("text-[10px] mt-2 font-bold uppercase tracking-widest opacity-50", i === 1 ? 'text-white' : 'text-slate-400')}>
                            Location: {part.location || 'N/A'}
                          </p>
                        </div>
                        <div className="flex items-center justify-between mt-6">
                          <div className="flex items-center gap-2">
                            <span className="text-2xl font-bold tracking-tight">{part.stock}</span>
                            <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Units</span>
                          </div>
                          <div className="flex items-center gap-1 opacity-70">
                            <TrendingUp className="w-3 h-3" />
                            <span className="text-[10px] font-bold">Active</span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {parts.length === 0 && (
                      <div className="col-span-3 py-12 text-center bg-white rounded-[32px] border border-dashed border-slate-200 text-slate-400 text-sm italic">
                        No parts registered yet.
                      </div>
                    )}
                  </div>
                </div>

                {/* Analytics Section -> Transaction Activity */}
                <div className="bg-white rounded-[40px] p-10 shadow-sm">
                  <div className="flex items-center justify-between mb-10">
                    <h3 className="text-2xl font-bold text-slate-900">Inventory Activity</h3>
                  </div>
                  <div className="h-48 w-full relative">
                    <svg viewBox="0 0 800 200" className="w-full h-full overflow-visible">
                      <defs>
                        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="black" stopOpacity="0.1" />
                          <stop offset="100%" stopColor="black" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      {/* Grid Lines */}
                      {[0, 50, 100, 150, 200].map((y) => (
                        <line key={y} x1="0" y1={y} x2="800" y2={y} stroke="#f1f5f9" strokeWidth="1" />
                      ))}
                      {/* Area Fill */}
                      <path 
                        d="M0,180 Q150,120 300,150 T600,110 T800,140 L800,200 L0,200 Z" 
                        fill="url(#chartGradient)"
                      />
                      {/* Main Line */}
                      <path 
                        d="M0,180 Q150,120 300,150 T600,110 T800,140" 
                        fill="none" 
                        stroke="black" 
                        strokeWidth="4" 
                        strokeLinecap="round"
                        className="drop-shadow-sm"
                      />
                      <circle cx="300" cy="150" r="5" fill="black" stroke="white" strokeWidth="2" />
                      <circle cx="600" cy="110" r="5" fill="black" stroke="white" strokeWidth="2" />
                      {/* Tooltip */}
                      <g transform="translate(280, 110)">
                        <rect width="40" height="24" rx="8" fill="black" />
                        <text x="20" y="16" textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{stats.todayTxs}</text>
                      </g>
                    </svg>
                  </div>
                </div>
              </div>

              {/* Right Column: Stats, Recent Activity, CTA */}
              <div className="lg:col-span-4 space-y-8">
                {/* Stats Cards */}
                <div className="bg-white rounded-[40px] p-8 space-y-4 shadow-sm">
                  {[
                    { label: 'Total Inventory', value: stats.totalParts, icon: <Box className="w-5 h-5" />, color: 'bg-slate-50' },
                    { label: 'Today Transactions', value: stats.todayTxs, icon: <ArrowRightLeft className="w-5 h-5" />, color: 'bg-slate-50' },
                    { label: 'Total Logs', value: transactions.length, icon: <History className="w-5 h-5" />, color: 'bg-slate-50' }
                  ].map((stat, i) => (
                    <div key={i} className="flex items-center justify-between p-4 rounded-3xl hover:bg-slate-50 transition-all group cursor-default">
                      <div className="flex items-center gap-4">
                        <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", stat.color)}>
                          {stat.icon}
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</p>
                          <p className="text-xl font-bold text-slate-900">{stat.value}</p>
                        </div>
                      </div>
                      <ChevronLeft className="w-5 h-5 text-slate-300 rotate-180 group-hover:text-black transition-colors" />
                    </div>
                  ))}
                </div>

                {/* Recent Activity Section */}
                <div className="bg-white rounded-[40px] p-8 shadow-sm">
                  <div className="flex items-center justify-between mb-6">
                    <h3 className="text-lg font-bold text-slate-900">Recent Activity</h3>
                  </div>
                  <div className="space-y-6">
                    {transactions.slice(0, 4).map((tx, i) => (
                      <div key={tx.id} className="flex items-center gap-4 group">
                        <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center shrink-0 group-hover:bg-black group-hover:text-white transition-all">
                          <History className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">{tx.partBarcode}</p>
                          <p className="text-[10px] text-slate-400 font-medium">{tx.technicianName} • {tx.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs font-bold text-slate-900">+{tx.quantity || 1}</p>
                        </div>
                      </div>
                    ))}
                    {transactions.length === 0 && (
                      <p className="text-center text-slate-400 text-xs italic py-4">No activity today</p>
                    )}
                  </div>
                </div>

                {/* CTA Card -> Quick Scan */}
                <div className="bg-white rounded-[40px] p-10 shadow-sm text-center relative overflow-hidden group">
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 opacity-5 group-hover:scale-110 transition-transform duration-500">
                    <Scan className="w-32 h-32" />
                  </div>
                  <div className="relative z-10">
                    <p className="text-slate-500 text-sm mb-6 px-4">
                      Ready to update stock? <span className="font-bold text-slate-900">Quick Scan</span> to record transactions.
                    </p>
                    <button 
                      onClick={() => setView('scan')}
                      className="w-full py-4 bg-black text-white rounded-2xl font-bold text-sm hover:bg-slate-800 transition-all shadow-xl shadow-black/10"
                    >
                      Open Scanner
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'scan' && (
            <motion.div 
              key="scan"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="max-w-4xl mx-auto space-y-10"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('home')} className="flex items-center gap-3 text-slate-500 hover:text-black transition-all group">
                  <div className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center group-hover:border-black bg-white shadow-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </div>
                  <span className="font-bold uppercase tracking-widest text-[10px]">Back to Dashboard</span>
                </button>
                <h2 className="text-2xl font-bold text-slate-900">Scanner <span className="text-slate-400">Active</span></h2>
              </div>

              <div className="bg-white rounded-3xl p-10 space-y-10 shadow-sm border border-brand-border">
                <div className="relative aspect-video bg-slate-50 rounded-3xl overflow-hidden border-4 border-white shadow-lg group">
                  <Scanner onScanSuccess={onScanSuccess} />
                  
                  {/* Scanner Overlay UI */}
                  <div className="absolute inset-0 pointer-events-none border-[40px] border-white/40">
                    <div className="w-full h-full border-2 border-slate-100 relative">
                      {/* Corner Accents */}
                      <div className="absolute -top-1 -left-1 w-8 h-8 border-t-4 border-l-4 border-black rounded-tl-lg"></div>
                      <div className="absolute -top-1 -right-1 w-8 h-8 border-t-4 border-r-4 border-black rounded-tr-lg"></div>
                      <div className="absolute -bottom-1 -left-1 w-8 h-8 border-b-4 border-l-4 border-black rounded-bl-lg"></div>
                      <div className="absolute -bottom-1 -right-1 w-8 h-8 border-b-4 border-r-4 border-black rounded-br-lg"></div>
                      
                      {/* Scanning Line */}
                      <motion.div 
                        animate={{ top: ['0%', '100%'] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        className="absolute left-0 right-0 h-1 bg-black shadow-[0_0_20px_rgba(0,0,0,0.2)]"
                      />
                    </div>
                  </div>

                  <div className="absolute bottom-8 left-1/2 -translate-x-1/2 px-6 py-3 bg-white/90 backdrop-blur-md rounded-full border border-brand-border flex items-center gap-3 shadow-lg">
                    <div className="w-2 h-2 rounded-full bg-black animate-pulse shadow-[0_0_10px_rgba(0,0,0,0.1)]"></div>
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-widest">System Ready: Align Barcode</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="p-6 bg-slate-50 rounded-2xl border border-brand-border space-y-2">
                    <div className="flex items-center gap-2 text-black">
                      <Camera className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">Camera Mode</span>
                    </div>
                    <p className="text-slate-500 text-sm leading-relaxed">Position the barcode within the central frame for automatic detection.</p>
                  </div>
                  <div className="p-6 bg-slate-50 rounded-2xl border border-brand-border space-y-2">
                    <div className="flex items-center gap-2 text-black">
                      <Zap className="w-4 h-4" />
                      <span className="text-xs font-bold uppercase tracking-widest">USB Scanner</span>
                    </div>
                    <p className="text-slate-500 text-sm leading-relaxed">External scanners are supported. Simply scan and the system will redirect.</p>
                  </div>
                </div>

                <div className="relative max-w-2xl mx-auto group">
                  <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-black transition-colors" />
                  <input 
                    ref={usbInputRef}
                    type="text"
                    value={manualBarcode}
                    onChange={(e) => setManualBarcode(e.target.value)}
                    onKeyDown={handleUsbScan}
                    placeholder="Or type barcode manually..."
                    className="w-full bg-slate-50 border border-brand-border rounded-2xl pl-16 pr-6 py-5 text-slate-900 font-mono font-bold text-lg outline-none focus:ring-4 focus:ring-black/5 focus:border-black transition-all placeholder:text-slate-300"
                    autoFocus
                  />
                </div>
              </div>
            </motion.div>
          )}

          {view === 'form' && scannedBarcode && (
            <motion.div 
              key="form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('scan')} className="flex items-center gap-3 text-slate-500 hover:text-black transition-all group">
                  <div className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center group-hover:border-black bg-white shadow-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </div>
                  <span className="font-bold uppercase tracking-widest text-[10px]">Back to Scan</span>
                </button>
                <div className="text-right">
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Record Transaction</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1">Update inventory stock levels in real-time</p>
                </div>
              </div>

              <div className="bg-white rounded-[32px] shadow-xl border border-brand-border overflow-hidden flex flex-col md:flex-row min-h-[600px]">
                {/* Left Side: Part Info (Black) */}
                <div className="md:w-2/5 bg-black p-10 text-white flex flex-col justify-between relative overflow-hidden">
                  <div className="relative z-10">
                    <h3 className="text-2xl font-bold mb-4">Part Information</h3>
                    <p className="text-white/70 text-sm leading-relaxed mb-10">
                      Review the scanned part details before recording the transaction. Ensure all data is accurate.
                    </p>

                    <div className="space-y-8">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                          <Scan className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Barcode ID</p>
                          <p className="text-xl font-mono font-bold tracking-tight">{scannedBarcode}</p>
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                          <Package className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Current Stock</p>
                          <p className="text-xl font-bold tracking-tight">{currentPart?.stock || 0} Units</p>
                        </div>
                      </div>

                      {currentPart?.location && (
                        <div className="flex items-start gap-4">
                          <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                            <Box className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Location</p>
                            <p className="text-xl font-bold tracking-tight">{currentPart.location}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Decorative Circle */}
                  <div className="absolute -bottom-20 -right-20 w-64 h-64 bg-white/5 rounded-full blur-3xl"></div>
                </div>

                {/* Right Side: Form (White) */}
                <form onSubmit={handleTransaction} className="md:w-3/5 p-10 md:p-12 space-y-10 bg-white">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Part Name</label>
                      {currentPart ? (
                        <div className="py-3 border-b-2 border-slate-100">
                          <p className="text-xl font-bold text-slate-900">{currentPart.name}</p>
                        </div>
                      ) : (
                        <input 
                          name="name"
                          required
                          placeholder="John Trangely"
                          className="input-field w-full text-xl"
                        />
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Technician Name</label>
                      <input 
                        name="technicianName"
                        required
                        placeholder="Your Name"
                        className="input-field w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Quantity</label>
                      <input 
                        type="number"
                        name="quantity"
                        required
                        min="1"
                        defaultValue="1"
                        className="input-field w-full"
                      />
                    </div>

                    <div className="space-y-2 md:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Additional Notes</label>
                      <textarea 
                        name="notes"
                        placeholder="Write here your message"
                        rows={3}
                        className="input-field w-full resize-none"
                      />
                    </div>
                  </div>

                  <div className="pt-6">
                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="btn-primary w-full md:w-auto min-w-[200px] flex items-center justify-center gap-3"
                    >
                      {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRightLeft className="w-5 h-5" />}
                      Record Transaction
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          )}

          {view === 'history' && (
            <motion.div 
              key="history"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('home')} className="flex items-center gap-3 text-slate-500 hover:text-black transition-all group">
                  <div className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center group-hover:border-black bg-white shadow-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </div>
                  <span className="font-bold uppercase tracking-wider text-[10px]">Back to Dashboard</span>
                </button>
                <h2 className="text-2xl font-bold text-slate-900">Transaction History</h2>
              </div>

              <div className="bg-white rounded-3xl border border-brand-border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-brand-border">
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Part Info</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Technician</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest text-center">Qty</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Remarks</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map((tx) => (
                        <tr key={tx.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-8 py-5">
                            <div className="flex flex-col">
                              <span className="text-slate-900 font-bold text-sm">{tx.timestamp?.toDate().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                              <span className="text-slate-400 font-mono text-[10px]">{tx.timestamp?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex flex-col gap-1">
                              <span className="text-slate-900 font-bold group-hover:text-black transition-colors">{tx.partName}</span>
                              <span className="text-slate-400 font-mono text-[10px]">{tx.partBarcode}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-black font-bold text-[10px] border border-brand-border">
                                {tx.technicianName.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-slate-600 font-medium text-sm">{tx.technicianName}</span>
                            </div>
                          </td>
                          <td className="px-8 py-5 text-center">
                            <span className="inline-flex items-center justify-center px-3 py-1 rounded-lg bg-slate-100 text-slate-900 font-bold text-xs border border-slate-200">
                              {tx.quantity || 1}
                            </span>
                          </td>
                          <td className="px-8 py-5">
                            <div className="max-w-xs">
                              <p className="text-slate-500 text-xs line-clamp-2 leading-relaxed">
                                {tx.notes || <span className="text-slate-300 italic">No remarks</span>}
                              </p>
                            </div>
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

      {/* System Status Bar - Desktop Only */}
      <div className="hidden lg:flex fixed bottom-0 left-24 right-0 h-10 bg-white/80 backdrop-blur-md border-t border-brand-border items-center justify-between px-8 z-30 shadow-sm">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.3)]"></div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">System Operational</span>
          </div>
          <div className="h-3 w-[1px] bg-brand-border"></div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Database:</span>
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Cloud Firestore</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Clock className="w-3 h-3 text-slate-400" />
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest font-mono">
              {currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Navigation - Mobile Only */}
      <nav className="lg:hidden fixed bottom-6 left-6 right-6 h-16 bg-white/90 backdrop-blur-xl border border-brand-border rounded-2xl flex items-center justify-around px-4 z-40 shadow-xl">
        <button 
          onClick={() => setView('home')} 
          className={cn(
            "flex flex-col items-center gap-1 transition-all duration-300 px-4 py-1.5 rounded-xl",
            view === 'home' ? "text-black bg-slate-100" : "text-slate-400"
          )}
        >
          <LayoutDashboard className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Home</span>
        </button>
        
        <button 
          onClick={() => setView('scan')} 
          className="w-14 h-14 bg-black text-white rounded-2xl flex items-center justify-center -mt-10 shadow-lg shadow-black/30 active:scale-95 transition-all hover:scale-105"
        >
          <Scan className="w-7 h-7" />
        </button>
        
        <button 
          onClick={() => setView('history')} 
          className={cn(
            "flex flex-col items-center gap-1 transition-all duration-300 px-4 py-1.5 rounded-xl",
            view === 'history' ? "text-black bg-slate-100" : "text-slate-400"
          )}
        >
          <History className="w-5 h-5" />
          <span className="text-[9px] font-bold uppercase tracking-widest">Logs</span>
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
