import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { ActivityIndicator, Button, Checkbox, Dialog, HelperText, Portal, Switch, Text, TextInput } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import ExtraBarcodesEditor from '../../components/ExtraBarcodesEditor';
import SearchableSelect from '../../components/ui/SearchableSelect';
import SectionCard from '../../components/ui/SectionCard';
import { t as translate, useT } from '../../i18n';
import VariantTable from './VariantTable';
import { fetchMe } from '../../services/authService';
import { barcodeOrGenerated } from '../../utils/barcode';
import {
  createProduct,
  fetchBrands,
  fetchCategories,
  fetchProduct,
  fetchTaxGroups,
  fetchUnits,
  mainBarcodeOf,
  plainBarcodesOf,
  quantityBarcodesOf,
  updateProduct,
} from '../../services/catalogService';
import { useAuthStore } from '../../store/authStore';
import type { Brand, Category, QuantityBarcodeInput, TaxGroup, UnitOfMeasure } from '../../types/catalog';
import { formatQuantity, parseQuantityForUom } from '../../utils/quantity';
import { variantProfileForBusinessType } from '../../utils/variantProfile';
import { colors } from '../../theme/colors';
import { common, dialogCard, radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ProductForm'>;

type Choice = { value: string; label: string };

type SizeRow = {
  key: string;
  id?: string;
  size: string;
  sku: string;
  barcode: string;
  /** Extra plain barcodes for this size (same SKU, different printed codes). */
  extraBarcodes: string[];
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

function digitsOnly(value: string) {
  return value.replace(/\D/g, '').slice(0, 18);
}

/** Quantity typed on the product form. One decimal point, up to 3 places. */
function sanitizeStockInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned.slice(0, 10);
  const whole = cleaned.slice(0, dot).slice(0, 10);
  const frac = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, 3);
  return `${whole}.${frac}`;
}

function parseStockQty(value: string) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

/** Keep a barcode only when it is already all digits. Letter codes are left blank so a number is created. */
function numericBarcode(value: string) {
  const code = String(value || '').trim();
  return /^\d{4,18}$/.test(code) ? code : '';
}

function newRowKey() {
  return `row-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function makeSizeSku(baseSku: string, size: string) {
  const base = baseSku.trim().replace(/\s+/g, '-') || 'SKU';
  const suffix = size.trim().replace(/\s+/g, '').toUpperCase() || 'VAR';
  // A short token keeps SHIRT-M from colliding with the same size on another product,
  // or with a size that was removed earlier (its SKU stays reserved).
  const token = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}-${suffix}-${token}`.slice(0, 50);
}

type ChoiceFieldProps = {
  label: string;
  value: string;
  choices: Choice[];
  placeholder: string;
  onChange: (value: string) => void;
};

function ChoiceField({ label, value, choices, placeholder, onChange }: ChoiceFieldProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const selected = choices.find((choice) => choice.value === value);

  return (
    <>
      <Pressable onPress={() => setOpen(true)}>
        <View pointerEvents="none">
          <AppTextInput
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
            <Button onPress={() => setOpen(false)}>{t('Cancel')}</Button>
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
  const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return translate(message || fallback);
}

export default function ProductFormScreen({ navigation, route }: Props) {
  const t = useT();
  const tRef = useRef(t);
  tRef.current = t;
  const { width: windowWidth } = useWindowDimensions();
  const twoColumn = windowWidth >= 860;
  const productId = route.params?.productId;
  const isEdit = !!productId;
  const canScanBarcode = Platform.OS !== 'web';
  const tenant = useAuthStore((s) => s.tenant);
  const updateTenant = useAuthStore((s) => s.updateTenant);
  const variantProfile = useMemo(
    () => variantProfileForBusinessType(tenant?.businessTypeCode),
    [tenant?.businessTypeCode],
  );

  const [name, setName] = useState('');
  const [nameMr, setNameMr] = useState('');
  const [description, setDescription] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [extraBarcodes, setExtraBarcodes] = useState<string[]>([]);
  const [costPrice, setCostPrice] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [color, setColor] = useState('');
  const [taxCode, setTaxCode] = useState('');
  const [multiSizes, setMultiSizes] = useState(false);
  const [sizeRows, setSizeRows] = useState<SizeRow[]>([]);
  const [mainStockQty, setMainStockQty] = useState('');
  const [isWeightBased, setIsWeightBased] = useState(false);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [qtyRows, setQtyRows] = useState<QtyBarcodeRow[]>([]);

  const [categories, setCategories] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<UnitOfMeasure[]>([]);
  const [taxGroups, setTaxGroups] = useState<TaxGroup[]>([]);

  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
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

  // Older sessions may not have business type yet — refresh from /auth/me once.
  useEffect(() => {
    if (tenant?.businessTypeCode) return;
    let cancelled = false;
    fetchMe()
      .then((data) => {
        if (cancelled || !data?.tenant) return;
        updateTenant({
          businessTypeId: data.tenant.businessTypeId ?? null,
          businessTypeCode: data.tenant.businessTypeCode ?? null,
          businessTypeName: data.tenant.businessTypeName ?? null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tenant?.businessTypeCode, updateTenant]);

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
          setNameMr(product.name_mr || '');
          setDescription(product.description || '');
          setCategoryId(product.category_id || '');
          setBrandId(product.brand_id || '');
          setUomId(product.uom_id);
          setTaxGroupId(product.tax_group_id || '');
          setTaxCode(product.tax_code || '');
          setIsWeightBased(product.is_weight_based);
          setMultiSizes(useSizes);
          setVariantId(first?.id || null);
          const loadedStock =
            product.stockQty ?? variants.reduce((sum, v) => sum + (v.stockQty || 0), 0);
          setMainStockQty(sanitizeStockInput(String(loadedStock || 0)));

          if (first) {
            setSku(first.sku || '');
            const plains = plainBarcodesOf(first).map(numericBarcode).filter(Boolean);
            setBarcode(plains[0] || numericBarcode(mainBarcodeOf(first)));
            setExtraBarcodes(plains.slice(1));
            const productUom = u.find((x) => x.id === product.uom_id);
            setQtyRows(
              quantityBarcodesOf(first).map((b) => ({
                key: newRowKey(),
                quantity: formatQuantity(b.quantity, productUom),
                barcode: numericBarcode(b.barcode),
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
            setExtraBarcodes([]);
            setSizeRows(
              variants.map((v) => {
                const plains = plainBarcodesOf(v).map(numericBarcode).filter(Boolean);
                return {
                  key: v.id,
                  id: v.id,
                  size: v.size || 'Default',
                  sku: v.sku || '',
                  barcode: plains[0] || numericBarcode(mainBarcodeOf(v)),
                  extraBarcodes: plains.slice(1),
                  sellingPrice: String(parseFloat(String(v.selling_price)) || ''),
                  costPrice: String(parseFloat(String(v.cost_price)) || ''),
                  mrp: v.mrp != null && v.mrp !== '' ? String(parseFloat(String(v.mrp)) || '') : '',
                  stockQty: String(v.stockQty ?? 0),
                };
              }),
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
        if (!cancelled) setError(tRef.current('Could not load product'));
      } finally {
        if (!cancelled) setLoadingProduct(false);
      }
    })();

    return () => { cancelled = true; };
  }, [productId]);

  const scanNonce = route.params?.scanNonce;
  const scannedBarcode = route.params?.scannedBarcode;
  const scanTarget = route.params?.scanTarget;

  useEffect(() => {
    if (!scanNonce || scannedBarcode == null) return;
    const code = digitsOnly(scannedBarcode);
    const target = scanTarget || 'primary';
    if (target.startsWith('qty:')) {
      const key = target.slice(4);
      setQtyRows((rows) => rows.map((row) => (row.key === key ? { ...row, barcode: code } : row)));
    } else if (target.startsWith('size:')) {
      const key = target.slice(5);
      setSizeRows((rows) => rows.map((row) => (row.key === key ? { ...row, barcode: code } : row)));
    } else {
      setBarcode(code);
    }
    navigation.setParams({ scannedBarcode: undefined, scanTarget: undefined, scanNonce: undefined });
  }, [navigation, scanNonce, scanTarget, scannedBarcode]);

  const openBarcodeScanner = (target: string) => {
    navigation.navigate('BarcodeScanner', {
      purpose: 'capture',
      scanTarget: target,
      ...(productId ? { productId } : {}),
    });
  };

  const addSize = (rawSize: string) => {
    const size = rawSize.trim();
    if (!size) return;
    if (selectedSizes.has(size.toUpperCase())) return;

    setSizeRows((rows) => {
      const reuseExisting = rows.length === 0 && !!variantId;
      // When converting a single item into sizes, carry prices + stock onto the first size only.
      const seedFromSingle = reuseExisting || (rows.length === 0 && !multiSizes);
      const openingStock = seedFromSingle ? mainStockQty.trim() || '0' : '0';
      return [
        ...rows,
        {
          key: newRowKey(),
          id: reuseExisting ? variantId || undefined : undefined,
          size,
          sku: makeSizeSku(sku || name.slice(0, 8).toUpperCase(), size),
          barcode: reuseExisting ? barcode : '',
          extraBarcodes: reuseExisting ? [...extraBarcodes] : [],
          sellingPrice: seedFromSingle ? sellingPrice : '',
          costPrice: seedFromSingle ? costPrice : '',
          mrp: seedFromSingle ? mrp : '',
          // Each variant keeps its own stock — never divide across sizes.
          stockQty: openingStock,
        },
      ];
    });
    if (!multiSizes) {
      setSellingPrice('');
      setCostPrice('');
      setMrp('');
      setExtraBarcodes([]);
    }
    setMultiSizes(true);
  };

  const removeSizeRow = (key: string) => {
    setSizeRows((rows) => rows.filter((row) => row.key !== key));
  };

  const updateSizeRow = (key: string, patch: Partial<SizeRow>) => {
    setSizeRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const toggleMultiSizes = (enabled: boolean) => {
    if (!enabled && sizeRows.filter((row) => row.id).length > 1) {
      Alert.alert(
        variantProfile.axis === 'apparel' ? t('Turn off multiple sizes?') : t('Turn off pack sizes?'),
        variantProfile.axis === 'apparel'
          ? t('Saving after this will keep only one variant and remove the other sizes.')
          : t('Saving after this will keep only one variant and remove the other packs.'),
        [
          { text: t('Cancel'), style: 'cancel' },
          {
            text: t('Turn off'),
            style: 'destructive',
            onPress: () => {
              const first = sizeRows[0];
              if (first) {
                setVariantId(first.id || null);
                setSku(first.sku);
                setBarcode(numericBarcode(first.barcode));
                setExtraBarcodes((first.extraBarcodes || []).map(numericBarcode).filter(Boolean));
                setSellingPrice(first.sellingPrice);
                setCostPrice(first.costPrice);
                setMrp(first.mrp);
                setMainStockQty(first.stockQty || '0');
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

  /** Primary first, then extras. Blank primary is auto-generated; blank extras are dropped. */
  const buildPlainBarcodeList = (primary: string, extras: string[], used: Set<string>): string[] => {
    const codes: string[] = [barcodeOrGenerated(primary, used)];
    for (const raw of extras) {
      const code = String(raw || '').trim();
      if (!code) continue;
      if (used.has(code)) continue;
      codes.push(barcodeOrGenerated(code, used));
    }
    return codes;
  };

  const buildVariantPayload = () => {
    if (!multiSizes || sizeRows.length === 0) return null;
    const sharedColor = variantProfile.showColor ? (color.trim() || undefined) : undefined;
    const used = new Set<string>();
    return sizeRows.map((row) => {
      const barcodes = buildPlainBarcodeList(row.barcode, row.extraBarcodes || [], used);
      return {
        id: row.id,
        size: row.size.trim(),
        color: sharedColor,
        sku: row.sku.trim() || undefined,
        barcode: barcodes[0],
        barcodes,
        costPrice: row.costPrice ? parseFloat(row.costPrice) : 0,
        sellingPrice: parseFloat(row.sellingPrice),
        mrp: row.mrp ? parseFloat(row.mrp) : undefined,
        stockQty: parseFloat(row.stockQty) || 0,
      };
    });
  };

  const selectedUom = units.find((u) => u.id === uomId);

  const updateQtyRow = (key: string, patch: Partial<QtyBarcodeRow>) => {
    setQtyRows((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  /** Returns the payload, or an error message for the first bad row. */
  const buildQuantityBarcodes = (seenCodes: Set<string>): QuantityBarcodeInput[] | string => {
    const out: QuantityBarcodeInput[] = [];
    const seenQty = new Set<string>();
    for (const row of qtyRows) {
      const raw = row.quantity.trim();
      const code = row.barcode.trim();
      if (!raw && !code) continue;
      if (!raw) return t('Enter a quantity for barcode {{code}}', { code });
      const qty = parseQuantityForUom(raw, selectedUom);
      if (!qty) return t('"{{qty}}" is not a valid quantity', { qty: raw });
      const qtyKey = qty.toFixed(4);
      if (seenQty.has(qtyKey)) return t('Quantity {{qty}} is listed twice', { qty: raw });
      seenQty.add(qtyKey);
      if (code && seenCodes.has(code)) return t('Barcode {{code}} is used twice', { code });
      const assigned = barcodeOrGenerated(code, seenCodes);
      out.push({ quantity: qty, barcode: assigned });
    }
    return out;
  };

  const handleSubmit = async () => {
    setError('');
    if (nameMissing || !uomId) {
      setError(t('Please complete the highlighted required fields'));
      return;
    }
    if (!multiSizes && priceMissing) {
      setError(t('Please complete the highlighted required fields'));
      return;
    }
    const usedCodes = new Set<string>();
    const productBarcodes = multiSizes
      ? []
      : buildPlainBarcodeList(barcode, extraBarcodes, usedCodes);
    const productBarcode = productBarcodes[0] || '';
    const quantityBarcodes = multiSizes ? undefined : buildQuantityBarcodes(usedCodes);
    if (typeof quantityBarcodes === 'string') {
      setError(quantityBarcodes);
      return;
    }
    if (multiSizes) {
      if (!sizeRows.length) {
        setError(t(variantProfile.missingRowsError));
        return;
      }
      const badPrice = sizeRows.find((row) => !(parseFloat(row.sellingPrice) > 0));
      if (badPrice) {
        setError(t('Enter a selling price for {{sizeLabel}} {{size}}', {
          sizeLabel: t(variantProfile.sizeLabel).toLowerCase(),
          size: badPrice.size,
        }));
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
            nameMr: nameMr.trim(),
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
            nameMr: nameMr.trim(),
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
                barcode: productBarcode,
                barcodes: productBarcodes,
                size: '',
                color: '',
                costPrice: costPrice ? parseFloat(costPrice) : 0,
                sellingPrice: parseFloat(sellingPrice),
                mrp: mrp ? parseFloat(mrp) : undefined,
                stockQty: parseStockQty(mainStockQty),
                quantityBarcodes,
              },
            ],
          });
        }
      } else if (variants) {
        // Pricing is only on variants — no product-level sellingPrice/cost/mrp.
        await createProduct({
          name: name.trim(),
          nameMr: nameMr.trim(),
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
          nameMr: nameMr.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId || undefined,
          brandId: brandId || undefined,
          uomId,
          taxGroupId: taxValue || undefined,
          taxCode: taxCode.trim() || undefined,
          isWeightBased,
          allowDecimalQty: isWeightBased,
          sku: sku.trim() || undefined,
          barcode: productBarcode,
          barcodes: productBarcodes,
          quantityBarcodes,
          costPrice: costPrice ? parseFloat(costPrice) : 0,
          sellingPrice: parseFloat(sellingPrice),
          mrp: mrp ? parseFloat(mrp) : undefined,
          stockQty: parseStockQty(mainStockQty),
        });
      }
      navigation.goBack();
    } catch (err: unknown) {
      setError(t(apiError(err, isEdit ? t('Failed to update product') : t('Failed to create product'))));
    } finally {
      setLoading(false);
    }
  };

  const categoryOptions = categories.map((c) => ({
    id: c.id,
    label: c.name,
  }));

  const brandOptions = brands.map((brand) => ({
    id: brand.id,
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
      <Text style={styles.label}>{t('Tax')}</Text>
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
            {t('No tax')}
          </Text>
        </Pressable>
        {taxableGroups.map((group) => {
          const active = taxGroupId === group.id;
          return (
            <Pressable
              key={group.id}
              onPress={() => setTaxGroupId(group.id)}
              style={[styles.taxChip, active && styles.taxChipActive]}>
              <Text style={[styles.taxChipRate, active && styles.taxChipTextActive]}>{taxLabel(group)}</Text>
              <Text style={[styles.taxChipName, active && styles.taxChipTextActive]} numberOfLines={1}>
                {group.name.replace(/^GST\s*/i, '')}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );

  const productColumn = (
    <SectionCard title={t('Product')} subtitle={t('Basic info and pricing')} icon="package-variant">
      <AppTextInput
        label={t('Product name *')}
        value={name}
        onChangeText={setName}
        mode="outlined"
        style={styles.input}
        error={!!error && nameMissing}
        autoCapitalize="words"
        returnKeyType="next"
      />
      {!!error && nameMissing ? <HelperText type="error">{t('Enter a product name')}</HelperText> : null}
      <AppTextInput
        label={t('Product name (Marathi)')}
        value={nameMr}
        onChangeText={setNameMr}
        mode="outlined"
        style={styles.input}
        placeholder={t('मराठी नाव')}
        maxLength={200}
      />

      <View style={styles.priceRow}>
        <View style={styles.halfInput}>
          <Text style={styles.fieldLabel}>{t('Category')}</Text>
          <SearchableSelect
            options={categoryOptions}
            value={categoryId || null}
            onChange={(id) => setCategoryId(id || '')}
            open={categoryOpen}
            onOpenChange={(open) => {
              setCategoryOpen(open);
              if (open) setBrandOpen(false);
            }}
            placeholder="Category"
            allLabel="No category"
            searchPlaceholder="Search categories…"
          />
        </View>
        <View style={styles.halfInput}>
          <Text style={styles.fieldLabel}>{t('Brand')}</Text>
          <SearchableSelect
            options={brandOptions}
            value={brandId || null}
            onChange={(id) => setBrandId(id || '')}
            open={brandOpen}
            onOpenChange={(open) => {
              setBrandOpen(open);
              if (open) setCategoryOpen(false);
            }}
            placeholder="Brand"
            allLabel="No brand"
            searchPlaceholder="Search brands…"
          />
        </View>
      </View>

      <ChoiceField
        label={t('Unit *')}
        value={uomId}
        choices={uomChoices}
        placeholder={t('Select unit')}
        onChange={setUomId}
      />

      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={styles.switchTitle}>{t('Sold by weight / decimal')}</Text>
          <Text style={styles.switchHint}>{t('kg, litre, metre, partial qty')}</Text>
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
          <Text style={styles.switchTitle}>{t(variantProfile.checkboxTitle)}</Text>
          <Text style={styles.switchHint}>{t(variantProfile.checkboxHint)}</Text>
        </View>
      </Pressable>

      {!multiSizes ? (
        <>
          <Text style={styles.sectionDivider}>{t('Price')}</Text>
          <AppTextInput
            label={t('Selling price *')}
            value={sellingPrice}
            onChangeText={setSellingPrice}
            keyboardType="decimal-pad"
            mode="outlined"
            style={styles.input}
            error={!!error && priceMissing}
            left={<TextInput.Affix text="₹" />}
          />
          {!!error && priceMissing ? <HelperText type="error">{t('Enter a valid selling price')}</HelperText> : null}

          <View style={styles.priceRow}>
            <AppTextInput
              label={t('Cost')}
              value={costPrice}
              onChangeText={setCostPrice}
              keyboardType="decimal-pad"
              mode="outlined"
              style={[styles.input, styles.halfInput]}
              left={<TextInput.Affix text="₹" />}
            />
            <AppTextInput
              label={t('MRP')}
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
                {profit >= 0
                  ? t('Profit ₹{{amount}} · {{margin}}% margin', {
                      amount: Math.abs(profit).toFixed(2),
                      margin: margin.toFixed(1),
                    })
                  : t('Loss ₹{{amount}}', { amount: Math.abs(profit).toFixed(2) })}
              </Text>
            </View>
          ) : null}

          <AppTextInput
            label={t('Stock')}
            value={mainStockQty}
            onChangeText={(value) => setMainStockQty(sanitizeStockInput(value))}
            keyboardType="decimal-pad"
            mode="outlined"
            placeholder="0"
            style={styles.input}
            right={<TextInput.Affix text={(selectedUom?.code || 'qty').toUpperCase()} />}
          />
          <Text style={styles.stockFieldHint}>
            {isEdit
              ? t('Quantity in this branch. Saving sets stock to this number.')
              : t('Opening stock for this product. Leave blank if you have none yet.')}
          </Text>

          <View style={styles.priceRow}>
            <AppTextInput
              label="SKU"
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={[styles.input, styles.halfInput]}
            />
            <AppTextInput
              label={t('Barcode')}
              value={barcode}
              onChangeText={(value) => setBarcode(digitsOnly(value))}
              keyboardType="number-pad"
              mode="outlined"
              placeholder={t('Auto number')}
              style={[styles.input, styles.halfInput]}
              right={canScanBarcode ? (
                <TextInput.Icon
                  icon="barcode-scan"
                  forceTextInputFocus={false}
                  onPress={() => openBarcodeScanner('primary')}
                />
              ) : undefined}
            />
          </View>

          <ExtraBarcodesEditor values={extraBarcodes} onChange={setExtraBarcodes} />

          <View style={styles.packHeader}>
            <Text style={styles.packTitle}>{t('Pack barcodes')}</Text>
            <Text style={styles.packHint}>{t('Optional · e.g. 500 g pack scans as that qty')}</Text>
          </View>
          {qtyRows.map((row) => {
            const raw = row.quantity.trim();
            const qty = raw ? parseQuantityForUom(raw, selectedUom) : null;
            const hint = !raw
              ? ''
              : qty
                ? (selling > 0
                  ? t('Adds {{qty}} · ₹{{amount}}', {
                      qty: formatQuantity(qty, selectedUom),
                      amount: (selling * qty).toFixed(2),
                    })
                  : t('Adds {{qty}}', { qty: formatQuantity(qty, selectedUom) }))
                : t('Not a valid quantity');
            return (
              <View key={row.key} style={styles.qtyRow}>
                <View style={styles.qtyFields}>
                  <View style={styles.priceRow}>
                    <AppTextInput
                      label={selectedUom ? t('Qty ({{code}})', { code: selectedUom.code }) : t('Qty')}
                      value={row.quantity}
                      onChangeText={(value) => updateQtyRow(row.key, { quantity: value })}
                      mode="outlined"
                      dense
                      autoCapitalize="none"
                      placeholder={selectedUom?.code === 'kg' ? '500g' : '2'}
                      style={[styles.qtyInput, styles.halfInput]}
                    />
                    <AppTextInput
                      label={t('Barcode')}
                      value={row.barcode}
                      onChangeText={(value) => updateQtyRow(row.key, { barcode: digitsOnly(value) })}
                      keyboardType="number-pad"
                      mode="outlined"
                      dense
                      placeholder={t('Auto number')}
                      style={[styles.qtyInput, styles.halfInput]}
                      right={canScanBarcode ? (
                        <TextInput.Icon
                          icon="barcode-scan"
                          forceTextInputFocus={false}
                          onPress={() => openBarcodeScanner(`qty:${row.key}`)}
                        />
                      ) : undefined}
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
            {t('Add pack barcode')}
          </Button>
        </>
      ) : (
        <Text style={styles.variantPriceNote}>{t(variantProfile.priceNote)}</Text>
      )}

      <Pressable style={styles.moreToggle} onPress={() => setShowOptional((v) => !v)}>
        <Text style={styles.moreToggleText}>
          {showOptional ? t('Hide · description & HSN') : t('More · description & HSN')}
        </Text>
        <Icon name={showOptional ? 'chevron-up' : 'chevron-down'} size={20} color={colors.primary} />
      </Pressable>
      {showOptional ? (
        <View style={styles.moreBox}>
          <AppTextInput
            label={t('Description')}
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            style={styles.input}
            multiline
            numberOfLines={2}
          />
          <AppTextInput
            label={t('HSN / SAC')}
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
        title={t('Variants')}
        subtitle={multiSizes
          ? t(variantProfile.variantsSubtitle)
          : t('Check “{{title}}” to enable', { title: t(variantProfile.checkboxTitle).toLowerCase() })}
        icon="shape-outline"
        iconColor={multiSizes ? colors.secondary : colors.textMuted}
        iconBg={multiSizes ? colors.secondaryLight : colors.surfaceVariant}>
        {!multiSizes ? (
          <View style={styles.variantsLocked}>
            <Icon name="lock-outline" size={36} color={colors.textMuted} />
            <Text style={styles.variantsLockedTitle}>{t('Variants locked')}</Text>
            <Text style={styles.variantsLockedHint}>{t(variantProfile.lockedHint)}</Text>
          </View>
        ) : (
          <>
            <AppTextInput
              label={t('SKU prefix')}
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={styles.input}
              placeholder={t(variantProfile.skuPrefixHint)}
            />

            {(parseStockQty(mainStockQty) > 0 || sizeStockTotal > 0) ? (
              <View style={styles.stockSplitBox}>
                <Icon name="warehouse" size={18} color={colors.secondary} />
                <View style={styles.stockSplitText}>
                  <Text style={styles.stockSplitTitle}>
                    {t('Total stock {{qty}}', { qty: sizeStockTotal || parseStockQty(mainStockQty) })}
                  </Text>
                  <Text style={styles.stockSplitHint}>{t(variantProfile.stockHint)}</Text>
                </View>
              </View>
            ) : null}

            <VariantTable
              rows={sizeRows}
              color={color}
              onColorChange={setColor}
              profile={variantProfile}
              onScanBarcode={canScanBarcode ? (key) => openBarcodeScanner(`size:${key}`) : undefined}
              onChange={(key, patch) => {
                if (patch.size && selectedSizes.has(patch.size.toUpperCase())) {
                  const own = sizeRows.find((row) => row.key === key);
                  if (!own || own.size.toUpperCase() !== patch.size.toUpperCase()) return;
                }
                updateSizeRow(key, patch);
              }}
              onRemove={removeSizeRow}
              onAdd={() => {
                const next = variantProfile.sizeOptions.find(
                  (preset) => !selectedSizes.has(preset.toUpperCase()),
                );
                addSize(next || `${variantProfile.sizeLabel} ${sizeRows.length + 1}`);
              }}
            />
          </>
        )}
      </SectionCard>
    </View>
  );

  return (
    <KeyboardAvoidingView style={common.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={common.screenPad}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!categoryOpen && !brandOpen}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Icon name={isEdit ? 'pencil-outline' : 'package-variant'} size={26} color={colors.primary} />
          </View>
          <View style={styles.heroText}>
            <Text style={styles.heading}>{isEdit ? t('Edit Product') : t('New Product')}</Text>
            <Text style={styles.subheading}>
              {t('Product on the left · variants on the right when enabled')}
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
            <Text style={styles.errorText}>{t(error)}</Text>
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
          {isEdit ? t('Save Changes') : t('Save Product')}
        </Button>
        <Text style={styles.requiredNote}>
          {multiSizes
            ? t('* Required · name, unit, and a price on each {{sizeLabel}}', {
                sizeLabel: t(variantProfile.sizeLabel).toLowerCase(),
              })
            : t('* Required · name, unit, selling price')}
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
  fieldLabel: { ...typography.label, marginBottom: 0 },
  choiceDialog: { ...dialogCard },
  choiceContent: { paddingHorizontal: 0, maxHeight: 280 },
  choiceScroll: { maxHeight: 260 },
  choiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
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
  stockFieldHint: {
    ...typography.caption,
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 16,
  },
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
