import { Alert } from 'react-native';
import { t } from '../i18n';
import type { BillDetail } from '../services/businessService';
import { printDraftReceipt, printReceipt } from './receiptPrinter';

export type DraftJob = {
  kind: 'draft';
  bill: BillDetail;
  clickSeq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
};

export type SavedJob = {
  kind: 'saved';
  billId: string;
  clickSeq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
};

export type Job = DraftJob | SavedJob;

export type FailedPrintJob = {
  kind: 'draft' | 'saved';
  bill?: BillDetail;
  billId?: string;
  clickSeq: number;
  failedAt: number;
  error: string;
};

export type RetryAction = 'retry' | 'later';
export type PromptHandler = (job: Job, err: unknown) => Promise<RetryAction>;

/**
 * Synchronous click → queue. Every Print tap is recorded before any encode/USB
 * work, so rapid taps cannot be lost (3 clicks must become 3 slips).
 */
const jobs: Job[] = [];
const failedJobs: FailedPrintJob[] = [];
let draining = false;
let promptHandler: PromptHandler | null = null;
const listeners = new Set<(pending: number, failed: number) => void>();

function pendingCount(): number {
  return jobs.length + (draining ? 1 : 0);
}

function notify() {
  const p = pendingCount();
  const f = failedJobs.length;
  listeners.forEach((fn) => {
    try {
      fn(p, f);
    } catch {
      /* ignore */
    }
  });
}

export function getPendingPrintCount(): number {
  return pendingCount();
}

export function getFailedPrintCount(): number {
  return failedJobs.length;
}

export function getFailedPrintJobs(): readonly FailedPrintJob[] {
  return [...failedJobs];
}

export function setPromptHandlerForTest(handler: PromptHandler | null): void {
  promptHandler = handler;
}

export function subscribePrintQueue(listener: (pending: number, failed: number) => void): () => void {
  listeners.add(listener);
  listener(getPendingPrintCount(), getFailedPrintCount());
  return () => {
    listeners.delete(listener);
  };
}

let clickSeq = 0;

function promptRetryDialog(job: Job, err: unknown): Promise<RetryAction> {
  if (promptHandler) {
    return promptHandler(job, err);
  }
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (action: RetryAction) => {
      if (!resolved) {
        resolved = true;
        resolve(action);
      }
    };

    const rawMessage = (err instanceof Error ? err.message : typeof err === 'string' ? err : '').trim();
    const explanation = rawMessage ? `${rawMessage}\n\n` : '';
    const body = `${explanation}${t('Printer offline / Out of paper — Retry or Reprint Later')}`;

    try {
      Alert.alert(
        t('Printer offline / Out of paper'),
        body,
        [
          {
            text: t('Reprint Later'),
            style: 'cancel',
            onPress: () => finish('later'),
          },
          {
            text: t('Retry'),
            onPress: () => finish('retry'),
          },
        ],
        {
          cancelable: true,
          onDismiss: () => finish('later'),
        },
      );
    } catch {
      finish('later');
    }
  });
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  notify();
  try {
    while (jobs.length) {
      const job = jobs.shift()!;
      notify();
      const tag = `#${job.clickSeq || '?'}`;

      let handled = false;
      while (!handled) {
        try {
          console.log('[KDSPOZ] renderer print start', tag, job.kind, 'left=', jobs.length);
          if (job.kind === 'draft') {
            await printDraftReceipt(job.bill);
          } else {
            await printReceipt(job.billId);
          }
          console.log('[KDSPOZ] renderer print done', tag);
          // If this slip was previously logged in failedJobs, remove it on success
          const existingIdx = failedJobs.findIndex((f) => f.clickSeq === job.clickSeq);
          if (existingIdx !== -1) {
            failedJobs.splice(existingIdx, 1);
            notify();
          }
          job.resolve();
          handled = true;
        } catch (err) {
          console.error('[KDSPOZ] renderer print fail', tag, err);
          const errString = (err instanceof Error ? err.message : String(err)) || 'Printer error';

          // Retain failed slip in retry queue
          const failedEntry: FailedPrintJob = {
            kind: job.kind,
            bill: job.kind === 'draft' ? job.bill : undefined,
            billId: job.kind === 'saved' ? job.billId : undefined,
            clickSeq: job.clickSeq,
            failedAt: Date.now(),
            error: errString,
          };
          const existingIdx = failedJobs.findIndex((f) => f.clickSeq === job.clickSeq);
          if (existingIdx !== -1) {
            failedJobs[existingIdx] = failedEntry;
          } else {
            failedJobs.push(failedEntry);
          }
          notify();

          // Prompt cashier: "Printer offline / Out of paper — Retry or Reprint Later"
          const action = await promptRetryDialog(job, err);
          if (action === 'retry') {
            console.log('[KDSPOZ] cashier requested retry for', tag);
            // Loop repeats and retries printing the same slip
            continue;
          } else {
            console.log('[KDSPOZ] cashier chose reprint later for', tag);
            // Retained in failedJobs for later reprint. Settle this job invocation so UI unblocks.
            job.resolve();
            handled = true;
          }
        }
      }
    }
  } finally {
    draining = false;
    notify();
    if (jobs.length) void drain();
  }
}

/** Queue a draft bill print. Resolves when that slip has been accepted by the OS or retained in retry queue. */
export function enqueueDraftPrint(bill: BillDetail): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const seq = (clickSeq += 1);
    jobs.push({ kind: 'draft', bill, resolve, reject, clickSeq: seq });
    console.log('[KDSPOZ] renderer enqueue', `#${seq}`, 'draft', 'depth=', jobs.length);
    notify();
    void drain();
  });
}

/** Queue a saved-bill reprint. */
export function enqueueSavedPrint(billId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const seq = (clickSeq += 1);
    jobs.push({ kind: 'saved', billId, resolve, reject, clickSeq: seq });
    console.log('[KDSPOZ] renderer enqueue', `#${seq}`, 'saved', 'depth=', jobs.length);
    notify();
    void drain();
  });
}

/** Retry all failed slips currently held in the retry queue. */
export async function retryFailedPrints(): Promise<void> {
  if (!failedJobs.length) return;
  const toRetry = [...failedJobs];
  failedJobs.length = 0;
  notify();

  for (const item of toRetry) {
    if (item.kind === 'draft' && item.bill) {
      await enqueueDraftPrint(item.bill);
    } else if (item.kind === 'saved' && item.billId) {
      await enqueueSavedPrint(item.billId);
    }
  }
}

/** Retry a specific failed slip by its clickSeq. */
export async function retryFailedPrint(clickSeq: number): Promise<void> {
  const idx = failedJobs.findIndex((j) => j.clickSeq === clickSeq);
  if (idx === -1) return;
  const [item] = failedJobs.splice(idx, 1);
  notify();

  if (item.kind === 'draft' && item.bill) {
    await enqueueDraftPrint(item.bill);
  } else if (item.kind === 'saved' && item.billId) {
    await enqueueSavedPrint(item.billId);
  }
}

/** Clear all slips from the retry queue. */
export function clearFailedPrints(): void {
  failedJobs.length = 0;
  notify();
}
