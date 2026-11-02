import React, { useEffect, useMemo, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Chip, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { SearchProductResult } from '../../services/catalogService';
import { formatQuantity, getQuantityPresets, parseQuantityInput, quantityHint, type UomInfo } from '../../utils/quantity';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

function quantityPrefill(qty: number, uom: UomInfo): string {
  const code = (uom.code || '').toLowerCase();
  if ((code === 'kg' || code === 'ltr') && qty > 0 && qty < 1) {
    return `${Math.round(qty * 1000)}${code === 'kg' ? 'g' : 'ml'}`;
  }
  return parseFloat(qty.toFixed(4)).toString();
}

type Props = {
  product: SearchProductResult | null;
  initialQuantity?: number;
  editing?: boolean;
  /** When true, overlay stays inside the parent (e.g. item selection pane). */
  contained?: boolean;
  onConfirm: (quantity: number) => void;
  onDismiss: () => void;
};

export default function QuantityEntryDialog({
  product,
  initialQuantity,
  editing = false,
  contained = false,
  onConfirm,
  onDismiss,
}: Props) {
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const uom: UomInfo = useMemo(() => product?.uom || { code: 'pcs', type: 'count' }, [product?.uom]);
  const presets = useMemo(() => getQuantityPresets(uom), [uom]);

  useEffect(() => {
    if (!product) { setInput(''); setError(''); return; }
    setInput(initialQuantity != null && initialQuantity > 0
      ? quantityPrefill(initialQuantity, uom)
      : '');
    setError('');
    Keyboard.dismiss();
  }, [product, initialQuantity, uom]);

  const parsedQty = input.trim() ? parseQuantityInput(input, uom) : null;
  const lineTotal = parsedQty != null && product ? Math.round(parsedQty * product.sellingPrice * 100) / 100 : null;

  const confirm = () => {
    const qty = parseQuantityInput(input, uom);
    if (qty == null || qty <= 0) { setError('Enter a valid quantity'); return; }
    onConfirm(qty);
  };

  const body = product ? (
    <>
      <Text style={styles.dialogTitle}>{editing ? 'Change quantity' : 'How much?'}</Text>
      <View style={styles.header}>
        <View style={styles.headerIcon}><Icon name="scale-balance" size={24} color={colors.primary} /></View>
        <View style={styles.headerText}>
          <Text style={styles.productName} numberOfLines={2}>
            {product.productName}
            {variantLabel(product.size, product.color) ? ` · ${variantLabel(product.size, product.color)}` : ''}
          </Text>
          <Text style={styles.price}>₹{product.sellingPrice} / {uom.code}</Text>
          <Text style={styles.stock}>
            Available stock: {formatQuantity(product.stockQty ?? 0, uom)}
          </Text>
        </View>
      </View>

      <View style={styles.content}>
        <TextInput
          label="Quantity"
          value={input}
          onChangeText={(v) => { setInput(v); setError(''); }}
          mode="outlined"
          keyboardType="decimal-pad"
          autoFocus={false}
          blurOnSubmit
          placeholder={quantityHint(uom)}
          style={styles.input}
        />
        <HelperText type="info" visible>{quantityHint(uom)}</HelperText>
        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        {lineTotal != null && (
          <View style={styles.totalBox}>
            <Text style={styles.totalLbl}>You'll charge</Text>
            <Text style={styles.totalVal}>₹{lineTotal.toFixed(2)}</Text>
          </View>
        )}

        <Text style={styles.presetsLbl}>Quick amounts</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.presets}>
            {presets.map((p) => (
              <Chip key={p.label} onPress={() => onConfirm(p.quantity)} style={styles.chip} textStyle={styles.chipText}>{p.label}</Chip>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.actions}>
        <Button onPress={onDismiss} textColor={colors.textMuted}>Cancel</Button>
        <Button mode="contained" onPress={confirm} buttonColor={colors.secondary} icon={editing ? 'check' : 'cart-plus'}>
          {editing ? 'Update' : 'Add'}
        </Button>
      </View>
    </>
  ) : null;

  if (contained) {
    if (!product) return null;
    return (
      <View style={styles.containedRoot} pointerEvents="box-none">
        <Pressable style={styles.containedScrim} onPress={onDismiss} accessibilityLabel="Dismiss quantity" />
        <View style={styles.containedCard} accessibilityViewIsModal>
          {body}
        </View>
      </View>
    );
  }

  return (
    <Portal>
      <Dialog visible={!!product} onDismiss={onDismiss} style={styles.dialog}>
        {product ? (
          <>
            <Dialog.Title style={styles.paperTitle}>{editing ? 'Change quantity' : 'How much?'}</Dialog.Title>
            <View style={styles.header}>
              <View style={styles.headerIcon}><Icon name="scale-balance" size={24} color={colors.primary} /></View>
              <View style={styles.headerText}>
                <Text style={styles.productName} numberOfLines={2}>
                  {product.productName}
                  {variantLabel(product.size, product.color) ? ` · ${variantLabel(product.size, product.color)}` : ''}
                </Text>
                <Text style={styles.price}>₹{product.sellingPrice} / {uom.code}</Text>
                <Text style={styles.stock}>
                  Available stock: {formatQuantity(product.stockQty ?? 0, uom)}
                </Text>
              </View>
            </View>

            <Dialog.Content>
              <TextInput
                label="Quantity"
                value={input}
                onChangeText={(v) => { setInput(v); setError(''); }}
                mode="outlined"
                keyboardType="decimal-pad"
                autoFocus={false}
                blurOnSubmit
                placeholder={quantityHint(uom)}
                style={styles.input}
              />
              <HelperText type="info" visible>{quantityHint(uom)}</HelperText>
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}

              {lineTotal != null && (
                <View style={styles.totalBox}>
                  <Text style={styles.totalLbl}>You'll charge</Text>
                  <Text style={styles.totalVal}>₹{lineTotal.toFixed(2)}</Text>
                </View>
              )}

              <Text style={styles.presetsLbl}>Quick amounts</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.presets}>
                  {presets.map((p) => (
                    <Chip key={p.label} onPress={() => onConfirm(p.quantity)} style={styles.chip} textStyle={styles.chipText}>{p.label}</Chip>
                  ))}
                </View>
              </ScrollView>
            </Dialog.Content>

            <Dialog.Actions style={styles.actions}>
              <Button onPress={onDismiss} textColor={colors.textMuted}>Cancel</Button>
              <Button mode="contained" onPress={confirm} buttonColor={colors.secondary} icon={editing ? 'check' : 'cart-plus'}>
                {editing ? 'Update' : 'Add'}
              </Button>
            </Dialog.Actions>
          </>
        ) : null}
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { marginHorizontal: spacing.lg, borderRadius: radius.xl, backgroundColor: colors.surface },
  paperTitle: { marginBottom: 0 },
  dialogTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  containedRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 40,
    elevation: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  containedScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
  },
  containedCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    maxHeight: '92%',
    overflow: 'hidden',
    zIndex: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  header: { flexDirection: 'row', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.borderLight },
  headerIcon: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.primaryLight, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  headerText: { flex: 1 },
  productName: { fontSize: 16, fontWeight: '700', color: colors.text },
  price: { fontSize: 14, fontWeight: '600', color: colors.secondary, marginTop: 2 },
  stock: { fontSize: 12, fontWeight: '600', color: colors.textMuted, marginTop: 4 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm },
  input: { backgroundColor: colors.surface },
  totalBox: { backgroundColor: colors.secondaryLight, borderRadius: radius.md, padding: spacing.md, alignItems: 'center', marginVertical: spacing.md },
  totalLbl: { fontSize: 12, color: colors.secondaryDark },
  totalVal: { fontSize: 32, fontWeight: '700', color: colors.secondaryDark, marginTop: 2 },
  presetsLbl: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: spacing.sm },
  presets: { flexDirection: 'row', gap: spacing.sm },
  chip: { backgroundColor: colors.primaryLight },
  chipText: { color: colors.primary, fontWeight: '600' },
  actions: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
});
