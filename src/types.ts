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
}
