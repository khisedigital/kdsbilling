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
import AppTextInput from '../../components/ui/AppTextInput';
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
  updateProduct,
  type SearchProductResult,
} from '../../services/catalogService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { variantLabel } from '../../utils/variantLabel';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography, dialogCard} from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PurchaseBillForm'>;

type LineItem = {
  key: string;
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  size?: string | null;
  color?: string | null;
  quantity: string;
  unitCost: string;
  uomCode?: string;
  sellingPrice?: number;
  mrp?: number | null;
  /** Temp line — create this size on the product before posting the purchase. */
  isNewVariant?: boolean;
};

type ProductGroup = {
  productId: string;
  productName: string;
  variants: SearchProductResult[];
};

type VariantQtyDraft = {
  key: string;
  variantId: string;
  productName: string;
  sku: string;
  barcode?: string;
  size?: string | null;
  color?: string | null;
  uomCode?: string;
  mrp?: number | null;
  sellingPrice: string;
  quantity: string;
  unitCost: string;
  isNew?: boolean;
};

type ActiveProduct = {
  productId: string;
  productName: string;
  drafts: VariantQtyDraft[];
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
    key: v.variantId,
    variantId: v.variantId,
    productName: v.productName,
    sku: v.sku,
    barcode: (v.barcodes || []).find(Boolean) || '',
    size: v.size,
    color: v.color,
    uomCode: v.uom?.code,
    mrp: v.mrp ?? null,
    sellingPrice: String(v.sellingPrice || 0),
    quantity: '0',
    unitCost: String(defaultUnitCost(v)),
    isNew: false,
  };
}

function sameVariantKey(size?: string | null, color?: string | null) {
  return `${(size || '').trim().toLowerCase()}|${(color || '').trim().toLowerCase()}`;
}

export default function PurchaseBillFormScreen({ route, navigation }: Props) {
  const t = useT();
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

  const [activeProduct, setActiveProduct] = useState<ActiveProduct | null>(null);
  const [loadingVariants, setLoadingVariants] = useState(false);
  const [variantError, setVariantError] = useState('');

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
    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchError('');
      try {
        const found = await searchProducts(q);
        if (cancelled) return;
        setResults(found);
        if (!found.length) setSearchError(t('No product for "{{q}}"', { q }));
      } catch {
        if (cancelled) return;
        setResults([]);
        setSearchError(t('Search failed. Try again.'));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search, t]);

  const upsertLine = (product: SearchProductResult & { productId?: string }, quantity: number, unitCost: number) => {
    if (!(quantity > 0)) return;
    setLines((prev) => {
      const existing = prev.find(
        (line) => !line.isNewVariant && line.variantId === product.variantId,
      );
      if (existing) {
        return prev.map((line) =>
          line.key === existing.key
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
          productId: product.productId || '',
          productName: product.productName,
          sku: product.sku,
          size: product.size,
          color: product.color,
          quantity: String(quantity),
          unitCost: String(unitCost || 0),
          uomCode: product.uom?.code,
          sellingPrice: product.sellingPrice,
          mrp: product.mrp,
          isNewVariant: false,
        },
      ];
    });
  };

  const addSingleVariant = (product: SearchProductResult) => {
    upsertLine(product, 1, defaultUnitCost(product));
    setActiveProduct(null);
    setSearch('');
    setResults([]);
    setSearchError('');
    Keyboard.dismiss();
  };

  const showInlineVariants = (
    productId: string,
    productName: string,
    list: SearchProductResult[],
    warning?: string,
  ) => {
    setVariantError(warning || '');
    setActiveProduct({
      productId,
      productName,
      drafts: list.map(toVariantDraft),
    });
    setSearch('');
    setResults([]);
    setSearchError('');
  };

  const selectProductGroup = async (group: ProductGroup) => {
    setVariantError('');
    setLoadingVariants(true);
    Keyboard.dismiss();
    try {
      const product = await fetchProduct(group.productId);
      const activeVariants = (product.variants || [])
        .filter((v) => v?.id && isActiveVariant(v.status))
        .map((v) => productVariantToSearchResult(product, v));

      if (!activeVariants.length) {
        setError(t('No active variants found for this product'));
        return;
      }

      if (productHasVariants(product, activeVariants)) {
        showInlineVariants(product.id, product.name || group.productName, activeVariants);
      } else {
        addSingleVariant(activeVariants[0]);
      }
    } catch {
      const fallback = group.variants;
      if (productHasVariants({ has_variants: false }, fallback) || fallback.length > 1) {
        showInlineVariants(
          group.productId,
          group.productName,
          fallback,
          t('Could not load all sizes. Showing search matches.'),
        );
      } else if (fallback[0]) {
        addSingleVariant(fallback[0]);
      } else {
        setError(t('Could not load product variants'));
      }
    } finally {
      setLoadingVariants(false);
    }
  };

  const updateDraft = (key: string, patch: Partial<VariantQtyDraft>) => {
    setActiveProduct((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        drafts: prev.drafts.map((row) => (row.key === key ? { ...row, ...patch } : row)),
      };
    });
    setVariantError('');
  };

  const addNewVariantDraft = () => {
    if (!activeProduct) return;
    const ref = activeProduct.drafts.find((d) => !d.isNew) || activeProduct.drafts[0];
    const key = `new-${Date.now()}`;
    setActiveProduct({
      ...activeProduct,
      drafts: [
        ...activeProduct.drafts,
        {
          key,
          variantId: key,
          productName: activeProduct.productName,
          sku: '',
          barcode: '',
          size: '',
          color: '',
          uomCode: ref?.uomCode,
          mrp: null,
          sellingPrice: ref?.sellingPrice || '0',
          quantity: '0',
          unitCost: ref?.unitCost || '0',
          isNew: true,
        },
      ],
    });
    setVariantError('');
  };

  const removeDraft = (key: string) => {
    setActiveProduct((prev) => {
      if (!prev) return prev;
      return { ...prev, drafts: prev.drafts.filter((row) => row.key !== key) };
    });
  };

  const variantDraftTotals = useMemo(() => {
    const drafts = activeProduct?.drafts || [];
    return drafts.reduce(
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
  }, [activeProduct]);

  const confirmInlineVariants = () => {
    if (!activeProduct) return;
    const selected = activeProduct.drafts.filter((row) => (parseFloat(row.quantity) || 0) > 0);
    if (!selected.length) {
      setVariantError(t('Enter quantity greater than 0 for at least one variant'));
      return;
    }

    const existingKeys = new Set(
      activeProduct.drafts
        .filter((row) => !row.isNew)
        .map((row) => sameVariantKey(row.size, row.color)),
    );
    const seenNew = new Set<string>();

    for (const row of selected) {
      const qty = parseFloat(row.quantity);
      const unitCost = parseFloat(row.unitCost);
      if (Number.isNaN(qty) || qty <= 0) {
        setVariantError(t('Invalid quantity for {{name}}', {
          name: variantLabel(row.size, row.color) || row.sku || t('new size'),
        }));
        return;
      }
      if (Number.isNaN(unitCost) || unitCost < 0) {
        setVariantError(t('Enter a valid purchase price for {{name}}', {
          name: variantLabel(row.size, row.color) || t('new size'),
        }));
        return;
      }
      if (row.isNew && !(row.size || '').trim() && !(row.color || '').trim()) {
        setVariantError(t('New variant needs a size or colour'));
        return;
      }
      const sell = parseFloat(row.sellingPrice);
      if (row.isNew && (Number.isNaN(sell) || sell < 0)) {
        setVariantError(t('New variant needs a valid selling price (0 allowed)'));
        return;
      }
      if (row.isNew) {
        const key = sameVariantKey(row.size, row.color);
        if (existingKeys.has(key) || seenNew.has(key)) {
          setVariantError(
            t('Size {{name}} already exists — use the existing row', {
              name: variantLabel(row.size, row.color) || t('Default'),
            }),
          );
          return;
        }
        seenNew.add(key);
      }
    }

    setLines((prev) => {
      let next = [...prev];
      for (const row of selected) {
        const qty = parseFloat(row.quantity) || 0;
        const unitCost = parseFloat(row.unitCost) || 0;
        if (row.isNew) {
          next.push({
            key: `${row.key}-${Date.now()}`,
            variantId: row.variantId,
            productId: activeProduct.productId,
            productName: activeProduct.productName,
            sku: row.sku || 'New',
            size: (row.size || '').trim() || null,
            color: (row.color || '').trim() || null,
            quantity: String(qty),
            unitCost: String(unitCost),
            uomCode: row.uomCode,
            sellingPrice: parseFloat(row.sellingPrice) || 0,
            mrp: row.mrp,
            isNewVariant: true,
          });
          continue;
        }

        const existing = next.find((line) => !line.isNewVariant && line.variantId === row.variantId);
        if (existing) {
          next = next.map((line) =>
            line.key === existing.key
              ? {
                  ...line,
                  quantity: String((parseFloat(line.quantity) || 0) + qty),
                  unitCost: String(unitCost),
                }
              : line,
          );
        } else {
          next.push({
            key: `${row.variantId}-${Date.now()}`,
            variantId: row.variantId,
            productId: activeProduct.productId,
            productName: row.productName,
            sku: row.sku,
            size: row.size,
            color: row.color,
            quantity: String(qty),
            unitCost: String(unitCost),
            uomCode: row.uomCode,
            sellingPrice: parseFloat(row.sellingPrice) || 0,
            mrp: row.mrp,
            isNewVariant: false,
          });
        }
      }
      return next;
    });

    setActiveProduct(null);
    setVariantError('');
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
      setSupplierError(t('Supplier name is required'));
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

  /** Create any new sizes on their products (append-only), then return lines with real variantIds. */
  const resolveNewVariants = async (purchaseLines: LineItem[]): Promise<LineItem[]> => {
    const newLines = purchaseLines.filter((line) => line.isNewVariant);
    if (!newLines.length) return purchaseLines;

    const byProduct = new Map<string, LineItem[]>();
    for (const line of newLines) {
      if (!line.productId) throw new Error(t('New variant is missing product id'));
      const list = byProduct.get(line.productId) || [];
      list.push(line);
      byProduct.set(line.productId, list);
    }

    const idMap = new Map<string, string>(); // temp variantId → real id

    for (const [productId, pending] of byProduct.entries()) {
      const product = await fetchProduct(productId);
      const existing = (product.variants || []).filter((v) => v?.id);
      const existingKeys = new Set(existing.map((v) => sameVariantKey(v.size, v.color)));

      // Reuse an existing size instead of creating a duplicate.
      const toCreate: LineItem[] = [];
      for (const line of pending) {
        const key = sameVariantKey(line.size, line.color);
        const match = existing.find((v) => sameVariantKey(v.size, v.color) === key);
        if (match?.id) {
          idMap.set(line.variantId, match.id);
        } else {
          toCreate.push(line);
          existingKeys.add(key);
        }
      }

      if (toCreate.length) {
        const createPayload = toCreate.map((line) => ({
          size: line.size || undefined,
          color: line.color || undefined,
          sellingPrice:
            line.sellingPrice != null && line.sellingPrice >= 0
              ? line.sellingPrice
              : parseFloat(line.unitCost) || 0,
          costPrice: parseFloat(line.unitCost) || 0,
          mrp: line.mrp != null ? line.mrp : undefined,
          stockQty: 0,
        }));

        const beforeKeys = new Set(existing.map((v) => sameVariantKey(v.size, v.color)));
        const updated = await updateProduct(productId, {
          variantSyncMode: 'append',
          variants: createPayload,
        });

        const after = (updated.variants || []).filter((v) => v?.id);
        const newlyCreated = after.filter((v) => !beforeKeys.has(sameVariantKey(v.size, v.color)));

        for (const line of toCreate) {
          const match =
            newlyCreated.find(
              (v) => sameVariantKey(v.size, v.color) === sameVariantKey(line.size, line.color),
            )
            || after.find(
              (v) => sameVariantKey(v.size, v.color) === sameVariantKey(line.size, line.color),
            );
          if (!match?.id) {
            throw new Error(
              t('Could not create variant {{label}} on {{product}}', {
                label: variantLabel(line.size, line.color) || '',
                product: line.productName,
              }),
            );
          }
          idMap.set(line.variantId, match.id);
          const idx = newlyCreated.findIndex((v) => v.id === match.id);
          if (idx >= 0) newlyCreated.splice(idx, 1);
        }
      }
    }

    return purchaseLines.map((line) => {
      if (!line.isNewVariant) return line;
      const realId = idMap.get(line.variantId);
      if (!realId) throw new Error(t('Failed to resolve new variant id'));
      return {
        ...line,
        variantId: realId,
        isNewVariant: false,
      };
    });
  };

  const handleSubmit = async () => {
    setError('');
    if (!supplierId) {
      setError(t('Select or add a supplier'));
      return;
    }
    if (!lines.length) {
      setError(t('Add at least one product'));
      return;
    }
    if (activeProduct) {
      setError(t('Finish adding the selected product variants first (or clear them)'));
      return;
    }

    const invalid = lines.find((line) => {
      const qty = parseFloat(line.quantity);
      const cost = parseFloat(line.unitCost);
      return Number.isNaN(qty) || qty <= 0 || Number.isNaN(cost) || cost < 0;
    });
    if (invalid) {
      setError(t('Each item needs a valid quantity and unit cost'));
      return;
    }

    const newInvalid = lines.find(
      (line) => line.isNewVariant && !(line.size || '').trim() && !(line.color || '').trim(),
    );
    if (newInvalid) {
      setError(t('New variants need a size or colour'));
      return;
    }

    setLoading(true);
    try {
      const resolved = await resolveNewVariants(lines);
      const bill = await createPurchaseBill({
        supplierId,
        notes: notes.trim() || undefined,
        items: resolved.map((line) => ({
          variantId: line.variantId,
          quantity: parseFloat(line.quantity),
          unitCost: parseFloat(line.unitCost),
        })),
      });
      Alert.alert(t('Purchase saved'), t('{{bill}} · stock updated', { bill: bill.bill_number }), [
        {
          text: t('OK'),
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
        <Text style={styles.title}>{t('Purchase Entry')}</Text>
        <Text style={styles.subtitle}>{t('Buy stock from supplier — quantity goes into inventory')}</Text>

        <SectionCard
          title={t('Supplier')}
          icon="truck"
          action={
            <Button compact mode="text" icon="plus" onPress={() => setSupplierDialog(true)} textColor={colors.primary}>
              {t('Add')}
            </Button>
          }>
          {loadingSuppliers ? (
            <ActivityIndicator color={colors.primary} />
          ) : suppliers.length === 0 ? (
            <View style={styles.emptySupplier}>
              <Text style={styles.emptySupplierText}>{t('No suppliers yet. Add one to continue.')}</Text>
              <Button mode="contained" icon="truck-plus" onPress={() => setSupplierDialog(true)}>
                {t('Add supplier')}
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
            <Text style={styles.selectedHint}>{t('Selected: {{name}}', { name: selectedSupplier.name })}</Text>
          ) : null}
        </SectionCard>

        <SectionCard
          title={t('Add products')}
          icon="package-variant"
          subtitle={t('Search a product. Variants open inline — you can also add a new size here.')}>
          <AppTextInput
            label={t('Search product')}
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
                    ? (group.variants.length > 1
                      ? t('{{count}}+ sizes', { count: group.variants.length })
                      : variantLabel(first?.size, first?.color) || t('sizes'))
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
                            ? t('Tap to enter qty per size (inline)')
                            : t('{{sku}} · Cost {{cost}} · Stock {{stock}}', {
                              sku: first?.sku || '',
                              cost: money(cost),
                              stock: first?.stockQty ?? 0,
                            })}
                        </Text>
                      </View>
                      <Text style={styles.resultAdd}>{multi ? t('Open') : t('Add')}</Text>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}

          {activeProduct ? (
            <View style={styles.inlinePanel}>
              <View style={styles.inlineHead}>
                <View style={styles.flex}>
                  <Text style={styles.inlineTitle}>{activeProduct.productName}</Text>
                  <Text style={styles.inlineHint}>
                    {t('Qty 0 = skip. New sizes are saved on this product when you save the purchase.')}
                  </Text>
                </View>
                <Pressable
                  onPress={() => {
                    setActiveProduct(null);
                    setVariantError('');
                  }}
                  hitSlop={10}
                  style={styles.removeBtn}>
                  <Icon name="close" size={16} color={colors.textMuted} />
                </Pressable>
              </View>

              {activeProduct.drafts.map((row) => {
                const size = variantLabel(row.size, row.color) || (row.isNew ? t('New size') : t('Default'));
                const qty = parseFloat(row.quantity) || 0;
                const cost = parseFloat(row.unitCost) || 0;
                return (
                  <View key={row.key} style={[styles.variantCard, row.isNew && styles.variantCardNew]}>
                    {row.isNew ? (
                      <>
                        <View style={styles.newBadgeRow}>
                          <Text style={styles.newBadge}>{t('New variant')}</Text>
                          <Pressable onPress={() => removeDraft(row.key)} hitSlop={8}>
                            <Icon name="delete-outline" size={18} color={colors.error} />
                          </Pressable>
                        </View>
                        <View style={styles.variantFields}>
                          <AppTextInput
                            label={t('Size *')}
                            value={row.size || ''}
                            onChangeText={(v) => updateDraft(row.key, { size: v })}
                            mode="outlined"
                            dense
                            style={styles.variantQty}
                          />
                          <AppTextInput
                            label={t('Colour')}
                            value={row.color || ''}
                            onChangeText={(v) => updateDraft(row.key, { color: v })}
                            mode="outlined"
                            dense
                            style={styles.variantCost}
                          />
                        </View>
                        <AppTextInput
                          label={t('Selling price ₹ *')}
                          value={row.sellingPrice}
                          onChangeText={(v) => updateDraft(row.key, { sellingPrice: v })}
                          keyboardType="decimal-pad"
                          mode="outlined"
                          dense
                          style={styles.fullInput}
                        />
                      </>
                    ) : (
                      <>
                        <Text style={styles.variantSize}>{size}</Text>
                        <Text style={styles.variantSku}>{t('SKU {{sku}}', { sku: row.sku })}</Text>
                        <Text style={styles.variantBarcode} numberOfLines={1}>
                          {row.barcode ? t('Barcode {{code}}', { code: row.barcode }) : t('No barcode yet')}
                        </Text>
                        <Text style={styles.variantRef}>
                          {t('MRP {{mrp}}  ·  Sell {{sell}}', {
                            mrp: row.mrp != null && row.mrp > 0 ? money(row.mrp) : '—',
                            sell: money(parseFloat(row.sellingPrice) || 0),
                          })}
                        </Text>
                      </>
                    )}
                    <View style={styles.variantFields}>
                      <AppTextInput
                        label={t('Qty')}
                        value={row.quantity}
                        onChangeText={(v) => updateDraft(row.key, { quantity: v })}
                        keyboardType="decimal-pad"
                        mode="outlined"
                        dense
                        style={styles.variantQty}
                      />
                      <AppTextInput
                        label={t('Purchase ₹')}
                        value={row.unitCost}
                        onChangeText={(v) => updateDraft(row.key, { unitCost: v })}
                        keyboardType="decimal-pad"
                        mode="outlined"
                        dense
                        style={styles.variantCost}
                      />
                    </View>
                    {qty > 0 ? (
                      <Text style={styles.variantLineTotal}>{t('Line {{amount}}', { amount: money(qty * cost) })}</Text>
                    ) : null}
                  </View>
                );
              })}

              <View style={styles.inlineActions}>
                <Button
                  mode="outlined"
                  icon="plus"
                  onPress={addNewVariantDraft}
                  style={styles.addVariantBtn}>
                  {t('Add variant')}
                </Button>
                <Button mode="contained" onPress={confirmInlineVariants} style={styles.addPurchaseBtn}>
                  {t('Add to purchase')}
                </Button>
              </View>

              {variantDraftTotals.lines > 0 ? (
                <View style={styles.variantTotals}>
                  <Text style={styles.variantTotalsText}>
                    {t('Selected {{lines}} · Qty {{qty}}', {
                      lines: variantDraftTotals.lines,
                      qty: variantDraftTotals.qty,
                    })}
                  </Text>
                  <Text style={styles.variantTotalsAmount}>{money(variantDraftTotals.amount)}</Text>
                </View>
              ) : null}
              {variantError ? <HelperText type="error">{variantError}</HelperText> : null}
            </View>
          ) : null}
        </SectionCard>

        <SectionCard title={t('Purchase items')} icon="clipboard-list-outline" subtitle={t(lines.length === 1 ? '{{count}} line' : '{{count}} lines', { count: lines.length })}>
          {!lines.length ? (
            <Text style={styles.emptyLines}>{t('Search and add products above')}</Text>
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
                        {line.isNewVariant ? t(' · New') : ''}
                      </Text>
                      <Text style={styles.lineSku}>
                        {line.isNewVariant ? t('Will be created on save') : line.sku}
                      </Text>
                    </View>
                    <Pressable onPress={() => removeLine(line.key)} hitSlop={10} style={styles.removeBtn}>
                      <Icon name="close" size={16} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <View style={styles.lineFields}>
                    <AppTextInput
                      label={line.uomCode ? t('Qty ({{uom}})', { uom: line.uomCode }) : t('Qty')}
                      value={line.quantity}
                      onChangeText={(v) => updateLine(line.key, { quantity: v })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={styles.lineInput}
                      dense
                    />
                    <AppTextInput
                      label={t('Unit cost ₹')}
                      value={line.unitCost}
                      onChangeText={(v) => updateLine(line.key, { unitCost: v })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={styles.lineInput}
                      dense
                    />
                  </View>
                  <Text style={styles.lineTotal}>{t('Line {{amount}}', { amount: money(lineTotal) })}</Text>
                </View>
              );
            })
          )}
        </SectionCard>

        <SectionCard title={t('Notes')} icon="note-text-outline">
          <AppTextInput
            label={t('Optional notes')}
            value={notes}
            onChangeText={setNotes}
            mode="outlined"
            style={styles.input}
          />
        </SectionCard>

        <View style={styles.totalBar}>
          <View>
            <Text style={styles.totalLabel}>{t('Total qty')}</Text>
            <Text style={styles.totalQtyValue}>{totalQuantity}</Text>
          </View>
          <View style={styles.totalAmountWrap}>
            <Text style={styles.totalLabel}>{t('Bill total')}</Text>
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
          {t('Save purchase & stock in')}
        </Button>
      </ScrollView>

      <Portal>
        <Dialog visible={supplierDialog} onDismiss={() => setSupplierDialog(false)} style={styles.dialog}>
          <Dialog.Title>{t('Add supplier')}</Dialog.Title>
          <Dialog.Content>
            <AppTextInput
              label={t('Name *')}
              value={newSupplierName}
              onChangeText={setNewSupplierName}
              mode="outlined"
              style={styles.input}
              autoFocus
            />
            <AppTextInput
              label={t('Phone')}
              value={newSupplierPhone}
              onChangeText={setNewSupplierPhone}
              mode="outlined"
              keyboardType="phone-pad"
              style={styles.input}
            />
            {supplierError ? <HelperText type="error">{supplierError}</HelperText> : null}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setSupplierDialog(false)} disabled={savingSupplier}>{t('Cancel')}</Button>
            <Button onPress={handleAddSupplier} loading={savingSupplier}>{t('Save')}</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { ...typography.h1, fontSize: 22 },
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  flex: { flex: 1, minWidth: 0 },
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
  fullInput: { marginTop: spacing.sm, backgroundColor: colors.surface },
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
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  resultPressed: { backgroundColor: colors.primaryLight },
  resultBody: { flex: 1, minWidth: 0 },
  resultName: { fontSize: 14, fontWeight: '600', color: colors.text },
  resultMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  resultAdd: { fontSize: 13, fontWeight: '700', color: colors.secondary, marginLeft: spacing.sm },
  inlinePanel: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.primaryLight,
  },
  inlineHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing.md },
  inlineTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  inlineHint: { fontSize: 12, color: colors.textMuted, marginTop: 4, lineHeight: 16 },
  inlineActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  addVariantBtn: { flex: 1, borderRadius: radius.md },
  addPurchaseBtn: { flex: 1.2, borderRadius: radius.md },
  emptyLines: { color: colors.textMuted, fontSize: 14, paddingVertical: spacing.sm },
  lineCard: {
    borderWidth: 1,
    borderColor: colors.border,
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
  dialog: { ...dialogCard },
  variantCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  variantCardNew: {
    borderColor: colors.secondary,
    borderStyle: 'dashed',
  },
  newBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  newBadge: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.secondary,
    textTransform: 'uppercase',
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
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  variantTotalsText: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  variantTotalsAmount: { fontSize: 16, fontWeight: '800', color: colors.primary },
});
