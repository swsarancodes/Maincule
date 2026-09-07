import { create } from 'zustand';
import { persist, createJSONStorage, StateStorage } from 'zustand/middleware';
import { ViewMode } from '../../editor/modes/view-mode';

export type AppTheme = 'light' | 'dark' | 'system';

export interface SettingsState {
  theme: AppTheme;
  mode: ViewMode;
  sidebarOpen: boolean;
  outlineOpen: boolean;
  searchModalOpen: boolean;
  typewriterMode: boolean;
  focusMode: 'off' | 'sentence' | 'paragraph';
  fontSize: number;
  lineMeasure: string;

  setTheme: (theme: AppTheme) => void;
  setMode: (mode: ViewMode) => void;
  toggleSidebar: () => void;
  toggleOutline: () => void;
  setSearchModalOpen: (open: boolean) => void;
  toggleSearchModal: () => void;
  toggleTypewriter: () => void;
  setFocusMode: (mode: 'off' | 'sentence' | 'paragraph') => void;
  setFontSize: (size: number) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'light',
      mode: 'hybrid',
      sidebarOpen: true,
      outlineOpen: false,
      searchModalOpen: false,
      typewriterMode: false,
      focusMode: 'off',
      fontSize: 16,
      lineMeasure: '72ch',

      setTheme: (theme) => set({ theme }),
      setMode: (mode) => set({ mode }),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      toggleOutline: () => set((state) => ({ outlineOpen: !state.outlineOpen })),
      setSearchModalOpen: (searchModalOpen) => set({ searchModalOpen }),
      toggleSearchModal: () => set((state) => ({ searchModalOpen: !state.searchModalOpen })),
      toggleTypewriter: () => set((state) => ({ typewriterMode: !state.typewriterMode })),
      setFocusMode: (focusMode) => set({ focusMode }),
      setFontSize: (fontSize) => set({ fontSize }),
    }),
    {
      name: 'manicule_settings',
      storage: createJSONStorage(() => settingsStorage),
      // searchModalOpen is transient UI; outline follows the doc.
      partialize: (s) => ({
        theme: s.theme,
        mode: s.mode,
        sidebarOpen: s.sidebarOpen,
        typewriterMode: s.typewriterMode,
        focusMode: s.focusMode,
        fontSize: s.fontSize,
        lineMeasure: s.lineMeasure,
      }),
    }
  )
);

const settingsStorage: StateStorage = {
  getItem: (name) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) return window.localStorage.getItem(name);
    } catch {}
    return null;
  },
  setItem: (name, value) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(name, value);
    } catch {}
  },
  removeItem: (name) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) window.localStorage.removeItem(name);
    } catch {}
  },
};
