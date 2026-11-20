import { useEffect, useRef, useState } from 'react';
import { translateToMarathi } from '../i18n/translateToMarathi';

type Options = {
  /** When false, never auto-fill (default true). */
  enabled?: boolean;
  /** Debounce ms after English stops changing. */
  delayMs?: number;
};

/**
 * When the user types English, auto-fill the Marathi field.
 * Never overwrites an existing Marathi value unless it was our own last auto-fill
 * (so edits and loaded records stay intact).
 */
export function useAutoMarathi(
  english: string,
  marathi: string,
  setMarathi: (value: string) => void,
  opts?: Options,
) {
  const enabled = opts?.enabled !== false;
  const delayMs = opts?.delayMs ?? 550;
  const lastAutoRef = useRef('');
  const [translating, setTranslating] = useState(false);
  const reqId = useRef(0);
  const marathiRef = useRef(marathi);
  marathiRef.current = marathi;

  const onMarathiChange = (value: string) => {
    // Clearing Marathi allows auto-fill again on the next English change.
    if (!value.trim()) lastAutoRef.current = '';
    setMarathi(value);
  };

  useEffect(() => {
    if (!enabled) return undefined;
    const en = english.trim();
    if (!en) return undefined;

    const currentMr = marathiRef.current.trim();
    // Preserve loaded / manually typed Marathi.
    if (currentMr && currentMr !== lastAutoRef.current) return undefined;

    const id = ++reqId.current;
    const timer = setTimeout(() => {
      setTranslating(true);
      void translateToMarathi(en)
        .then((result) => {
          if (id !== reqId.current) return;
          if (!result.text) return;
          const latest = marathiRef.current.trim();
          if (latest && latest !== lastAutoRef.current) return;
          lastAutoRef.current = result.text;
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

  return { translating, onMarathiChange };
}

/** One-shot translate for table rows (Price Management). */
export async function fillMarathiFromEnglish(english: string): Promise<string> {
  const result = await translateToMarathi(english);
  return result.text || '';
}
