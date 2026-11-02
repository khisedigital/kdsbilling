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
import {
  fetchProduct,
  productVariantToSearchResult,
  searchProducts,
  type SearchProductResult,
} from '../../services/catalogService';
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

type ProductGroup = {
  productId: string;
  productName: string;
  variants: SearchProductResult[];
};

type VariantQtyDraft = {
  variantId: string;
  productName: string;
  sku: string;
  barcode?: string;
  size?: string | null;
  color?: string | null;
  uomCode?: string;
  mrp?: number | null;
  sellingPrice: number;
  quantity: string;
  unitCost: string;
};

function groupSearchResults(items: SearchProductResult[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>();
  for (const item of items) {
    const existing = map.get(item.productId);
    if (existing) {
      if (!existing.variants.some((v) => v.variantId === item.variantId)) {
        existing.variants.push(item);
      }
    } else {
      map.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        variants: [item],
      });
    }
  }
  return Array.from(map.values());
}

function defaultUnitCost(product: SearchProductResult) {
  return product.costPrice && product.costPrice > 0 ? product.costPrice : product.sellingPrice || 0;
}

function money(n: number) {
  return `₹${n.toFixed(2)}`;
}

function isActiveVariant(status?: string | null) {
  return !status || status === 'active';
}

function productHasVariants(
  product: { has_variants?: boolean },
  variants: SearchProductResult[],
) {
  return Boolean(
    product.has_variants
      || variants.length > 1
      || variants.some((v) => Boolean(v.size || v.color)),
  );
}

function toVariantDraft(v: SearchProductResult): VariantQtyDraft {
  return {
    variantId: v.variantId,
    productName: v.productName,
    sku: v.sku,
    barcode: (v.barcodes || []).find(Boolean) || '',
    size: v.size,
    color: v.color,
    uomCode: v.uom?.code,
    mrp: v.mrp ?? null,
    sellingPrice: v.sellingPrice || 0,
    quantity: '0',
    unitCost: String(defaultUnitCost(v)),
  };
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

  const [variantPickerOpen, setVariantPickerOpen] = useState(false);
  const [variantPickerTitle, setVariantPickerTitle] = useState('');
  const [variantDrafts, setVariantDrafts] = useState<VariantQtyDraft[]>([]);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [variantPickerError, setVariantPickerError] = useState('');

  const productGroups = useMemo(() => groupSearchResults(results), [results]);

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

  const upsertLine = (product: SearchProductResult, quantity: number, unitCost: number) => {
    if (!(quantity > 0)) return;
    setLines((prev) => {
      const existing = prev.find((line) => line.variantId === product.variantId);
      if (existing) {
        return prev.map((line) =>
          line.variantId === product.variantId
            ? {
                ...line,
                quantity: String((parseFloat(line.quantity) || 0) + quantity),
                unitCost: String(unitCost || parseFloat(line.unitCost) || 0),
              }
            : line,
        );
      }
      return [
        ...prev,
        {
          key: `${product.variantId}-${Date.now()}`,
          variantId: product.variantId,
          productName: product.productName,
          sku: product.sku,
          size: product.size,
          color: product.color,
          quantity: String(quantity),
          unitCost: String(unitCost || 0),
          uomCode: product.uom?.code,
        },
      ];
    });
  };

  const addSingleVariant = (product: SearchProductResult) => {
    upsertLine(product, 1, defaultUnitCost(product));
    setSearch('');
    setResults([]);
    setSearchError('');
    Keyboard.dismiss();
  };

  const openVariantPickerWithList = (title: string, list: SearchProductResult[], warning?: string) => {
    setVariantPickerError(warning || '');
    setVariantPickerTitle(title);
    setVariantDrafts(list.map(toVariantDraft));
    setVariantPickerOpen(true);
  };

  const selectProductGroup = async (group: ProductGroup) => {
    setVariantPickerError('');
    setLoadingVariants(true);
    Keyboard.dismiss();
    try {
      const product = await fetchProduct(group.productId);
      const activeVariants = (product.variants || [])
        .filter((v) => v?.id && isActiveVariant(v.status))
        .map((v) => productVariantToSearchResult(product, v));

      if (!activeVariants.length) {
        setError('No active variants found for this product');
        return;
      }

      if (productHasVariants(product, activeVariants)) {
        openVariantPickerWithList(product.name || group.productName, activeVariants);
      } else {
        // No size/color variants — keep normal product-level purchase entry.
        addSingleVariant(activeVariants[0]);
      }
    } catch {
      const fallback = group.variants;
      if (productHasVariants({ has_variants: false }, fallback) || fallback.length > 1) {
        openVariantPickerWithList(
          group.productName,
          fallback,
          'Could not load all sizes. Showing search matches.',
        );
      } else if (fallback[0]) {
        addSingleVariant(fallback[0]);
      } else {
        setError('Could not load product variants');
      }
    } finally {
      setLoadingVariants(false);
    }
  };

  const updateVariantDraft = (variantId: string, patch: Partial<VariantQtyDraft>) => {
    setVariantDrafts((prev) =>
      prev.map((row) => (row.variantId === variantId ? { ...row, ...patch } : row)),
    );
    setVariantPickerError('');
  };

  const variantDraftTotals = useMemo(() => {
    return variantDrafts.reduce(
      (acc, row) => {
        const qty = parseFloat(row.quantity) || 0;
        const cost = parseFloat(row.unitCost) || 0;
        if (qty > 0) {
          acc.qty += qty;
          acc.amount += qty * cost;
          acc.lines += 1;
        }
        return acc;
      },
      { qty: 0, amount: 0, lines: 0 },
    );
  }, [variantDrafts]);

  const confirmVariantPicker = () => {
    const selected = variantDrafts.filter((row) => (parseFloat(row.quantity) || 0) > 0);
    if (!selected.length) {
      setVariantPickerError('Enter quantity greater than 0 for at least one variant');
      return;
    }
    for (const row of selected) {
      const qty = parseFloat(row.quantity);
      const unitCost = parseFloat(row.unitCost);
      if (Number.isNaN(qty) || qty <= 0) {
        setVariantPickerError(`Invalid quantity for ${variantLabel(row.size, row.color) || row.sku}`);
        return;
      }
      if (Number.isNaN(unitCost) || unitCost < 0) {
        setVariantPickerError(`Enter a valid purchase price for ${variantLabel(row.size, row.color) || row.sku}`);
        return;
      }
    }
    for (const row of selected) {
      upsertLine(
        {
          variantId: row.variantId,
          productId: '',
          productName: row.productName,
          sku: row.sku,
          size: row.size,
          color: row.color,
          sellingPrice: row.sellingPrice,
          costPrice: parseFloat(row.unitCost) || 0,
          mrp: row.mrp,
          barcodes: row.barcode ? [row.barcode] : [],
          uom: row.uomCode ? { code: row.uomCode } : null,
        },
        parseFloat(row.quantity) || 0,
        parseFloat(row.unitCost) || 0,
      );
    }
    setVariantPickerOpen(false);
    setVariantDrafts([]);
    setSearch('');
    setResults([]);
    setSearchError('');
  };

  const updateLine = (key: string, patch: Partial<LineItem>) => {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((line) => line.key !== key));
  };

  const totalQuantity = useMemo(
    () => lines.reduce((sum, line) => sum + (parseFloat(line.quantity) || 0), 0),
    [lines],
  );

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

        <SectionCard
          title="Add products"
          icon="package-variant"
          subtitle="Search by name, SKU or barcode. Variant products show all active sizes for qty entry.">
          <TextInput
            label="Search product"
            value={search}
            onChangeText={setSearch}
            mode="outlined"
            style={styles.input}
            autoCorrect={false}
            right={
              searching || loadingVariants
                ? <TextInput.Icon icon={() => <ActivityIndicator size={18} color={colors.primary} />} />
                : <TextInput.Icon icon="magnify" />
            }
          />
          {showResults ? (
            <View style={styles.resultsPanel}>
              {searchError ? (
                <Text style={styles.resultsStatus}>{searchError}</Text>
              ) : (
                productGroups.slice(0, 10).map((group) => {
                  const multi = group.variants.length > 1
                    || Boolean(group.variants[0]?.size || group.variants[0]?.color);
                  const first = group.variants[0];
                  const cost = first ? defaultUnitCost(first) : 0;
                  const sizeHint = multi
                    ? `${group.variants.length > 1 ? `${group.variants.length}+ sizes` : variantLabel(first?.size, first?.color) || 'sizes'}`
                    : null;
                  return (
                    <Pressable
                      key={group.productId}
                      onPress={() => selectProductGroup(group)}
                      disabled={loadingVariants}
                      style={({ pressed }) => [styles.resultRow, pressed && styles.resultPressed]}>
                      <View style={styles.resultBody}>
                        <Text style={styles.resultName} numberOfLines={1}>
                          {group.productName}
                          {sizeHint ? ` · ${sizeHint}` : ''}
                        </Text>
                        <Text style={styles.resultMeta} numberOfLines={1}>
                          {multi
                            ? 'Tap to enter qty & purchase price per size'
                            : `${first?.sku || ''} · Cost ${money(cost)} · Stock ${first?.stockQty ?? 0}`}
                        </Text>
                      </View>
                      <Text style={styles.resultAdd}>{multi ? 'Variants' : 'Add'}</Text>
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
          <View>
            <Text style={styles.totalLabel}>Total qty</Text>
            <Text style={styles.totalQtyValue}>{totalQuantity}</Text>
          </View>
          <View style={styles.totalAmountWrap}>
            <Text style={styles.totalLabel}>Bill total</Text>
            <Text style={styles.totalValue}>{money(totalAmount)}</Text>
          </View>
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

        <Dialog
          visible={variantPickerOpen}
          onDismiss={() => !loadingVariants && setVariantPickerOpen(false)}
          style={styles.variantDialog}>
          <Dialog.Title>{variantPickerTitle || 'Variants'}</Dialog.Title>
          <Dialog.ScrollArea style={styles.variantScroll}>
            {loadingVariants ? (
              <View style={styles.variantLoading}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.resultsStatus}>Loading variants…</Text>
              </View>
            ) : (
              <View style={styles.variantList}>
                <Text style={styles.variantHint}>
                  All active variants are listed. Qty defaults to 0 — only variants with qty greater than 0 are added.
                  MRP and selling price are for reference.
                </Text>
                {variantDrafts.map((row) => {
                  const size = variantLabel(row.size, row.color) || 'Default';
                  const qty = parseFloat(row.quantity) || 0;
                  const cost = parseFloat(row.unitCost) || 0;
                  return (
                    <View key={row.variantId} style={styles.variantCard}>
                      <Text style={styles.variantSize}>{size}</Text>
                      <Text style={styles.variantSku}>SKU {row.sku}</Text>
                      <Text style={styles.variantBarcode} numberOfLines={1}>
                        {row.barcode ? `Barcode ${row.barcode}` : 'No barcode yet'}
                      </Text>
                      <Text style={styles.variantRef}>
                        MRP {row.mrp != null && row.mrp > 0 ? money(row.mrp) : '—'}
                        {'  ·  '}
                        Sell {money(row.sellingPrice || 0)}
                      </Text>
                      <View style={styles.variantFields}>
                        <TextInput
                          label="Qty"
                          value={row.quantity}
                          onChangeText={(v) => updateVariantDraft(row.variantId, { quantity: v })}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          style={styles.variantQty}
                        />
                        <TextInput
                          label="Purchase ₹"
                          value={row.unitCost}
                          onChangeText={(v) => updateVariantDraft(row.variantId, { unitCost: v })}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          style={styles.variantCost}
                        />
                      </View>
                      {qty > 0 ? (
                        <Text style={styles.variantLineTotal}>Line {money(qty * cost)}</Text>
                      ) : null}
                    </View>
                  );
                })}
                {!variantDrafts.length ? (
                  <Text style={styles.resultsStatus}>No active variants found for this product.</Text>
                ) : null}
                {variantDrafts.length ? (
                  <View style={styles.variantTotals}>
                    <Text style={styles.variantTotalsText}>
                      Selected {variantDraftTotals.lines} · Qty {variantDraftTotals.qty}
                    </Text>
                    <Text style={styles.variantTotalsAmount}>{money(variantDraftTotals.amount)}</Text>
                  </View>
                ) : null}
                {variantPickerError ? <HelperText type="error">{variantPickerError}</HelperText> : null}
              </View>
            )}
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setVariantPickerOpen(false)} disabled={loadingVariants}>
              Cancel
            </Button>
            <Button
              onPress={confirmVariantPicker}
              disabled={loadingVariants || !variantDrafts.length}
              mode="contained">
              Add to purchase
            </Button>
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
  totalLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  totalQtyValue: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 2 },
  totalAmountWrap: { alignItems: 'flex-end' },
  totalValue: { fontSize: 22, fontWeight: '800', color: colors.primary, marginTop: 2 },
  submit: { marginTop: spacing.sm, borderRadius: radius.md },
  submitContent: { minHeight: 50 },
  submitLabel: { fontSize: 16, fontWeight: '700' },
  dialog: { borderRadius: radius.lg },
  variantDialog: { borderRadius: radius.lg, maxHeight: '90%' },
  variantScroll: { maxHeight: 480, paddingHorizontal: 0 },
  variantLoading: { paddingVertical: spacing.xl, alignItems: 'center', gap: spacing.sm },
  variantList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  variantHint: { ...typography.bodySm, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  variantCard: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  variantSize: { fontSize: 15, fontWeight: '700', color: colors.text },
  variantSku: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  variantBarcode: { fontSize: 11, color: colors.secondary, marginTop: 2, fontWeight: '600' },
  variantRef: { fontSize: 12, color: colors.textSecondary, marginTop: 6, fontWeight: '600' },
  variantFields: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  variantQty: { flex: 1, backgroundColor: colors.surface },
  variantCost: { flex: 1.2, backgroundColor: colors.surface },
  variantLineTotal: {
    marginTop: spacing.sm,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondary,
  },
  variantTotals: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  variantTotalsText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  variantTotalsAmount: { fontSize: 16, fontWeight: '800', color: colors.primary },
});
