import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import Ajv2020, { AnySchema, ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import { forkJoin, map, Observable } from 'rxjs';
import type { ContractBase } from './generated/contracts';

export type ContractDiagnostic = Readonly<{ pointer: string; message: string; keyword: string }>;
export type ContractValidationResult = Readonly<{ kind: string; version: '4.0.0'; valid: boolean; diagnostics: ContractDiagnostic[] }>;

const KINDS = ['package', 'expression', 'input-answer', 'typed-answer', 'runtime-manifest', 'submission-envelope', 'event'] as const;
export type ContractKind = typeof KINDS[number];
const ASSET_ROOT = '/assets/contracts/smart-form-builder-lite/4.0.0';

/** Browser-side Draft 2020-12 validation adapter. It validates local authoring input only; server validation remains authoritative. */
@Injectable({ providedIn: 'root' })
export class AjvContractValidationAdapter {
  private readonly ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  private readonly validators = new Map<ContractKind, ValidateFunction>();

  constructor(private readonly http: HttpClient) {}

  load(): Observable<void> {
    return forkJoin(KINDS.map(kind => this.http.get<AnySchema>(`${ASSET_ROOT}/${kind}.schema.json`))).pipe(
      map(schemas => {
        schemas.forEach(schema => this.ajv.addSchema(schema));
        KINDS.forEach(kind => {
          const id = `https://kodeboxx.example/contracts/smart-form-builder-lite/4.0.0/${kind}.schema.json`;
          const validate = this.ajv.getSchema(id);
          if (!validate) throw new Error(`Missing compiled schema ${kind}@4.0.0`);
          this.validators.set(kind, validate);
        });
      }),
    );
  }

  validate(kind: ContractKind, document: ContractBase | Record<string, unknown>): ContractValidationResult {
    const validate = this.validators.get(kind);
    if (!validate) throw new Error('AJV contract schemas are not loaded');
    const valid = Boolean(validate(document));
    return { kind, version: '4.0.0', valid, diagnostics: (validate.errors ?? []).map(diagnostic) };
  }
}

function diagnostic(error: ErrorObject): ContractDiagnostic {
  return { pointer: error.instancePath || '', message: error.message ?? 'Schema validation failed', keyword: error.keyword };
}
