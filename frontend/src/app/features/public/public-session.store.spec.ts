import { of } from 'rxjs';
import { PublicSessionStore } from './public-session.store';

describe('PublicSessionStore respondent privacy and initial projection', () => {
  const session = {
    sessionId: 'session-1', revision: 0, locale: 'en', status: 'DRAFT', definition: { flow: { phases: [] } },
    answers: {}, reachablePageIds: [], activePlacementKeys: [], requiredCount: 0, completedRequiredCount: 0,
  } as any;

  it('treats an empty active-placement projection as authoritative and opens zero-step review', () => {
    const api = { respondentReview: () => of({ reviewDigest: 'digest', answers: [], reviewGates: [] }) } as any;
    const router = { navigate: () => Promise.resolve(true) } as any;
    const store = new PublicSessionStore(api, router);
    (store as any).acceptSession(session);
    expect(store.placementProjectionKnown()).toBe(true);
    expect(store.activePlacementKeys()).toEqual([]);
    expect(store.phase()).toBe('review');
    expect(store.progressAnnouncement()).toBe('No answer steps. Review and submit remain.');
    store.ngOnDestroy();
  });

  it('removes durable respondent and receipt capabilities in shared-device mode', () => {
    const store = new PublicSessionStore({} as any, {} as any);
    store.session.set(session); store.token.set('secret'); store.shareId.set('share');
    sessionStorage.setItem('smart-intake.respondent.session-1', 'secret');
    sessionStorage.setItem('smart-intake.receipt.session-1', 'receipt-secret');
    sessionStorage.setItem('smart-intake.respondent.older-session', 'older-secret');
    store.setSharedDevice(true);
    expect(sessionStorage.getItem('smart-intake.respondent.session-1')).toBeNull();
    expect(sessionStorage.getItem('smart-intake.receipt.session-1')).toBeNull();
    expect(sessionStorage.getItem('smart-intake.respondent.older-session')).toBeNull();
    store.ngOnDestroy();
  });

  it('retains the approved iframe origin across route component changes', () => {
    const store = new PublicSessionStore({} as any, {} as any);
    store.setIframeOrigin('https://embed.example.test');
    expect(store.iframeOrigin()).toBe('https://embed.example.test');
    store.ngOnDestroy();
  });

  it('keeps an accepted shared-device receipt in memory across the receipt route', () => {
    const store = new PublicSessionStore({} as any, {} as any);
    store.session.set(session); store.sharedDevice.set(true);
    store.receipt.set({receiptId:'submission-1',receiptCapability:'capability',shareId:'share',submittedAt:'2026-09-22T00:00:00Z'});
    store.restoreReceipt('session-1');
    expect(store.phase()).toBe('receipt');
    expect(store.receipt()?.receiptId).toBe('submission-1');
    store.ngOnDestroy();
  });
});
