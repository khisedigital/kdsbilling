import type { BillDetail } from '../services/businessService';
import { printDraftReceipt, printReceipt } from './receiptPrinter';

type DraftJob = {
  kind: 'draft';
  bill: BillDetail;
  clickSeq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
};

type SavedJob = {
  kind: 'saved';
  billId: string;
  clickSeq: number;
  resolve: () => void;
  reject: (err: unknown) => void;
};

type Job = DraftJob | SavedJob;

/**
 * Synchronous click → queue. Every Print tap is recorded before any encode/USB
 * work, so rapid taps cannot be lost (3 clicks must become 3 slips).
 */
const jobs: Job[] = [];
let draining = false;
const listeners = new Set<(pending: number) => void>();

function pendingCount(): number {
  return jobs.length + (draining ? 1 : 0);
}

function notify() {
  const n = pendingCount();
  listeners.forEach((fn) => {
    try {
      fn(n);
    } catch {
      /* ignore */
    }
  });
}

export function getPendingPrintCount(): number {
  return pendingCount();
}

export function subscribePrintQueue(listener: (pending: number) => void): () => void {
  listeners.add(listener);
  listener(getPendingPrintCount());
  return () => {
    listeners.delete(listener);
  };
}

let clickSeq = 0;

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  notify();
  try {
    while (jobs.length) {
      const job = jobs.shift()!;
      notify();
      const tag = `#${job.clickSeq || '?'}`;
      try {
        console.log('[KDSPOZ] renderer print start', tag, job.kind, 'left=', jobs.length);
        if (job.kind === 'draft') {
          await printDraftReceipt(job.bill);
        } else {
          await printReceipt(job.billId);
        }
        console.log('[KDSPOZ] renderer print done', tag);
        job.resolve();
      } catch (err) {
        console.error('[KDSPOZ] renderer print fail', tag, err);
        job.reject(err);
      }
    }
  } finally {
    draining = false;
    notify();
    if (jobs.length) void drain();
  }
}

/** Queue a draft bill print. Resolves when that slip has been accepted by the OS. */
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
