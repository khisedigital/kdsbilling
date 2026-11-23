import React from 'react';
import AppTextInput from '../src/components/ui/AppTextInput';
import { TextInput } from 'react-native-paper';

describe('AppTextInput tabIndex sanitization', () => {
  it('adds tabIndex -1 and focusable false to adornments', () => {
    const leftIcon = <TextInput.Icon icon="storefront-outline" />;
    const rightIcon = <TextInput.Icon icon="eye" />;

    const element = <AppTextInput label="Test" left={leftIcon} right={rightIcon} />;
    expect(element).toBeDefined();

    // Call the component or render function to check cloned adornment props
    const rendered = (AppTextInput as any).render(
      {
        label: 'Test',
        left: leftIcon,
        right: rightIcon,
      },
      null
    );

    expect(rendered.props.left.props.tabIndex).toBe(-1);
    expect(rendered.props.left.props.focusable).toBe(false);
    expect(rendered.props.right.props.tabIndex).toBe(-1);
    expect(rendered.props.right.props.focusable).toBe(false);
  });

  it('respects explicitly provided tabIndex if specified', () => {
    const customIcon = <TextInput.Icon icon="magnify" tabIndex={0} />;
    const rendered = (AppTextInput as any).render(
      {
        label: 'Search',
        right: customIcon,
      },
      null
    );

    expect(rendered.props.right.props.tabIndex).toBe(0);
  });
});
