import React from 'react';
import { StyleSheet } from 'react-native';
import { TextInput as PaperTextInput, type TextInputProps } from 'react-native-paper';
import { colors } from '../../theme/colors';

/**
 * Ensures input adornments (icons/affixes) are excluded from keyboard Tab navigation
 * unless an explicit tabIndex is provided.
 */
function sanitizeAdornment(adornment: React.ReactNode) {
  if (React.isValidElement(adornment)) {
    const props = adornment.props as any;
    return React.cloneElement(adornment, {
      tabIndex: props?.tabIndex ?? -1,
      focusable: props?.focusable ?? false,
    } as any);
  }
  return adornment;
}

/**
 * Outlined Paper field with a normal visible border (not the heavy dark pass).
 * Bare chrome-less fields (billing search, table cells) should keep RN TextInput.
 */
const AppTextInput = React.forwardRef<any, TextInputProps>(function AppTextInput(
  {
    mode = 'outlined',
    outlineColor = colors.border,
    activeOutlineColor = colors.primary,
    style,
    left,
    right,
    ...rest
  },
  ref
) {
  return (
    <PaperTextInput
      ref={ref}
      mode={mode}
      outlineColor={outlineColor}
      activeOutlineColor={activeOutlineColor}
      style={[styles.field, style]}
      left={sanitizeAdornment(left)}
      right={sanitizeAdornment(right)}
      {...rest}
    />
  );
});

export default AppTextInput;

const styles = StyleSheet.create({
  field: {
    backgroundColor: colors.surface,
  },
});
