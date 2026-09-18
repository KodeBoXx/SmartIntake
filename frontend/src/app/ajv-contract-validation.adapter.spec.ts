import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AjvContractValidationAdapter, ContractKind } from './ajv-contract-validation.adapter';
import { negativeFixtures, positiveFixtures } from './generated/contract-fixtures';
import { contractSchemas } from './generated/contract-schemas';

const KINDS: ContractKind[] = ['package', 'expression', 'input-answer', 'typed-answer', 'runtime-manifest', 'submission-envelope', 'event'];

describe('AjvContractValidationAdapter', () => {
  let adapter: AjvContractValidationAdapter;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    adapter = TestBed.inject(AjvContractValidationAdapter);
    http = TestBed.inject(HttpTestingController);
    adapter.load().subscribe();
    for (const kind of KINDS) http.expectOne(`/assets/contracts/smart-form-builder-lite/4.0.0/${kind}.schema.json`).flush(contractSchemas[kind]);
  });
  afterEach(() => http.verify());

  it('accepts every positive fixture and rejects every independent negative fixture', () => {
    for (const kind of KINDS) {
      expect(adapter.validate(kind, positiveFixtures[kind] as Record<string, unknown>)).toMatchObject({ kind, version: '4.0.0', valid: true, diagnostics: [] });
      const invalid = adapter.validate(kind, negativeFixtures[kind] as Record<string, unknown>);
      expect(invalid.valid).toBe(false);
      expect(invalid.diagnostics.length).toBeGreaterThan(0);
      expect(invalid.diagnostics.every(diagnostic => diagnostic.pointer.startsWith('/') || diagnostic.pointer === '')).toBe(true);
    }
  });

  it('keeps canonical int64 and decimal strings and validates recursive answer items', () => {
    const input = positiveFixtures['input-answer'];
    const typed = positiveFixtures['typed-answer'];
    expect(typeof input.value.items[0].fields.child.value).toBe('string');
    expect(input.value.items[0].fields.child.value).toBe('9007199254740993');
    expect(typeof typed.value.items[0].fields.amount.value).toBe('string');
    expect(typed.value.items[0].fields.amount.value).toBe('44.75');
    expect(adapter.validate('input-answer', input as Record<string, unknown>).valid).toBe(true);
    expect(adapter.validate('typed-answer', typed as Record<string, unknown>).valid).toBe(true);
  });
});
