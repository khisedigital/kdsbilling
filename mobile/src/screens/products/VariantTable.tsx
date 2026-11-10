import React, { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Button, Portal, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import type { VariantProfile } from '../../utils/variantProfile';
import { variantProfileForBusinessType } from '../../utils/variantProfile';

export type VariantTableRow = {
  key: string;
  size: string;
  sellingPrice: string;
  costPrice: string;
  mrp: string;
  stockQty: string;
  sku: string;
  barcode: string;
  extraBarcodes: string[];
};

const COLOR_OPTIONS: { label: string; swatch: string }[] = [
  { label: 'Black', swatch: '#111111' },
  { label: 'White', swatch: '#F4F4F5' },
  { label: 'Red', swatch: '#DC2626' },
  { label: 'Blue', swatch: '#2563EB' },
  { label: 'Navy', swatch: '#1E3A5F' },
  { label: 'Green', swatch: '#16A34A' },
  { label: 'Yellow', swatch: '#EAB308' },
  { label: 'Orange', swatch: '#EA580C' },
  { label: 'Pink', swatch: '#EC4899' },
  { label: 'Purple', swatch: '#7C3AED' },
  { label: 'Brown', swatch: '#92400E' },
  { label: 'Grey', swatch: '#6B7280' },
  { label: 'Beige', swatch: '#D6C4A8' },
  { label: 'Maroon', swatch: '#7F1D1D' },
];

type Props = {
  rows: VariantTableRow[];
  color: string;
  onColorChange: (color: string) => void;
  onChange: (key: string, patch: Partial<VariantTableRow>) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
  /** Phone camera fill for a size's barcode. */
  onScanBarcode?: (key: string) => void;
  /** Defaults to clothing-style sizes when omitted. */
  profile?: VariantProfile;
};

function swatchFor(label: string) {
  return COLOR_OPTIONS.find((item) => item.label.toLowerCase() === label.trim().toLowerCase())?.swatch;
}

function CellSelect({
  value,
  placeholder,
  options,
  onChange,
}: {
  value: string;
  placeholder: string;
  options: { label: string; value: string; swatch?: string }[];
  onChange: (value: string) => void;
}) {
  const t = useT();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const [anchor, setAnchor] = useState({ x: 0, y: 0, width: 160, height: 36 });
  const selected = options.find((item) => item.value === value);
  const swatch = selected?.swatch || (value ? swatchFor(value) : undefined);

  const openMenu = () => {
    anchorRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width: Math.max(width, 168), height });
      setCustom('');
      setOpen(true);
    });
  };

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <>
      <View ref={anchorRef} collapsable={false}>
        <Pressable onPress={openMenu} style={styles.select}>
          {swatch ? (
            <View style={[styles.swatch, { backgroundColor: swatch }, swatch === '#F4F4F5' && styles.swatchBorder]} />
          ) : null}
          <Text style={[styles.selectText, !value && styles.placeholder]} numberOfLines={1}>
            {value ? (selected?.label || value) : t(placeholder)}
          </Text>
          <Icon name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
      {open ? (
        <Portal>
          <View style={styles.portal} pointerEvents="box-none">
            <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
            <View style={[styles.menu, { top: anchor.y + anchor.height + 4, left: anchor.x, width: anchor.width }]}>
              <ScrollView style={styles.menuScroll} keyboardShouldPersistTaps="handled">
                {options.map((item) => {
                  const active = item.value === value;
                  return (
                    <Pressable
                      key={item.value}
                      onPress={() => choose(item.value)}
                      style={[styles.menuItem, active && styles.menuItemOn]}>
                      {item.swatch ? (
                        <View
                          style={[
                            styles.swatch,
                            { backgroundColor: item.swatch },
                            item.swatch === '#F4F4F5' && styles.swatchBorder,
                          ]}
                        />
                      ) : null}
                      <Text style={[styles.menuLabel, active && styles.menuLabelOn]} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {active ? <Icon name="check" size={16} color={colors.primary} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View style={styles.customRow}>
                <TextInput
                  value={custom}
                  onChangeText={setCustom}
                  placeholder={t('Custom')}
                  placeholderTextColor={colors.textMuted}
                  style={styles.customInput}
                  onSubmitEditing={() => {
                    const next = custom.trim();
                    if (next) choose(next);
                  }}
                />
              </View>
            </View>
          </View>
        </Portal>
      ) : null}
    </>
  );
}

export default function VariantTable({
  rows,
  color,
  onColorChange,
  onChange,
  onRemove,
  onAdd,
  onScanBarcode,
  profile = variantProfileForBusinessType('clothing'),
}: Props) {
  const t = useT();
  const sizePresets = profile.sizeOptions;
  const showColor = profile.showColor;

  const setExtraAt = (key: string, extras: string[], index: number, value: string) => {
    const next = [...extras];
    next[index] = value.replace(/\D/g, '').slice(0, 18);
    onChange(key, { extraBarcodes: next });
  };

  const removeExtraAt = (key: string, extras: string[], index: number) => {
    onChange(key, { extraBarcodes: extras.filter((_, i) => i !== index) });
  };

  const addExtra = (key: string, extras: string[]) => {
    onChange(key, { extraBarcodes: [...extras, ''] });
  };

  const sizeOptions = (current: string) => {
    const names = !current || sizePresets.includes(current) ? sizePresets : [current, ...sizePresets];
    return names.map((name) => ({
      label: sizePresets.includes(name) || name === 'Default' ? t(name) : name,
      value: name,
    }));
  };

  const colorOptions = () => {
    const known = COLOR_OPTIONS.some((item) => item.label.toLowerCase() === color.trim().toLowerCase());
    const extra = color && !known ? [{ label: color, value: color, swatch: '#CBD5E1' }] : [];
    return [
      ...extra,
      ...COLOR_OPTIONS.map((item) => ({ label: t(item.label), value: item.label, swatch: item.swatch })),
    ];
  };

  return (
    <View>
      <Text style={styles.intro}>{t(profile.intro)}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
        <View style={[styles.table, !showColor && styles.tableNoColor]}>
          <View style={styles.head}>
            <Text style={[styles.headText, styles.sizeCol]}>{t(profile.sizeLabel)} *</Text>
            {showColor ? <Text style={[styles.headText, styles.colorCol]}>{t('Color *')}</Text> : null}
            <Text style={[styles.headText, styles.moneyCol]}>{t('Selling Price (₹) *')}</Text>
            <Text style={[styles.headText, styles.moneyCol]}>{t('MRP (₹) *')}</Text>
            <Text style={[styles.headText, styles.barcodeCol]}>{t('Barcode')}</Text>
            <Text style={[styles.headText, styles.smallCol]}>{t('Cost')}</Text>
            <Text style={[styles.headText, styles.smallCol]}>{t('Stock')}</Text>
            <Text style={[styles.headText, styles.skuCol]}>SKU</Text>
            <Text style={[styles.headText, styles.actionCol]}>{t('Action')}</Text>
          </View>
          {rows.length === 0 ? (
            <Text style={styles.empty}>{t(profile.emptyRowsHint)}</Text>
          ) : (
            rows.map((row) => (
              <View key={row.key} style={styles.bodyRow}>
                <View style={styles.sizeCol}>
                  <CellSelect
                    value={row.size}
                    placeholder={profile.sizeLabel}
                    options={sizeOptions(row.size)}
                    onChange={(size) => onChange(row.key, { size })}
                  />
                </View>
                {showColor ? (
                  <View style={styles.colorCol}>
                    <CellSelect
                      value={color}
                      placeholder={t('Color')}
                      options={colorOptions()}
                      onChange={onColorChange}
                    />
                  </View>
                ) : null}
                <View style={styles.moneyCol}>
                  <TextInput
                    value={row.sellingPrice}
                    onChangeText={(sellingPrice) => onChange(row.key, { sellingPrice })}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={styles.moneyCol}>
                  <TextInput
                    value={row.mrp}
                    onChangeText={(mrp) => onChange(row.key, { mrp })}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={styles.barcodeCol}>
                  <View style={styles.barcodeField}>
                    <TextInput
                      value={row.barcode}
                      onChangeText={(barcode) => onChange(row.key, { barcode: barcode.replace(/\D/g, '').slice(0, 18) })}
                      keyboardType="number-pad"
                      placeholder={t('Auto number')}
                      placeholderTextColor={colors.textMuted}
                      style={[styles.input, onScanBarcode ? styles.barcodeInput : null]}
                    />
                    {onScanBarcode ? (
                      <Pressable
                        onPress={() => onScanBarcode(row.key)}
                        hitSlop={6}
                        style={styles.scanBtn}
                        accessibilityLabel={t('Scan barcode')}>
                        <Icon name="barcode-scan" size={18} color={colors.primary} />
                      </Pressable>
                    ) : null}
                  </View>
                  {(row.extraBarcodes || []).map((code, index) => (
                    <View key={`${row.key}-extra-${index}`} style={styles.extraBarcodeRow}>
                      <TextInput
                        value={code}
                        onChangeText={(value) => setExtraAt(row.key, row.extraBarcodes || [], index, value)}
                        keyboardType="number-pad"
                        placeholder={t('Barcode {{n}}', { n: index + 2 })}
                        placeholderTextColor={colors.textMuted}
                        style={[styles.input, styles.extraBarcodeInput]}
                      />
                      <Pressable
                        onPress={() => removeExtraAt(row.key, row.extraBarcodes || [], index)}
                        hitSlop={6}
                        style={styles.extraRemove}>
                        <Icon name="close" size={14} color={colors.textMuted} />
                      </Pressable>
                    </View>
                  ))}
                  <Pressable onPress={() => addExtra(row.key, row.extraBarcodes || [])} hitSlop={6} style={styles.moreBarcodes}>
                    <Text style={styles.moreBarcodesText}>{t('+ Add barcode')}</Text>
                  </Pressable>
                </View>
                <View style={styles.smallCol}>
                  <TextInput
                    value={row.costPrice}
                    onChangeText={(costPrice) => onChange(row.key, { costPrice })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={styles.smallCol}>
                  <TextInput
                    value={row.stockQty}
                    onChangeText={(stockQty) => onChange(row.key, { stockQty })}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={styles.skuCol}>
                  <TextInput
                    value={row.sku}
                    onChangeText={(sku) => onChange(row.key, { sku })}
                    placeholder="SKU"
                    placeholderTextColor={colors.textMuted}
                    style={styles.input}
                  />
                </View>
                <View style={styles.actionCol}>
                  <Pressable
                    onPress={() => onRemove(row.key)}
                    hitSlop={8}
                    accessibilityLabel={t('Remove {{name}}', { name: row.size || t('variant') })}
                    style={styles.deleteBtn}>
                    <Icon name="trash-can-outline" size={18} color={colors.textSecondary} />
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Button mode="outlined" icon="plus" onPress={onAdd} textColor={colors.primary} style={styles.addBtn}>
          {t(profile.addButtonLabel)}
        </Button>
        <Text style={styles.total}>{t('Total: {{count}}', { count: rows.length })}</Text>
      </View>
    </View>
  );
}

const COL_GAP = 8;

const styles = StyleSheet.create({
  intro: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  table: { minWidth: 1180 },
  tableNoColor: { minWidth: 1032 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: COL_GAP,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: radius.md,
    borderTopRightRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  headText: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  bodyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: COL_GAP,
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  sizeCol: { width: 120 },
  colorCol: { width: 140 },
  moneyCol: { width: 140 },
  barcodeCol: { width: 196 },
  barcodeField: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  barcodeInput: { flex: 1 },
  scanBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  extraBarcodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  extraBarcodeInput: { flex: 1 },
  extraRemove: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreBarcodes: { marginTop: 4 },
  moreBarcodesText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  smallCol: { width: 90 },
  skuCol: { width: 120 },
  actionCol: { width: 64, alignItems: 'center' },
  select: {
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
  },
  selectText: { flex: 1, fontSize: 14, color: colors.text },
  placeholder: { color: colors.textMuted },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  swatchBorder: { borderWidth: 1, borderColor: colors.border },
  input: {
    height: 36,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    padding: spacing.lg,
    color: colors.textMuted,
    borderWidth: 1,
    borderTopWidth: 0,
    borderColor: colors.border,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  addBtn: { borderColor: colors.primary, borderRadius: radius.sm },
  total: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  portal: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  menu: {
    position: 'absolute',
    maxHeight: 280,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  menuScroll: { maxHeight: 220 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  menuItemOn: { backgroundColor: colors.primaryLight },
  menuLabel: { flex: 1, fontSize: 14, color: colors.text },
  menuLabelOn: { color: colors.primary, fontWeight: '700' },
  customRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 8,
  },
  customInput: {
    height: 34,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    fontSize: 13,
    color: colors.text,
  },
});
