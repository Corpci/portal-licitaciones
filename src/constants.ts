import sourcesData from '../scraper/sources.json';
import { Portal } from './types';

export const INITIAL_PORTALS: Portal[] = sourcesData.map((s: any) => ({
  id: s.url.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 40),
  name: s.nombre,
  url: s.url,
  status: 'active' as const,
}));
