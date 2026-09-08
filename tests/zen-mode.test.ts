import { describe, test, expect, beforeAll } from 'bun:test';
import { GlobalWindow } from 'happy-dom';
import { useSettingsStore } from '../src/app/stores/settings';

beforeAll(() => {
  if (typeof (global as any).window === 'undefined') {
    const window = new GlobalWindow();
    (global as any).window = window;
    (global as any).document = window.document;
    (global as any).localStorage = window.localStorage;
  }
});

describe('zen mode (C3)', () => {
  test('toggles and exits via setter', () => {
    const s0 = useSettingsStore.getState();
    expect(s0.zenMode).toBe(false);
    s0.toggleZenMode();
    expect(useSettingsStore.getState().zenMode).toBe(true);
    useSettingsStore.getState().setZenMode(false);
    expect(useSettingsStore.getState().zenMode).toBe(false);
  });

  test('zen setter is idempotent and exits cleanly', () => {
    useSettingsStore.getState().setZenMode(true);
    expect(useSettingsStore.getState().zenMode).toBe(true);
    useSettingsStore.getState().setZenMode(true);
    expect(useSettingsStore.getState().zenMode).toBe(true);
    useSettingsStore.getState().setZenMode(false);
    expect(useSettingsStore.getState().zenMode).toBe(false);
  });
});
