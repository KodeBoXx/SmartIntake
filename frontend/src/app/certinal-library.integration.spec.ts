import { CERTINAL_UI_VERSION, CuiButtonComponent, CuiDrawerComponent, CuiToastService } from '@certinal/ui';

describe('@certinal/ui local materialization', () => {
  it('resolves the pinned public API through the Angular workspace path', () => {
    expect(CERTINAL_UI_VERSION).toBe('0.0.1');
    expect(CuiButtonComponent).toBeDefined();
    expect(CuiDrawerComponent).toBeDefined();
    expect(CuiToastService).toBeDefined();
  });
});
