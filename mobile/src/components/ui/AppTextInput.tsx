import React from 'react';
import { StyleSheet } from 'react-native';
import { TextInput as PaperTextInput, type TextInputProps } from 'react-native-paper';
import { colors } from '../../theme/colors';

/**
 * Outlined Paper field with a normal visible border (not the heavy dark pass).
 * Bare chrome-less fields (billing search, table cells) should keep RN TextInput.
 */
export default function AppTextInput({
  mode = 'outlined',
  outlineColor = colors.border,
  activeOutlineColor = colors.primary,
  style,
  ...rest
}: TextInputProps) {
  return (
    <PaperTextInput
      mode={mode}
      outlineColor={outlineColor}
      activeOutlineColor={activeOutlineColor}
      style={[styles.field, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  field: {
    backgroundColor: colors.surface,
  },
});
