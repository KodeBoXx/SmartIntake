export type AuthoringNodeKind = 'field' | 'group' | 'display' | 'reusable-component';

export interface AuthoringNode {
  readonly id: string;
  readonly kind: AuthoringNodeKind;
  readonly label: string;
  readonly control?: string;
  readonly expression?: unknown;
  readonly componentVersion?: string;
}

export interface AuthoringSection {
  readonly id: string;
  readonly title: string;
  readonly nodes: readonly AuthoringNode[];
}

export interface AuthoringPage {
  readonly id: string;
  readonly title: string;
  readonly sections: readonly AuthoringSection[];
}

export interface AuthoringPhase {
  readonly id: string;
  readonly title: string;
  readonly pages: readonly AuthoringPage[];
}

export interface AuthoringDocument {
  readonly id: string;
  readonly revision: number;
  readonly title: string;
  readonly phases: readonly AuthoringPhase[];
  readonly definition?: unknown;
  readonly packageHash?: string;
}

export interface AuthoringHistoryEntry {
  readonly id: string;
  readonly label: string;
  readonly at: string;
  readonly revision?: number;
  readonly impact?: readonly string[];
  readonly undone?: boolean;
}

export interface AuthoringConflict {
  readonly id: string;
  readonly client: AuthoringDocument;
  readonly server: AuthoringDocument;
  readonly message: string;
}

export interface AuthoringComment {
  readonly id: string;
  readonly targetId: string;
  readonly body: string;
  readonly author: string;
  readonly createdAt: string;
}

export interface PresenceMember {
  readonly accountId: string;
  readonly displayName: string;
  readonly selectedId?: string;
  readonly expiresAt?: string;
}

export interface ThemeSettings {
  readonly preset: string;
  readonly themeKey?: string;
  /** Canonical package theme version, distinct from the authoring revision. */
  readonly version?: string;
  readonly revision?: number;
  readonly tokens: Record<string, string>;
  readonly locks: readonly string[];
  readonly preflight: readonly { code: string; severity: 'error' | 'warning'; message: string }[];
  readonly document?: AuthoringDocument;
}

export interface LocaleBundle {
  readonly direction: 'ltr' | 'rtl';
  readonly messages: Record<string, string>;
  readonly pronunciations?: readonly string[];
  readonly reviewState?: 'approved-prd-fixed-values' | 'approved';
}

export type SupportedAuthoringLocale = 'en' | 'hi' | 'ar';

export interface LocaleReview {
  readonly locale: SupportedAuthoringLocale;
  readonly sourceRevision: number;
  readonly status: 'DRAFT' | 'APPROVED';
  readonly reviewedAt?: string | null;
}

/**
 * Guidance is an authored canonical package subtree. Keep its values opaque here
 * so this client preserves governed extensions instead of silently reshaping them.
 */
export type GovernedGuidance = Record<string, unknown>;

export type GovernedContentScope = 'guidance' | 'translations' | 'review';

export interface SpeechResult {
  readonly available: boolean;
  readonly code?: string;
  readonly locale: SupportedAuthoringLocale;
  readonly contentType?: string;
  readonly audioBase64?: string;
  readonly latencyMillis?: number;
}

export interface ContentSettings {
  readonly locale: SupportedAuthoringLocale;
  /** Missing keys are meaningful: the server has not supplied that locale bundle. */
  readonly translations: Partial<Record<SupportedAuthoringLocale, LocaleBundle>>;
  readonly guidance: GovernedGuidance;
  readonly revision?: number;
  readonly localeCompleteness?: Partial<Record<SupportedAuthoringLocale, { present: boolean; complete: boolean }>>;
  readonly localeReviews?: readonly LocaleReview[];
  readonly document?: AuthoringDocument;
}

export interface ReusableComponent {
  readonly id: string;
  readonly key: string;
  readonly version: string;
  readonly name: string;
  readonly description?: string;
}

export interface AuthoringCommand {
  readonly type: 'rename' | 'add-phase' | 'add-page' | 'add-section' | 'add-node' | 'remove-node' | 'move' | 'insert-component' | 'update-field' | 'set-expression' | 'set-route';
  readonly targetId?: string;
  /** Stable ID allocated before both visual and canonical projections are applied. */
  readonly entityId?: string;
  readonly fieldId?: string;
  readonly destinationId?: string;
  readonly label?: string;
  readonly node?: AuthoringNode;
  /** Closed canonical field properties supplied by the visual field inspector. */
  readonly field?: Record<string, unknown>;
  readonly expressionId?: string;
  readonly expression?: unknown;
  readonly route?: { id: string; targetPageId: string; whenExpressionId: string };
  readonly component?: ReusableComponent;
  readonly patches?: readonly import('./authoring-patches').CanonicalPatch[];
}

export interface PreviewResult {
  readonly mode?: 'synthetic';
  readonly packageHash?: string;
  readonly diagnostics?: readonly { code: string; message: string }[];
  readonly syntheticAnswers?: Record<string, unknown>;
  readonly effects: { sessions: 0; submissions: 0; email: 0; webhooks: 0; providers: 0 };
}

export interface AuthoringImportCandidate {
  readonly candidateId: string;
  readonly digest: string;
  readonly baseRevision: number;
  readonly state: 'VALID' | 'INVALID';
  readonly diagnostics: readonly { code: string; pointer: string; message: string }[];
}

export const DEFAULT_AUTHORING_DOCUMENT: AuthoringDocument = {
  id: 'draft', revision: 0, title: 'Untitled intake form', phases: [{
    id: 'phase-intake', title: 'Intake', pages: [{
      id: 'page-details', title: 'Details', sections: [{
        id: 'section-main', title: 'Main questions', nodes: [{ id: 'field-name', kind: 'field', label: 'Full name', control: 'text' }],
      }],
    }],
  }],
};
