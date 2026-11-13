import { MAKERWORLD_SIGN_IN_CLEANUP_JS } from '@/utils/makerworldSignInCleanup';

describe('MakerWorld sign-in cleanup script', () => {
  it('is valid JavaScript that ends with true (required by WKWebView)', () => {
    // eslint-disable-next-line no-new-func
    expect(() => new Function(MAKERWORLD_SIGN_IN_CLEANUP_JS)).not.toThrow();
    expect(MAKERWORLD_SIGN_IN_CLEANUP_JS.trim().endsWith('true;')).toBe(true);
  });
  it('never presses the Bambu Handy button and never accepts cookies', () => {
    expect(MAKERWORLD_SIGN_IN_CLEANUP_JS).toContain('if (!HANDY.test(buttons[i].textContent');
    expect(MAKERWORLD_SIGN_IN_CLEANUP_JS).not.toMatch(/accept/i);
  });
});
