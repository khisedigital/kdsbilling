import { Platform, useWindowDimensions } from 'react-native';
import { getDesktopBridge } from '../desktop/bridge';

/** Docked sidebar width on desktop. */
export const SIDEBAR_WIDTH = 292;

/**
 * Desktop keeps the sidebar open: the Electron app, or a wide browser window.
 * Phones keep the slide-over menu.
 */
export function usePinnedSidebar(): boolean {
  const { width } = useWindowDimensions();
  if (Platform.OS !== 'web') return false;
  if (getDesktopBridge()) return true;
  return width >= 900;
}
