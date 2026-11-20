import { useEffect, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent } from 'react-native';

function overlapFromEvent(event: KeyboardEvent): number {
  const windowHeight = Dimensions.get('window').height;
  const screenY = event.endCoordinates?.screenY;
  if (typeof screenY === 'number' && screenY > 0) {
    return Math.max(0, Math.round(windowHeight - screenY));
  }
  const reported = Math.round(event.endCoordinates?.height || 0);
  const screenHeight = Dimensions.get('screen').height;
  if (windowHeight <= screenHeight - reported + 48) return 0;
  return reported;
}

/** Pixels of this window covered by the keyboard. Zero when the window already resized. */
export function useKeyboardOverlap(): number {
  const [overlap, setOverlap] = useState(0);

  useEffect(() => {
    if (Platform.OS === 'web') return undefined;
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      setOverlap(overlapFromEvent(event));
    });
    const hide = Keyboard.addListener(hideEvent, () => setOverlap(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return overlap;
}

/** Height left for a popup once the keyboard and safe areas are removed. */
export function spaceAboveKeyboard(
  windowHeight: number,
  overlap: number,
  topInset = 0,
  bottomInset = 0,
): number {
  const bottom = Math.max(bottomInset, overlap);
  return Math.max(0, windowHeight - topInset - bottom - 16);
}
