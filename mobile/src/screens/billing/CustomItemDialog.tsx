import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

type Props = {
  visible: boolean;
  onDismiss: () => void;
  onSubmit: (item: { name: string; price: number; quantity: number }) => void;
};

export default function CustomItemDialog({ visible, onDismiss, onSubmit }: Props) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    setName('');
    setPrice('');
    setQty('1');
    setError('');
    setSubmitting(false);
    submittedRef.current = false;
  }, [visible]);

  const submit = () => {
    if (submitting || submittedRef.current) return;

    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter an item name');
      return;
    }
    const unitPrice = parseFloat(price.replace(',', '.'));
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError('Enter a valid price');
      return;
    }
    const quantity = parseFloat(qty.replace(',', '.'));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setError('Enter a valid quantity');
      return;
    }

    submittedRef.current = true;
    setSubmitting(true);
    onSubmit({
      name: trimmed,
      price: Math.round(unitPrice * 100) / 100,
      quantity,
    });
  };

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={submitting ? () => undefined : onDismiss} style={styles.dialog}>
        <Dialog.Title>Custom item</Dialog.Title>
        <Dialog.Content>
          <Text style={styles.hint}>Bill a one-off item without adding it to the catalog</Text>
          <TextInput
            label="Item name"
            value={name}
            onChangeText={(v) => {
              setName(v);
              setError('');
            }}
            mode="outlined"
            style={styles.input}
            autoFocus
            maxLength={120}
            disabled={submitting}
          />
          <View style={styles.row}>
            <TextInput
              label="Price ₹"
              value={price}
              onChangeText={(v) => {
                setPrice(v);
                setError('');
              }}
              mode="outlined"
              keyboardType="decimal-pad"
              style={[styles.input, styles.half]}
              disabled={submitting}
            />
            <TextInput
              label="Qty"
              value={qty}
              onChangeText={(v) => {
                setQty(v);
                setError('');
              }}
              mode="outlined"
              keyboardType="decimal-pad"
              style={[styles.input, styles.half]}
              disabled={submitting}
            />
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button onPress={onDismiss} disabled={submitting}>
            Cancel
          </Button>
          <Button mode="contained" onPress={submit} disabled={submitting} loading={submitting}>
            Add to bill
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
  },
  hint: {
    color: colors.textMuted,
    marginBottom: spacing.md,
    fontSize: 13,
  },
  input: {
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  half: {
    flex: 1,
  },
  error: {
    color: colors.error,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  actions: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    justifyContent: 'flex-end',
    gap: spacing.xs,
  },
});
