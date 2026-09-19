import { ActivatedRoute } from '@angular/router';
import { M5StubState } from '../core/m5-session.store';

const supported = new Set<M5StubState>([
  'ready', 'loading', 'empty', 'invalid', 'denied', 'expired', 'email-unavailable',
  'offline', 'stale', 'closed', 'pending', 'succeeded', 'failed', 'tombstone',
  'conflict', 'error', 'acknowledgment',
]);

export function m5RouteState(route: ActivatedRoute, fallback: M5StubState = 'ready'): M5StubState {
  const requested = route.snapshot.queryParamMap.get('state') as M5StubState | null;
  return requested && supported.has(requested) ? requested : fallback;
}

export function titleCase(value: string): string {
  return value.split('-').map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ');
}
