export type Option = { id: string; label: string };

export type Rule = { fieldId: string; equals: string };

export type Field = {
  id: string;
  type: string;
  label: string;
  required?: boolean;
  options?: Option[];
  constraints?: { minLength?: number; maxLength?: number };
  visibleWhen?: Rule;
  visibilityRule?: unknown;
  requiredRule?: unknown;
  requiredRuleField?: string;
  requiredRuleValue?: string;
};

export type Page = { id: string; title: string; fields: Field[] };

export type FormDefinition = {
  contractVersion: string;
  formKey: string;
  title: string;
  pages: Page[];
};

export type ResponseSummary = { id: string; submittedAt?: string; [key: string]: unknown };

export type RepeaterItem = { id: string; value: string };

export const FIELD_TYPES = [
  'text',
  'integer',
  'decimal',
  'date',
  'boolean',
  'choice',
  'multiChoice',
  'object',
  'list',
  'repeater',
  'calculated',
  'readOnly',
];

export const DEFAULT_DEFINITION: FormDefinition = {
  contractVersion: '4.0.0',
  formKey: 'responsive-intake',
  title: 'Responsive intake',
  pages: [
    {
      id: 'contact',
      title: 'Contact details',
      fields: [
        { id: 'name', type: 'text', label: 'Full name', required: true, constraints: {} },
        {
          id: 'contact',
          type: 'choice',
          label: 'Preferred contact',
          options: [
            { id: 'email', label: 'Email' },
            { id: 'phone', label: 'Phone' },
          ],
        },
      ],
    },
    { id: 'details', title: 'Additional details', fields: [{ id: 'date', type: 'date', label: 'Requested date' }] },
  ],
};

export function createDefaultDefinition(): FormDefinition {
  return structuredClone(DEFAULT_DEFINITION);
}
