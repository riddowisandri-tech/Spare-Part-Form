// Spare Parts Form System - Updated Workflow: Team Selection -> Form with Integrated Scanner
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
import { Html5QrcodeScanner, Html5Qrcode } from 'html5-qrcode';
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
  Cpu,
  LayoutDashboard,
  Download
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
  team?: string;
}

interface Transaction {
  id: string;
  partBarcode: string;
  technicianName: string;
  team: string;
  action: 'take' | 'return';
  quantity: number;
  notes: string;
  timestamp: any;
}

// --- Constants ---
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const YEARS = Array.from({ length: 5 }, (_, i) => (new Date().getFullYear() - i).toString());

// --- Components ---

const Logo = ({ dark = false }: { dark?: boolean }) => {
  const gradientId = dark ? "siixGradientDark" : "siixGradientLight";
  return (
    <div className="w-full flex items-center justify-center py-2">
      <svg viewBox="0 0 240 150" className="w-full h-auto max-h-24 overflow-visible drop-shadow-lg">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={dark ? "#1e293b" : "#FFFFFF"} />
            <stop offset="50%" stopColor="#72B1E1" />
            <stop offset="100%" stopColor="#F58220" />
            <animate attributeName="x1" values="0%;100%;0%" dur="6s" repeatCount="indefinite" />
            <animate attributeName="x2" values="100%;0%;100%" dur="6s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        {/* 's' */}
        <text x="10" y="85" fontFamily="'Arial Black', 'Arial', sans-serif" fontSize="90" fontWeight="900" fill={`url(#${gradientId})`}>s</text>
        
        {/* First 'i' */}
        <rect x="65" y="40" width="18" height="45" fill="white" stroke={dark ? "#e2e8f0" : "none"} strokeWidth="1" />
        <circle cx="74" cy="20" r="14" fill="#72B1E1" />
        
        {/* Second 'i' */}
        <rect x="95" y="40" width="18" height="45" fill="white" stroke={dark ? "#e2e8f0" : "none"} strokeWidth="1" />
        <circle cx="104" cy="105" r="14" fill="#F58220" />
        
        {/* 'x' */}
        <text x="125" y="85" fontFamily="'Arial Black', 'Arial', sans-serif" fontSize="90" fontWeight="900" fill={`url(#${gradientId})`}>x</text>
        
        {/* "We care." - Full tagline with proper spacing and visibility */}
        <text x="110" y="130" fontFamily="'Libre Baskerville', serif" fontSize="28" fontStyle="italic" fontWeight="bold" fill={dark ? "#475569" : "white"}>
          We care.
        </text>
      </svg>
    </div>
  );
};

export default function App() {
  const [view, setView] = useState<'home' | 'scan' | 'form' | 'history' | 'team-select'>('home');
  const [selectedScanTeam, setSelectedScanTeam] = useState<'FCT' | 'TESTER' | 'AUTOMATION' | null>(null);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const [currentPart, setCurrentPart] = useState<SparePart | null>(null);
  const [parts, setParts] = useState<SparePart[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const [stats, setStats] = useState({ 
    totalParts: 0, 
    todayTxs: 0,
    fctParts: 0,
    testerParts: 0,
    automationParts: 0
  });
  const [dashboardTeamTab, setDashboardTeamTab] = useState<'ALL' | 'FCT' | 'TESTER' | 'AUTOMATION'>('ALL');
  const [filterMonth, setFilterMonth] = useState<string>(new Date().toLocaleString('default', { month: 'long' }));
  const [filterYear, setFilterYear] = useState<string>(new Date().getFullYear().toString());
  const [showSettings, setShowSettings] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [confirmAction, setConfirmAction] = useState<{ type: 'history' | 'parts', title: string, message: string } | null>(null);
  const [pendingTransaction, setPendingTransaction] = useState<{
    barcode: string;
    partName: string;
    technicianName: string;
    team: string;
    quantity: number;
    notes: string;
    isNewPart: boolean;
    location?: string;
    model?: string;
    vendor?: string;
  } | null>(null);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [adminPassword, setAdminPassword] = useState('');
  const [passwordError, setPasswordError] = useState(false);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState<{
    action: () => void;
    title: string;
  } | null>(null);

  const ADMIN_PASSWORD = "lego";

  const handleAdminAction = (title: string, action: () => void) => {
    setShowPasswordPrompt({ title, action });
  };

  const verifyPassword = () => {
    if (adminPassword === ADMIN_PASSWORD) {
      const action = showPasswordPrompt?.action;
      setShowPasswordPrompt(null);
      setAdminPassword('');
      setPasswordError(false);
      if (action) action();
    } else {
      setPasswordError(true);
      setMessage({ type: 'error', text: "Incorrect password!" });
      setTimeout(() => {
        setMessage(null);
        setPasswordError(false);
      }, 3000);
    }
  };

  // Reset camera state when leaving scan view
  useEffect(() => {
    if (view !== 'scan') {
      setIsCameraActive(false);
    }
  }, [view]);

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
      const partsList = snap.docs.map(d => ({ ...d.data() } as SparePart));
      setParts(partsList);
      
      const fct = partsList.filter(p => !p.team || p.team === 'FCT').length;
      const tester = partsList.filter(p => p.team === 'TESTER').length;
      const automation = partsList.filter(p => p.team === 'AUTOMATION').length;
      
      setStats(prev => ({ 
        ...prev, 
        totalParts: snap.size,
        fctParts: fct,
        testerParts: tester,
        automationParts: automation
      }));
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

    setIsImporting(true);
    setImportProgress({ current: 0, total: 0 });
    try {
      const reader = new FileReader();
      reader.onload = async (evt) => {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];

        const rows = data.slice(3);
        const uniqueBarcodes = new Set<string>();
        const validRows = rows.filter(row => String(row[0] || '').trim() && String(row[1] || '').trim());
        
        setImportProgress({ current: 0, total: validRows.length });

        let processed = 0;
        for (const row of validRows) {
          const barcode = String(row[0] || '').trim();
          const name = String(row[1] || '').trim();
          const location = String(row[2] || '').trim();
          const model = String(row[3] || '').trim();
          const vendor = String(row[4] || '').trim();

          uniqueBarcodes.add(barcode);
          const partRef = doc(db, 'spareparts', barcode);
          
          await setDoc(partRef, {
            barcode,
            name,
            location,
            model,
            vendor,
            description: '',
          }, { merge: true });

          const partSnap = await getDoc(partRef);
          if (!partSnap.exists() || partSnap.data()?.stock === undefined) {
            await updateDoc(partRef, { stock: 0 });
          }

          processed++;
          setImportProgress(prev => ({ ...prev, current: processed }));
        }

        const finalCount = uniqueBarcodes.size;
        setMessage({ type: 'success', text: `Successfully imported ${finalCount} unique spare parts.` });
        
        const snap = await getDocs(collection(db, 'spareparts'));
        setStats(prev => ({ ...prev, totalParts: snap.size }));
        setShowSettings(false);
        setIsImporting(false);
      };
      reader.readAsBinaryString(file);
    } catch (err) {
      console.error("Import error:", err);
      setMessage({ type: 'error', text: "Failed to import Excel file." });
      setIsImporting(false);
    } finally {
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const exportToExcel = () => {
    try {
      if (transactions.length === 0) {
        setMessage({ type: 'error', text: "No transaction history to export." });
        return;
      }

      const dataToExport = transactions.map(tx => ({
        'Date': tx.timestamp?.toDate().toLocaleDateString('en-GB'),
        'Time': tx.timestamp?.toDate().toLocaleTimeString(),
        'Part Name': tx.partName,
        'Barcode': tx.partBarcode,
        'Name': tx.technicianName,
        'Team': tx.team || '-',
        'Action': tx.action === 'take' ? 'Taken' : 'Returned',
        'Quantity': tx.quantity,
        'Notes': tx.notes || '-'
      }));

      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "History");
      
      const dateStr = new Date().toISOString().split('T')[0];
      XLSX.writeFile(wb, `SpareParts_History_${dateStr}.xlsx`);
      
      setMessage({ type: 'success', text: "History exported successfully!" });
    } catch (error) {
      console.error("Export error:", error);
      setMessage({ type: 'error', text: "Failed to export history." });
    } finally {
      setTimeout(() => setMessage(null), 3000);
    }
  };

  const onScanSuccess = async (decodedText: string) => {
    const partRef = doc(db, 'spareparts', decodedText);
    const partSnap = await getDoc(partRef);
    
    if (partSnap.exists()) {
      const partData = partSnap.data() as SparePart;
      // Check if team matches
      if (partData.team && partData.team !== selectedScanTeam) {
        setMessage({ 
          type: 'error', 
          text: `This part is registered for ${partData.team} Team. Please select the correct team.` 
        });
        setTimeout(() => setMessage(null), 5000);
        return;
      }
      setCurrentPart(partData);
    } else {
      setCurrentPart(null);
    }

    setScannedBarcode(decodedText);
    setView('form');
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
    const team = formData.get('team') as string;
    const quantity = parseInt(formData.get('quantity') as string) || 1;
    const notes = formData.get('notes') as string;
    const partName = (formData.get('name') as string || currentPart?.name || scannedBarcode) as string;
    const location = formData.get('location') as string || currentPart?.location || '';
    const model = formData.get('model') as string || currentPart?.model || '';
    const vendor = formData.get('vendor') as string || currentPart?.vendor || '';

    if (!technicianName) {
      setMessage({ type: 'error', text: "Please enter your name." });
      return;
    }

    if (!team) {
      setMessage({ type: 'error', text: "Please select your team." });
      return;
    }

    setPendingTransaction({
      barcode: scannedBarcode,
      partName,
      technicianName,
      team,
      quantity,
      notes,
      isNewPart: !currentPart,
      location,
      model,
      vendor
    });
  };

  const executeTransaction = async () => {
    if (!pendingTransaction) return;
    
    setIsSubmitting(true);
    const { barcode, partName, technicianName, team, quantity, notes, isNewPart, location, model, vendor } = pendingTransaction;

    try {
      const partRef = doc(db, 'spareparts', barcode);
      if (isNewPart) {
        await setDoc(partRef, {
          barcode,
          name: partName,
          location: location || '',
          model: model || '',
          vendor: vendor || '',
          description: '',
          stock: 0,
          team: team // Associate new part with the team that first takes it
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
        team,
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

  const filteredTransactions = transactions.filter(tx => {
    const date = tx.timestamp?.toDate();
    if (!date) return false;
    
    const monthMatch = date.toLocaleString('default', { month: 'long' }) === filterMonth;
    const yearMatch = date.getFullYear().toString() === filterYear;
    const teamMatch = dashboardTeamTab === 'ALL' || tx.team === dashboardTeamTab;
    
    return monthMatch && yearMatch && teamMatch;
  });

  return (
    <div className="min-h-screen bg-brand-bg text-slate-300 font-sans flex">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-28 flex-col bg-black sticky top-0 h-screen py-8 overflow-visible z-20">
        <div className="flex flex-col items-center gap-12 w-full overflow-visible">
          <div className="w-full px-2 transition-transform duration-500 hover:scale-110">
            <Logo />
          </div>
          
          <nav className="w-full flex flex-col items-end overflow-visible">
            <button 
              onClick={() => setView('home')}
              className={cn("sidebar-item", view === 'home' && "active")}
              title="Dashboard"
            >
              <LayoutDashboard className="w-6 h-6 relative z-10" />
            </button>
            
            <button 
              onClick={() => setView('team-select')}
              className={cn("sidebar-item", (view === 'scan' || view === 'team-select') && "active")}
              title="Scan Barcode"
            >
              <Scan className="w-6 h-6 relative z-10" />
            </button>
            
            <button 
              onClick={() => setView('history')}
              className={cn("sidebar-item", view === 'history' && "active")}
              title="Transaction History"
            >
              <History className="w-6 h-6 relative z-10" />
            </button>

            <button 
              onClick={() => setShowSettings(true)}
              className="sidebar-item"
              title="Settings"
            >
              <Settings className="w-6 h-6 relative z-10" />
            </button>
          </nav>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="px-6 py-6 flex flex-col md:flex-row items-center md:justify-between gap-4">
          <div className="lg:hidden w-32 md:w-40">
            <Logo dark={true} />
          </div>
          <div className="text-center md:text-left">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-serif font-black tracking-tighter bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent drop-shadow-2xl leading-tight">
              Spare Parts Form System
            </h1>
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
                    onClick={() => handleAdminAction('Clear History', () => setConfirmAction({ 
                      type: 'history', 
                      title: 'Clear History', 
                      message: 'Are you sure you want to delete all transaction logs? This cannot be undone.' 
                    }))}
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
                    onClick={() => handleAdminAction('Clear Parts Data', () => setConfirmAction({ 
                      type: 'parts', 
                      title: 'Clear Parts Data', 
                      message: 'Are you sure you want to delete all parts? All stock and names will be lost.' 
                    }))}
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
                    <div 
                      onClick={() => handleAdminAction('Import Data', () => {
                        const input = document.getElementById('excel-import-input');
                        if (input) input.click();
                      })}
                      className="block w-full p-5 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 cursor-pointer hover:bg-emerald-500/10 transition-all group"
                    >
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
                        id="excel-import-input"
                        type="file" 
                        accept=".xlsx, .xls" 
                        className="hidden" 
                        onChange={handleImportExcel}
                        disabled={isClearing}
                      />
                    </div>
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
          {showPasswordPrompt && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[80] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-sm"
            >
              <motion.div 
                initial={{ scale: 0.95, y: 10 }}
                animate={passwordError ? { 
                  x: [0, -10, 10, -10, 10, 0],
                  scale: 1, 
                  y: 0 
                } : { 
                  scale: 1, 
                  y: 0 
                }}
                transition={passwordError ? { duration: 0.4 } : {}}
                className="w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-brand-border overflow-hidden"
              >
                <div className="p-8 text-center">
                  <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Settings className="w-8 h-8 text-slate-900" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-900 mb-2">Admin Access</h3>
                  <p className="text-slate-500 text-sm mb-8 leading-relaxed">Please enter the admin password to proceed with <strong>{showPasswordPrompt.title}</strong>.</p>
                  
                  <div className="space-y-4">
                    <div className="relative">
                      <input 
                        type="password"
                        value={adminPassword}
                        onChange={(e) => {
                          setAdminPassword(e.target.value);
                          if (passwordError) setPasswordError(false);
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && verifyPassword()}
                        placeholder="Enter Password"
                        autoFocus
                        className={cn(
                          "input-field w-full text-center transition-all",
                          passwordError && "border-red-500 bg-red-50 text-red-900 placeholder:text-red-300"
                        )}
                      />
                      {passwordError && (
                        <motion.p 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-[10px] font-bold text-red-500 uppercase tracking-widest mt-2"
                        >
                          Incorrect Password
                        </motion.p>
                      )}
                    </div>
                    
                    <div className="flex flex-col gap-3">
                      <button 
                        onClick={verifyPassword}
                        className={cn(
                          "w-full py-4 rounded-2xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg",
                          passwordError 
                            ? "bg-red-500 text-white shadow-red-500/20" 
                            : "bg-black text-white shadow-black/20 hover:bg-slate-800"
                        )}
                      >
                        {passwordError ? "Try Again" : "Verify & Continue"}
                      </button>
                      <button 
                        onClick={() => {
                          setShowPasswordPrompt(null);
                          setAdminPassword('');
                        }}
                        className="w-full py-4 bg-slate-50 text-slate-500 rounded-2xl font-bold hover:text-slate-900 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isImporting && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center border border-brand-border"
              >
                <div className="relative w-24 h-24 mx-auto mb-8">
                  <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                  <svg className="absolute inset-0 w-full h-full -rotate-90">
                    <circle
                      cx="48"
                      cy="48"
                      r="44"
                      fill="none"
                      stroke="black"
                      strokeWidth="8"
                      strokeDasharray={276}
                      strokeDashoffset={276 - (276 * (importProgress.current / (importProgress.total || 1)))}
                      strokeLinecap="round"
                      className="transition-all duration-300"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Loader2 className="w-8 h-8 animate-spin text-black opacity-20" />
                  </div>
                </div>
                
                <h3 className="text-2xl font-serif font-black tracking-tight text-slate-900 mb-2">Importing Data...</h3>
                <p className="text-slate-500 text-sm mb-6">Processing your Excel file</p>
                
                <div className="bg-slate-50 rounded-2xl p-4 border border-brand-border">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Progress</span>
                    <span className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">
                      {importProgress.current} / {importProgress.total}
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <motion.div 
                      initial={{ width: 0 }}
                      animate={{ width: `${(importProgress.current / (importProgress.total || 1)) * 100}%` }}
                      className="h-full bg-black"
                    />
                  </div>
                </div>
                <p className="mt-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Please do not close this window</p>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isClearing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-slate-900/60 backdrop-blur-md"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="w-full max-w-sm bg-white rounded-[40px] p-10 shadow-2xl text-center border border-brand-border"
              >
                <div className="relative w-24 h-24 mx-auto mb-8 flex items-center justify-center">
                  <div className="absolute inset-0 border-4 border-slate-100 rounded-full"></div>
                  <Loader2 className="w-10 h-10 animate-spin text-black" />
                </div>
                
                <h3 className="text-2xl font-serif font-black tracking-tight text-slate-900 mb-2">Clearing Data...</h3>
                <p className="text-slate-500 text-sm mb-6">Wiping records from database</p>
                
                <div className="bg-slate-50 rounded-2xl p-4 border border-brand-border flex items-center justify-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-black animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-2 h-2 rounded-full bg-black animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-2 h-2 rounded-full bg-black animate-bounce"></div>
                </div>
                <p className="mt-6 text-[10px] font-bold text-slate-400 uppercase tracking-widest animate-pulse">Please wait a moment</p>
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
                      <h3 className="text-2xl font-serif font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent">Confirm Transaction</h3>
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
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Name</p>
                        <p className="text-sm font-bold text-slate-900">{pendingTransaction.technicianName}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Team</p>
                        <p className="text-sm font-bold text-slate-900">{pendingTransaction.team}</p>
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
              className="space-y-8"
            >
              {/* Header Section */}
              <div className="flex items-center justify-between">
                <h2 className="text-5xl font-serif font-black tracking-tighter bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent">Dashboard</h2>
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setView('team-select')}
                    className="px-6 py-3 bg-black text-white rounded-2xl font-bold text-xs hover:bg-slate-800 transition-all shadow-xl shadow-black/10 flex items-center gap-2"
                  >
                    <Scan className="w-4 h-4" />
                    Create Transaction
                  </button>
                </div>
              </div>

              {/* Summary Cards Section */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                  { label: 'FCT Team Parts', value: stats.fctParts, icon: <Cpu className="w-6 h-6" />, color: 'bg-blue-500' },
                  { label: 'Tester Team Parts', value: stats.testerParts, icon: <Zap className="w-6 h-6" />, color: 'bg-emerald-500' },
                  { label: 'Automation Team Parts', value: stats.automationParts, icon: <Box className="w-6 h-6" />, color: 'bg-orange-500' }
                ].map((stat, i) => (
                  <div key={i} className="bg-white rounded-[40px] p-8 shadow-sm border border-brand-border hover:shadow-md transition-all group">
                    <div className="flex items-center justify-between mb-6">
                      <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center text-white shadow-lg", stat.color)}>
                        {stat.icon}
                      </div>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{stat.label}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <p className="text-5xl font-black tracking-tighter text-slate-900">{stat.value.toLocaleString()}</p>
                      <span className="text-slate-400 font-bold text-sm">Parts</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Active Filters Section */}
              <div className="bg-white rounded-[40px] p-8 shadow-sm border border-brand-border">
                <div className="flex items-center gap-2 mb-6">
                  <h3 className="text-sm font-bold text-slate-900">Active filters</h3>
                  <div className="w-4 h-4 bg-slate-100 rounded-full flex items-center justify-center text-[10px] text-slate-400 font-bold">i</div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="relative group">
                    <select 
                      value={filterMonth}
                      onChange={(e) => setFilterMonth(e.target.value)}
                      className="w-full h-14 pl-6 pr-10 bg-slate-50 border border-slate-100 rounded-2xl appearance-none font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                    >
                      {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  <div className="relative group">
                    <select 
                      value={filterYear}
                      onChange={(e) => setFilterYear(e.target.value)}
                      className="w-full h-14 pl-6 pr-10 bg-slate-50 border border-slate-100 rounded-2xl appearance-none font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                    >
                      {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
                    </select>
                    <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  </div>
                  <div className="md:col-span-2 relative">
                    <input 
                      type="text"
                      placeholder="Search transactions..."
                      className="w-full h-14 pl-12 pr-6 bg-slate-50 border border-slate-100 rounded-2xl font-bold text-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-black/5 transition-all"
                    />
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                  </div>
                </div>
              </div>

              {/* Recent Activity Section */}
              <div className="bg-white rounded-[40px] shadow-sm border border-brand-border overflow-hidden">
                <div className="p-8 border-b border-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {['ALL', 'FCT', 'TESTER', 'AUTOMATION'].map((tab) => (
                      <button 
                        key={tab}
                        onClick={() => setDashboardTeamTab(tab as any)}
                        className={cn(
                          "px-6 py-2.5 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                          dashboardTeamTab === tab 
                            ? "bg-black text-white shadow-lg shadow-black/10" 
                            : "text-slate-400 hover:text-slate-900 hover:bg-slate-50"
                        )}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400">
                      <LayoutDashboard className="w-4 h-4" />
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center text-slate-400">
                      <Settings className="w-4 h-4" />
                    </div>
                  </div>
                </div>

                <div className="p-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
                  {/* List View */}
                  <div className="lg:col-span-4 space-y-4">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-widest mb-6">Recent Activity</h4>
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                      {filteredTransactions.map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 transition-all group cursor-pointer border border-transparent hover:border-slate-100">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-900 font-bold text-xs uppercase">
                              {tx.technicianName.charAt(0)}
                            </div>
                            <div>
                              <p className="text-sm font-bold text-slate-900">#{tx.partBarcode.slice(-6)}</p>
                              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{tx.timestamp?.toDate().toLocaleDateString([], { day: 'numeric', month: 'short' })}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-black text-slate-900">{tx.quantity} Units</p>
                            <span className={cn(
                              "text-[8px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-md",
                              tx.team === 'FCT' ? "bg-blue-50 text-blue-600" :
                              tx.team === 'TESTER' ? "bg-emerald-50 text-emerald-600" :
                              "bg-orange-50 text-orange-600"
                            )}>
                              {tx.team}
                            </span>
                          </div>
                        </div>
                      ))}
                      {filteredTransactions.length === 0 && (
                        <div className="py-12 text-center text-slate-400 text-xs italic">
                          No activity for this period.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Detail View (Mocked from image style) */}
                  <div className="lg:col-span-8 bg-slate-900 rounded-[32px] p-10 text-white relative overflow-hidden">
                    <div className="relative z-10">
                      <div className="flex items-center justify-between mb-12">
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Transaction Details</p>
                          <h3 className="text-4xl font-serif font-black tracking-tighter">
                            {filteredTransactions[0] ? `#${filteredTransactions[0].partBarcode}` : 'No Data'}
                          </h3>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Team</p>
                          <p className="text-2xl font-serif font-black">{filteredTransactions[0]?.team || '-'}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-8 mb-12">
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Technician</p>
                          <p className="text-lg font-bold">{filteredTransactions[0]?.technicianName || '-'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Quantity</p>
                          <p className="text-lg font-bold">{filteredTransactions[0]?.quantity || 0} Units</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Date</p>
                          <p className="text-lg font-bold">{filteredTransactions[0]?.timestamp?.toDate().toLocaleDateString() || '-'}</p>
                        </div>
                      </div>

                      <div className="pt-10 border-t border-white/10 flex items-center justify-between">
                        <div>
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Part Name</p>
                          <p className="text-xl font-bold">{filteredTransactions[0]?.partName || '-'}</p>
                        </div>
                        <button className="px-8 py-4 bg-brand-accent text-white rounded-2xl font-bold text-xs hover:bg-brand-accent/90 transition-all shadow-lg shadow-brand-accent/20">
                          View Part Details
                        </button>
                      </div>
                    </div>
                    {/* Decorative background */}
                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {view === 'team-select' && (
            <motion.div 
              key="team-select"
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
                <h2 className="text-3xl font-serif font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent">Select <span className="text-slate-400">Team</span></h2>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                  { name: 'FCT', icon: <Cpu className="w-8 h-8" />, color: 'bg-blue-500', desc: 'Functional Circuit Tester' },
                  { name: 'TESTER', icon: <Zap className="w-8 h-8" />, color: 'bg-emerald-500', desc: 'Tester Equipment' },
                  { name: 'AUTOMATION', icon: <Box className="w-8 h-8" />, color: 'bg-orange-500', desc: 'Automation Systems' }
                ].map((team) => (
                  <button 
                    key={team.name}
                    onClick={() => {
                      setSelectedScanTeam(team.name as any);
                      setScannedBarcode(null);
                      setCurrentPart(null);
                      setView('form');
                      setIsCameraActive(true);
                    }}
                    className="bg-white rounded-[40px] p-10 shadow-sm border border-brand-border hover:shadow-xl hover:-translate-y-2 transition-all group text-center"
                  >
                    <div className={cn("w-20 h-20 rounded-3xl flex items-center justify-center text-white shadow-lg mx-auto mb-6 transition-transform group-hover:scale-110", team.color)}>
                      {team.icon}
                    </div>
                    <h3 className="text-2xl font-black tracking-tighter text-slate-900 mb-2">{team.name}</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">{team.desc}</p>
                    <div className="w-full py-3 bg-slate-50 rounded-xl text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:bg-black group-hover:text-white transition-all">
                      Select Team
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'form' && (
            <motion.div 
              key="form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-5xl mx-auto space-y-8"
            >
              <div className="flex items-center justify-between">
                <button onClick={() => setView('team-select')} className="flex items-center gap-3 text-slate-500 hover:text-black transition-all group">
                  <div className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center group-hover:border-black bg-white shadow-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </div>
                  <span className="font-bold uppercase tracking-widest text-[10px]">Change Team</span>
                </button>
                <div className="text-right">
                  <h2 className="text-3xl font-serif font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent">Record Transaction</h2>
                  <p className="text-xs text-slate-400 font-medium mt-1">Update inventory stock levels for <span className="text-black font-bold uppercase">{selectedScanTeam} Team</span></p>
                </div>
              </div>

              <div className="bg-white rounded-[32px] shadow-xl border border-brand-border overflow-hidden flex flex-col md:flex-row min-h-[600px]">
                {/* Left Side: Scanner & Part Info (Black) */}
                <div className="md:w-2/5 bg-black p-10 text-white flex flex-col justify-between relative overflow-hidden">
                  <div className="relative z-10 space-y-8">
                    <div>
                      <h3 className="text-2xl font-serif font-black tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent mb-4">Scanner</h3>
                      <div className="relative aspect-video bg-white/5 rounded-2xl overflow-hidden border border-white/10 group">
                        {isCameraActive ? (
                          <Scanner onScanSuccess={onScanSuccess} />
                        ) : (
                          <div className="w-full h-full flex flex-col items-center justify-center text-white/30 gap-4">
                            <Camera className="w-10 h-10" />
                            <p className="text-[10px] font-bold uppercase tracking-widest">Camera Inactive</p>
                          </div>
                        )}
                        {isCameraActive && (
                          <div className="absolute inset-0 pointer-events-none border-[20px] border-black/40">
                            <div className="w-full h-full border border-white/20 relative">
                              <div className="absolute -top-1 -left-1 w-4 h-4 border-t-2 border-l-2 border-brand-accent"></div>
                              <div className="absolute -top-1 -right-1 w-4 h-4 border-t-2 border-r-2 border-brand-accent"></div>
                              <div className="absolute -bottom-1 -left-1 w-4 h-4 border-b-2 border-l-2 border-brand-accent"></div>
                              <div className="absolute -bottom-1 -right-1 w-4 h-4 border-b-2 border-r-2 border-brand-accent"></div>
                            </div>
                          </div>
                        )}
                      </div>
                      <button 
                        onClick={() => setIsCameraActive(!isCameraActive)}
                        className="mt-4 w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-2"
                      >
                        <Camera className="w-3 h-3" />
                        {isCameraActive ? "Deactivate Camera" : "Activate Camera"}
                      </button>
                    </div>

                    <div className="space-y-8 pt-4 border-t border-white/10">
                      <div className="flex items-start gap-4">
                        <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                          <Scan className="w-5 h-5" />
                        </div>
                        <div className="flex-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Barcode ID</p>
                          <div className="relative group">
                            <input 
                              ref={usbInputRef}
                              type="text"
                              value={manualBarcode}
                              onChange={(e) => setManualBarcode(e.target.value)}
                              onKeyDown={handleUsbScan}
                              placeholder="Scan or type barcode..."
                              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white font-mono font-bold text-sm outline-none focus:border-brand-accent transition-all placeholder:text-white/20"
                            />
                            <Search className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-white/20 group-focus-within:text-brand-accent" />
                          </div>
                          {scannedBarcode && (
                            <p className="mt-2 text-xs font-mono text-brand-accent font-bold">Active: {scannedBarcode}</p>
                          )}
                        </div>
                      </div>

                      {scannedBarcode && (
                        <>
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

                          {currentPart?.model && (
                            <div className="flex items-start gap-4">
                              <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                                <Cpu className="w-5 h-5" />
                              </div>
                              <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Model / Machine</p>
                                <p className="text-xl font-bold tracking-tight">{currentPart.model}</p>
                              </div>
                            </div>
                          )}
                        </>
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
                          placeholder={scannedBarcode ? "Enter part name" : "Scan barcode first..."}
                          disabled={!scannedBarcode}
                          className="input-field w-full text-xl disabled:bg-slate-50 disabled:cursor-not-allowed"
                        />
                      )}
                    </div>

                    {!currentPart && (
                      <>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Location</label>
                          <input 
                            name="location"
                            placeholder="Storage location"
                            disabled={!scannedBarcode}
                            className="input-field w-full disabled:bg-slate-50 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Model / Machine</label>
                          <input 
                            name="model"
                            placeholder="Machine model"
                            disabled={!scannedBarcode}
                            className="input-field w-full disabled:bg-slate-50 disabled:cursor-not-allowed"
                          />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor</label>
                          <input 
                            name="vendor"
                            placeholder="Supplier name"
                            disabled={!scannedBarcode}
                            className="input-field w-full disabled:bg-slate-50 disabled:cursor-not-allowed"
                          />
                        </div>
                      </>
                    )}

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
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Team</label>
                      <select 
                        name="team"
                        required
                        defaultValue={selectedScanTeam || ""}
                        className="input-field w-full appearance-none bg-white"
                      >
                        <option value="">Select Team</option>
                        <option value="FCT">FCT</option>
                        <option value="TESTER">TESTER</option>
                        <option value="AUTOMATION">AUTOMATION</option>
                      </select>
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
                      disabled={isSubmitting || !scannedBarcode}
                      className="btn-primary w-full md:w-auto min-w-[200px] flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRightLeft className="w-5 h-5" />}
                      Record Transaction
                    </button>
                    {!scannedBarcode && (
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-4 text-center md:text-left">Please scan a part first to enable submission</p>
                    )}
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
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <button onClick={() => setView('home')} className="flex items-center gap-3 text-slate-500 hover:text-black transition-all group self-start">
                  <div className="w-10 h-10 rounded-xl border border-slate-200 flex items-center justify-center group-hover:border-black bg-white shadow-sm">
                    <ChevronLeft className="w-5 h-5" />
                  </div>
                  <span className="font-bold uppercase tracking-wider text-[10px]">Back to Dashboard</span>
                </button>
                
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <button 
                    onClick={exportToExcel}
                    className="flex items-center gap-3 px-6 py-3 bg-emerald-500 text-white rounded-2xl font-bold text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 group"
                  >
                    <Download className="w-4 h-4 group-hover:scale-110 transition-transform" />
                    Download History (.xlsx)
                  </button>
                  <h2 className="text-3xl font-serif font-black tracking-tight bg-gradient-to-r from-slate-900 to-slate-500 bg-clip-text text-transparent">Transaction History</h2>
                </div>
              </div>

              <div className="bg-white rounded-3xl border border-brand-border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50/50 border-b border-brand-border">
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Time</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Part Info</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Name</th>
                        <th className="px-8 py-5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Team</th>
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
                          <td className="px-8 py-5">
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                              {tx.team || '-'}
                            </span>
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
      <div className="hidden lg:flex fixed bottom-0 left-28 right-0 h-10 bg-white/80 backdrop-blur-md border-t border-brand-border items-center justify-between px-8 z-30 shadow-sm">
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
          onClick={() => setView('team-select')} 
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
  const [error, setError] = useState<string | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    const html5QrCode = new Html5Qrcode("reader");
    html5QrCodeRef.current = html5QrCode;

    const startScanner = async () => {
      const config = {
        fps: 20,
        qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.floor(minEdge * 0.7);
          return {
            width: qrboxSize,
            height: qrboxSize
          };
        },
        aspectRatio: 1.0,
      };

      try {
        // Try back camera first
        await html5QrCode.start(
          { facingMode: "environment" },
          config,
          (decodedText) => {
            onScanSuccess(decodedText);
          },
          () => {}
        );
      } catch (err) {
        console.warn("Failed to start with environment camera, trying default:", err);
        try {
          // Fallback to any available camera if environment fails
          await html5QrCode.start(
            { facingMode: "user" }, // Try front camera
            config,
            (decodedText) => {
              onScanSuccess(decodedText);
            },
            () => {}
          );
        } catch (err2) {
          try {
            // Last resort: just try to start with no constraints
            await html5QrCode.start(
              undefined as any,
              config,
              (decodedText) => {
                onScanSuccess(decodedText);
              },
              () => {}
            );
          } catch (finalErr) {
            console.error("Failed to start scanner:", finalErr);
            setError("Camera access failed. Please ensure you have granted camera permissions and are using a secure connection (HTTPS).");
          }
        }
      }
    };

    // Small delay to ensure DOM is ready and animations are finished
    const timer = setTimeout(startScanner, 500);

    return () => {
      clearTimeout(timer);
      if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
        html5QrCodeRef.current.stop().catch(err => console.error("Failed to stop scanner", err));
      }
    };
  }, [onScanSuccess]);

  return (
    <div className="w-full h-full relative bg-black flex items-center justify-center">
      <div id="reader" className="w-full h-full"></div>
      {error && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-8 bg-slate-900/90 backdrop-blur-md text-center">
          <div className="max-w-xs space-y-6">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <div className="space-y-2">
              <h4 className="text-white font-bold uppercase tracking-widest text-xs">Camera Error</h4>
              <p className="text-slate-400 text-sm leading-relaxed">{error}</p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-white text-black rounded-2xl font-bold text-sm hover:bg-slate-100 transition-colors shadow-lg"
            >
              Refresh Page
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
