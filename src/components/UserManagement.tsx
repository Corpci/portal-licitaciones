import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Check, X } from 'lucide-react';
import { getUsers, createUser, updateUser, deleteUser } from '../services/authService';

export default function UserManagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ email: '', password: '', nombre: '', role: 'user' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(data.users);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await createUser(form);
      setForm({ email: '', password: '', nombre: '', role: 'user' });
      setShowForm(false);
      loadUsers();
    } catch (e: any) { setError(e.message); }
  };

  const handleToggleActive = async (user: any) => {
    try {
      await updateUser(user.id, { ...user, activo: !user.activo });
      loadUsers();
    } catch (e: any) { setError(e.message); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('¿Eliminar este usuario?')) return;
    try {
      await deleteUser(id);
      loadUsers();
    } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-8">
      <header className="flex justify-between items-end border-b border-[#141414] pb-6">
        <div>
          <h2 className="text-4xl font-serif italic tracking-tight">Usuarios</h2>
          <p className="text-sm opacity-60 mt-2">Gestión de acceso a la plataforma.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#141414] text-[#E4E3E0] px-6 py-3 text-xs uppercase tracking-widest hover:opacity-90"
        >
          <Plus size={16} /> Nuevo Usuario
        </button>
      </header>

      {error && <div className="p-3 border border-red-300 bg-red-50 text-red-700 text-sm">{error}</div>}

      {/* Create user form */}
      {showForm && (
        <div className="border border-[#141414] p-6 bg-white">
          <h3 className="text-sm font-medium mb-6 uppercase tracking-widest">Nuevo Usuario</h3>
          <form onSubmit={handleCreate} className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Nombre</label>
              <input required value={form.nombre} onChange={e => setForm({...form, nombre: e.target.value})}
                className="w-full border border-[#141414] p-2 text-sm focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Email</label>
              <input type="email" required value={form.email} onChange={e => setForm({...form, email: e.target.value})}
                className="w-full border border-[#141414] p-2 text-sm focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Contraseña</label>
              <input type="password" required value={form.password} onChange={e => setForm({...form, password: e.target.value})}
                className="w-full border border-[#141414] p-2 text-sm focus:outline-none" />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] uppercase tracking-widest opacity-50">Rol</label>
              <select value={form.role} onChange={e => setForm({...form, role: e.target.value})}
                className="w-full border border-[#141414] p-2 text-sm focus:outline-none bg-white">
                <option value="user">Usuario</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <div className="col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)}
                className="px-6 py-2 border border-[#141414] text-xs uppercase tracking-widest hover:bg-[#141414]/5">
                Cancelar
              </button>
              <button type="submit"
                className="px-6 py-2 bg-[#141414] text-[#E4E3E0] text-xs uppercase tracking-widest hover:opacity-90">
                Crear Usuario
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Users table */}
      <div className="border border-[#141414] overflow-hidden">
        <div className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] p-4 border-b border-[#141414] bg-[#141414] text-[#E4E3E0] text-[10px] uppercase tracking-widest">
          <div>Nombre</div><div>Email</div><div>Rol</div><div>Estado</div><div className="text-right">Acciones</div>
        </div>
        {loading ? (
          <div className="p-8 text-center opacity-50 text-sm">Cargando...</div>
        ) : (
          <div className="divide-y divide-[#141414]/10">
            {users.map(user => (
              <div key={user.id} className="grid grid-cols-[2fr_2fr_1fr_1fr_1fr] p-4 items-center hover:bg-[#141414]/5">
                <div className="text-sm font-medium">{user.nombre}</div>
                <div className="text-xs opacity-60 font-mono">{user.email}</div>
                <div>
                  <span className={`text-[9px] px-2 py-0.5 uppercase tracking-widest ${user.role === 'admin' ? 'bg-[#141414] text-[#E4E3E0]' : 'bg-[#141414]/10'}`}>
                    {user.role}
                  </span>
                </div>
                <div>
                  <span className={`text-[9px] px-2 py-0.5 uppercase tracking-widest ${user.activo ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>
                    {user.activo ? 'Activo' : 'Inactivo'}
                  </span>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => handleToggleActive(user)}
                    className="p-1.5 border border-[#141414]/20 hover:bg-[#141414] hover:text-[#E4E3E0] transition-all"
                    title={user.activo ? 'Desactivar' : 'Activar'}>
                    {user.activo ? <X size={12} /> : <Check size={12} />}
                  </button>
                  <button onClick={() => handleDelete(user.id)}
                    className="p-1.5 border border-[#141414]/20 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
