/**
 * Browser-side representation of the M4 typed-answer protocol.
 *
 * These types deliberately separate input cells from server cells.  A browser
 * operation may propose an input value, but only a server projection carries
 * the resolved type and provenance used by review/export.
 */
export type AnswerStatus =
  | 'answered'
  | 'unanswered'
  | 'unknown'
  | 'declined'
  | 'respondentNotApplicable'
  | 'notApplicable';

export type FieldType =
  | 'text'
  | 'integer'
  | 'decimal'
  | 'boolean'
  | 'date'
  | 'time'
  | 'dateTime'
  | 'choice'
  | 'multiChoice'
  | 'attachments'
  | 'drawing'
  | 'object'
  | 'list';

export type ServerProvenanceSource = 'system' | 'default' | 'calculated' | 'respondent';

export interface ServerProvenance {
  readonly source: ServerProvenanceSource;
  readonly changedAt: string;
}

export interface RowPathSegment {
  readonly listFieldId: string;
  readonly itemId: string;
}

/** A row is addressed by stable list item IDs, never by an array index. */
export type RowPath = readonly RowPathSegment[];

export interface DateTimeValue {
  readonly instant: string;
  readonly timeZone: string;
}

export interface ObjectValue<Cell> {
  readonly fields: Readonly<Record<string, Cell>>;
}

export interface ListItem<Cell> {
  readonly itemId: string;
  readonly fields: Readonly<Record<string, Cell>>;
}

export interface ListValue<Cell> {
  readonly items: readonly ListItem<Cell>[];
}

export type AnswerValue<Cell> =
  | string
  | boolean
  | readonly string[]
  | DateTimeValue
  | ObjectValue<Cell>
  | ListValue<Cell>;

export type InputAnswerCell =
  | { readonly status: 'answered'; readonly value: AnswerValue<InputAnswerCell> }
  | { readonly status: Exclude<AnswerStatus, 'answered' | 'notApplicable'> };

export type ServerAnswerCell =
  | {
      readonly status: 'answered';
      readonly type: FieldType;
      readonly value: AnswerValue<ServerAnswerCell>;
      readonly provenance: ServerProvenance;
    }
  | {
      readonly status: Exclude<AnswerStatus, 'answered'>;
      readonly type: FieldType;
      readonly provenance: ServerProvenance;
    };

export interface RuntimeFieldDefinition {
  readonly id: string;
  readonly type: FieldType;
  readonly readOnly?: boolean;
  readonly calculated?: boolean;
  readonly allowUnknown?: boolean;
  readonly allowDeclined?: boolean;
  readonly allowNotApplicable?: boolean;
  /** Stored decimals must have precisely this many fractional digits. */
  readonly scale?: number;
  readonly options?: readonly string[];
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly min?: string;
  readonly max?: string;
  readonly step?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly exclusiveOptionIds?: readonly string[];
  readonly normalizer?: 'preserve' | 'trim' | 'lowercase' | 'uppercase';
  readonly hiddenRetention?: 'clear' | 'memory' | 'draft';
  readonly default?: InputAnswerCell;
  /** A fixed matrix/list may only be supplied by the server projection. */
  readonly fixedRows?: boolean;
  readonly fixedItemIds?: readonly string[];
  readonly fields?: readonly RuntimeFieldDefinition[];
  readonly itemFields?: readonly RuntimeFieldDefinition[];
}

export interface RuntimeDefinition {
  readonly fields: readonly RuntimeFieldDefinition[];
}

export interface ServerProjection {
  readonly answers: Readonly<Record<string, ServerAnswerCell>>;
  readonly invalidInputs?: readonly RuntimeTarget[];
}

export interface RuntimeAnswerState {
  /** Locally proposed input cells. They contain no resolved type or provenance. */
  readonly answers: Readonly<Record<string, InputAnswerCell>>;
  /** The last server-authoritative projection, including server-owned provenance. */
  readonly server: ServerProjection | null;
  /** Item IDs are never reused, including after a clear/remove/reconciliation. */
  readonly retiredItemIds: readonly string[];
  /** UI-only validation marker; it does not invent a seventh answer status. */
  readonly invalid: Readonly<Record<string, string>>;
}

export interface RuntimeTarget {
  readonly fieldId: string;
  readonly rowPath?: RowPath;
}

export type RuntimeOperation =
  | {
      readonly kind: 'set';
      readonly target: RuntimeTarget;
      readonly value?: AnswerValue<InputAnswerCell>;
      readonly answer?: InputAnswerCell;
    }
  | { readonly kind: 'clear'; readonly target: RuntimeTarget }
  | { readonly kind: 'markInvalid'; readonly target: RuntimeTarget; readonly reason: 'UNPARSEABLE_INPUT' }
  | {
      readonly kind: 'addItem';
      readonly target: RuntimeTarget;
      readonly itemId: string;
      readonly fields?: Readonly<Record<string, InputAnswerCell>>;
    }
  | { readonly kind: 'removeItem'; readonly target: RuntimeTarget; readonly itemId: string }
  | { readonly kind: 'moveItem'; readonly target: RuntimeTarget; readonly itemId: string; readonly beforeItemId?: string };

export type RuntimeRejection =
  | 'UNKNOWN_FIELD'
  | 'ROW_PATH_INVALID'
  | 'ROW_PATH_DEPTH'
  | 'PROTECTED_FIELD'
  | 'FIXED_ROWS'
  | 'INVALID_VALUE'
  | 'INVALID_STATUS'
  | 'ITEM_ID_INVALID'
  | 'ITEM_ID_REUSED'
  | 'ITEM_NOT_FOUND'
  | 'INDEX_INVALID';

export interface RuntimeMutationResult {
  readonly accepted: boolean;
  readonly state: RuntimeAnswerState;
  readonly rejection?: RuntimeRejection;
}
