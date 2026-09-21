export class RetainedMutationKeys {
  private readonly retained = new Map<string, { payload: string; key: string }>();

  key(action: string, resource: string, payload: unknown, create: () => string): string {
    const identity = `${action}:${resource}`;
    const canonicalPayload = canonicalJson(payload);
    const existing = this.retained.get(identity);
    if (existing?.payload === canonicalPayload) return existing.key;
    const key = create();
    this.retained.set(identity, { payload: canonicalPayload, key });
    return key;
  }

  complete(action: string, resource: string): void { this.retained.delete(`${action}:${resource}`); }
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
