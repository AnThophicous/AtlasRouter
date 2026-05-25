import type { CompeatScoreBreakdown } from './compeat-score.js';
import type { ProviderId } from '../types/router.js';

export type CompeatTraceStatus = 'running' | 'completed' | 'failed';
export type CompeatCandidateStatus = 'pending' | 'completed' | 'failed';

export interface CompeatCandidateTrace {
  providerId: ProviderId;
  model: string;
  upstreamModel: string;
  status: CompeatCandidateStatus;
  score: number | null;
  latencyMs: number | null;
  error: string | null;
  content: string;
  breakdown: CompeatScoreBreakdown | null;
  completedAt: number | null;
}

export interface CompeatTrace {
  id: string;
  requestId: string;
  model: string;
  status: CompeatTraceStatus;
  stream: boolean;
  startedAt: number;
  completedAt: number | null;
  winnerProviderId: ProviderId | null;
  winnerModel: string | null;
  candidates: CompeatCandidateTrace[];
}

const active = new Map<string, CompeatTrace>();
const recent: CompeatTrace[] = [];
const maxRecent = 50;

function cloneTrace(trace: CompeatTrace): CompeatTrace {
  return {
    ...trace,
    candidates: trace.candidates.map((candidate) => ({ ...candidate, breakdown: candidate.breakdown ? { ...candidate.breakdown } : null }))
  };
}

export function startCompeatTrace(value: Omit<CompeatTrace, 'status' | 'startedAt' | 'completedAt' | 'winnerProviderId' | 'winnerModel'>): CompeatTrace {
  const trace: CompeatTrace = {
    ...value,
    status: 'running',
    startedAt: Date.now(),
    completedAt: null,
    winnerProviderId: null,
    winnerModel: null
  };
  active.set(trace.id, trace);
  return trace;
}

export function updateCompeatCandidate(traceId: string, providerId: ProviderId, value: Partial<Omit<CompeatCandidateTrace, 'providerId'>>): void {
  const trace = active.get(traceId);
  if (!trace) return;
  const candidate = trace.candidates.find((item) => item.providerId === providerId);
  if (!candidate) return;
  Object.assign(candidate, value);
}

export function finishCompeatTrace(traceId: string, value: { status: CompeatTraceStatus; winnerProviderId?: ProviderId; winnerModel?: string }): void {
  const trace = active.get(traceId);
  if (!trace) return;
  trace.status = value.status;
  trace.completedAt = Date.now();
  trace.winnerProviderId = value.winnerProviderId ?? null;
  trace.winnerModel = value.winnerModel ?? null;
  active.delete(traceId);
  recent.unshift(trace);
  if (recent.length > maxRecent) recent.pop();
}

export function listCompeatTraces(): { active: CompeatTrace[]; recent: CompeatTrace[] } {
  return {
    active: [...active.values()].map(cloneTrace),
    recent: recent.map(cloneTrace)
  };
}
