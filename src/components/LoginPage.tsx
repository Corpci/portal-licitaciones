import React, { useState } from 'react';
import { motion } from 'motion/react';

interface Props {
  onLogin: (email: string, password: string) => Promise<void>;
}

export default function LoginPage({ onLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#E4E3E0] flex items-center justify-center p-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <div className="mb-12 text-center">
          <h1 className="text-4xl font-bold tracking-tighter uppercase italic font-serif">Licitaciones.AI</h1>
          <p className="text-[10px] opacity-50 uppercase tracking-widest mt-2">Automatización de Portales</p>
        </div>

        <div className="border border-[#141414] bg-white p-8 shadow-sm">
          <h2 className="text-xl font-serif italic mb-8">Iniciar Sesión</h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Correo Electrónico</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414]"
                placeholder="usuario@empresa.com"
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Contraseña</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-white border border-[#141414] p-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#141414]"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="p-3 border border-red-300 bg-red-50 text-red-700 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#141414] text-[#E4E3E0] py-4 text-xs uppercase tracking-widest font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>
        </div>

        <p className="text-center text-[10px] opacity-30 uppercase tracking-widest mt-8">
          Acceso restringido — Solo usuarios autorizados
        </p>
      </motion.div>
    </div>
  );
}
