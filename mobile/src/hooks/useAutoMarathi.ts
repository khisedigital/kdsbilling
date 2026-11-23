import { useEffect, useRef, useState, useCallback } from 'react';
import {
  translateToMarathi,
  transliterateText,
  transliterateWhileTyping,
  hasDevanagari,
} from '../i18n/translateToMarathi';

type Options = {
  /** When false, never auto-fill from English (default true). */
  enabled?: boolean;
  /** Debounce ms after English stops changing. */
  delayMs?: number;
};

/**
 * Hook for Marathi translation & while-typing transliteration.
 *
 * 1. Auto-translation: When typing in English, auto-fills the Marathi field.
 * 2. While-typing: When typing in the Marathi field, phonetically converts
 *    English letters into Marathi Devanagari (on space, debounce, and blur).
 * 3. Works 100% offline (rule-based engine + offline glossary) and online (AI models).
 */
export function useAutoMarathi(
  english: string,
  marathi: string,
  setMarathi: (value: string) => void,
  opts?: Options,
) {
  const enabled = opts?.enabled !== false;
  const delayMs = opts?.delayMs ?? 450;
  const [translating, setTranslating] = useState(false);

  const lastAutoMrRef = useRef('');
  const lastEnRef = useRef(english.trim());
  const userTypedMrRef = useRef(false);
  const reqId = useRef(0);

  const marathiRef = useRef(marathi);
  marathiRef.current = marathi;

  const englishRef = useRef(english);
  englishRef.current = english;

  const mrDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Handle changes when typing directly in the Marathi input field:
   * - Immediately updates the field so there's zero typing latency.
   * - On word boundary (space / punctuation), converts preceding English word to Marathi.
   * - On pause (350ms debounce), converts any trailing English words to Marathi.
   */
  const onMarathiChange = useCallback(
    (value: string) => {
      userTypedMrRef.current = true;
      if (!value.trim()) {
        lastAutoMrRef.current = '';
        setMarathi('');
        return;
      }

      // Check word boundary transliteration (space or punctuation pressed)
      const { text: wordBoundaryConverted, changed } = transliterateWhileTyping(value);
      if (changed) {
        lastAutoMrRef.current = wordBoundaryConverted;
        setMarathi(wordBoundaryConverted);
        return;
      }

      // Otherwise set the value immediately for smooth typing
      setMarathi(value);

      // Debounce transliteration for words without spaces
      if (mrDebounceTimer.current) clearTimeout(mrDebounceTimer.current);
      if (/[a-zA-Z]/.test(value)) {
        mrDebounceTimer.current = setTimeout(() => {
          const converted = transliterateText(value);
          if (converted && converted !== value) {
            lastAutoMrRef.current = converted;
            setMarathi(converted);
          }
        }, 350);
      }
    },
    [setMarathi],
  );

  /**
   * On blur: ensure any remaining Latin text in the Marathi field is transliterated.
   */
  const onMarathiBlur = useCallback(() => {
    if (mrDebounceTimer.current) clearTimeout(mrDebounceTimer.current);
    const current = marathiRef.current;
    if (current && /[a-zA-Z]/.test(current)) {
      const converted = transliterateText(current);
      if (converted && converted !== current) {
        lastAutoMrRef.current = converted;
        setMarathi(converted);
      }
    }
  }, [setMarathi]);

  /**
   * Manually trigger immediate translation from English (or transliterate Marathi).
   */
  const translateNow = useCallback(async () => {
    const en = englishRef.current.trim();
    const mr = marathiRef.current.trim();

    if (en) {
      setTranslating(true);
      try {
        const result = await translateToMarathi(en);
        if (result.text) {
          lastAutoMrRef.current = result.text;
          userTypedMrRef.current = false;
          setMarathi(result.text);
          return;
        }
      } finally {
        setTranslating(false);
      }
    }

    if (mr && /[a-zA-Z]/.test(mr)) {
      const converted = transliterateText(mr);
      if (converted) {
        lastAutoMrRef.current = converted;
        setMarathi(converted);
      }
    }
  }, [setMarathi]);

  // Auto-translate from English input
  useEffect(() => {
    if (!enabled) return undefined;
    const en = english.trim();
    if (!en) return undefined;

    // Skip if English hasn't changed
    if (en === lastEnRef.current && lastAutoMrRef.current) return undefined;

    const currentMr = marathiRef.current.trim();
    // Allow auto-fill if Marathi is empty OR if it was previously auto-filled
    // OR if the user is editing the English name
    const canAutoFill =
      !currentMr ||
      currentMr === lastAutoMrRef.current ||
      !userTypedMrRef.current ||
      en !== lastEnRef.current;

    if (!canAutoFill) return undefined;

    lastEnRef.current = en;
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      setTranslating(true);
      void translateToMarathi(en)
        .then((result) => {
          if (id !== reqId.current) return;
          if (!result.text) return;
          lastAutoMrRef.current = result.text;
          userTypedMrRef.current = false;
          setMarathi(result.text);
        })
        .finally(() => {
          if (id === reqId.current) setTranslating(false);
        });
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [english, enabled, delayMs, setMarathi]);

  return {
    translating,
    onMarathiChange,
    onMarathiBlur,
    translateNow,
  };
}

/** One-shot translate for table rows (Price Management, etc.). */
export async function fillMarathiFromEnglish(english: string): Promise<string> {
  const result = await translateToMarathi(english);
  return result.text || transliterateText(english);
}

/** Synchronously transliterates Latin text to Marathi Devanagari. */
export function transliterateMarathiField(text: string): string {
  return transliterateText(text);
}
