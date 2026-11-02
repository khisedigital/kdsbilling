import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Button, Dialog, HelperText, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import {
  createPurchaseBill,
  createSupplier,
  fetchSuppliers,
  type Supplier,
} from '../../services/inventoryService';
import { searchProducts, type SearchProductResult } from '../../services/catalogService';
import { apiError } from '../../utils/apiError';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PurchaseBillForm'>;

type LineItem = {
  key: string;
  variantId: string;
  productName: string;
  sku: string;
  size?: string | null;
  color?: string | null;
  quantity: string;
  unitCost: string;
  uomCode?: string;
};

function money(n: number) {
  return `₹${n.toFixed(2)}`;
}

export default function PurchaseBillFormScreen({ route, navigation }: Props) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState(route.params?.supplierId || '');
  const [loadingSuppliers, setLoadingSuppliers] = useState(true);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchProductResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [lines, setLines] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [supplierDialog, setSupplierDialog] = useState(false);
  const [newSupplierName, setNewSupplierName] = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierError, setSupplierError] = useState('');

  const loadSuppliers = useCallback(async () => {
    setLoadingSuppliers(true);
    try {
      const list = await fetchSuppliers();
      setSuppliers(list);
      if (!supplierId && list.length === 1) {
        setSupplierId(list[0].id);
      }
    } catch (err) {
      setError(apiError(err, 'Could not load suppliers'));
    } finally {
      setLoadingSuppliers(false);
    }
  }, [supplierId]);

  useEffect(() => {
    loadSuppliers();
  }, [loadSuppliers]);

  useEffect(() => {
    const q = search.trim();
    if (q.length < 2) {
      setResults([]);
      setSearchError('');
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const found = await searchProducts(q);
        setResults(found);
        if (!found.length) setSearchError(`No product for "${q}"`);
      } catch {
        setResults([]);
        setSearchError('Search failed. Try again.');
      } finally {
        setSearching(false);
      }
    }, 280);
    return () => clearTimeout(t);
  }, [search]);

  const addProduct = (product: SearchProductResult) => {
    const existing = lines.find((line) => line.variantId === product.variantId);
    if (existing) {
      setLines((prev) =>
        prev.map((line) =>
          line.variantId === product.variantId
            ? { ...line, quantity: String((parseFloat(line.quantity) || 0) + 1) }
            : line,
        ),
      );
    } else {
      const cost = product.costPrice && product.costPrice > 0
        ? product.costPrice
        : product.sellingPrice;
      setLines((prev) => [
        ...prev,
        {
          key: `${product.variantId}-${Date.now()}`,
          variantId: product.variantId,
          productName: product.productName,
          sku: product.sku,
          size: product.size,
          color: product.color,
          quantity: '1',
          unitCost: String(cost || 0),
          uomCode: product.uom?.code,
        },
      ]);
    }
    setSearch('');
    setResults([]);
    setSearchError('');
    Keyboard.dismiss();
  };

  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((line) => line.key !== key));
  };

  const totalAmount = useMemo(
    () =>
      lines.reduce((sum, line) => {
        const qty = parseFloat(line.quantity) || 0;
        const cost = parseFloat(line.unitCost) || 0;
        return sum + qty * cost;
      }, 0),
    [lines],
  );

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);

  const handleAddSupplier = async () => {
    setSupplierError('');
    if (!newSupplierName.trim()) {
      setSupplierError('Supplier name is required');
      return;
    }
    setSavingSupplier(true);
    try {
      const created = await createSupplier({
        name: newSupplierName.trim(),
        phone: newSupplierPhone.trim() || undefined,
      });
      setSuppliers((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setSupplierId(created.id);
      setSupplierDialog(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
    } catch (err) {
      setSupplierError(apiError(err, 'Could not add supplier'));
    } finally {
      setSavingSupplier(false);
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (!supplierId) {
      setError('Select or add a supplier');
      return;
    }
    if (!lines.length) {
      setError('Add at least one product');
      return;
    }

    const items = lines.map((line) => ({
      variantId: line.variantId,
      quantity: parseFloat(line.quantity),
      unitCost: parseFloat(line.unitCost),
    }));

    const invalid = items.find(
      (item) =>
        !item.variantId ||
        Number.isNaN(item.quantity) ||
        item.quantity <= 0 ||
        Number.isNaN(item.unitCost) ||
        item.unitCost < 0,
    );
    if (invalid) {
      setError('Each item needs a valid quantity and unit cost');
      return;
    }

    setLoading(true);
    try {
      const bill = await createPurchaseBill({
        supplierId,
        notes: notes.trim() || undefined,
        items,
      });
      Alert.alert('Purchase saved', `${bill.bill_number} · stock updated`, [
        {
          text: 'OK',
          onPress: () => navigation.replace('PurchaseBillDetail', { billId: bill.id }),
        },
      ]);
    } catch (err) {
      setError(apiError(err, 'Failed to create purchase bill'));
    } finally {
      setLoading(false);
    }
  };

  const showResults = search.trim().length >= 2 && (searching || results.length > 0 || !!searchError);

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Purchase Entry</Text>
        <Text style={styles.subtitle}>Buy stock from supplier — quantity goes into inventory</Text>

        <SectionCard
          title="Supplier"
          icon="truck"
          action={
            <Button compact mode="text" icon="plus" onPress={() => setSupplierDialog(true)} textColor={colors.primary}>
              Add
            </Button>
          }>
          {loadingSuppliers ? (
            <ActivityIndicator color={colors.primary} />
          ) : suppliers.length === 0 ? (
            <View style={styles.emptySupplier}>
              <Text style={styles.emptySupplierText}>No suppliers yet. Add one to continue.</Text>
              <Button mode="contained" icon="truck-plus" onPress={() => setSupplierDialog(true)}>
                Add supplier
              </Button>
            </View>
          ) : (
            <View style={styles.supplierGrid}>
              {suppliers.map((s) => {
                const on = supplierId === s.id;
                return (
                  <Pressable
                    key={s.id}
                    onPress={() => setSupplierId(s.id)}
                    style={[styles.supplierChip, on && styles.supplierChipOn]}>
                    <Icon
                      name={on ? 'check-circle' : 'truck-outline'}
                      size={18}
                      color={on ? colors.primary : colors.textMuted}
                    />
                    <View style={styles.supplierText}>
                      <Text style={[styles.supplierName, on && styles.supplierNameOn]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      {s.phone ? <Text style={styles.supplierPhone}>{s.phone}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
          {selectedSupplier ? (
            <Text style={styles.selectedHint}>Selected: {selectedSupplier.name}</Text>
          ) : null}
        </SectionCard>

        <SectionCard title="Add products" icon="package-variant" subtitle="Search by name, SKU or barcode">
          <TextInput
            label="Search product"
            value={search}
            onChangeText={setSearch}
            mode="outlined"
            style={styles.input}
            autoCorrect={false}
            right={
              searching
                ? <TextInput.Icon icon={() => <ActivityIndicator size={18} color={colors.primary} />} />
                : <TextInput.Icon icon="magnify" />
            }
          />
          {showResults ? (
            <View style={styles.resultsPanel}>
              {searchError ? (
                <Text style={styles.resultsStatus}>{searchError}</Text>
              ) : (
                results.slice(0, 8).map((item) => {
                  const size = variantLabel(item.size, item.color);
                  const cost = item.costPrice && item.costPrice > 0 ? item.costPrice : item.sellingPrice;
                  return (
                    <Pressable
                      key={item.variantId}
                      onPress={() => addProduct(item)}
                      style={({ pressed }) => [styles.resultRow, pressed && styles.resultPressed]}>
                      <View style={styles.resultBody}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {item.productName}
                          {size ? ` · ${size}` : ''}
                        </Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>
                          {item.sku} · Cost {money(cost)} · Stock {item.stockQty ?? 0}
                        </Text>
                      </View>
                      <Text style={styles.resultAdd}>Add</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title="Purchase items" icon="clipboard-list-outline" subtitle={`${lines.length} line${lines.length === 1 ? '' : 's'}`}>
          {!lines.length ? (
            <Text style={styles.emptyLines}>Search and add products above</Text>
          ) : (
            lines.map((line) => {
              const size = variantLabel(line.size, line.color);
              const lineTotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unitCost) || 0);
              return (
                <View key={line.key} style={styles.lineCard}>
                  <View style={styles.lineTop}>
                    <View style={styles.lineInfo}>
                      <Text style={styles.lineName} numberOfLines={2}>
                        {line.productName}
                        {size ? ` · ${size}` : ''}
                      </Text>
                      <Text style={styles.lineSku}>{line.sku}</Text>
                    </View>
                    <Pressable onPress={() => removeLine(line.key)} hitSlop={10} style={styles.removeBtn}>
                      <Icon name="close" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <View style={styles.lineFields}>
                    <TextInput
                      label={`Qty${line.uomCode ? ` (${line.uomCode})` : ''}`}
                      value={line.quantity}
                      onChangeText={(v) => updateLine(line.key, { quantity: v })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={styles.lineInput}
                      dense
                    />
                    <TextInput
                      label="Unit cost ₹"
                      value={line.unitCost}
                      onChangeText={(v) => updateLine(line.key, { unitCost: v })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={styles.lineInput}
                      dense
                    />
                  </View>
                  <Text style={styles.lineTotal}>Line {money(lineTotal)}</Text>
                </View>
              );
            })
          )}
        </SectionCard>

        <SectionCard title="Notes" icon="note-text-outline">
          <TextInput
            label="Optional notes"
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            style={styles.input}
          />
        </SectionCard>

        <View style={styles.totalBar}>
          <Text style={styles.totalLabel}>Bill total</Text>
          <Text style={styles.totalValue}>{money(totalAmount)}</Text>
        </View>

        {error ? <HelperText type="error" visible>{error}</HelperText> : null}

        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={loading}
          disabled={loading}
          icon="content-save"
          style={styles.submit}
          contentStyle={styles.submitContent}
          labelStyle={styles.submitLabel}>
          Save purchase & stock in
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={supplierDialog} onDismiss={() => setSupplierDialog(false)} style={styles.dialog}>
          <Dialog.Title>Add supplier</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Name *"
              value={newSupplierName}
              onChangeText={setNewSupplierName}
              mode="outlined"
              style={styles.input}
              autoFocus
            />
            <TextInput
              label="Phone"
              value={newSupplierPhone}
              onChangeText={setNewSupplierPhone}
              mode="outlined"
              keyboardType="phone-pad"
              style={styles.input}
            />
            {supplierError ? <HelperText type="error">{supplierError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSupplierDialog(false)} disabled={savingSupplier}>Cancel</Button>
            <Button onPress={handleAddSupplier} loading={savingSupplier}>Save</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.h1, fontSize: 22 },
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  supplierGrid: { gap: spacing.sm },
  supplierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
  },
  supplierChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  supplierText: { flex: 1, minWidth: 0 },
  supplierName: { fontSize: 14, fontWeight: '600', color: colors.text },
  supplierNameOn: { color: colors.primary },
  supplierPhone: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  selectedHint: { marginTop: spacing.sm, fontSize: 12, color: colors.secondary, fontWeight: '600' },
  emptySupplier: { gap: spacing.md, alignItems: 'flex-start' },
  emptySupplierText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  resultsPanel: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  resultsStatus: {
    padding: spacing.md,
    color: colors.textMuted,
    textAlign: 'center',
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  resultPressed: { backgroundColor: colors.primaryLight },
  resultBody: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 14, fontWeight: '600', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultAdd: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
  emptyLines: { color: colors.textMuted, fontSize: 14, paddingVertical: spacing.sm },
  lineCard: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.sm },
  lineInfo: { flex: 1, paddingRight: spacing.sm },
  lineName: { fontSize: 14, fontWeight: '600', color: colors.text },
  lineSku: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  removeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineFields: { flexDirection: 'row', gap: spacing.sm },
  lineInput: { flex: 1, backgroundColor: colors.surface },
  lineTotal: {
    marginTop: spacing.sm,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: colors.secondary,
  },
  totalBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  totalLabel: { fontSize: 14, fontWeight: '600', color: colors.textSecondary },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.primary },
  submit: { marginTop: spacing.sm, borderRadius: radius.md },
  submitContent: { minHeight: 50 },
  submitLabel: { fontSize: 16, fontWeight: '700' },
  dialog: { borderRadius: radius.lg },
});
