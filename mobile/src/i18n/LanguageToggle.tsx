import React, { useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Menu, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useLanguageStore, type AppLanguage } from './languageStore';
import { colors } from '../theme/colors';

type Props = {
  /** toolbar sits on the white header; onPrimary sits on the blue login screen. */
  tone?: 'toolbar' | 'onPrimary';
  /** Mobile top bar: translate icon only (menu still lists English / Marathi). */
  iconOnly?: boolean;
};

const OPTIONS: Array<{ id: AppLanguage; label: string }> = [
  { id: 'en', label: 'English' },
  { id: 'mr', label: 'मराठी' },
];

export default function LanguageToggle({ tone = 'toolbar', iconOnly = false }: Props) {
  const ui = useLanguageStore((s) => s.ui);
  const setUi = useLanguageStore((s) => s.setUi);
  const onBlue = tone === 'onPrimary';
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<View>(null);
  const selected = OPTIONS.find((option) => option.id === ui) || OPTIONS[0];

  const choose = (lang: AppLanguage) => {
    setUi(lang);
    setOpen(false);
  };

  return (
    <View ref={anchorRef} collapsable={false} style={[styles.anchor, iconOnly && styles.anchorIcon]}>
      <Menu
        visible={open}
        onDismiss={() => setOpen(false)}
        anchor={
          <Pressable
            onPress={() => setOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={ui === 'en' ? 'Language: English' : 'Language: Marathi'}
            style={[
              iconOnly ? styles.triggerIcon : styles.trigger,
              onBlue ? styles.triggerOnPrimary : styles.triggerToolbar,
            ]}>
            {iconOnly ? (
              <Icon
                name="translate"
                size={20}
                color={onBlue ? colors.textOnPrimary : colors.primary}
              />
            ) : (
              <>
                <Text
                  style={[
                    styles.triggerLabel,
                    onBlue ? styles.triggerLabelOnPrimary : styles.triggerLabelToolbar,
                  ]}
                  numberOfLines={1}>
                  {selected.label}
                </Text>
                <Text
                  style={[
                    styles.chevron,
                    onBlue ? styles.triggerLabelOnPrimary : styles.chevronToolbar,
                  ]}>
                  ▾
                </Text>
              </>
            )}
          </Pressable>
        }
        contentStyle={styles.menu}>
        {OPTIONS.map((option) => {
          const active = ui === option.id;
          return (
            <Menu.Item
              key={option.id}
              onPress={() => choose(option.id)}
              title={option.label}
              titleStyle={active ? styles.menuItemActive : styles.menuItem}
              leadingIcon={active ? 'check' : undefined}
            />
          );
        })}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    marginRight: 4,
  },
  anchorIcon: {
    marginRight: 2,
  },
  trigger: {
    minHeight: 32,
    minWidth: 108,
    paddingHorizontal: 10,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  triggerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  triggerToolbar: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  triggerOnPrimary: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  triggerLabel: {
    fontSize: 13,
    fontWeight: '700',
  },
  triggerLabelToolbar: {
    color: colors.text,
  },
  triggerLabelOnPrimary: {
    color: colors.textOnPrimary,
  },
  chevron: {
    fontSize: 11,
    fontWeight: '700',
  },
  chevronToolbar: {
    color: colors.textMuted,
  },
  menu: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    minWidth: 160,
  },
  menuItem: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  menuItemActive: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
  },
});
