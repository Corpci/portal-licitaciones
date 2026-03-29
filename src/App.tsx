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
  X
} from 'lucide-react';
import { Portal, Tender, PortalSummary } from './types';
import { INITIAL_PORTALS } from './constants';
import { scanPortal } from './services/geminiService';

export default function App() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [capturedTenders, setCapturedTenders] = useState<Tender[]>([]);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'portals' | 'captured'>('dashboard');
  const [isScanning, setIsScanning] = useState<string | null>(null); // portalId being scanned
  const [scanResult, setScanResult] = useState<PortalSummary | null>(null);
  const [showAddPortal, setShowAddPortal] = useState(false);
  const [newPortal, setNewPortal] = useState({ name: '', url: '' });

  // Load data from localStorage
  useEffect(() => {
    const savedPortals = localStorage.getItem('portals');
    const savedTenders = localStorage.getItem('capturedTenders');
    
    if (savedPortals) {
      setPortals(JSON.parse(savedPortals));
    } else {
      setPortals(INITIAL_PORTALS);
      localStorage.setItem('portals', JSON.stringify(INITIAL_PORTALS));
    }
    
    if (savedTenders) {
      setCapturedTenders(JSON.parse(savedTenders));
    }
  }, []);

  // Save data to localStorage
  useEffect(() => {
    if (portals.length > 0) {
      localStorage.setItem('portals', JSON.stringify(portals));
    }
  }, [portals]);

  useEffect(() => {
    localStorage.setItem('capturedTenders', JSON.stringify(capturedTenders));
  }, [capturedTenders]);

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
      
      // Update portal last checked time
      setPortals(portals.map(p => 
        p.id === portal.id ? { ...p, lastChecked: new Date().toISOString() } : p
      ));
    } catch (error) {
      console.error("Scan failed", error);
      // Update status to error
      setPortals(portals.map(p => 
        p.id === portal.id ? { ...p, status: 'error' } : p
      ));
    } finally {
      setIsScanning(null);
    }
  };

  const handleCaptureTender = (tenderData: Omit<Tender, 'id' | 'portalId' | 'capturedAt'>, portalId: string) => {
    const tender: Tender = {
      ...tenderData,
      id: Math.random().toString(36).substr(2, 9),
      portalId,
      capturedAt: new Date().toISOString()
    };
    setCapturedTenders([...capturedTenders, tender]);
  };

  const handleDeleteTender = (id: string) => {
    setCapturedTenders(capturedTenders.filter(t => t.id !== id));
  };

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
        </nav>

        <div className="absolute bottom-0 left-0 w-full p-6 border-t border-[#141414]">
          <div className="flex items-center gap-3 text-[10px] opacity-50 uppercase tracking-widest">
            <Clock size={12} />
            <span>Última Sincronización: {new Date().toLocaleTimeString()}</span>
          </div>
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
                        <p className="text-xs opacity-60">Escaneo inteligente habilitado vía Gemini AI.</p>
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
                          <h3 className="text-xl font-serif italic">Resultados del Escaneo</h3>
                          <p className="text-[10px] uppercase tracking-widest opacity-50">Portal: {portals.find(p => p.id === scanResult.portalId)?.name}</p>
                        </div>
                        <button onClick={() => setScanResult(null)} className="hover:rotate-90 transition-transform">
                          <X size={24} />
                        </button>
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
                            <button className="flex items-center gap-2 border border-[#141414] px-6 py-3 text-[10px] uppercase tracking-widest hover:bg-[#141414] hover:text-[#E4E3E0] transition-all">
                              <ChevronRight size={14} />
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
        </AnimatePresence>
      </main>

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
