import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';
import type { RootStackParamList } from './AppNavigator';
import type { MainStackParamList } from './MainNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateMainScreen<K extends keyof MainStackParamList>(
  screen: K,
  params?: MainStackParamList[K],
) {
  if (!navigationRef.isReady()) return;

  const innerRoutes =
    screen === 'Dashboard'
      ? [{ name: 'Dashboard' as const }]
      : [
          { name: 'Dashboard' as const },
          { name: screen as string, params },
        ];

  const action = CommonActions.reset({
    index: innerRoutes.length - 1,
    routes: innerRoutes,
  });

  // Reset only the inner stack. Resetting the root remounts the desktop sidebar
  // and jumps its scroll position back to the top.
  const root = navigationRef.getRootState();
  const mainRoute = root.routes.find((route) => route.name === 'Main');
  const nestedKey = mainRoute?.state?.key;
  if (nestedKey) {
    navigationRef.dispatch({ ...action, target: nestedKey });
    return;
  }

  navigationRef.dispatch(
    CommonActions.reset({
      index: 0,
      routes: [
        {
          name: 'Main',
          state: {
            index: innerRoutes.length - 1,
            routes: innerRoutes,
          },
        },
      ],
    }),
  );
}
