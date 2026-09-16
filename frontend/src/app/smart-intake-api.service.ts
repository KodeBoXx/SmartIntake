import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ResponseSummary } from './models/form-definition.models';

@Injectable({ providedIn: 'root' })
export class SmartIntakeApiService {
  constructor(private readonly http: HttpClient) {}

  bootstrap(): Observable<{ staffSession: string }> {
    return this.http.post<{ staffSession: string }>('/v1/auth/bootstrap', {
      email: 'owner@local.test',
      password: 'LocalDevelopmentPassword!',
    });
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

  importDefinition(staffToken: string, formId: string, definition: unknown): Observable<{ revision: number }> {
    return this.http.put<{ revision: number }>(`/v1/workspaces/local/forms/${formId}/definition-import`, definition, {
      headers: new HttpHeaders({ 'X-Staff-Session': staffToken, 'If-Match': '"1"' }),
    });
  }

  exportResponses(staffToken: string): Observable<ResponseSummary[]> {
    return this.http.get<ResponseSummary[]>('/v1/workspaces/local/exports.json', this.staff(staffToken));
  }

  saveDraft(staffToken: string, formKey: string, title: string): Observable<{ id: string; revision?: number }> {
    return this.http.post<{ id: string; revision?: number }>('/v1/workspaces/local/forms', { formKey, title }, this.staff(staffToken));
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
}
