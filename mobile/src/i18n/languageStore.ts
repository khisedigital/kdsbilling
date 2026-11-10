import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type AppLanguage = 'en' | 'mr';

const UI_KEY = 'kdspoz.uiLanguage';
const BILL_KEY = 'kdspoz.billLanguage';

function parseLang(value: string | null | undefined): AppLanguage {
  return value === 'mr' ? 'mr' : 'en';
}

type LanguageState = {
  ui: AppLanguage;
  bill: AppLanguage;
  ready: boolean;
  setUi: (lang: AppLanguage) => void;
  setBill: (lang: AppLanguage) => void;
  hydrate: () => Promise<void>;
};

export const useLanguageStore = create<LanguageState>((set, get) => ({
  ui: 'en',
  bill: 'en',
  ready: false,
  setUi: (lang) => {
    set({ ui: lang });
    AsyncStorage.setItem(UI_KEY, lang).catch(() => {});
  },
  setBill: (lang) => {
    set({ bill: lang });
    AsyncStorage.setItem(BILL_KEY, lang).catch(() => {});
  },
  hydrate: async () => {
    if (get().ready) return;
    try {
      const pairs = await AsyncStorage.multiGet([UI_KEY, BILL_KEY]);
      const stored: Record<string, string | null> = {};
      for (const [key, value] of pairs) stored[key] = value;
      set({
        ui: parseLang(stored[UI_KEY]),
        bill: parseLang(stored[BILL_KEY]),
        ready: true,
      });
    } catch {
      set({ ready: true });
    }
  },
}));
