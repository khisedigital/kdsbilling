import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInput as TextInputType,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
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

/**
 * Inline Select2-style control. Search query is local so typing does not
 * re-render the parent screen (avoids cursor jump + lag).
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
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInputType>(null);
  const wasOpen = useRef(false);

  const selectedLabel = useMemo(() => {
    if (!value) return allLabel;
    return options.find((o) => o.id === value)?.label || allLabel;
  }, [options, value, allLabel]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setQuery('');
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      wasOpen.current = true;
      return () => clearTimeout(t);
    }
    if (!open) {
      wasOpen.current = false;
      setQuery('');
    }
  }, [open]);

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
        <Text style={[styles.optionText, !value && styles.optionTextOn]}>{allLabel}</Text>
        {!value ? <Icon name="check" size={18} color={colors.primary} /> : null}
      </Pressable>
    ),
    [allLabel, pick, value],
  );

  return (
    <View style={styles.wrap}>
      <View style={[styles.trigger, open && styles.triggerOpen]}>
        <Pressable
          onPress={toggle}
          style={styles.triggerMain}
          accessibilityRole="button"
          accessibilityLabel={placeholder}>
          <Icon name="shape-outline" size={18} color={colors.textMuted} />
          <Text style={styles.value} numberOfLines={1}>
            {selectedLabel}
          </Text>
        </Pressable>
        {value ? (
          <Pressable
            onPress={clearValue}
            hitSlop={8}
            accessibilityLabel="Clear"
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

      {open ? (
        <View style={styles.panel}>
          <View style={styles.search}>
            <Icon name="magnify" size={18} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={searchPlaceholder}
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
            ListEmptyComponent={<Text style={styles.empty}>No matches</Text>}
            renderItem={renderItem}
            initialNumToRender={12}
            windowSize={5}
            removeClippedSubviews={false}
          />
        </View>
      ) : null}
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
  if (!visible) return null;
  return (
    <Pressable
      style={styles.backdrop}
      onPress={onPress}
      accessibilityLabel="Dismiss"
    />
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: spacing.sm,
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
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
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
  panel: {
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.primary,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadow.sm,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
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
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.18)',
  },
});
