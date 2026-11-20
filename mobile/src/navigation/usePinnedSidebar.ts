import { useWindowDimensions } from 'react-native';
import { getDesktopBridge } from '../desktop/bridge';

/** Docked sidebar width on desktop / tablets. */
export const SIDEBAR_WIDTH = 292;

/**
 * Keep the sidebar open on Electron, wide tablets, and wide browser windows.
 * Phones keep the slide-over menu.
 */
export function usePinnedSidebar(): boolean {
  const { width } = useWindowDimensions();
  if (getDesktopBridge()) return true;
  return width >= 900;
}
