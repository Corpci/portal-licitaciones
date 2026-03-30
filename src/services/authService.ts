const BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

export async function login(email: string, password: string): Promise<{ token: string; user: any }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Error al iniciar sesión');
  }
  return res.json();
}

export function logout() {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
}

export function getStoredAuth(): { token: string; user: any } | null {
  const token = localStorage.getItem('auth_token');
  const user = localStorage.getItem('auth_user');
  if (!token || !user) return null;
  return { token, user: JSON.parse(user) };
}

export function saveAuth(token: string, user: any) {
  localStorage.setItem('auth_token', token);
  localStorage.setItem('auth_user', JSON.stringify(user));
}

export function authHeader(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Users (admin only)
export async function getUsers() {
  const res = await fetch(`${BASE}/api/users`, { headers: authHeader() });
  if (!res.ok) throw new Error('Error al obtener usuarios');
  return res.json();
}

export async function createUser(data: { email: string; password: string; nombre: string; role: string }) {
  const res = await fetch(`${BASE}/api/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function updateUser(id: number, data: any) {
  const res = await fetch(`${BASE}/api/users/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(data),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function deleteUser(id: number) {
  const res = await fetch(`${BASE}/api/users/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

// Tenders (per user, MySQL)
export async function fetchTenders() {
  const res = await fetch(`${BASE}/api/tenders`, { headers: authHeader() });
  if (!res.ok) throw new Error('Error al obtener licitaciones');
  const data = await res.json();
  return data.tenders;
}

export async function saveTender(tender: any) {
  const res = await fetch(`${BASE}/api/tenders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(tender),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}

export async function deleteTender(id: string) {
  const res = await fetch(`${BASE}/api/tenders/${id}`, {
    method: 'DELETE',
    headers: authHeader(),
  });
  if (!res.ok) { const e = await res.json(); throw new Error(e.error); }
  return res.json();
}
