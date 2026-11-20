import React from 'react';
import { Platform, ScrollView, StyleProp, useWindowDimensions, ViewStyle } from 'react-native';
import { Dialog, Modal } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { spaceAboveKeyboard, useKeyboardOverlap } from '../../hooks/useKeyboardOverlap';
import { dialogCard } from '../../theme/layout';

type Props = React.ComponentProps<typeof Dialog> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * Paper dialog that stays above the keyboard and within the screen.
 * On phones the card is centered in the space the keyboard leaves free.
 */
export default function AppDialog({
  style,
  children,
  visible,
  onDismiss,
  dismissable = true,
  dismissableBackButton = dismissable,
  testID,
  theme,
}: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const overlap = useKeyboardOverlap();
  const bottom = Math.max(insets.bottom, overlap);
  const room = spaceAboveKeyboard(height, overlap, insets.top, insets.bottom);
  const maxHeight = Math.min(height * 0.92, room > 0 ? room : height * 0.92);

  const body = Platform.OS === 'web' ? (
    children
  ) : (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      bounces={false}
      nestedScrollEnabled
      style={{ maxHeight, flexGrow: 0 }}
      contentContainerStyle={{ flexGrow: 0 }}>
      {children}
    </ScrollView>
  );

  return (
    <Modal
      visible={visible}
      onDismiss={onDismiss}
      dismissable={dismissable}
      dismissableBackButton={dismissableBackButton}
      testID={testID}
      theme={theme}
      style={{ marginTop: insets.top, marginBottom: bottom, justifyContent: 'center' }}
      contentContainerStyle={[
        dialogCard,
        style,
        { maxHeight, marginVertical: 0, elevation: 24 },
      ]}>
      {body}
    </Modal>
  );
}

AppDialog.Title = Dialog.Title;
AppDialog.Content = Dialog.Content;
AppDialog.Actions = Dialog.Actions;
AppDialog.ScrollArea = Dialog.ScrollArea;
AppDialog.Icon = Dialog.Icon;
