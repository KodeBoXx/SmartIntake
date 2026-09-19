import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import Ajv2020, { AnySchema, ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { forkJoin, map, Observable } from 'rxjs';

export type ContractDiagnostic = Readonly<{ pointer: string; message: string; keyword: string }>;
export type ContractValidationResult = Readonly<{ kind: string; version: '4.0.0'; valid: boolean; diagnostics: ContractDiagnostic[] }>;

const KINDS = ['package', 'expression', 'input-answer', 'typed-answer', 'runtime-manifest', 'submission-envelope', 'event'] as const;
export type ContractKind = typeof KINDS[number];
const ASSET_ROOT = '/assets/contracts/smart-form-builder-lite/4.0.0';

/** Browser-side Draft 2020-12 validation adapter. It validates local authoring input only; server validation remains authoritative. */
@Injectable({ providedIn: 'root' })
export class AjvContractValidationAdapter {
  private readonly ajv = createAjv();
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

  validate(kind: ContractKind, document: unknown): ContractValidationResult {
    const validate = this.validators.get(kind);
    if (!validate) throw new Error('AJV contract schemas are not loaded');
    const valid = Boolean(validate(document));
    return { kind, version: '4.0.0', valid, diagnostics: (validate.errors ?? []).map(diagnostic) };
  }
}

function createAjv(): Ajv2020 {
  // Schemas intentionally carry x-* contract annotations. Format assertions
  // stay enabled; strict unknown-keyword rejection would reject annotations.
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: true });
  addFormats(ajv, ['date', 'date-time']);
  ajv.addFormat('canonical-int64', {
    type: 'string',
    validate: value => /^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)
      && BigInt(value) >= -(2n ** 63n) && BigInt(value) <= 2n ** 63n - 1n,
  });
  ajv.addFormat('canonical-decimal', {
    type: 'string',
    validate: value => /^(?:0|[1-9][0-9]*(?:\.[0-9]*[1-9])?|-[1-9][0-9]*(?:\.[0-9]*[1-9])?|-0\.[0-9]*[1-9])$/.test(value) && decimalIsBounded(value),
  });
  ajv.addFormat('stored-decimal', {
    type: 'string',
    validate: value => /^(?:0(?:\.[0-9]+)?|[1-9][0-9]*(?:\.[0-9]+)?|-[1-9][0-9]*(?:\.[0-9]+)?|-0\.[0-9]*[1-9][0-9]*)$/.test(value) && decimalIsBounded(value),
  });
  ajv.addFormat('expression-decimal-input', {
    type: 'string',
    validate: value => /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value) && decimalIsBounded(value),
  });
  // Contract times are local wall-clock values, not RFC 3339 offset times.
  ajv.addFormat('time', {
    type: 'string',
    validate: value => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]{1,9})?$/.test(value),
  });
  return ajv;
}

function decimalIsBounded(value: string): boolean {
  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integer, fraction = ''] = unsigned.split('.');
  const coefficient = `${integer}${fraction}`.replace(/^0+/, '');
  if (!coefficient) return true;
  if (coefficient.replace(/0+$/, '').length > 34) return false;
  const integerWithoutLeadingZeroes = integer.replace(/^0+/, '');
  const adjustedExponent = integerWithoutLeadingZeroes
    ? integerWithoutLeadingZeroes.length - 1
    : -(fraction.length - fraction.replace(/^0+/, '').length + 1);
  return adjustedExponent >= -6143 && adjustedExponent <= 6144;
}

function diagnostic(error: ErrorObject): ContractDiagnostic {
  return { pointer: error.instancePath || '', message: error.message ?? 'Schema validation failed', keyword: error.keyword };
}
