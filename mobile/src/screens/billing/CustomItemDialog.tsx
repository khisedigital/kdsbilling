import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

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
  const { height, width } = useWindowDimensions();
  const compact = width < 720;
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
      setError('Enter at least one item');
      return;
    }

    const ready: CustomItemInput[] = [];
    for (let index = 0; index < filled.length; index += 1) {
      const row = filled[index];
      const label = `Item ${index + 1}`;
      const name = row.name.trim();
      if (!name) {
        setError(`${label} needs a name`);
        return;
      }
      const unitPrice = parseAmount(row.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        setError(`${label} needs a valid price`);
        return;
      }
      const quantity = parseAmount(row.qty);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setError(`${label} needs a quantity greater than 0`);
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
  const addLabel = readyCount > 1 ? `Add ${readyCount} items` : 'Add to bill';

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={onDismiss} style={[styles.dialog, { maxHeight: height * 0.88 }]}>
        <Dialog.Title>Custom items</Dialog.Title>
        <Dialog.Content style={styles.content}>
          <Text style={styles.hint}>
            Bill one-off items that are not in the catalog. Add as many as you need, then put them on the bill together.
          </Text>
          <ScrollView
            style={{ maxHeight: Math.max(220, height * 0.48) }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.list}>
            {rows.map((row, index) => {
              const total = lineTotal(row);
              return (
                <View key={row.key} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.cardIndex}>Item {index + 1}</Text>
                    {total != null && row.name.trim() ? (
                      <Text style={styles.cardTotal}>₹{total.toFixed(2)}</Text>
                    ) : (
                      <Text style={styles.cardTotalMuted}>Price × qty</Text>
                    )}
                    <Pressable
                      onPress={() => removeRow(row.key)}
                      hitSlop={8}
                      accessibilityLabel={`Remove item ${index + 1}`}
                      style={styles.removeBtn}>
                      <Icon name="close" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <TextInput
                    label="Item name"
                    value={row.name}
                    onChangeText={(name) => patchRow(row.key, { name })}
                    mode="outlined"
                    style={styles.input}
                    autoFocus={row.key === focusKey}
                    maxLength={120}
                    dense
                  />
                  <View style={compact ? styles.stack : styles.row}>
                    <TextInput
                      label="Price ₹"
                      value={row.price}
                      onChangeText={(price) => patchRow(row.key, { price })}
                      mode="outlined"
                      keyboardType="decimal-pad"
                      style={[styles.input, styles.grow]}
                      dense
                    />
                    <TextInput
                      label="Qty"
                      value={row.qty}
                      onChangeText={(qty) => patchRow(row.key, { qty })}
                      mode="outlined"
                      keyboardType="decimal-pad"
                      style={[styles.input, compact ? styles.grow : styles.qty]}
                      dense
                    />
                  </View>
                </View>
              );
            })}
          </ScrollView>
          <Button mode="outlined" icon="plus" onPress={addRow} style={styles.addAnother} textColor={colors.primary}>
            Add another item
          </Button>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {readyCount > 0 ? (
            <Text style={styles.summary}>
              {readyCount} {readyCount === 1 ? 'item' : 'items'} · ₹{readyTotal.toFixed(2)}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss}>Cancel</Button>
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
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    alignSelf: 'center',
    width: '94%',
    maxWidth: 640,
  },
  content: {
    paddingTop: 0,
  },
  hint: {
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontSize: 13,
    lineHeight: 18,
  },
  list: {
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    padding: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.sm,
  },
  cardIndex: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  cardTotal: {
    marginLeft: 'auto',
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  cardTotalMuted: {
    marginLeft: 'auto',
    fontSize: 12,
    color: colors.textMuted,
  },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  input: {
    marginBottom: spacing.xs,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stack: {
    gap: 0,
  },
  grow: {
    flex: 1,
  },
  qty: {
    width: 110,
  },
  addAnother: {
    marginTop: spacing.sm,
    borderRadius: radius.md,
    borderColor: colors.primary,
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
