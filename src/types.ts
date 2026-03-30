export interface Portal {
  id: string;
  name: string;
  url: string;
  lastChecked?: string;
  status: 'active' | 'error' | 'pending';
}

export interface Tender {
  id: string;
  portalId: string;
  title: string;
  description: string;
  url: string;
  date: string;
  capturedAt: string;
}

export interface PortalSummary {
  portalId: string;
  summary: string;
  tenders: Omit<Tender, 'id' | 'portalId' | 'capturedAt'>[];
  source?: 'scraper' | 'ai';
}

export interface AgentRunStatus {
  running: boolean;
  progress: number;    // 0-100
  currentSource: string;
  totalSources: number;
  completedSources: number;
  errors: string[];
}

export interface User {
  id: number;
  email: string;
  nombre: string;
  role: 'admin' | 'user';
  activo?: boolean;
  created_at?: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export interface ReportRecord {
  estado: string;
  ente_convocante: string;
  tipo_procedimiento: string;
  numero_procedimiento: string;
  objeto: string;
  tipo_contrato: string;
  fecha_publicacion: string;
  fecha_apertura: string;
  estatus: string;
  url_detalle_procedimiento: string;
  fuente_url: string;
}
