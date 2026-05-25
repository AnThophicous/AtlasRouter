import type { ProviderId } from '../types/router.js';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface RouterAlert {
  id: string;
  severity: AlertSeverity;
  providerId?: ProviderId;
  code: string;
  message: string;
  createdAt: number;
  resolvedAt: number | null;
}

const alerts: RouterAlert[] = [];
const MAX_ALERTS = 200;

function alertId(): string {
  return `alert-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function recordAlert(value: Omit<RouterAlert, 'id' | 'createdAt' | 'resolvedAt'>): RouterAlert {
  const activeDuplicate = alerts.find((alert) => (
    alert.resolvedAt === null &&
    alert.providerId === value.providerId &&
    alert.code === value.code
  ));

  if (activeDuplicate) return activeDuplicate;

  const alert: RouterAlert = {
    id: alertId(),
    createdAt: Date.now(),
    resolvedAt: null,
    ...value
  };

  alerts.unshift(alert);
  if (alerts.length > MAX_ALERTS) alerts.pop();
  console.warn(`[AtlasRouter] ${alert.severity.toUpperCase()} ${alert.code}: ${alert.message}`);
  return alert;
}

export function resolveAlerts(providerId: ProviderId, codes: string[]): void {
  const now = Date.now();
  for (const alert of alerts) {
    if (alert.providerId === providerId && codes.includes(alert.code) && alert.resolvedAt === null) {
      alert.resolvedAt = now;
    }
  }
}

export function listAlerts(includeResolved = false): RouterAlert[] {
  return alerts
    .filter((alert) => includeResolved || alert.resolvedAt === null)
    .map((alert) => ({ ...alert }));
}
