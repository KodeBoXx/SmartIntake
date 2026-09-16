import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { FormDefinition, ResponseSummary } from './models/form-definition.models';

type StaffSession = { staffSession: string; workspaceKey?: string };
export type CreatedForm = { id: string; draftId: string; revision: number; definition: FormDefinition };
export type SavedDraft = { revision: number; definition: FormDefinition; diagnostics: unknown[] };
export type PublishedForm = { releaseId: string; version: number; shareId: string; status: string };

@Injectable({ providedIn: 'root' })
export class SmartIntakeApiService {
  constructor(private readonly http: HttpClient) {}

  bootstrap(): Observable<StaffSession> {
    return this.http.post<StaffSession>('/v1/auth/bootstrap', this.localCredentials());
  }

  signIn(): Observable<StaffSession> {
    return this.http.post<StaffSession>('/v1/auth/sign-in', this.localCredentials());
  }

  listResponses(staffToken: string): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>('/v1/workspaces/local/submissions', this.staff(staffToken));
  }

  responseDetail(staffToken: string, id: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/local/submissions/${id}`, this.staff(staffToken));
  }

  exportDefinition(staffToken: string, formId: string): Observable<unknown> {
    return this.http.get<unknown>(`/v1/workspaces/local/forms/${formId}/definition-export`, this.staff(staffToken));
  }

  importDefinition(staffToken: string, formId: string, revision: number, definition: unknown): Observable<{ revision: number }> {
    return this.http.put<{ revision: number }>(`/v1/workspaces/local/forms/${formId}/definition-import`, definition, {
      headers: new HttpHeaders({ 'X-Staff-Session': staffToken, 'If-Match': this.etag(revision) }),
    });
  }

  exportResponses(staffToken: string): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>('/v1/workspaces/local/exports.json', this.staff(staffToken));
  }

  createForm(staffToken: string, formKey: string, title: string): Observable<CreatedForm> {
    return this.http.post<CreatedForm>('/v1/workspaces/local/forms', { formKey, title }, this.staff(staffToken));
  }

  updateDraft(staffToken: string, formId: string, draftId: string, revision: number, definition: FormDefinition): Observable<SavedDraft> {
    return this.http.put<SavedDraft>(`/v1/workspaces/local/forms/${formId}/drafts/${draftId}`, { definition }, {
      headers: new HttpHeaders({ 'X-Staff-Session': staffToken, 'If-Match': this.etag(revision) }),
    });
  }

  publish(staffToken: string, formId: string): Observable<PublishedForm> {
    return this.http.post<PublishedForm>(`/v1/workspaces/local/forms/${formId}/releases`, {}, this.staff(staffToken));
  }

  startSession(formId: string): Observable<{ sessionId: string; respondentSession: string; revision: number }> {
    return this.http.post<{ sessionId: string; respondentSession: string; revision: number }>(`/v1/public/forms/${formId}/sessions`, {});
  }

  patchSession(sessionId: string, respondentToken: string, body: unknown): Observable<{ acceptedRevision: number }> {
    return this.http.patch<{ acceptedRevision: number }>(`/v1/sessions/${sessionId}`, body, this.respondent(respondentToken));
  }

  submitSession(sessionId: string, respondentToken: string, sessionRevision: number): Observable<{ receiptId: string }> {
    return this.http.post<{ receiptId: string }>(`/v1/sessions/${sessionId}/submissions`, { sessionRevision }, this.respondent(respondentToken));
  }

  private staff(staffToken: string) {
    return { headers: new HttpHeaders({ 'X-Staff-Session': staffToken }) };
  }

  private respondent(respondentToken: string) {
    return { headers: new HttpHeaders({ 'X-Respondent-Session': respondentToken }) };
  }

  private localCredentials() {
    return { email: 'owner@local.test', password: 'LocalDevelopmentPassword!' };
  }

  private etag(revision: number) {
    return `"${revision}"`;
  }
}
