import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'node-html-parser';
import { spawn } from 'child_process';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query, queryOne } from './src/db.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'changeme';
const MIN_YEAR = 2026;

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ─── Auth middleware ───────────────────────────────────────────────────────────

interface AuthRequest extends Request {
  user?: { id: number; email: string; role: string; nombre: string };
}

function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return res.status(401).json({ error: 'No autorizado' });
  try {
    const token = header.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as any;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

function adminMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  authMiddleware(req, res, () => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Requiere rol administrador' });
    next();
  });
}

// ─── Seed admin user on startup ───────────────────────────────────────────────

async function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@licitaciones.ai';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin1234!';
  try {
    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!existing) {
      const hash = await bcrypt.hash(adminPassword, 10);
      await query(
        'INSERT INTO users (email, password_hash, nombre, role) VALUES (?, ?, ?, ?)',
        [adminEmail, hash, 'Administrador', 'admin']
      );
      console.log(`Admin user created: ${adminEmail}`);
    }
  } catch (e: any) {
    console.error('Error seeding admin:', e.message);
  }
}

// ─── Auth endpoints ────────────────────────────────────────────────────────────

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const user = await queryOne<any>('SELECT * FROM users WHERE email = ? AND activo = 1', [email]);
  if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Credenciales inválidas' });

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, nombre: user.nombre },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  return res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role, nombre: user.nombre }
  });
});

app.get('/api/auth/me', authMiddleware as any, (req: AuthRequest, res) => {
  res.json({ user: req.user });
});

// ─── User management (admin only) ─────────────────────────────────────────────

app.get('/api/users', adminMiddleware as any, async (req, res) => {
  const users = await query('SELECT id, email, nombre, role, activo, created_at FROM users ORDER BY created_at DESC');
  res.json({ users });
});

app.post('/api/users', adminMiddleware as any, async (req, res) => {
  const { email, password, nombre, role = 'user' } = req.body;
  if (!email || !password || !nombre) return res.status(400).json({ error: 'Email, contraseña y nombre requeridos' });

  const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) return res.status(409).json({ error: 'El email ya está registrado' });

  const hash = await bcrypt.hash(password, 10);
  await query('INSERT INTO users (email, password_hash, nombre, role) VALUES (?, ?, ?, ?)', [email, hash, nombre, role]);
  res.status(201).json({ message: 'Usuario creado' });
});

app.put('/api/users/:id', adminMiddleware as any, async (req, res) => {
  const { nombre, role, activo, password } = req.body;
  const { id } = req.params;

  if (password) {
    const hash = await bcrypt.hash(password, 10);
    await query('UPDATE users SET nombre=?, role=?, activo=?, password_hash=? WHERE id=?', [nombre, role, activo, hash, id]);
  } else {
    await query('UPDATE users SET nombre=?, role=?, activo=? WHERE id=?', [nombre, role, activo, id]);
  }
  res.json({ message: 'Usuario actualizado' });
});

app.delete('/api/users/:id', adminMiddleware as any, async (req: AuthRequest, res) => {
  if (String(req.user?.id) === req.params.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  await query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'Usuario eliminado' });
});

// ─── Captured tenders (per user, MySQL) ───────────────────────────────────────

app.get('/api/tenders', authMiddleware as any, async (req: AuthRequest, res) => {
  const tenders = await query(
    'SELECT * FROM captured_tenders WHERE user_id = ? ORDER BY captured_at DESC',
    [req.user!.id]
  );
  res.json({ tenders });
});

app.post('/api/tenders', authMiddleware as any, async (req: AuthRequest, res) => {
  const { id, portalId, title, description, url, date } = req.body;
  await query(
    'INSERT INTO captured_tenders (id, user_id, portal_id, title, description, url, date) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, req.user!.id, portalId, title, description, url, date]
  );
  res.status(201).json({ message: 'Licitación capturada' });
});

app.delete('/api/tenders/:id', authMiddleware as any, async (req: AuthRequest, res) => {
  await query('DELETE FROM captured_tenders WHERE id = ? AND user_id = ?', [req.params.id, req.user!.id]);
  res.json({ message: 'Eliminada' });
});

// ─── Scraping helpers ──────────────────────────────────────────────────────────

async function runPythonScraper(portalUrl: string): Promise<{ summary: string; tenders: any[] } | null> {
  return new Promise((resolve, reject) => {
    const appRoot = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.join(appRoot, 'scraper', 'main.py');
    let stdoutData = '';
    let stderrData = '';
    let timedOut = false;

    function trySpawn(pythonExe: string): void {
      const child = spawn(pythonExe, [scriptPath, '--url', portalUrl, '--json-stdout'], { cwd: appRoot });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
        reject(new Error(`Timeout after 60s for ${portalUrl}`));
      }, 60000);
      child.stdout.on('data', (chunk: Buffer) => { stdoutData += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderrData += chunk.toString(); });
      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT' && pythonExe === 'python3') {
          stdoutData = ''; stderrData = '';
          trySpawn('python');
        } else {
          reject(new Error(`Spawn error (${pythonExe}): ${err.message}`));
        }
      });
      child.on('close', (code: number | null) => {
        clearTimeout(timer);
        if (timedOut) return;
        if (code !== 0) { reject(new Error(`Exit code ${code}. stderr: ${stderrData.slice(0, 500)}`)); return; }
        try { resolve(JSON.parse(stdoutData.trim())); }
        catch (e: any) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }
    trySpawn('python3');
  });
}

async function scrapeText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
      'Accept-Language': 'es-MX,es;q=0.9',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const root = parse(html);
  root.querySelectorAll('script, style, nav, footer, header, iframe, noscript, meta, link').forEach(el => el.remove());

  const rows = root.querySelectorAll('tr');
  const recentRows = rows.filter(r => r.text.includes(String(MIN_YEAR)));
  if (recentRows.length > 0) {
    const header = root.querySelector('thead tr, tr:first-child');
    const headerText = header ? `ENCABEZADO: ${header.text.replace(/\s+/g, ' ').trim()}\n` : '';
    return (headerText + recentRows.map(r => r.text.replace(/\s+/g, ' ').trim()).join('\n')).slice(0, 6000);
  }
  const items = root.querySelectorAll('li, .card, article, .licitacion, .convocatoria');
  const recentItems = items.filter(el => el.text.includes(String(MIN_YEAR)));
  if (recentItems.length > 0) {
    return recentItems.map(el => el.text.replace(/\s+/g, ' ').trim()).join('\n').slice(0, 6000);
  }
  return root.text.replace(/\s+/g, ' ').trim().slice(0, 4000);
}

function filterTendersByDate(tenders: any[]): any[] {
  return tenders.filter(t => {
    if (!t.date) return false;
    const match = t.date.match(/\b(20\d{2})\b/);
    return match ? parseInt(match[1]) >= MIN_YEAR : false;
  });
}

// ─── Scan endpoint ─────────────────────────────────────────────────────────────

app.post('/api/scan', authMiddleware as any, async (req, res) => {
  const { portalUrl, portalId } = req.body;

  try {
    const scraperResult = await runPythonScraper(portalUrl);
    if (scraperResult && scraperResult.tenders.length > 0) {
      const filtered = filterTendersByDate(scraperResult.tenders);
      if (filtered.length > 0) return res.json({ ...scraperResult, tenders: filtered, portalId, source: 'scraper' });
    }
  } catch (e: any) {
    console.warn('Python scraper failed, falling back to AI:', e.message);
  }

  try {
    let pageContent = '';
    try {
      pageContent = await scrapeText(portalUrl);
    } catch (e: any) {
      pageContent = `No se pudo acceder al portal. URL: ${portalUrl}`;
    }

    const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.MOONSHOT_API_KEY}` },
      body: JSON.stringify({
        model: 'moonshot-v1-8k',
        temperature: 0.1,
        messages: [
          { role: 'system', content: 'Eres un experto en licitaciones gubernamentales mexicanas. Extraes información REAL del contenido HTML. Solo reportas lo que encuentras. Responde ÚNICAMENTE con JSON válido, sin markdown.' },
          { role: 'user', content: `Analiza este contenido del portal ${portalUrl} y extrae SOLO licitaciones con fecha >= ${MIN_YEAR}-01-01.\n\nCONTENIDO:\n${pageContent}\n\nJSON:\n{"portalId":"${portalId}","summary":"resumen real","tenders":[{"title":"...","description":"...","url":"${portalUrl}","date":"YYYY-MM-DD"}]}` },
        ],
      }),
    });

    const data = await response.json() as any;
    if (!response.ok) return res.status(response.status).json({ error: data });
    const result = JSON.parse(data.choices[0].message.content ?? '{}');
    const filtered = filterTendersByDate(result.tenders ?? []);
    return res.json({ ...result, tenders: filtered, portalId, source: 'ai' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// ─── Summary endpoint ──────────────────────────────────────────────────────────

app.post('/api/summary', authMiddleware as any, async (req, res) => {
  const { title, description, url, date, portalName } = req.body;
  const response = await fetch('https://api.moonshot.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.MOONSHOT_API_KEY}` },
    body: JSON.stringify({
      model: 'moonshot-v1-8k', temperature: 0.5,
      messages: [
        { role: 'system', content: 'Eres un redactor experto en licitaciones públicas en México. Redactas en español para sitios web.' },
        { role: 'user', content: `Genera un resumen profesional en Markdown para:\nTítulo: ${title}\nDescripción: ${description}\nPortal: ${portalName}\nFecha: ${date}\nURL: ${url}\n\nIncluye: H1 atractivo, párrafo introductorio, puntos clave, llamado a la acción, tags SEO.` },
      ],
    }),
  });
  const data = await response.json() as any;
  if (!response.ok) return res.status(response.status).json({ error: data });
  return res.json({ summary: data.choices[0].message.content ?? '' });
});

// ─── Agent run (admin only) ────────────────────────────────────────────────────

app.post('/api/run-agent', adminMiddleware as any, (req: AuthRequest, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const appRoot = path.dirname(fileURLToPath(import.meta.url));
  const scriptPath = path.join(appRoot, 'scraper', 'main.py');
  const sendEvent = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  sendEvent({ type: 'start', message: 'Iniciando agente...' });

  const child = spawn('python3', [scriptPath], { cwd: appRoot, env: { ...process.env, PYTHONUNBUFFERED: '1' } });
  let lineBuffer = '';
  child.stderr.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString();
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    for (const line of lines) { if (line.trim()) sendEvent({ type: 'log', message: line.trim() }); }
  });
  child.on('close', (code) => {
    sendEvent({ type: code === 0 ? 'done' : 'error', message: code === 0 ? 'Agente completado.' : `Código de salida: ${code}` });
    res.end();
  });
  child.on('error', (err) => { sendEvent({ type: 'error', message: err.message }); res.end(); });
  req.on('close', () => child.kill());
});

// ─── Report data ───────────────────────────────────────────────────────────────

app.get('/api/report-data', authMiddleware as any, (req, res) => {
  const csvPath = path.join(__dirname, 'scraper', 'output', 'licitanet_reciente_consolidado.csv');
  if (!fs.existsSync(csvPath)) return res.json({ records: [], message: 'No hay datos aún.' });
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.trim().split('\n');
  if (lines.length < 2) return res.json({ records: [] });
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const records = lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|^(?=,)|(?<=,)$)/g) ?? [];
    const record: Record<string, string> = {};
    headers.forEach((h, i) => { record[h] = (values[i] ?? '').replace(/^"|"$/g, '').trim(); });
    return record;
  });
  return res.json({ records });
});

app.get('/api/download-csv', authMiddleware as any, (req, res) => {
  const csvPath = path.join(__dirname, 'scraper', 'output', 'licitanet_reciente_consolidado.csv');
  if (!fs.existsSync(csvPath)) return res.status(404).json({ error: 'No hay datos aún.' });
  res.setHeader('Content-Disposition', 'attachment; filename="licitaciones_recientes.csv"');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  fs.createReadStream(csvPath).pipe(res);
});

// ─── Static frontend ───────────────────────────────────────────────────────────

const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

// ─── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  // Wait a bit for MySQL to be ready then seed admin
  setTimeout(seedAdmin, 3000);
});
