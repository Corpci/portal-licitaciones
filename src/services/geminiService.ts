import { PortalSummary } from "../types";

function authHeader(): Record<string, string> {
  const token = localStorage.getItem('auth_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function scanPortal(portalUrl: string, portalId: string): Promise<PortalSummary> {
  try {
    const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
    const response = await fetch(`${base}/api/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ portalUrl, portalId }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(JSON.stringify(err));
    }

    const result = await response.json();
    return result as PortalSummary;
  } catch (error) {
    console.error("Error scanning portal:", error);
    throw error;
  }
}

export async function prepareWebSummary(tender: {
  title: string;
  description: string;
  url: string;
  date: string;
  portalName: string;
}): Promise<string> {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  const response = await fetch(`${base}/api/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(tender),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(JSON.stringify(err));
  }

  const result = await response.json();
  return result.summary as string;
}

export function runFullAgent(_onLog: (msg: string) => void, _onDone: () => void, _onError: (msg: string) => void): () => void {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  const eventSource = new EventSource(`${base}/api/run-agent-sse`);
  // NOTE: EventSource only works with GET. We'll use fetch with ReadableStream instead.
  // Return cleanup function
  eventSource.close();
  return () => {};
}

export async function runFullAgentFetch(
  onLog: (msg: string) => void,
  onDone: () => void,
  onError: (msg: string) => void
): Promise<void> {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  try {
    const response = await fetch(`${base}/api/run-agent`, {
      method: 'POST',
      headers: authHeader(),
    });
    if (!response.body) throw new Error('No response body');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'log') onLog(event.message);
            else if (event.type === 'done') onDone();
            else if (event.type === 'error') onError(event.message);
          } catch {}
        }
      }
    }
  } catch (err: any) {
    onError(err.message);
  }
}

export async function fetchReportData(): Promise<any[]> {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  const response = await fetch(`${base}/api/report-data`, { headers: authHeader() });
  const data = await response.json();
  return data.records ?? [];
}

export function getDownloadCsvUrl(): string {
  const base = import.meta.env.DEV ? 'http://localhost:3001' : '';
  return `${base}/api/download-csv`;
}
