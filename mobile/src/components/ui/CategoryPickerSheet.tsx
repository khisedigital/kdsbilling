import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type TextInput as RNTextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { dialogCard, radius, shadow, spacing } from '../../theme/layout';

export type CategoryOption = {
  id: string;
  label: string;
};

type Props = {
  visible: boolean;
  options: CategoryOption[];
  value: string | null;
  allLabel?: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
};

/**
 * Bottom-sheet category picker for billing — avoids nested FlatList / focus bugs.
 */
function CategoryPickerSheet({
  visible,
  options,
  value,
  allLabel = 'All categories',
  onSelect,
  onClose,
}: Props) {
  const t = useT();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width >= 720 || Platform.OS === 'web';
  const [query, setQuery] = useState('');
  const inputRef = useRef<RNTextInput>(null);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      Keyboard.dismiss();
      return;
    }
    const focusTimer = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(focusTimer);
  }, [visible]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  const dismissAndClose = useCallback(() => {
    Keyboard.dismiss();
    inputRef.current?.blur();
    onClose();
  }, [onClose]);

  const pick = useCallback(
    (id: string | null) => {
      Keyboard.dismiss();
      inputRef.current?.blur();
      onSelect(id);
      onClose();
    },
    [onClose, onSelect],
  );

  const rows = useMemo(
    () => [{ id: '', label: allLabel }, ...filtered],
    [allLabel, filtered],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={dismissAndClose}
      statusBarTranslucent>
      <View style={[styles.root, compact && styles.rootCentered]}>
        <Pressable style={styles.overlay} onPress={dismissAndClose} accessibilityLabel={t('Close')} />
        <View
          style={[
            styles.sheet,
            compact && styles.sheetCompact,
            { paddingBottom: Math.max(insets.bottom, spacing.md) },
          ]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('Category')}</Text>
            <Pressable onPress={dismissAndClose} hitSlop={10} accessibilityLabel={t('Close')}>
              <Icon name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.search}>
            <Icon name="magnify" size={20} color={colors.textMuted} />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder={t('Search categories…')}
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <FlatList
            data={rows}
            keyExtractor={(item) => item.id || '__all__'}
            keyboardShouldPersistTaps="handled"
            style={styles.list}
            renderItem={({ item }) => {
              const id = item.id || null;
              const active = value === id || (!value && !item.id);
              return (
                <Pressable
                  onPress={() => pick(id)}
                  style={[styles.row, active && styles.rowOn]}>
                  <Text style={[styles.rowText, active && styles.rowTextOn]} numberOfLines={1}>
                    {item.id ? item.label : t(item.label)}
                  </Text>
                  {active ? <Icon name="check" size={20} color={colors.primary} /> : null}
                </Pressable>
              );
            }}
            ListEmptyComponent={<Text style={styles.empty}>{t('No matching categories')}</Text>}
          />
        </View>
      </View>
    </Modal>
  );
}

export default memo(CategoryPickerSheet);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  rootCentered: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '70%',
    paddingTop: spacing.sm,
    ...shadow.lg,
  },
  sheetCompact: {
    ...dialogCard,
    width: '100%',
    maxWidth: 380,
    maxHeight: 420,
    borderRadius: radius.lg,
    marginHorizontal: 0,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    height: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.text,
    paddingVertical: 0,
  },
  list: {
    flexGrow: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowOn: {
    backgroundColor: colors.primaryLight,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  rowTextOn: {
    color: colors.primary,
    fontWeight: '700',
  },
  empty: {
    padding: spacing.xl,
    textAlign: 'center',
    fontSize: 14,
    color: colors.textMuted,
  },
});
