import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { Dialog } from 'react-native-paper';
import { dialogCard } from '../../theme/layout';

type Props = React.ComponentProps<typeof Dialog> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * Paper Dialog with a compact max width so desktop windows stay readable.
 * Use this (or `common.dialog` / `dialogCard`) for any new modal.
 */
export default function AppDialog({ style, children, ...rest }: Props) {
  return (
    <Dialog {...rest} style={[dialogCard, style]}>
      {children}
    </Dialog>
  );
}

AppDialog.Title = Dialog.Title;
AppDialog.Content = Dialog.Content;
AppDialog.Actions = Dialog.Actions;
AppDialog.ScrollArea = Dialog.ScrollArea;
AppDialog.Icon = Dialog.Icon;
