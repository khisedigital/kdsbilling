import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { radius, shadow, spacing } from '../../theme/layout';

export type SearchableSelectOption = {
  id: string;
  label: string;
};

type Props = {
  options: SearchableSelectOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Controlled open state (required for parent scroll-lock / backdrop). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  allLabel?: string;
  searchPlaceholder?: string;
};

type MenuLayout = { x: number; y: number; width: number };

/**
 * Inline Select2-style control. Dropdown overlays (does not expand layout)
 * and closes when tapping outside.
 */
function SearchableSelect({
  options,
  value,
  onChange,
  open,
  onOpenChange,
  placeholder = 'Select…',
  allLabel = 'All',
  searchPlaceholder = 'Type to filter…',
}: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [menuLayout, setMenuLayout] = useState<MenuLayout | null>(null);
  const inputRef = useRef<TextInputType>(null);
  const wrapRef = useRef<View>(null);
  const wasOpen = useRef(false);

  const selectedLabel = useMemo(() => {
    if (!value) return t(allLabel);
    return options.find((o) => o.id === value)?.label || t(allLabel);
  }, [options, value, allLabel, t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  const measureMenu = useCallback(() => {
    wrapRef.current?.measureInWindow((x, y, width, height) => {
      setMenuLayout({ x, y: y + height, width });
    });
  }, []);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setQuery('');
      measureMenu();
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 40);
      wasOpen.current = true;
      return () => clearTimeout(focusTimer);
    }
    if (!open) {
      wasOpen.current = false;
      setQuery('');
      setMenuLayout(null);
    }
  }, [open, measureMenu]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measureMenu();
    // Web: keep panel aligned if the window size changes.
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
  }, [open, measureMenu]);

  const toggle = useCallback(() => {
    onOpenChange(!open);
  }, [onOpenChange, open]);

  const pick = useCallback(
    (id: string | null) => {
      onChange(id);
      onOpenChange(false);
    },
    [onChange, onOpenChange],
  );

  const clearValue = useCallback(() => {
    onChange(null);
  }, [onChange]);

  const renderItem = useCallback(
    ({ item }: { item: SearchableSelectOption }) => {
      const active = value === item.id;
      return (
        <Pressable
          onPress={() => pick(item.id)}
          style={[styles.option, active && styles.optionOn]}>
          <Text style={[styles.optionText, active && styles.optionTextOn]} numberOfLines={1}>
            {item.label}
          </Text>
          {active ? <Icon name="check" size={18} color={colors.primary} /> : null}
        </Pressable>
      );
    },
    [pick, value],
  );

  const header = useMemo(
    () => (
      <Pressable
        onPress={() => pick(null)}
        style={[styles.option, !value && styles.optionOn]}>
        <Text style={[styles.optionText, !value && styles.optionTextOn]}>{t(allLabel)}</Text>
        {!value ? <Icon name="check" size={18} color={colors.primary} /> : null}
      </Pressable>
    ),
    [allLabel, pick, t, value],
  );

  return (
    <View ref={wrapRef} style={styles.wrap} collapsable={false}>
      <View style={[styles.trigger, open && styles.triggerOpen]}>
        <Pressable
          onPress={toggle}
          style={styles.triggerMain}
          accessibilityRole="button"
          accessibilityLabel={t(placeholder)}>
          <Icon name="shape-outline" size={18} color={colors.textMuted} />
          <Text style={styles.value} numberOfLines={1}>
            {selectedLabel}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={clearValue}
            hitSlop={8}
            accessibilityLabel={t('Clear')}
            style={styles.iconBtn}>
            <Icon name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        ) : null}
        <Pressable onPress={toggle} hitSlop={8} style={styles.iconBtn}>
          <Icon
            name={open ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>

      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable
            style={styles.scrim}
            onPress={close}
            accessibilityLabel={t('Dismiss')}
          />
          {menuLayout ? (
            <View
              style={[
                styles.panel,
                {
                  top: menuLayout.y,
                  left: menuLayout.x,
                  width: Math.max(menuLayout.width, 180),
                },
              ]}>
              <View style={styles.search}>
                <Icon name="magnify" size={18} color={colors.textMuted} />
                <TextInput
                  ref={inputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t(searchPlaceholder)}
                  placeholderTextColor={colors.textMuted}
                  style={styles.searchInput}
                  autoCorrect={false}
                  autoCapitalize="none"
                  returnKeyType="search"
                  blurOnSubmit={false}
                />
                {query ? (
                  <Pressable onPress={() => setQuery('')} hitSlop={8}>
                    <Icon name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                ) : null}
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(item) => item.id}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="none"
                style={styles.list}
                ListHeaderComponent={header}
                ListEmptyComponent={<Text style={styles.empty}>{t('No matches')}</Text>}
                renderItem={renderItem}
                initialNumToRender={12}
                windowSize={5}
                removeClippedSubviews={false}
              />
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

export default memo(SearchableSelect);

export function SearchableSelectBackdrop({
  visible,
  onPress,
}: {
  visible: boolean;
  onPress: () => void;
}) {
  const t = useT();
  if (!visible) return null;
  return (
    <Pressable
      style={styles.legacyBackdrop}
      onPress={onPress}
      accessibilityLabel={t('Dismiss')}
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
    zIndex: 1,
  },
  trigger: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  triggerOpen: {
    borderColor: colors.primary,
  },
  triggerMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingRight: spacing.sm,
  },
  iconBtn: {
    paddingHorizontal: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  value: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.text,
  },
  modalRoot: {
    flex: 1,
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
  },
  panel: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.md,
    maxHeight: 280,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: colors.text,
    paddingVertical: 4,
  },
  list: {
    maxHeight: 220,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionOn: {
    backgroundColor: colors.primaryLight,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.text,
  },
  optionTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  empty: {
    padding: spacing.md,
    textAlign: 'center',
    fontSize: 13,
    color: colors.textMuted,
  },
  legacyBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
});
