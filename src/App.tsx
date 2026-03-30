import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Globe,
  Search,
  Plus,
  Trash2,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  FileText,
  Save,
  X,
  BarChart2,
  Users,
  LogOut
} from 'lucide-react';
import { Portal, Tender, PortalSummary } from './types';
import { INITIAL_PORTALS } from './constants';
import { scanPortal, prepareWebSummary, runFullAgentFetch, fetchReportData, getDownloadCsvUrl } from './services/geminiService';
import LoginPage from './components/LoginPage';
import UserManagement from './components/UserManagement';
import { login, logout, getStoredAuth, saveAuth, fetchTenders, saveTender, deleteTender } from './services/authService';

export default function App() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [capturedTenders, setCapturedTenders] = useState<Tender[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'portals' | 'captured' | 'reportes' | 'usuarios'>('dashboard');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentLogs, setAgentLogs] = useState<string[]>([]);
  const [reportData, setReportData] = useState<any[]>([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [isScanning, setIsScanning] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<PortalSummary | null>(null);
  const [showAddPortal, setShowAddPortal] = useState(false);
  const [newPortal, setNewPortal] = useState({ name: '', url: '' });
  const [webSummary, setWebSummary] = useState<string | null>(null);
  const [isPreparingSummary, setIsPreparingSummary] = useState<string | null>(null);

  // Auth state
  const [authUser, setAuthUser] = useState<any>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  // On mount: restore auth + portals
  useEffect(() => {
    const stored = getStoredAuth();
    if (stored) {
      setAuthUser(stored.user);
      setAuthToken(stored.token);
    }

    const savedPortals = localStorage.getItem('portals');
    if (savedPortals) {
      const parsed = JSON.parse(savedPortals);
      if (parsed.length < INITIAL_PORTALS.length) {
        setPortals(INITIAL_PORTALS);
        localStorage.setItem('portals', JSON.stringify(INITIAL_PORTALS));
      } else {
        setPortals(parsed);
      }
    } else {
      setPortals(INITIAL_PORTALS);
      localStorage.setItem('portals', JSON.stringify(INITIAL_PORTALS));
    }
  }, []);

  // Load tenders from API when authenticated
  useEffect(() => {
    if (!authToken) return;
    fetchTenders().then(tenders => {
      // Map DB column names to Tender interface
      const mapped: Tender[] = tenders.map((t: any) => ({
        id: t.id,
        portalId: t.portal_id ?? t.portalId,
        title: t.title,
        description: t.description ?? '',
        url: t.url ?? '',
        date: t.date ?? '',
        capturedAt: t.captured_at ?? t.capturedAt ?? '',
      }));
      setCapturedTenders(mapped);
    }).catch(console.error);
  }, [authToken]);

  // Save portals to localStorage
  useEffect(() => {
    if (portals.length > 0) {
      localStorage.setItem('portals', JSON.stringify(portals));
    }
  }, [portals]);

  // Auth handlers
  const handleLogin = async (email: string, password: string) => {
    const { token, user } = await login(email, password);
    saveAuth(token, user);
    setAuthToken(token);
    setAuthUser(user);
  };

  const handleLogout = () => {
    logout();
    setAuthToken(null);
    setAuthUser(null);
    setCapturedTenders([]);
  };

  // Portal handlers
  const handleAddPortal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortal.name || !newPortal.url) return;
    const portal: Portal = {
      id: Math.random().toString(36).substr(2, 9),
      name: newPortal.name,
      url: newPortal.url,
      status: 'active'
    };
    setPortals([...portals, portal]);
    setNewPortal({ name: '', url: '' });
    setShowAddPortal(false);
  };

  const handleDeletePortal = (id: string) => {
    setPortals(portals.filter(p => p.id !== id));
  };

  const handleScan = async (portal: Portal) => {
    setIsScanning(portal.id);
    setScanResult(null);
    try {
      const result = await scanPortal(portal.url, portal.id);
      setScanResult(result);
      setPortals(portals.map(p =>
        p.id === portal.id ? { ...p, lastChecked: new Date().toISOString() } : p
      ));
    } catch (error) {
      console.error("Scan failed", error);
      setPortals(portals.map(p =>
        p.id === portal.id ? { ...p, status: 'error' } : p
      ));
    } finally {
      setIsScanning(null);
    }
  };

  // Tender handlers (API-backed)
  const handleCaptureTender = async (tenderData: Omit<Tender, 'id' | 'portalId' | 'capturedAt'>, portalId: string) => {
    const tender: Tender = {
      ...tenderData,
      id: Math.random().toString(36).substr(2, 9),
      portalId,
      capturedAt: new Date().toISOString(),
    };
    try {
      await saveTender(tender);
      setCapturedTenders(prev => [...prev, tender]);
    } catch (error) {
      console.error('Error saving tender:', error);
    }
  };

  const handleDeleteTender = async (id: string) => {
    try {
      await deleteTender(id);
      setCapturedTenders(prev => prev.filter(t => t.id !== id));
    } catch (error) {
      console.error('Error deleting tender:', error);
    }
  };

  const handleDownloadScanCsv = () => {
    if (!scanResult) return;
    const portalName = portals.find(p => p.id === scanResult.portalId)?.name ?? 'portal';
    const headers = ['titulo', 'descripcion', 'fecha', 'url'];
    const rows = scanResult.tenders.map(t => [
      `"${(t.title ?? '').replace(/"/g, '""')}"`,
      `"${(t.description ?? '').replace(/"/g, '""')}"`,
      `"${(t.date ?? '').replace(/"/g, '""')}"`,
      `"${(t.url ?? '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${portalName.replace(/[^a-z0-9]/gi, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handlePrepareWebSummary = async (tender: Tender) => {
    setIsPreparingSummary(tender.id);
    try {
      const portalName = portals.find(p => p.id === tender.portalId)?.name || 'Portal Gubernamental';
      const summary = await prepareWebSummary({
        title: tender.title,
        description: tender.description,
        url: tender.url,
        date: tender.date,
        portalName,
      });
      setWebSummary(summary);
    } catch (error) {
      console.error('Error preparing summary:', error);
    } finally {
      setIsPreparingSummary(null);
    }
  };

  const handleRunFullAgent = async () => {
    setAgentRunning(true);
    setAgentLogs([]);
    await runFullAgentFetch(
      (msg) => setAgentLogs(prev => [...prev.slice(-100), msg]),
      () => {
        setAgentRunning(false);
        handleLoadReport();
      },
      (err) => {
        setAgentLogs(prev => [...prev, `ERROR: ${err}`]);
        setAgentRunning(false);
      }
    );
  };

  const handleLoadReport = async () => {
    setReportLoading(true);
    try {
      const data = await fetchReportData();
      setReportData(data);
    } finally {
      setReportLoading(false);
    }
  };

  // Show login page if not authenticated
  if (!authToken) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return (
    <div className="min-h-screen bg-[#E4E3E0] text-[#141414] font-sans selection:bg-[#141414] selection:text-[#E4E3E0]">
      {/* Sidebar / Navigation */}
      <div className="fixed left-0 top-0 h-full w-64 border-r border-[#141414] bg-[#E4E3E0] z-20 hidden md:block">
        <div className="p-6 border-bottom border-[#141414]">
          <h1 className="text-xl font-bold tracking-tighter uppercase italic font-serif">Licitaciones.AI</h1>
          <p className="text-[10px] opacity-50 uppercase tracking-widest mt-1">Automatización de Portales</p>
        </div>

        <nav className="mt-8 px-4 space-y-2">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${activeTab === 'dashboard' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <LayoutDashboard size={18} />
            <span>Panel de Control</span>
          </button>
          <button
            onClick={() => setActiveTab('portals')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${activeTab === 'portals' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <Globe size={18} />
            <span>Portales Gubernamentales</span>
          </button>
          <button
            onClick={() => setActiveTab('captured')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${activeTab === 'captured' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <FileText size={18} />
            <span>Licitaciones Capturadas</span>
          </button>
          <button
            onClick={() => setActiveTab('reportes')}
            className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${activeTab === 'reportes' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
          >
            <BarChart2 size={18} />
            <span>Reportes</span>
          </button>
          {authUser?.role === 'admin' && (
            <button
              onClick={() => setActiveTab('usuarios')}
              className={`w-full flex items-center gap-3 px-4 py-3 text-sm transition-all ${activeTab === 'usuarios' ? 'bg-[#141414] text-[#E4E3E0]' : 'hover:bg-[#141414]/5'}`}
            >
              <Users size={18} />
              <span>Usuarios</span>
            </button>
          )}
        </nav>

        <div className="absolute bottom-0 left-0 w-full p-6 border-t border-[#141414]">
          <div className="flex items-center gap-3 text-[10px] opacity-50 uppercase tracking-widest mb-3">
            <Clock size={12} />
            <span>Última Sincronización: {new Date().toLocaleTimeString()}</span>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100 transition-opacity"
          >
            <LogOut size={12} />
            <span>Cerrar Sesión</span>
          </button>
          <p className="text-[10px] opacity-30 mt-1 truncate">{authUser?.nombre}</p>
        </div>
      </div>

      {/* Main Content */}
      <main className="md:ml-64 p-8 min-h-screen">
        <AnimatePresence mode="wait">
          {activeTab === 'dashboard' && (
            <motion.div
              key="dashboard"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header className="flex justify-between items-end border-b border-[#141414] pb-6">
                <div>
                  <h2 className="text-4xl font-serif italic tracking-tight">Panel de Control</h2>
                  <p className="text-sm opacity-60 mt-2">Resumen de actividad y portales activos.</p>
                </div>
                <div className="flex gap-4">
                  <div className="text-right">
                    <p className="text-[10px] uppercase opacity-50 tracking-widest">Portales</p>
                    <p className="text-2xl font-mono">{portals.length}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase opacity-50 tracking-widest">Capturadas</p>
                    <p className="text-2xl font-mono">{capturedTenders.length}</p>
                  </div>
                </div>
              </header>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Recent Portals Activity */}
                <div className="border border-[#141414] bg-white/50 p-6">
                  <h3 className="text-xs uppercase tracking-widest opacity-50 mb-6 flex items-center gap-2">
                    <RefreshCw size={12} />
                    Portales Recientes
                  </h3>
                  <div className="space-y-4">
                    {portals.slice(0, 5).map(portal => (
                      <div key={portal.id} className="flex items-center justify-between py-3 border-b border-[#141414]/10 last:border-0">
                        <div>
                          <p className="text-sm font-medium">{portal.name}</p>
                          <p className="text-[10px] opacity-50 truncate max-w-[200px]">{portal.url}</p>
                        </div>
                        <button
                          onClick={() => handleScan(portal)}
                          disabled={isScanning === portal.id}
                          className="p-2 hover:bg-[#141414] hover:text-[#E4E3E0] transition-colors disabled:opacity-50"
                        >
                          {isScanning === portal.id ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => setActiveTab('portals')}
                      className="w-full text-center py-2 text-[10px] uppercase tracking-widest hover:underline mt-4"
                    >
                      Ver todos los portales
                    </button>
                  </div>
                </div>

                {/* Quick Stats / Info */}
                <div className="space-y-8">
                  <div className="border border-[#141414] p-6 bg-[#141414] text-[#E4E3E0]">
                    <h3 className="text-xs uppercase tracking-widest opacity-50 mb-4">Estado del Sistema</h3>
                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 rounded-full border border-[#E4E3E0]/20 flex items-center justify-center">
                        <CheckCircle2 size={24} className="text-green-400" />
                      </div>
                      <div>
                        <p className="text-lg font-serif italic">Operativo</p>
                        <p className="text-xs opacity-60">Escaneo inteligente habilitado.</p>
                      </div>
                    </div>
                  </div>

                  <div className="border border-[#141414] p-6">
                    <h3 className="text-xs uppercase tracking-widest opacity-50 mb-4">Últimas Capturas</h3>
                    {capturedTenders.length === 0 ? (
                      <p className="text-sm italic opacity-50">No hay licitaciones capturadas recientemente.</p>
                    ) : (
                      <div className="space-y-3">
                        {capturedTenders.slice(-3).reverse().map(tender => (
                          <div key={tender.id} className="text-sm p-3 border border-[#141414]/10 bg-white/30">
                            <p className="font-medium truncate">{tender.title}</p>
                            <p className="text-[10px] opacity-50">{new Date(tender.capturedAt).toLocaleDateString()}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'portals' && (
            <motion.div
              key="portals"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header className="flex justify-between items-end border-b border-[#141414] pb-6">
                <div>
                  <h2 className="text-4xl font-serif italic tracking-tight">Portales</h2>
                  <p className="text-sm opacity-60 mt-2">Gestión y escaneo de fuentes de información.</p>
                </div>
                <button
                  onClick={() => setShowAddPortal(true)}
                  className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-6 py-3 text-xs uppercase tracking-widest hover:opacity-90 transition-opacity"
                >
                  <Plus size={16} />
                  Añadir Portal
                </button>
              </header>

              {/* Scan Result Overlay */}
              <AnimatePresence>
                {scanResult && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-[#141414]/40 backdrop-blur-sm"
                  >
                    <div className="bg-[#E4E3E0] border border-[#141414] w-full max-w-4xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl">
                      <div className="p-6 border-b border-[#141414] flex justify-between items-center bg-[#141414] text-[#E4E3E0]">
                        <div>
                          <div className="flex items-center gap-3 mb-1">
                            <h3 className="text-xl font-serif italic">Resultados del Escaneo</h3>
                            <span className={`text-[10px] px-2 py-1 uppercase tracking-widest ${scanResult.source === 'scraper' ? 'bg-green-500' : 'bg-yellow-500'} text-white`}>
                              {scanResult.source === 'scraper' ? 'Datos en tiempo real' : 'Generado por IA'}
                            </span>
                          </div>
                          <p className="text-[10px] uppercase tracking-widest opacity-50">Portal: {portals.find(p => p.id === scanResult.portalId)?.name}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={handleDownloadScanCsv}
                            disabled={scanResult.tenders.length === 0}
                            className="flex items-center gap-2 border border-[#E4E3E0]/30 px-4 py-2 text-[10px] uppercase tracking-widest hover:bg-[#E4E3E0] hover:text-[#141414] transition-all disabled:opacity-30"
                            title="Descargar resultados como CSV"
                          >
                            <Save size={14} />
                            Descargar CSV
                          </button>
                          <button onClick={() => setScanResult(null)} className="hover:rotate-90 transition-transform">
                            <X size={24} />
                          </button>
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-8 space-y-8">
                        <section>
                          <h4 className="text-[10px] uppercase tracking-widest opacity-50 mb-4">Resumen Ejecutivo</h4>
                          <div className="p-6 border border-[#141414] bg-white/50 leading-relaxed">
                            {scanResult.summary}
                          </div>
                        </section>

                        <section>
                          <h4 className="text-[10px] uppercase tracking-widest opacity-50 mb-4">Oportunidades Identificadas ({scanResult.tenders.length})</h4>
                          <div className="grid grid-cols-1 gap-4">
                            {scanResult.tenders.map((tender, idx) => (
                              <div key={idx} className="p-6 border border-[#141414] bg-white hover:bg-[#141414] hover:text-[#E4E3E0] transition-all group">
                                <div className="flex justify-between items-start gap-4">
                                  <div className="flex-1">
                                    <h5 className="text-lg font-medium mb-2">{tender.title}</h5>
                                    <p className="text-sm opacity-70 mb-4 line-clamp-2">{tender.description}</p>
                                    <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest opacity-50 group-hover:opacity-100">
                                      <span className="flex items-center gap-1"><Clock size={12} /> {tender.date || 'Sin fecha'}</span>
                                      <a href={tender.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:underline">
                                        <ExternalLink size={12} /> Ver Fuente
                                      </a>
                                    </div>
                                  </div>
                                  <button
                                    onClick={() => handleCaptureTender(tender, scanResult.portalId)}
                                    className="p-3 border border-current hover:bg-[#E4E3E0] hover:text-[#141414] transition-colors"
                                    title="Capturar Licitación"
                                  >
                                    <Save size={20} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Portals List */}
              <div className="border border-[#141414] bg-white/30 overflow-hidden">
                <div className="grid grid-cols-[1fr_2fr_1fr_1fr] p-4 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest font-bold">
                  <div>Nombre</div>
                  <div>URL</div>
                  <div>Último Escaneo</div>
                  <div className="text-right">Acciones</div>
                </div>
                <div className="divide-y divide-[#141414]/10">
                  {portals.map(portal => (
                    <div key={portal.id} className="grid grid-cols-[1fr_2fr_1fr_1fr] p-4 items-center hover:bg-[#141414]/5 transition-colors group">
                      <div className="text-sm font-medium">{portal.name}</div>
                      <div className="text-xs opacity-50 truncate pr-8 font-mono">{portal.url}</div>
                      <div className="text-xs opacity-50">
                        {portal.lastChecked ? new Date(portal.lastChecked).toLocaleString() : 'Nunca'}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleScan(portal)}
                          disabled={isScanning === portal.id}
                          className="p-2 border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all disabled:opacity-50"
                          title="Escanear Portal"
                        >
                          {isScanning === portal.id ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
                        </button>
                        <a
                          href={portal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                          title="Abrir Portal"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          onClick={() => handleDeletePortal(portal.id)}
                          className="p-2 border border-[#141414]/20 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all"
                          title="Eliminar"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === 'captured' && (
            <motion.div
              key="captured"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header className="flex justify-between items-end border-b border-[#141414] pb-6">
                <div>
                  <h2 className="text-4xl font-serif italic tracking-tight">Licitaciones</h2>
                  <p className="text-sm opacity-60 mt-2">Oportunidades capturadas y listas para procesar.</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] uppercase opacity-50 tracking-widest">Total Capturadas</p>
                  <p className="text-2xl font-mono">{capturedTenders.length}</p>
                </div>
              </header>

              {capturedTenders.length === 0 ? (
                <div className="h-64 border border-dashed border-[#141414]/30 flex flex-col items-center justify-center space-y-4 opacity-50">
                  <FileText size={48} />
                  <p className="font-serif italic">No hay licitaciones capturadas aún.</p>
                  <button
                    onClick={() => setActiveTab('portals')}
                    className="text-[10px] uppercase tracking-widest border-b border-[#141414] pb-1 hover:opacity-100"
                  >
                    Ir a portales para escanear
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6">
                  {capturedTenders.map(tender => (
                    <div key={tender.id} className="border border-[#141414] bg-white p-8 group relative overflow-hidden">
                      <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => handleDeleteTender(tender.id)}
                          className="text-red-500 hover:scale-110 transition-transform"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>

                      <div className="flex flex-col md:flex-row gap-8">
                        <div className="flex-1 space-y-4">
                          <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest opacity-50">
                            <span className="px-2 py-0.5 border border-current">{portals.find(p => p.id === tender.portalId)?.name || 'Portal Desconocido'}</span>
                            <span>{new Date(tender.capturedAt).toLocaleDateString()}</span>
                          </div>
                          <h3 className="text-2xl font-serif italic leading-tight">{tender.title}</h3>
                          <p className="text-sm leading-relaxed opacity-70">{tender.description}</p>

                          <div className="pt-4 flex flex-wrap gap-4">
                            <a
                              href={tender.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-6 py-3 text-[10px] uppercase tracking-widest hover:opacity-90 transition-opacity"
                            >
                              <ExternalLink size={14} />
                              Ver Convocatoria Original
                            </a>
                            <button
                              onClick={() => handlePrepareWebSummary(tender)}
                              disabled={isPreparingSummary === tender.id}
                              className="flex items-center gap-2 border border-[#141414] px-6 py-3 text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all disabled:opacity-50"
                            >
                              {isPreparingSummary === tender.id
                                ? <RefreshCw size={14} className="animate-spin" />
                                : <ChevronRight size={14} />
                              }
                              Preparar Resumen para Web
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'reportes' && (
            <motion.div
              key="reportes"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-8"
            >
              <header className="flex justify-between items-end border-b border-[#141414] pb-6">
                <div>
                  <h2 className="text-4xl font-serif italic tracking-tight">Reportes</h2>
                  <p className="text-sm opacity-60 mt-2">Licitaciones recientes de los 87 portales monitoreados.</p>
                </div>
                <div className="flex gap-3">
                  {authUser?.role === 'admin' && (
                    <button
                      onClick={handleRunFullAgent}
                      disabled={agentRunning}
                      className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-6 py-3 text-xs uppercase tracking-widest hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {agentRunning ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
                      {agentRunning ? 'Ejecutando...' : 'Ejecutar Agente Completo'}
                    </button>
                  )}
                  <a
                    href={getDownloadCsvUrl()}
                    className="flex items-center gap-2 border border-[#141414] px-6 py-3 text-xs uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                  >
                    <Save size={16} />
                    Descargar CSV
                  </a>
                </div>
              </header>

              {/* Agent Log Console */}
              {(agentRunning || agentLogs.length > 0) && (
                <div className="border border-[#141414] bg-[#141414] text-[#E4E3E0] p-4 font-mono text-xs max-h-48 overflow-y-auto">
                  <p className="text-[10px] uppercase tracking-widest opacity-50 mb-3">Log del Agente</p>
                  {agentLogs.map((log, i) => (
                    <div key={i} className="opacity-80 leading-relaxed">{log}</div>
                  ))}
                  {agentRunning && <div className="animate-pulse mt-2">▋</div>}
                </div>
              )}

              {/* Load Data Button (if no data yet) */}
              {reportData.length === 0 && !reportLoading && !agentRunning && (
                <div className="border border-dashed border-[#141414]/30 h-48 flex flex-col items-center justify-center gap-4 opacity-60">
                  <BarChart2 size={48} />
                  <p className="font-serif italic">No hay datos cargados.</p>
                  <button onClick={handleLoadReport} className="text-[10px] uppercase tracking-widest border-b border-[#141414] pb-1">
                    Cargar último reporte
                  </button>
                </div>
              )}

              {/* Loading spinner */}
              {reportLoading && (
                <div className="flex items-center justify-center h-32">
                  <RefreshCw size={32} className="animate-spin opacity-30" />
                </div>
              )}

              {/* Results Table */}
              {reportData.length > 0 && (
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-xs opacity-50 uppercase tracking-widest">{reportData.length} licitaciones encontradas</p>
                    <button onClick={handleLoadReport} className="text-[10px] uppercase tracking-widest opacity-50 hover:opacity-100 flex items-center gap-1">
                      <RefreshCw size={10} /> Actualizar
                    </button>
                  </div>
                  <div className="border border-[#141414] overflow-hidden overflow-x-auto">
                    <table className="w-full text-sm min-w-[900px]">
                      <thead>
                        <tr className="bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
                          <th className="p-3 text-left">Estado</th>
                          <th className="p-3 text-left">Convocante</th>
                          <th className="p-3 text-left">Objeto</th>
                          <th className="p-3 text-left">Tipo</th>
                          <th className="p-3 text-left">Fecha Pub.</th>
                          <th className="p-3 text-left">Estatus</th>
                          <th className="p-3 text-left">Enlace</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#141414]/10">
                        {reportData.map((row, i) => (
                          <tr key={i} className="hover:bg-[#141414]/5 transition-colors">
                            <td className="p-3 text-xs font-medium whitespace-nowrap">{row.estado || '—'}</td>
                            <td className="p-3 text-xs opacity-70 max-w-[160px] truncate">{row.ente_convocante || '—'}</td>
                            <td className="p-3 text-xs max-w-[260px]">
                              <span className="line-clamp-2">{row.objeto || row.numero_procedimiento || '—'}</span>
                            </td>
                            <td className="p-3 text-xs opacity-70 whitespace-nowrap">{row.tipo_procedimiento || '—'}</td>
                            <td className="p-3 text-xs opacity-70 whitespace-nowrap font-mono">{row.fecha_publicacion || '—'}</td>
                            <td className="p-3 text-xs">
                              <span className={`px-2 py-0.5 uppercase text-[9px] tracking-widest ${
                                row.estatus?.toLowerCase().includes('vigente') ? 'bg-green-100 text-green-800' :
                                row.estatus?.toLowerCase().includes('cancel') ? 'bg-red-100 text-red-800' :
                                'bg-[#141414]/10'
                              }`}>
                                {row.estatus || 'N/D'}
                              </span>
                            </td>
                            <td className="p-3">
                              {(row.url_detalle_procedimiento || row.fuente_url) ? (
                                <a
                                  href={row.url_detalle_procedimiento || row.fuente_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="p-1 hover:text-blue-600"
                                >
                                  <ExternalLink size={14} />
                                </a>
                              ) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === 'usuarios' && authUser?.role === 'admin' && (
            <motion.div
              key="usuarios"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <UserManagement />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Web Summary Modal */}
      <AnimatePresence>
        {webSummary && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-[#141414]/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-[#141414] flex justify-between items-center bg-[#141414] text-[#E4E3E0]">
                <h3 className="text-xl font-serif italic">Resumen para Web</h3>
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => navigator.clipboard.writeText(webSummary)}
                    className="text-[10px] uppercase tracking-widest border border-[#E4E3E0]/30 px-4 py-2 hover:bg-[#E4E3E0] hover:text-[#141414] transition-all"
                  >
                    Copiar Markdown
                  </button>
                  <button onClick={() => setWebSummary(null)} className="hover:rotate-90 transition-transform">
                    <X size={24} />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-8">
                <pre className="text-sm whitespace-pre-wrap font-mono leading-relaxed">{webSummary}</pre>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Portal Modal */}
      <AnimatePresence>
        {showAddPortal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-[#141414]/40 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="bg-[#E4E3E0] border border-[#141414] w-full max-w-md p-8 shadow-2xl"
            >
              <div className="flex justify-between items-center mb-8">
                <h3 className="text-2xl font-serif italic">Nuevo Portal</h3>
                <button onClick={() => setShowAddPortal(false)} className="hover:rotate-90 transition-transform">
                  <X size={24} />
                </button>
              </div>

              <form onSubmit={handleAddPortal} className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest opacity-50">Nombre del Portal</label>
                  <input
                    type="text"
                    required
                    value={newPortal.name}
                    onChange={e => setNewPortal({ ...newPortal, name: e.target.value })}
                    className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414]"
                    placeholder="Ej. Licitaciones CDMX"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] uppercase tracking-widest opacity-50">URL del Portal</label>
                  <input
                    type="url"
                    required
                    value={newPortal.url}
                    onChange={e => setNewPortal({ ...newPortal, url: e.target.value })}
                    className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414]"
                    placeholder="https://..."
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-[#141414] text-[#E4E3E0] py-4 text-xs uppercase tracking-widest font-bold hover:opacity-90 transition-opacity"
                >
                  Añadir a la Lista
                </button>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading Overlay */}
      <AnimatePresence>
        {isScanning && !scanResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-[#E4E3E0]/90 backdrop-blur-md"
          >
            <div className="relative">
              <RefreshCw size={64} className="animate-spin text-[#141414] opacity-20" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Search size={24} className="animate-pulse" />
              </div>
            </div>
            <h3 className="mt-8 text-2xl font-serif italic animate-pulse">Analizando Portal...</h3>
            <p className="mt-2 text-[10px] uppercase tracking-widest opacity-50">Usando Inteligencia Artificial para extraer licitaciones</p>
            <div className="mt-12 w-48 h-[1px] bg-[#141414]/10 overflow-hidden">
              <motion.div
                className="h-full bg-[#141414]"
                animate={{ x: [-200, 200] }}
                transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
