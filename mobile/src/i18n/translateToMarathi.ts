import AsyncStorage from '@react-native-async-storage/async-storage';
import { glossaryTranslate } from './marathiGlossary';
import { prefetchOfflineModel, translateWithOfflineModel } from './paarTranslate';
import {
  hasDevanagari,
  transliterateText,
  transliterateOnline,
} from './marathiTransliterate';

export { glossaryTranslate } from './marathiGlossary';
export {
  hasDevanagari,
  transliterateText,
  transliterateWord,
  transliterateWhileTyping,
  transliterateOnline,
} from './marathiTransliterate';

const CACHE_KEY = 'en_mr_translate_cache_v3';

let memoryCache: Record<string, string> | null = null;
let memoryCacheLoaded = false;

function cacheKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function mostlyLatin(text: string) {
  const letters = text.replace(/[^A-Za-z\u0900-\u097F]/g, '');
  if (!letters) return false;
  const latin = (letters.match(/[A-Za-z]/g) || []).length;
  return latin / letters.length >= 0.6;
}

async function loadMemoryCache() {
  if (memoryCacheLoaded) return memoryCache || {};
  memoryCacheLoaded = true;
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    memoryCache = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    memoryCache = {};
  }
  return memoryCache!;
}

async function remember(english: string, marathi: string) {
  const key = cacheKey(english);
  if (!key || !marathi) return;
  const cache = await loadMemoryCache();
  if (cache[key] === marathi) return;
  cache[key] = marathi;
  memoryCache = cache;
  const keys = Object.keys(cache);
  if (keys.length > 3000) {
    for (const old of keys.slice(0, keys.length - 2000)) delete cache[old];
  }
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore storage quota */
  }
}

/** Google Translate free web translation endpoint */
async function translateOnlineGoogle(text: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=mr&dt=t&q=' +
      encodeURIComponent(text.slice(0, 500));
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    if (Array.isArray(data) && Array.isArray(data[0])) {
      const translated = data[0]
        .map((segment: any) => (Array.isArray(segment) ? segment[0] : ''))
        .join('')
        .trim();
      if (translated && hasDevanagari(translated)) {
        return translated;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** MyMemory translation fallback */
async function translateOnlineMyMemory(text: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const url =
      'https://api.mymemory.translated.net/get?q=' +
      encodeURIComponent(text.slice(0, 450)) +
      '&langpair=en|mr';
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responseData?: { translatedText?: string };
      responseStatus?: number;
    };
    if (data.responseStatus !== 200) return null;
    const translated = String(data.responseData?.translatedText || '').trim();
    if (!translated || !hasDevanagari(translated)) return null;
    if (cacheKey(translated) === cacheKey(text)) return null;
    return translated;
  } catch {
    return null;
  }
}

export type TranslateResult = {
  text: string;
  source: 'glossary' | 'cache' | 'offline-model' | 'translit' | 'online' | 'unchanged';
};

/**
 * English → Marathi translation for product / brand / category / shop fields.
 * Works both ONLINE (Google Translate + Google Input Tools + MyMemory)
 * and OFFLINE (Offline Glossary + Local Cache + Offline Phonetic Transliteration Engine).
 */
export async function translateToMarathi(english: string): Promise<TranslateResult> {
  const input = String(english || '').trim().replace(/\s+/g, ' ');
  if (!input) return { text: '', source: 'unchanged' };

  // Already Marathi Devanagari text
  if (hasDevanagari(input) && !mostlyLatin(input)) {
    return { text: input, source: 'unchanged' };
  }

  // 1. Offline Glossary lookup (instant & offline)
  const gloss = glossaryTranslate(input);
  if (gloss) {
    await remember(input, gloss);
    return { text: gloss, source: 'glossary' };
  }

  // 2. Local memory / AsyncStorage cache
  const cache = await loadMemoryCache();
  const cached = cache[cacheKey(input)];
  if (cached && hasDevanagari(cached)) {
    return { text: cached, source: 'cache' };
  }

  // 3. Online AI translation (Google Translate GTX)
  const onlineGoogle = await translateOnlineGoogle(input);
  if (onlineGoogle) {
    await remember(input, onlineGoogle);
    return { text: onlineGoogle, source: 'online' };
  }

  // 4. MyMemory online fallback translation
  const onlineMyMemory = await translateOnlineMyMemory(input);
  if (onlineMyMemory) {
    await remember(input, onlineMyMemory);
    return { text: onlineMyMemory, source: 'online' };
  }

  // 5. Desktop offline HuggingFace model (if loaded/available)
  const offlineModel = await translateWithOfflineModel(input);
  if (offlineModel) {
    await remember(input, offlineModel);
    return { text: offlineModel, source: 'offline-model' };
  }

  // 6. Online Input Tools transliteration (fallback for proper nouns & brand names)
  const onlineInputTools = await transliterateOnline(input);
  if (onlineInputTools) {
    await remember(input, onlineInputTools);
    return { text: onlineInputTools, source: 'translit' };
  }

  // 7. Offline rule-based phonetic transliteration engine (works 100% offline!)
  const translit = transliterateText(input);
  if (translit && hasDevanagari(translit)) {
    await remember(input, translit);
    return { text: translit, source: 'translit' };
  }

  return { text: input, source: 'unchanged' };
}

/** Warm the translator on desktop / web so the first field translate is faster. */
export function prefetchMarathiTranslator(): void {
  prefetchOfflineModel();
  void loadMemoryCache();
}
