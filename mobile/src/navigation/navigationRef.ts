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
