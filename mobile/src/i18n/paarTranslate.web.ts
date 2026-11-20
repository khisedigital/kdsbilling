/**
 * Desktop / browser: Paar EN→MR via @huggingface/transformers (Apache-2.0).
 * First run downloads ~29 MB ONNX weights; after that it works fully offline.
 */
const MODEL_ID = 'udgamlabs/Paar-en-mr';

type TranslatePipe = (
  text: string,
  opts?: { max_new_tokens?: number },
) => Promise<Array<{ translation_text?: string }> | { translation_text?: string }>;

let pipelinePromise: Promise<TranslatePipe | null> | null = null;
let pipelineFailed = false;

function hasDevanagari(text: string) {
  return /[\u0900-\u097F]/.test(text);
}

async function getPipeline(): Promise<TranslatePipe | null> {
  if (pipelinePromise) return pipelinePromise;

  pipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      // Browser / Electron IndexedDB cache — keeps the model after first download.
      env.allowLocalModels = false;
      env.useBrowserCache = true;
      const pipe = await pipeline('translation', MODEL_ID, {
        dtype: 'q8',
      });
      pipelineFailed = false;
      return pipe as unknown as TranslatePipe;
    } catch (err) {
      console.warn('[paarTranslate] model unavailable', err);
      pipelineFailed = true;
      // Allow a later retry (network blip / first-load WASM race).
      pipelinePromise = null;
      return null;
    }
  })();

  return pipelinePromise;
}

export async function translateWithOfflineModel(text: string): Promise<string | null> {
  const pipe = await getPipeline();
  if (!pipe) return null;
  try {
    const result = await pipe(text, { max_new_tokens: 120 });
    const row = Array.isArray(result) ? result[0] : result;
    const translated = String(row?.translation_text || '')
      .replace(/⁇/g, '')
      .trim();
    if (!translated || !hasDevanagari(translated)) return null;
    return translated;
  } catch (err) {
    console.warn('[paarTranslate] failed', err);
    return null;
  }
}

export function prefetchOfflineModel(): void {
  // Don't spin forever if the last attempt already failed this session —
  // still allow one warm-up, and getPipeline() clears itself on failure.
  if (pipelineFailed && !pipelinePromise) {
    // Soft retry after a short delay so app open is not blocked.
    setTimeout(() => {
      void getPipeline();
    }, 2500);
    return;
  }
  void getPipeline();
}
