import AsyncStorage from '@react-native-async-storage/async-storage';
import { glossaryTranslate } from './marathiGlossary';
import { prefetchOfflineModel, translateWithOfflineModel } from './paarTranslate';

export { glossaryTranslate } from './marathiGlossary';

const CACHE_KEY = 'en_mr_translate_cache_v1';

let memoryCache: Record<string, string> | null = null;
let memoryCacheLoaded = false;

function cacheKey(text: string) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hasDevanagari(text: string) {
  return /[\u0900-\u097F]/.test(text);
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
  if (keys.length > 2000) {
    for (const old of keys.slice(0, keys.length - 1500)) delete cache[old];
  }
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota */
  }
}

async function translateOnlineMyMemory(text: string): Promise<string | null> {
  try {
    const url =
      'https://api.mymemory.translated.net/get?q='
      + encodeURIComponent(text.slice(0, 450))
      + '&langpair=en|mr';
    const res = await fetch(url);
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
  source: 'glossary' | 'cache' | 'offline-model' | 'online' | 'unchanged';
};

/**
 * English → Marathi for product / brand / category / shop fields.
 * Order: already Marathi → glossary → Paar (desktop/web) → cache → MyMemory online.
 * Paar runs before cache so a poor online result from an earlier session
 * does not permanently block the better offline model.
 */
export async function translateToMarathi(english: string): Promise<TranslateResult> {
  const input = String(english || '').trim().replace(/\s+/g, ' ');
  if (!input) return { text: '', source: 'unchanged' };
  if (hasDevanagari(input) && !mostlyLatin(input)) {
    return { text: input, source: 'unchanged' };
  }

  const gloss = glossaryTranslate(input);
  if (gloss) {
    await remember(input, gloss);
    return { text: gloss, source: 'glossary' };
  }

  const offline = await translateWithOfflineModel(input);
  if (offline) {
    await remember(input, offline);
    return { text: offline, source: 'offline-model' };
  }

  const cache = await loadMemoryCache();
  const cached = cache[cacheKey(input)];
  if (cached && hasDevanagari(cached)) {
    return { text: cached, source: 'cache' };
  }

  const online = await translateOnlineMyMemory(input);
  if (online) {
    await remember(input, online);
    return { text: online, source: 'online' };
  }

  return { text: '', source: 'unchanged' };
}

/** Warm the Paar model on desktop so the first field translate is faster. */
export function prefetchMarathiTranslator(): void {
  prefetchOfflineModel();
}
