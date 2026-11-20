/**
 * USB / Bluetooth barcode scanners type the code and then send Enter.
 * That Enter must not press Print, Complete, New bill, or any other focused button.
 * A second Enter (CR+LF) is swallowed too.
 */

const GAP_MS = 80;
const TAIL_MS = 500;

function isTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
}

function isPressable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el?.closest || isTextField(el)) return false;
  return Boolean(el.closest('button, [role="button"], [tabindex]'));
}

export function installBarcodeScannerGuard(): () => void {
  if (typeof window === 'undefined') return () => {};

  let buffer = '';
  let lastKey = 0;
  let blockUntil = 0;

  const swallow = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const now = Date.now();
    const key = event.key === 'NumpadEnter' ? 'Enter' : event.key;

    if (now - lastKey > GAP_MS) buffer = '';
    lastKey = now;

    if (key === 'Enter') {
      const code = buffer.trim();
      buffer = '';
      const scan = code.length >= 3;
      const tail = now < blockUntil;
      if (scan || tail || isPressable(event.target)) {
        if (scan || tail) blockUntil = now + TAIL_MS;
        swallow(event);
        if (isPressable(event.target)) {
          (event.target as HTMLElement).blur?.();
        }
      }
      return;
    }

    if ((key === ' ' || key === 'Spacebar') && (isPressable(event.target) || now < blockUntil)) {
      swallow(event);
      return;
    }

    if (key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      buffer += key;
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const key = event.key === 'NumpadEnter' ? 'Enter' : event.key;
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    if (isPressable(event.target) || Date.now() < blockUntil) swallow(event);
  };

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
  };
}
