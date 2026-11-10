import React, { useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { Button, Dialog, Portal, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { dialogCard, radius, spacing } from '../../theme/layout';

export type CustomItemInput = { name: string; price: number; quantity: number };

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (items: CustomItemInput[]) => void;
};

type DraftRow = {
  key: string;
  name: string;
  price: string;
  qty: string;
};

function newRow(): DraftRow {
  return {
    key: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    price: '',
    qty: '1',
  };
}

function parseAmount(value: string): number {
  return parseFloat(value.replace(',', '.'));
}

function rowIsBlank(row: DraftRow): boolean {
  return !row.name.trim() && !row.price.trim() && (row.qty.trim() === '' || row.qty.trim() === '1');
}

function lineTotal(row: DraftRow): number | null {
  const price = parseAmount(row.price);
  const qty = parseAmount(row.qty);
  if (!Number.isFinite(price) || price < 0 || !Number.isFinite(qty) || qty <= 0) return null;
  return Math.round(price * qty * 100) / 100;
}

export default function CustomItemDialog({ visible, onDismiss, onSubmit }: Props) {
  const t = useT();
  const { height, width } = useWindowDimensions();
  const compact = width < 520;
  const [rows, setRows] = useState<DraftRow[]>(() => [newRow()]);
  const [focusKey, setFocusKey] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    const first = newRow();
    setRows([first]);
    setFocusKey(first.key);
    setError('');
  }, [visible]);

  const patchRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    setError('');
  };

  const addRow = () => {
    const row = newRow();
    setRows((current) => [...current, row]);
    setFocusKey(row.key);
    setError('');
  };

  const removeRow = (key: string) => {
    setRows((current) => {
      const next = current.filter((row) => row.key !== key);
      return next.length ? next : [newRow()];
    });
    setError('');
  };

  const submit = () => {
    const filled = rows.filter((row) => !rowIsBlank(row));
    if (!filled.length) {
      setError(t('Enter at least one item'));
      return;
    }

    const ready: CustomItemInput[] = [];
    for (let index = 0; index < filled.length; index += 1) {
      const row = filled[index];
      const name = row.name.trim();
      if (!name) {
        setError(t('Item {{n}} needs a name', { n: index + 1 }));
        return;
      }
      const unitPrice = parseAmount(row.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setError(t('Item {{n}} needs a valid price', { n: index + 1 }));
        return;
      }
      const quantity = parseAmount(row.qty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(t('Item {{n}} needs a quantity greater than 0', { n: index + 1 }));
        return;
      }
      ready.push({
        name,
        price: Math.round(unitPrice * 100) / 100,
        quantity,
      });
    }

    onSubmit(ready);
  };

  const readyCount = rows.filter((row) => row.name.trim() && lineTotal(row) != null).length;
  const readyTotal = rows.reduce((sum, row) => sum + (row.name.trim() ? lineTotal(row) || 0 : 0), 0);
  const addLabel = readyCount > 1
    ? t('Add {{count}} items', { count: readyCount })
    : t('Add to bill');

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={[styles.dialog, { maxHeight: height * 0.88 }]}>
        <Dialog.Title>{t('Custom items')}</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <View style={styles.tableHeader}>
            <Text style={[styles.th, styles.colName]}>{t('Item')}</Text>
            <Text style={[styles.th, styles.alignEnd, styles.colPrice, compact && styles.colPriceCompact]}>{t('Price')}</Text>
            <Text style={[styles.th, styles.alignEnd, styles.colQty, compact && styles.colQtyCompact]}>{t('Qty')}</Text>
            {compact ? null : <Text style={[styles.th, styles.colTotal]}>{t('Total')}</Text>}
            <View style={styles.colRemove} />
          </View>
          <ScrollView
            style={{ maxHeight: Math.max(160, height * 0.42) }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}>
            {rows.map((row, index) => {
              const total = lineTotal(row);
              return (
                <View key={row.key} style={styles.tableRow}>
                  <TextInput
                    value={row.name}
                    onChangeText={(name) => patchRow(row.key, { name })}
                    placeholder={t('Name')}
                    placeholderTextColor={colors.textMuted}
                    style={[styles.field, styles.colName]}
                    autoFocus={row.key === focusKey}
                    maxLength={120}
                    accessibilityLabel={t('Item {{n}} name', { n: index + 1 })}
                  />
                  <TextInput
                    value={row.price}
                    onChangeText={(price) => patchRow(row.key, { price })}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={[styles.field, styles.colPrice, styles.alignEnd, compact && styles.colPriceCompact]}
                    accessibilityLabel={t('Item {{n}} price', { n: index + 1 })}
                  />
                  <TextInput
                    value={row.qty}
                    onChangeText={(qty) => patchRow(row.key, { qty })}
                    placeholder="1"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                    style={[styles.field, styles.colQty, styles.alignEnd, compact && styles.colQtyCompact]}
                    accessibilityLabel={t('Item {{n}} quantity', { n: index + 1 })}
                  />
                  {compact ? null : (
                    <Text style={[styles.total, styles.colTotal]} numberOfLines={1}>
                      {total != null ? `₹${total.toFixed(2)}` : '—'}
                    </Text>
                  )}
                  <Pressable
                    onPress={() => removeRow(row.key)}
                    hitSlop={8}
                    accessibilityLabel={t('Remove item {{n}}', { n: index + 1 })}
                    style={styles.removeBtn}>
                    <Icon name="close" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              );
            })}
          </ScrollView>
          <Pressable onPress={addRow} style={styles.addAnother} accessibilityLabel={t('Add another item')}>
            <Icon name="plus" size={16} color={colors.primary} />
            <Text style={styles.addAnotherText}>{t('Add another item')}</Text>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {readyCount > 0 ? (
            <Text style={styles.summary}>
              {readyCount === 1
                ? t('{{count}} item · ₹{{total}}', { count: readyCount, total: readyTotal.toFixed(2) })
                : t('{{count}} items · ₹{{total}}', { count: readyCount, total: readyTotal.toFixed(2) })}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>{t('Cancel')}</Button>
          <Button mode="contained" onPress={submit}>
            {addLabel}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: {
    ...dialogCard,
    maxWidth: 420,
  },
  content: {
    paddingTop: 0,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  th: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  list: {
    paddingBottom: spacing.xs,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  colName: { flex: 1, minWidth: 0 },
  colPrice: { width: 88 },
  colPriceCompact: { width: 72 },
  colQty: { width: 56 },
  colQtyCompact: { width: 48 },
  colTotal: { width: 78, textAlign: 'right' },
  colRemove: { width: 28 },
  field: {
    height: 32,
    paddingVertical: 0,
    paddingHorizontal: 8,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    ...(Platform.OS === 'web'
      ? ({ outlineStyle: 'none', outlineWidth: 0, outlineColor: 'transparent' } as object)
      : null),
  },
  alignEnd: { textAlign: 'right' },
  total: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addAnother: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: spacing.sm,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  addAnotherText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.sm,
  },
  summary: {
    marginTop: spacing.sm,
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
});
