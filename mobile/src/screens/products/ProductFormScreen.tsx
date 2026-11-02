import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  Dialog,
  HelperText,
  Portal,
  Switch,
  Text,
  TextInput,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import {
  createProduct,
  fetchBrands,
  fetchCategories,
  fetchProduct,
  fetchTaxGroups,
  fetchUnits,
  mainBarcodeOf,
  quantityBarcodesOf,
  updateProduct,
} from '../../services/catalogService';
import type { Brand, Category, QuantityBarcodeInput, TaxGroup, UnitOfMeasure } from '../../types/catalog';
import { formatQuantity, parseQuantityForUom } from '../../utils/quantity';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductForm'>;

type Choice = { value: string; label: string };

type SizeRow = {
  key: string;
  id?: string;
  size: string;
  sku: string;
  barcode: string;
  sellingPrice: string;
  costPrice: string;
  mrp: string;
  stockQty: string;
};

type QtyBarcodeRow = {
  key: string;
  quantity: string;
  barcode: string;
};

const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Free Size'];

function newRowKey() {
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeSizeSku(baseSku: string, size: string) {
  const base = baseSku.trim().replace(/\s+/g, '-') || 'SKU';
  const suffix = size.trim().replace(/\s+/g, '').toUpperCase();
  return `${base}-${suffix}`;
}

/** Match API: split total across sizes; remainder on first sizes. */
function splitStockLocal(total: number, count: number, allowDecimal: boolean): number[] {
  if (count <= 0) return [];
  if (total <= 0) return Array.from({ length: count }, () => 0);
  if (!allowDecimal) {
    const whole = Math.round(total);
    const base = Math.floor(whole / count);
    let rem = whole - base * count;
    return Array.from({ length: count }, () => {
      const share = base + (rem > 0 ? 1 : 0);
      if (rem > 0) rem -= 1;
      return share;
    });
  }
  const base = Math.floor((total / count) * 1000) / 1000;
  const shares = Array.from({ length: count }, () => base);
  shares[0] = Math.round((total - base * (count - 1)) * 1000) / 1000;
  return shares;
}

function rebalanceRowStock(rows: SizeRow[], total: number, allowDecimal: boolean): SizeRow[] {
  const shares = splitStockLocal(total, rows.length, allowDecimal);
  return rows.map((row, index) => ({
    ...row,
    stockQty: String(shares[index] ?? 0),
  }));
}

type ChoiceFieldProps = {
  label: string;
  value: string;
  choices: Choice[];
  placeholder: string;
  onChange: (value: string) => void;
};

function ChoiceField({ label, value, choices, placeholder, onChange }: ChoiceFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.value === value);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <View pointerEvents="none">
          <TextInput
            label={label}
            value={selected?.label || ''}
            placeholder={placeholder}
            mode="outlined"
            editable={false}
            style={styles.input}
            right={<TextInput.Icon icon="chevron-down" />}
          />
        </View>
      </Pressable>

      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={styles.choiceDialog}>
          <Dialog.Title>{label.replace(/\s*\*$/, '')}</Dialog.Title>
          <Dialog.Content style={styles.choiceContent}>
            <ScrollView style={styles.choiceScroll} keyboardShouldPersistTaps="handled">
              {choices.map((item) => {
                const active = item.value === value;
                return (
                  <Pressable
                    key={item.value || 'none'}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                    style={[styles.choiceRow, active && styles.choiceRowOn]}>
                    <Text style={[styles.choiceLabel, active && styles.choiceLabelOn]}>{item.label}</Text>
                    {active ? <Icon name="check" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)}>Cancel</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

function sortTaxGroups(groups: TaxGroup[]) {
  return [...groups].sort(
    (a, b) => parseFloat(String(a.total_rate)) - parseFloat(String(b.total_rate)),
  );
}

function taxLabel(group: TaxGroup) {
  const rate = parseFloat(String(group.total_rate));
  return `${rate}%`;
}

function apiError(err: unknown, fallback: string) {
  return (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message || fallback;
}

export default function ProductFormScreen({ navigation, route }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const twoColumn = windowWidth >= 860;
  const productId = route.params?.productId;
  const isEdit = !!productId;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [color, setColor] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [multiSizes, setMultiSizes] = useState(false);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>([]);
  const [customSize, setCustomSize] = useState('');
  const [mainStockQty, setMainStockQty] = useState(0);
  const [isWeightBased, setIsWeightBased] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qtyRows, setQtyRows] = useState<QtyBarcodeRow[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);

  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [uomId, setUomId] = useState('');
  const [taxGroupId, setTaxGroupId] = useState('');

  const [loading, setLoading] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(isEdit);
  const [error, setError] = useState('');
  const [showOptional, setShowOptional] = useState(isEdit);

  const sortedTaxGroups = useMemo(() => sortTaxGroups(taxGroups), [taxGroups]);
  const zeroTaxGroup = sortedTaxGroups.find(
    (group) => parseFloat(String(group.total_rate)) === 0,
  );
  const taxableGroups = sortedTaxGroups.filter(
    (group) => parseFloat(String(group.total_rate)) > 0,
  );
  const cost = parseFloat(costPrice) || 0;
  const selling = parseFloat(sellingPrice) || 0;
  const profit = selling - cost;
  const margin = selling > 0 ? (profit / selling) * 100 : 0;
  const nameMissing = !name.trim();
  // Product-level price only for single-item mode; multi-size prices live on each variant.
  const priceMissing = !multiSizes && (!sellingPrice.trim() || selling <= 0);
  const selectedSizes = useMemo(() => new Set(sizeRows.map((row) => row.size.toUpperCase())), [sizeRows]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [cats, brs, u, taxes, product] = await Promise.all([
          fetchCategories(),
          fetchBrands(),
          fetchUnits(),
          fetchTaxGroups(),
          productId ? fetchProduct(productId) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        setCategories(cats);
        setBrands(brs);
        setUnits(u);
        setTaxGroups(taxes);

        if (product) {
          const variants = product.variants || [];
          const first = variants[0];
          const useSizes =
            variants.length > 1 || variants.some((v) => !!(v.size || v.color));

          setName(product.name);
          setDescription(product.description || '');
          setCategoryId(product.category_id || '');
          setBrandId(product.brand_id || '');
          setUomId(product.uom_id);
          setTaxGroupId(product.tax_group_id || '');
          setTaxCode(product.tax_code || '');
          setIsWeightBased(product.is_weight_based);
          setMultiSizes(useSizes);
          setVariantId(first?.id || null);
          setMainStockQty(product.stockQty ?? variants.reduce((sum, v) => sum + (v.stockQty || 0), 0));

          if (first) {
            setSku(first.sku || '');
            setBarcode(mainBarcodeOf(first));
            const productUom = u.find((x) => x.id === product.uom_id);
            setQtyRows(
              quantityBarcodesOf(first).map((b) => ({
                key: newRowKey(),
                quantity: formatQuantity(b.quantity, productUom),
                barcode: b.barcode,
              })),
            );
            setCostPrice(String(parseFloat(String(first.cost_price)) || ''));
            setSellingPrice(String(parseFloat(String(first.selling_price)) || ''));
            setMrp(first.mrp ? String(parseFloat(String(first.mrp))) : '');
            setColor(first.color || '');
          }

          if (useSizes) {
            setShowOptional(true);
            // Clear product-level prices — only variants carry price when multi-size.
            setSellingPrice('');
            setCostPrice('');
            setMrp('');
            setSku('');
            setBarcode('');
            setSizeRows(
              variants.map((v) => ({
                key: v.id,
                id: v.id,
                size: v.size || 'Default',
                sku: v.sku || '',
                barcode: mainBarcodeOf(v),
                sellingPrice: String(parseFloat(String(v.selling_price)) || ''),
                costPrice: String(parseFloat(String(v.cost_price)) || ''),
                mrp: v.mrp != null && v.mrp !== '' ? String(parseFloat(String(v.mrp)) || '') : '',
                stockQty: String(v.stockQty ?? 0),
              })),
            );
            const colors = [...new Set(variants.map((v) => v.color).filter(Boolean))];
            if (colors.length === 1) setColor(colors[0] as string);
          }
        } else {
          if (u.length) setUomId(u.find((x) => x.code === 'pcs')?.id || u[0].id);
          const zeroTax = taxes.find(
            (group) => parseFloat(String(group.total_rate)) === 0,
          );
          setTaxGroupId(zeroTax?.id || '');
        }
      } catch {
        if (!cancelled) setError('Could not load product');
      } finally {
        if (!cancelled) setLoadingProduct(false);
      }
    })();

    return () => { cancelled = true; };
  }, [productId]);

  const addSize = (rawSize: string) => {
    const size = rawSize.trim();
    if (!size) return;
    if (selectedSizes.has(size.toUpperCase())) return;

    setSizeRows((rows) => {
      const reuseExisting = rows.length === 0 && !!variantId;
      // When converting a single item into sizes, carry its prices onto the first size only.
      const seedFromSingle = reuseExisting || (rows.length === 0 && !multiSizes);
      const next: SizeRow[] = [
        ...rows,
        {
          key: newRowKey(),
          id: reuseExisting ? variantId || undefined : undefined,
          size,
          sku: makeSizeSku(sku || name.slice(0, 8).toUpperCase(), size),
          barcode: reuseExisting ? barcode : '',
          sellingPrice: seedFromSingle ? sellingPrice : '',
          costPrice: seedFromSingle ? costPrice : '',
          mrp: seedFromSingle ? mrp : '',
          stockQty: '0',
        },
      ];
      const totalFromRows = rows.reduce((sum, row) => sum + (parseFloat(row.stockQty) || 0), 0);
      const total = totalFromRows > 0 ? totalFromRows : mainStockQty;
      return rebalanceRowStock(next, total, isWeightBased);
    });
    if (!multiSizes) {
      setSellingPrice('');
      setCostPrice('');
      setMrp('');
    }
    setMultiSizes(true);
  };

  const removeSizeRow = (key: string) => {
    setSizeRows((rows) => {
      const remaining = rows.filter((row) => row.key !== key);
      if (!remaining.length) return remaining;
      const total = rows.reduce((sum, row) => sum + (parseFloat(row.stockQty) || 0), 0);
      return rebalanceRowStock(remaining, total, isWeightBased);
    });
  };

  const updateSizeRow = (key: string, patch: Partial<SizeRow>) => {
    setSizeRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const splitStockEvenly = () => {
    setSizeRows((rows) => {
      if (!rows.length) return rows;
      const total = rows.reduce((sum, row) => sum + (parseFloat(row.stockQty) || 0), 0) || mainStockQty;
      return rebalanceRowStock(rows, total, isWeightBased);
    });
  };

  const toggleMultiSizes = (enabled: boolean) => {
    if (!enabled && sizeRows.filter((row) => row.id).length > 1) {
      Alert.alert(
        'Turn off multiple sizes?',
        'Saving after this will keep only one variant and remove the other sizes.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Turn off',
            style: 'destructive',
            onPress: () => {
              const first = sizeRows[0];
              if (first) {
                setVariantId(first.id || null);
                setSku(first.sku);
                setBarcode(first.barcode);
                setSellingPrice(first.sellingPrice);
                setCostPrice(first.costPrice);
                setMrp(first.mrp);
                setMainStockQty(parseFloat(first.stockQty) || 0);
              }
              setMultiSizes(false);
            },
          },
        ],
      );
      return;
    }
    setMultiSizes(enabled);
  };

  const sizeStockTotal = useMemo(
    () => sizeRows.reduce((sum, row) => sum + (parseFloat(row.stockQty) || 0), 0),
    [sizeRows],
  );

  const buildVariantPayload = () => {
    if (!multiSizes || sizeRows.length === 0) return null;
    const sharedColor = color.trim() || undefined;
    return sizeRows.map((row) => ({
      id: row.id,
      size: row.size.trim(),
      color: sharedColor,
      sku: row.sku.trim() || undefined,
      barcode: row.barcode.trim() || undefined,
      costPrice: row.costPrice ? parseFloat(row.costPrice) : 0,
      sellingPrice: parseFloat(row.sellingPrice),
      mrp: row.mrp ? parseFloat(row.mrp) : undefined,
      stockQty: parseFloat(row.stockQty) || 0,
    }));
  };

  const selectedUom = units.find((u) => u.id === uomId);

  const updateQtyRow = (key: string, patch: Partial<QtyBarcodeRow>) => {
    setQtyRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  /** Returns the payload, or an error message for the first bad row. */
  const buildQuantityBarcodes = (): QuantityBarcodeInput[] | string => {
    const out: QuantityBarcodeInput[] = [];
    const seenQty = new Set<string>();
    const seenCodes = new Set<string>(barcode.trim() ? [barcode.trim()] : []);
    for (const row of qtyRows) {
      const raw = row.quantity.trim();
      const code = row.barcode.trim();
      if (!raw && !code) continue;
      if (!raw) return `Enter a quantity for barcode ${code}`;
      const qty = parseQuantityForUom(raw, selectedUom);
      if (!qty) return `"${raw}" is not a valid quantity`;
      const qtyKey = qty.toFixed(4);
      if (seenQty.has(qtyKey)) return `Quantity ${raw} is listed twice`;
      seenQty.add(qtyKey);
      if (code) {
        if (seenCodes.has(code)) return `Barcode ${code} is used twice`;
        seenCodes.add(code);
      }
      out.push({ quantity: qty, barcode: code || undefined });
    }
    return out;
  };

  const handleSubmit = async () => {
    setError('');
    if (nameMissing || !uomId) {
      setError('Please complete the highlighted required fields');
      return;
    }
    if (!multiSizes && priceMissing) {
      setError('Please complete the highlighted required fields');
      return;
    }
    const quantityBarcodes = multiSizes ? undefined : buildQuantityBarcodes();
    if (typeof quantityBarcodes === 'string') {
      setError(quantityBarcodes);
      return;
    }
    if (multiSizes) {
      if (!sizeRows.length) {
        setError('Add at least one size (S, M, L…)');
        return;
      }
      const badPrice = sizeRows.find((row) => !(parseFloat(row.sellingPrice) > 0));
      if (badPrice) {
        setError(`Enter a selling price for size ${badPrice.size}`);
        return;
      }
    }

    setLoading(true);
    try {
      const taxValue = taxGroupId || null;
      const variants = buildVariantPayload();

      if (isEdit && productId) {
        if (variants) {
          await updateProduct(productId, {
            name: name.trim(),
            description: description.trim() || undefined,
            categoryId: categoryId || null,
            brandId: brandId || null,
            uomId,
            taxGroupId: taxValue,
            taxCode: taxCode.trim() || undefined,
            isWeightBased,
            allowDecimalQty: isWeightBased,
            variants,
          });
        } else {
          await updateProduct(productId, {
            name: name.trim(),
            description: description.trim() || undefined,
            categoryId: categoryId || null,
            brandId: brandId || null,
            uomId,
            taxGroupId: taxValue,
            taxCode: taxCode.trim() || undefined,
            isWeightBased,
            allowDecimalQty: isWeightBased,
            variants: [
              {
                id: variantId || undefined,
                sku: sku.trim() || undefined,
                barcode: barcode.trim() || undefined,
                size: '',
                color: '',
                costPrice: costPrice ? parseFloat(costPrice) : 0,
                sellingPrice: parseFloat(sellingPrice),
                mrp: mrp ? parseFloat(mrp) : undefined,
                quantityBarcodes,
              },
            ],
          });
        }
      } else if (variants) {
        // Pricing is only on variants — no product-level sellingPrice/cost/mrp.
        await createProduct({
          name: name.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          uomId,
          taxGroupId: taxValue || undefined,
          taxCode: taxCode.trim() || undefined,
          isWeightBased,
          allowDecimalQty: isWeightBased,
          sellingPrice: variants[0].sellingPrice,
          variants,
        });
      } else {
        await createProduct({
          name: name.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          uomId,
          taxGroupId: taxValue || undefined,
          taxCode: taxCode.trim() || undefined,
          isWeightBased,
          allowDecimalQty: isWeightBased,
          sku: sku.trim() || undefined,
          barcode: barcode.trim() || undefined,
          quantityBarcodes,
          costPrice: costPrice ? parseFloat(costPrice) : 0,
          sellingPrice: parseFloat(sellingPrice),
          mrp: mrp ? parseFloat(mrp) : undefined,
        });
      }
      navigation.goBack();
    } catch (err: unknown) {
      setError(apiError(err, isEdit ? 'Failed to update product' : 'Failed to create product'));
    } finally {
      setLoading(false);
    }
  };

  const categoryChoices = categories.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  const brandChoices = brands.map((brand) => ({
    value: brand.id,
    label: brand.name,
  }));

  const uomChoices = units.map((u) => ({
    value: u.id,
    label: `${u.name} (${u.code.toUpperCase()})`,
  }));

  if (loadingProduct) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const taxChips = (
    <>
      <Text style={styles.label}>Tax</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.taxRow}>
        <Pressable
          onPress={() => setTaxGroupId(zeroTaxGroup?.id || '')}
          style={[
            styles.taxChip,
            (!taxGroupId || taxGroupId === zeroTaxGroup?.id) && styles.taxChipActive,
          ]}>
          <Text
            style={[
              styles.taxChipRate,
              (!taxGroupId || taxGroupId === zeroTaxGroup?.id) && styles.taxChipTextActive,
            ]}>
            0%
          </Text>
          <Text
            style={[
              styles.taxChipName,
              (!taxGroupId || taxGroupId === zeroTaxGroup?.id) && styles.taxChipTextActive,
            ]}>
            No tax
          </Text>
        </Pressable>
        {taxableGroups.map((t) => {
          const active = taxGroupId === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTaxGroupId(t.id)}
              style={[styles.taxChip, active && styles.taxChipActive]}>
              <Text style={[styles.taxChipRate, active && styles.taxChipTextActive]}>{taxLabel(t)}</Text>
              <Text style={[styles.taxChipName, active && styles.taxChipTextActive]} numberOfLines={1}>
                {t.name.replace(/^GST\s*/i, '')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  const productColumn = (
    <SectionCard title="Product" subtitle="Basic info and pricing" icon="package-variant">
      <TextInput
        label="Product name *"
        value={name}
        onChangeText={setName}
        mode="outlined"
        style={styles.input}
        error={!!error && nameMissing}
        autoCapitalize="words"
        returnKeyType="next"
      />
      {!!error && nameMissing ? <HelperText type="error">Enter a product name</HelperText> : null}

      <View style={styles.priceRow}>
        <View style={styles.halfInput}>
          <ChoiceField
            label="Category"
            value={categoryId}
            choices={[{ value: '', label: 'No category' }, ...categoryChoices]}
            placeholder="Category"
            onChange={setCategoryId}
          />
        </View>
        <View style={styles.halfInput}>
          <ChoiceField
            label="Brand"
            value={brandId}
            choices={[{ value: '', label: 'No brand' }, ...brandChoices]}
            placeholder="Brand"
            onChange={setBrandId}
          />
        </View>
      </View>

      <ChoiceField
        label="Unit *"
        value={uomId}
        choices={uomChoices}
        placeholder="Select unit"
        onChange={setUomId}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchTitle}>Sold by weight / decimal</Text>
          <Text style={styles.switchHint}>kg, litre, metre, partial qty</Text>
        </View>
        <Switch value={isWeightBased} onValueChange={setIsWeightBased} color={colors.primary} />
      </View>

      {taxChips}

      <Pressable
        onPress={() => toggleMultiSizes(!multiSizes)}
        style={[styles.variantCheckRow, multiSizes && styles.variantCheckRowOn]}>
        <Checkbox
          status={multiSizes ? 'checked' : 'unchecked'}
          onPress={() => toggleMultiSizes(!multiSizes)}
          color={colors.primary}
        />
        <View style={styles.switchText}>
          <Text style={styles.switchTitle}>This product has variants</Text>
          <Text style={styles.switchHint}>
            Check to enable sizes (S, M, L…) in the right column. Pricing moves to each size.
          </Text>
        </View>
      </Pressable>

      {!multiSizes ? (
        <>
          <Text style={styles.sectionDivider}>Price</Text>
          <TextInput
            label="Selling price *"
            value={sellingPrice}
            onChangeText={setSellingPrice}
            keyboardType="decimal-pad"
            mode="outlined"
            style={styles.input}
            error={!!error && priceMissing}
            left={<TextInput.Affix text="₹" />}
          />
          {!!error && priceMissing ? <HelperText type="error">Enter a valid selling price</HelperText> : null}

          <View style={styles.priceRow}>
            <TextInput
              label="Cost"
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="decimal-pad"
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              left={<TextInput.Affix text="₹" />}
            />
            <TextInput
              label="MRP"
              value={mrp}
              onChangeText={setMrp}
              keyboardType="decimal-pad"
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              left={<TextInput.Affix text="₹" />}
            />
          </View>

          {selling > 0 && cost > 0 ? (
            <View style={[styles.profitBox, profit < 0 && styles.lossBox]}>
              <Icon
                name={profit >= 0 ? 'trending-up' : 'trending-down'}
                size={20}
                color={profit >= 0 ? colors.secondary : colors.error}
              />
              <Text style={[styles.profitText, profit < 0 && { color: colors.error }]}>
                {profit >= 0 ? 'Profit' : 'Loss'} ₹{Math.abs(profit).toFixed(2)}
                {profit >= 0 ? ` · ${margin.toFixed(1)}% margin` : ''}
              </Text>
            </View>
          ) : null}

          <View style={styles.priceRow}>
            <TextInput
              label="SKU"
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
            />
            <TextInput
              label="Barcode"
              value={barcode}
              onChangeText={setBarcode}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
            />
          </View>

          <View style={styles.packHeader}>
            <Text style={styles.packTitle}>Pack barcodes</Text>
            <Text style={styles.packHint}>Optional · e.g. 500 g pack scans as that qty</Text>
          </View>
          {qtyRows.map((row) => {
            const raw = row.quantity.trim();
            const qty = raw ? parseQuantityForUom(raw, selectedUom) : null;
            const hint = !raw
              ? ''
              : qty
                ? `Adds ${formatQuantity(qty, selectedUom)}${selling > 0 ? ` · ₹${(selling * qty).toFixed(2)}` : ''}`
                : 'Not a valid quantity';
            return (
              <View key={row.key} style={styles.qtyRow}>
                <View style={styles.qtyFields}>
                  <View style={styles.priceRow}>
                    <TextInput
                      label={`Qty${selectedUom ? ` (${selectedUom.code})` : ''}`}
                      value={row.quantity}
                      onChangeText={(value) => updateQtyRow(row.key, { quantity: value })}
                      mode="outlined"
                      dense
                      autoCapitalize="none"
                      placeholder={selectedUom?.code === 'kg' ? '500g' : '2'}
                      style={[styles.qtyInput, styles.halfInput]}
                    />
                    <TextInput
                      label="Barcode"
                      value={row.barcode}
                      onChangeText={(value) => updateQtyRow(row.key, { barcode: value })}
                      mode="outlined"
                      dense
                      placeholder="Auto"
                      style={[styles.qtyInput, styles.halfInput]}
                    />
                  </View>
                  {hint ? (
                    <Text style={[styles.qtyHint, !qty && styles.qtyHintErr]}>{hint}</Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setQtyRows((rows) => rows.filter((r) => r.key !== row.key))}
                  hitSlop={10}
                  style={styles.removeSize}>
                  <Icon name="close" size={18} color={colors.textMuted} />
                </Pressable>
              </View>
            );
          })}
          <Button
            mode="outlined"
            icon="plus"
            onPress={() => setQtyRows((rows) => [...rows, { key: newRowKey(), quantity: '', barcode: '' }])}
            style={styles.addQtyBtn}>
            Add pack barcode
          </Button>
        </>
      ) : (
        <Text style={styles.variantPriceNote}>
          Product pricing is off. Set price on each size in the Variants column.
        </Text>
      )}

      <Pressable style={styles.moreToggle} onPress={() => setShowOptional((v) => !v)}>
        <Text style={styles.moreToggleText}>
          {showOptional ? 'Hide' : 'More'} · description & HSN
        </Text>
        <Icon name={showOptional ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </Pressable>
      {showOptional ? (
        <View style={styles.moreBox}>
          <TextInput
            label="Description"
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={2}
          />
          <TextInput
            label="HSN / SAC"
            value={taxCode}
            onChangeText={setTaxCode}
            mode="outlined"
            style={styles.input}
          />
        </View>
      ) : null}
    </SectionCard>
  );

  const variantsColumn = (
    <View style={[styles.variantsCol, !multiSizes && styles.variantsColDisabled]} pointerEvents={multiSizes ? 'auto' : 'none'}>
      <SectionCard
        title="Variants"
        subtitle={multiSizes ? 'Each size has its own price & barcode' : 'Check “has variants” to enable'}
        icon="shape-outline"
        iconColor={multiSizes ? colors.secondary : colors.textMuted}
        iconBg={multiSizes ? colors.secondaryLight : colors.surfaceVariant}>
        {!multiSizes ? (
          <View style={styles.variantsLocked}>
            <Icon name="lock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.variantsLockedTitle}>Variants locked</Text>
            <Text style={styles.variantsLockedHint}>
              Tick “This product has variants” in the Product column to add sizes here.
            </Text>
          </View>
        ) : (
          <>
            <TextInput
              label="Colour (shared)"
              value={color}
              onChangeText={setColor}
              mode="outlined"
              style={styles.input}
              placeholder="e.g. Navy"
            />
            <TextInput
              label="SKU prefix"
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={styles.input}
              placeholder="Used when adding sizes"
            />

            {(mainStockQty > 0 || sizeStockTotal > 0) ? (
              <View style={styles.stockSplitBox}>
                <Icon name="warehouse" size={18} color={colors.secondary} />
                <View style={styles.stockSplitText}>
                  <Text style={styles.stockSplitTitle}>
                    Total stock {sizeStockTotal || mainStockQty}
                  </Text>
                  <Text style={styles.stockSplitHint}>Split across sizes — edit each before save</Text>
                </View>
                <Button mode="text" compact onPress={splitStockEvenly}>
                  Even
                </Button>
              </View>
            ) : null}

            <Text style={styles.label}>Add sizes</Text>
            <View style={styles.sizeChipWrap}>
              {SIZE_PRESETS.map((preset) => {
                const active = selectedSizes.has(preset.toUpperCase());
                return (
                  <Pressable
                    key={preset}
                    onPress={() => (active ? null : addSize(preset))}
                    disabled={active}
                    style={[styles.sizeChip, active && styles.sizeChipOn]}>
                    <Text style={[styles.sizeChipText, active && styles.sizeChipTextOn]}>{preset}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.customSizeRow}>
              <TextInput
                label="Custom size"
                value={customSize}
                onChangeText={setCustomSize}
                mode="outlined"
                style={[styles.input, styles.customSizeInput]}
                placeholder="32, Kids…"
              />
              <Button
                mode="outlined"
                onPress={() => {
                  addSize(customSize);
                  setCustomSize('');
                }}
                style={styles.addSizeBtn}
                contentStyle={styles.addSizeBtnContent}>
                Add
              </Button>
            </View>

            {sizeRows.length === 0 ? (
              <Text style={styles.emptySizes}>Tap a size above to add a variant</Text>
            ) : (
              sizeRows.map((row) => (
                <View key={row.key} style={styles.sizeCard}>
                  <View style={styles.sizeCardHead}>
                    <View style={styles.sizeBadge}>
                      <Text style={styles.sizeBadgeText}>{row.size}</Text>
                    </View>
                    <Pressable onPress={() => removeSizeRow(row.key)} hitSlop={10} style={styles.removeSize}>
                      <Icon name="close" size={18} color={colors.textMuted} />
                    </Pressable>
                  </View>
                  <View style={styles.priceRow}>
                    <TextInput
                      label="Selling price *"
                      value={row.sellingPrice}
                      onChangeText={(value) => updateSizeRow(row.key, { sellingPrice: value })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={[styles.input, styles.halfInput]}
                      left={<TextInput.Affix text="₹" />}
                    />
                    <TextInput
                      label="Cost"
                      value={row.costPrice}
                      onChangeText={(value) => updateSizeRow(row.key, { costPrice: value })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={[styles.input, styles.halfInput]}
                      left={<TextInput.Affix text="₹" />}
                    />
                  </View>
                  <View style={styles.priceRow}>
                    <TextInput
                      label="MRP"
                      value={row.mrp}
                      onChangeText={(value) => updateSizeRow(row.key, { mrp: value })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={[styles.input, styles.halfInput]}
                      left={<TextInput.Affix text="₹" />}
                    />
                    <TextInput
                      label="Stock"
                      value={row.stockQty}
                      onChangeText={(value) => updateSizeRow(row.key, { stockQty: value })}
                      keyboardType="decimal-pad"
                      mode="outlined"
                      style={[styles.input, styles.halfInput]}
                    />
                  </View>
                  <TextInput
                    label="SKU"
                    value={row.sku}
                    onChangeText={(value) => updateSizeRow(row.key, { sku: value })}
                    mode="outlined"
                    style={styles.input}
                  />
                  <TextInput
                    label="Barcode for this size"
                    value={row.barcode}
                    onChangeText={(value) => updateSizeRow(row.key, { barcode: value })}
                    mode="outlined"
                    style={styles.input}
                    placeholder="Leave blank to auto-create"
                    autoCapitalize="characters"
                  />
                  <Text style={styles.sizeBarcodeHint}>
                    Each size needs its own barcode for billing and labels.
                  </Text>
                </View>
              ))
            )}
          </>
        )}
      </SectionCard>
    </View>
  );

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon name={isEdit ? 'pencil-outline' : 'package-variant'} size={26} color={colors.primary} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heading}>{isEdit ? 'Edit Product' : 'New Product'}</Text>
            <Text style={styles.subheading}>
              Product on the left · variants on the right when enabled
            </Text>
          </View>
        </View>

        <View style={[styles.columns, twoColumn && styles.columnsWide]}>
          <View style={[styles.column, twoColumn && styles.columnLeft]}>{productColumn}</View>
          <View style={[styles.column, twoColumn && styles.columnRight]}>{variantsColumn}</View>
        </View>

        {error ? (
          <View style={styles.errorBox}>
            <Icon name="alert-circle-outline" size={20} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        <Button
          mode="contained"
          onPress={handleSubmit}
          loading={loading}
          disabled={loading}
          icon="content-save"
          style={styles.button}
          contentStyle={styles.buttonContent}>
          {isEdit ? 'Save Changes' : 'Save Product'}
        </Button>
        <Text style={styles.requiredNote}>
          * Required · name, unit{multiSizes ? ', and a price on each size' : ', selling price'}
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  heroText: { flex: 1 },
  heading: { ...typography.h1, fontSize: 22 },
  subheading: { ...typography.bodySm, marginTop: 2, lineHeight: 18 },
  columns: { gap: spacing.md, marginBottom: spacing.md },
  columnsWide: { flexDirection: 'row', alignItems: 'flex-start' },
  column: { width: '100%' },
  columnLeft: { flex: 1, minWidth: 0 },
  columnRight: { flex: 1, minWidth: 0 },
  variantsCol: { width: '100%' },
  variantsColDisabled: { opacity: 0.55 },
  variantsLocked: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  variantsLockedTitle: { fontSize: 16, fontWeight: '700', color: colors.textMuted },
  variantsLockedHint: {
    ...typography.bodySm,
    textAlign: 'center',
    color: colors.textMuted,
    lineHeight: 20,
    maxWidth: 280,
  },
  variantCheckRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingRight: spacing.md,
    paddingLeft: spacing.xs,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  variantCheckRowOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  sectionDivider: {
    ...typography.label,
    marginBottom: spacing.sm,
    marginTop: spacing.xs,
  },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  label: { ...typography.label, marginBottom: spacing.sm, marginTop: spacing.xs },
  choiceDialog: { borderRadius: radius.lg, backgroundColor: colors.surface },
  choiceContent: { paddingHorizontal: 0, maxHeight: 360 },
  choiceScroll: { maxHeight: 340 },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  choiceRowOn: { backgroundColor: colors.primaryLight },
  choiceLabel: { flex: 1, fontSize: 15, color: colors.text, paddingRight: spacing.md },
  choiceLabelOn: { color: colors.primary, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  switchText: { flex: 1, paddingRight: spacing.md },
  switchTitle: { ...typography.body, fontWeight: '600' },
  switchHint: { ...typography.caption, marginTop: 3, lineHeight: 16 },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
  moreToggleText: { fontSize: 14, fontWeight: '600', color: colors.primary },
  moreBox: { marginTop: spacing.xs },
  packHeader: { marginTop: spacing.sm, marginBottom: spacing.sm },
  packTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  packHint: { ...typography.caption, marginTop: 2 },
  variantPriceNote: {
    ...typography.bodySm,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  priceRow: { flexDirection: 'row', gap: spacing.md },
  halfInput: { flex: 1 },
  profitBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  lossBox: { backgroundColor: colors.errorLight },
  profitText: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  taxRow: { gap: spacing.sm, paddingVertical: spacing.xs, marginBottom: spacing.sm },
  taxChip: {
    minWidth: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  taxChipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  taxChipRate: { fontSize: 16, fontWeight: '700', color: colors.text },
  taxChipName: { fontSize: 11, color: colors.textMuted, marginTop: 2, maxWidth: 80 },
  taxChipTextActive: { color: colors.primary },
  sizeChipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sizeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sizeChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  sizeChipText: { fontSize: 14, fontWeight: '700', color: colors.text },
  sizeChipTextOn: { color: colors.primary },
  stockSplitBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.secondaryLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  stockSplitText: { flex: 1 },
  stockSplitTitle: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  stockSplitHint: { ...typography.caption, marginTop: 2, lineHeight: 16 },
  customSizeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  customSizeInput: { flex: 1 },
  addSizeBtn: { marginTop: 6, borderRadius: radius.md },
  addSizeBtnContent: { minHeight: 48 },
  emptySizes: { ...typography.bodySm, marginBottom: spacing.md, color: colors.textMuted },
  sizeBarcodeHint: {
    ...typography.caption,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    color: colors.textMuted,
  },
  sizeCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surfaceVariant,
  },
  sizeCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sizeBadge: {
    backgroundColor: colors.primaryLight,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  sizeBadgeText: { fontSize: 15, fontWeight: '800', color: colors.primary },
  removeSize: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs, marginBottom: spacing.sm },
  qtyFields: { flex: 1 },
  qtyInput: { backgroundColor: colors.surface },
  qtyHint: { ...typography.caption, marginTop: 4 },
  qtyHintErr: { color: colors.error },
  addQtyBtn: { marginTop: spacing.sm, borderRadius: radius.md },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.errorLight,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13, fontWeight: '600' },
  button: { marginTop: spacing.xs, borderRadius: radius.md },
  buttonContent: { minHeight: 52 },
  requiredNote: { ...typography.caption, textAlign: 'center', marginTop: spacing.sm },
});
