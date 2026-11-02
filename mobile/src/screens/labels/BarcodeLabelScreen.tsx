import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ProductSearchField from '../../components/ProductSearchField';
import { encodeBarcode } from '../../print/barcodeEncode';
import {
  isDesktopLabelPrintAvailable,
  isGapLabelPrintAvailable,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  printGapLabel,
  type GapLabelContent,
} from '../../print/gapLabel';
import {
  connectNativeLabelPrinter,
  getNativeLabelPrinterStatus,
  isNativeLabelPrinterAvailable,
  listNativeLabelPrinters,
} from '../../print/labelPrinterNative';
import { listSystemPrinters } from '../../print/PrintService';
import {
  ensureQuantityBarcodes,
  type SearchProductResult,
} from '../../services/catalogService';
import { getShopSettings } from '../../services/shopSettingsService';
import {
  getPrinterSettings,
  savePrinterSettings,
  type PrinterSettings,
} from '../../store/printerStore';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import { productDisplayName } from '../../utils/variantLabel';

type ListedPrinter = { name: string; address: string };

const QTY_CHIPS = ['1', '2', '5', '10'];
const LABEL_CHIPS = ['1', '2', '5', '10'];

/** Clear thermal-style face for preview (matches printed monospace). */
const PRINTER_FONT = Platform.select({
  ios: 'Courier',
  android: 'monospace',
  default: 'monospace',
}) as string;

function formatMoney(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseQty(raw: string): number {
  const n = Number(raw);
  if (!raw.trim() || Number.isNaN(n) || n <= 0) return 0;
  return n;
}

function unitOf(product: SearchProductResult | null): string {
  if (!product?.uom) return '';
  return (product.uom.code || product.uom.name || '').trim();
}

function priceForQty(unitPrice: number | null | undefined, qty: number): number | null {
  if (unitPrice == null || Number.isNaN(Number(unitPrice)) || qty <= 0) return null;
  return Number(unitPrice) * qty;
}

function LabelPreview({
  shopName,
  productName,
  qtyLabel,
  price,
  barcode,
  width,
  height,
}: {
  shopName: string;
  productName: string;
  qtyLabel: string;
  price: string;
  barcode: string;
  width: number;
  height: number;
}) {
  let modules = '';
  try {
    modules = barcode ? encodeBarcode(barcode) : '';
  } catch {
    modules = '';
  }

  const runs: { bar: boolean; n: number }[] = [];
  if (modules) {
    const quiet = 8;
    runs.push({ bar: false, n: quiet });
    for (const ch of modules) {
      const bar = ch === '1';
      const last = runs[runs.length - 1];
      if (last && last.bar === bar) last.n += 1;
      else runs.push({ bar, n: 1 });
    }
    runs.push({ bar: false, n: quiet });
  }

  const right = [qtyLabel, price].filter(Boolean).join('  ');

  return (
    <View style={[styles.previewCard, { width, height }]}>
      <Text style={styles.previewShop} numberOfLines={1}>
        {shopName || 'Shop'}
      </Text>
      <View style={styles.previewRow}>
        <Text style={styles.previewProduct} numberOfLines={1}>
          {productName || 'Product'}
        </Text>
        <Text style={styles.previewRight} numberOfLines={1}>
          {right || '—'}
        </Text>
      </View>
      <View style={styles.previewDivider} />
      {runs.length ? (
        <View style={styles.previewBarcode}>
          {runs.map((run, index) => (
            <View
              key={index}
              style={{ flex: run.n, backgroundColor: run.bar ? '#000' : '#FFF' }}
            />
          ))}
        </View>
      ) : (
        <View style={styles.previewBarcodeEmpty}>
          <Text style={styles.muted}>Barcode</Text>
        </View>
      )}
      <Text style={styles.previewDigits} numberOfLines={1}>
        {barcode || '------------'}
      </Text>
    </View>
  );
}

function SoftChip({
  label,
  active,
  onPress,
  disabled,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, active && styles.chipActive, disabled && styles.dim]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export default function BarcodeLabelScreen() {
  const useSdk = isNativeLabelPrinterAvailable();
  const useDesktop = isDesktopLabelPrintAvailable();
  const canPrint = isGapLabelPrintAvailable();
  const { width: winW } = useWindowDimensions();
  const previewW = Math.min(winW - spacing.lg * 2, 340);
  const previewH = previewW * (LABEL_HEIGHT_MM / LABEL_WIDTH_MM);

  const [shopName, setShopName] = useState('My Shop');
  const [product, setProduct] = useState<SearchProductResult | null>(null);
  const [productQty, setProductQty] = useState('1');
  const [labelQty, setLabelQty] = useState('1');
  const [previewBarcode, setPreviewBarcode] = useState('');

  const [printerName, setPrinterName] = useState('Tap to select');
  const [printerAddress, setPrinterAddress] = useState('');
  const [connected, setConnected] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printers, setPrinters] = useState<ListedPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const applyDesktopPrinter = useCallback((settings: PrinterSettings) => {
    if (settings.type === 'network' && settings.networkHost?.trim()) {
      const host = settings.networkHost.trim();
      const port = settings.networkPort || 9100;
      setConnected(true);
      setPrinterName(`${host}:${port}`);
      setPrinterAddress(host);
      return;
    }
    if (settings.type === 'bluetooth' && settings.bluetoothAddress?.trim()) {
      setConnected(true);
      setPrinterName(settings.bluetoothName || settings.bluetoothAddress);
      setPrinterAddress(settings.bluetoothAddress);
      return;
    }
    const name = settings.systemPrinterName?.trim();
    if (name) {
      setConnected(true);
      setPrinterName(name);
      setPrinterAddress(name);
      return;
    }
    setConnected(false);
    setPrinterName('Select USB printer');
    setPrinterAddress('');
  }, []);

  const selectedLabel = useMemo(() => {
    if (!product) return undefined;
    return productDisplayName(product.productName, product.size, product.color);
  }, [product]);

  const qty = parseQty(productQty);
  const unit = unitOf(product);
  const linePrice = priceForQty(product?.sellingPrice ?? null, qty);
  const priceText = formatMoney(linePrice);
  const qtyLabel = useMemo(() => {
    if (!product || qty <= 0) return '';
    return unit ? `${qty} ${unit}` : String(qty);
  }, [product, qty, unit]);

  const showStatus = useCallback((type: 'ok' | 'err', text: string) => {
    setStatus({ type, text });
  }, []);

  useEffect(() => {
    getShopSettings()
      .then((shop) => {
        const name = shop.shopName?.trim();
        if (name) setShopName(name);
      })
      .catch(() => {});

    if (useSdk) {
      getNativeLabelPrinterStatus()
        .then((s) => {
          setConnected(Boolean(s.connected));
          if (s.connected) {
            setPrinterName(s.name || 'Printer');
            setPrinterAddress(s.address || '');
          }
        })
        .catch(() => {});
      return;
    }

    if (useDesktop) {
      getPrinterSettings()
        .then(applyDesktopPrinter)
        .catch(() => {});
    }
  }, [useSdk, useDesktop, applyDesktopPrinter]);

  useEffect(() => {
    if (!product) {
      setPreviewBarcode('');
      return;
    }
    if (qty === 1 || qty <= 0) {
      setPreviewBarcode((product.barcodes || []).find((b) => b?.trim()) || '');
      return;
    }
    const match = (product.quantityBarcodes || []).find((b) => Number(b.quantity) === qty);
    setPreviewBarcode(match?.barcode || (product.barcodes || [])[0] || '');
  }, [product, qty]);

  const loadPrinters = useCallback(async () => {
    if (!canPrint) {
      showStatus('err', 'Label printing needs the desktop app or Android Microlan printer.');
      return;
    }
    setLoadingPrinters(true);
    try {
      if (useSdk) {
        setPrinters(await listNativeLabelPrinters());
      } else {
        const listed = await listSystemPrinters();
        setPrinters(
          listed.map((p) => ({
            name: p.displayName || p.name,
            address: p.name,
          })),
        );
      }
    } catch (err) {
      setPrinters([]);
      showStatus('err', err instanceof Error ? err.message : 'Could not list printers.');
    } finally {
      setLoadingPrinters(false);
    }
  }, [canPrint, useSdk, showStatus]);

  const openPrinter = () => {
    if (!canPrint) {
      showStatus('err', 'Label printing needs the desktop app or Android Microlan printer.');
      return;
    }
    setPrinterOpen(true);
    loadPrinters();
  };

  const selectPrinter = async (printer: ListedPrinter) => {
    if (connecting) return;
    setConnecting(true);
    try {
      if (useSdk) {
        const result = await connectNativeLabelPrinter(printer.address);
        setConnected(Boolean(result.connected));
        setPrinterName(result.name || printer.name);
        setPrinterAddress(result.address || printer.address);
        setPrinterOpen(false);
        showStatus('ok', `Connected · ${result.name || printer.name}`);
        return;
      }

      const current = await getPrinterSettings();
      const next: PrinterSettings = {
        ...current,
        type: 'system',
        systemPrinterName: printer.address,
      };
      await savePrinterSettings(next);
      applyDesktopPrinter(next);
      setPrinterOpen(false);
      showStatus('ok', `USB printer · ${printer.name}`);
    } catch (err) {
      setConnected(false);
      showStatus('err', err instanceof Error ? err.message : 'Connect failed.');
    } finally {
      setConnecting(false);
    }
  };

  const parsePositive = (raw: string, label: string, max = 999): number | null => {
    const n = Number(raw);
    if (!raw.trim() || Number.isNaN(n) || n <= 0 || n > max) {
      showStatus('err', `${label}: use 1–${max}`);
      return null;
    }
    return n;
  };

  const resolveBarcode = async (selected: SearchProductResult, amount: number): Promise<string> => {
    if (amount !== 1) {
      const match = (selected.quantityBarcodes || []).find((b) => Number(b.quantity) === amount);
      if (match?.barcode) return match.barcode;
      const ensured = await ensureQuantityBarcodes([
        { variantId: selected.variantId, quantity: amount },
      ]);
      const code = ensured[0]?.barcode?.trim();
      if (!code) throw new Error('Could not create barcode for this qty.');
      return code;
    }
    const primary = (selected.barcodes || []).find((b) => b?.trim());
    if (primary) return primary.trim();
    const unitQty = (selected.quantityBarcodes || []).find((b) => Number(b.quantity) === 1);
    if (unitQty?.barcode) return unitQty.barcode.trim();
    const ensured = await ensureQuantityBarcodes([{ variantId: selected.variantId, quantity: 1 }]);
    const code = ensured[0]?.barcode?.trim();
    if (!code) throw new Error('Product has no barcode.');
    return code;
  };

  const onPrint = async () => {
    if (printing || connecting) return;
    if (!product) {
      showStatus('err', 'Select a product first.');
      return;
    }
    const pQty = parsePositive(
      productQty,
      'Product qty',
      product.allowDecimalQty ? 9999 : 999,
    );
    if (pQty == null) return;
    const lQty = parsePositive(labelQty, 'Copies', 99);
    if (lQty == null) return;
    if (!canPrint) {
      showStatus(
        'err',
        useDesktop
          ? 'Open the KDSPOZ desktop app to print labels.'
          : 'Needs Android app with Microlan SDK.',
      );
      return;
    }
    if (!connected) {
      showStatus(
        'err',
        useDesktop
          ? 'Select your USB label printer first.'
          : 'Connect a printer first.',
      );
      return;
    }

    setPrinting(true);
    setStatus(null);
    try {
      const barcode = await resolveBarcode(product, pQty);
      setPreviewBarcode(barcode);
      const totalPrice = priceForQty(product.sellingPrice, pQty);
      const totalMrp = priceForQty(product.mrp ?? null, pQty);
      const uom = unitOf(product);

      await printGapLabel(
        {
          shopName,
          productName: product.productName,
          detail: uom ? `${pQty} ${uom}` : String(pQty),
          barcode,
          mrp: totalMrp != null ? formatMoney(totalMrp) : '',
          price: formatMoney(totalPrice),
        } satisfies GapLabelContent,
        lQty,
      );
      showStatus('ok', `Printed ${lQty} label${lQty === 1 ? '' : 's'}`);
    } catch (err) {
      showStatus('err', err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  const printLabel =
    printing
      ? 'Printing…'
      : !product
        ? 'Select product'
        : !connected
          ? useDesktop
            ? 'Select USB printer'
            : 'Connect printer'
          : `Print · ${labelQty} label${labelQty === '1' ? '' : 's'}`;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {status ? (
          <Pressable
            onPress={() => setStatus(null)}
            style={[styles.banner, status.type === 'ok' ? styles.bannerOk : styles.bannerErr]}>
            <Text style={styles.bannerText}>{status.text}</Text>
            <Icon name="close" size={16} color={colors.textMuted} />
          </Pressable>
        ) : null}

        <View style={styles.previewBlock}>
          <LabelPreview
            shopName={shopName}
            productName={product?.productName || 'Product'}
            qtyLabel={qtyLabel}
            price={priceText}
            barcode={previewBarcode}
            width={previewW}
            height={previewH}
          />
          <Text style={styles.previewCaption}>
            {LABEL_WIDTH_MM}×{LABEL_HEIGHT_MM} mm · live preview
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>1 · Product</Text>
          <ProductSearchField
            onSelect={(item) => {
              setProduct(item);
              setProductQty(
                item.scannedQuantity && item.scannedQuantity > 0
                  ? String(item.scannedQuantity)
                  : '1',
              );
            }}
            selectedLabel={selectedLabel}
          />
          {product ? (
            <Text style={styles.metaLine}>
              {[
                unit ? `Unit: ${unit}` : null,
                product.sellingPrice != null
                  ? `Rate: ${formatMoney(product.sellingPrice)}${unit ? `/${unit}` : ''}`
                  : null,
                linePrice != null ? `Label: ${priceText}` : null,
              ]
                .filter(Boolean)
                .join('   ·   ')}
            </Text>
          ) : (
            <Text style={styles.muted}>Search by name, SKU or barcode</Text>
          )}
        </View>

        <View style={styles.twoCol}>
          <View style={[styles.block, styles.col]}>
            <Text style={styles.blockTitle}>
              2 · Qty{unit ? ` (${unit})` : ''}
            </Text>
            <View style={styles.chipRow}>
              {QTY_CHIPS.map((v) => (
                <SoftChip
                  key={v}
                  label={v}
                  active={productQty === v}
                  onPress={() => setProductQty(v)}
                  disabled={printing}
                />
              ))}
            </View>
            <TextInput
              value={productQty}
              onChangeText={setProductQty}
              keyboardType={product?.allowDecimalQty ? 'decimal-pad' : 'number-pad'}
              mode="outlined"
              dense
              placeholder="Custom"
              style={styles.input}
            />
          </View>

          <View style={[styles.block, styles.col]}>
            <Text style={styles.blockTitle}>3 · Copies</Text>
            <View style={styles.chipRow}>
              {LABEL_CHIPS.map((v) => (
                <SoftChip
                  key={v}
                  label={v}
                  active={labelQty === v}
                  onPress={() => setLabelQty(v)}
                  disabled={printing}
                />
              ))}
            </View>
            <TextInput
              value={labelQty}
              onChangeText={setLabelQty}
              keyboardType="number-pad"
              mode="outlined"
              dense
              placeholder="1–99"
              style={styles.input}
            />
          </View>
        </View>

        <Pressable
          onPress={openPrinter}
          disabled={printing || connecting}
          style={[
            styles.printerCard,
            connected && styles.printerCardOn,
            (printing || connecting) && styles.dim,
          ]}>
          <View style={styles.printerIconWrap}>
            <Icon
              name={connected ? 'printer-check' : useDesktop ? 'usb' : 'bluetooth'}
              size={22}
              color={connected ? colors.success : colors.primary}
            />
          </View>
          <View style={styles.flex}>
            <Text style={styles.printerTitle}>
              {connected ? 'Printer ready' : useDesktop ? '4 · USB printer' : '4 · Printer'}
            </Text>
            <Text style={styles.printerName} numberOfLines={1}>
              {printerName}
            </Text>
          </View>
          {connecting ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Icon name="chevron-right" size={20} color={colors.textMuted} />
          )}
        </Pressable>

        <View style={{ height: 100 }} />
      </ScrollView>

      <View style={styles.footer}>
        <Button
          mode="contained"
          onPress={onPrint}
          loading={printing}
          disabled={printing || connecting}
          style={styles.printBtn}
          contentStyle={styles.printBtnContent}
          labelStyle={styles.printBtnLabel}
          icon="printer">
          {printLabel}
        </Button>
      </View>

      <Portal>
        <Dialog
          visible={printerOpen}
          onDismiss={() => !connecting && setPrinterOpen(false)}
          style={styles.dialog}>
          <Dialog.Title>Printers</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.muted}>
              {useDesktop
                ? 'USB / installed POS printers (same list as Printer Settings)'
                : 'Paired Bluetooth label printers'}
            </Text>
            {loadingPrinters || connecting ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.muted}>
                  {connecting ? 'Connecting…' : 'Loading…'}
                </Text>
              </View>
            ) : null}
            <ScrollView style={styles.printerList} keyboardShouldPersistTaps="handled">
              {printers.map((printer) => {
                const active = printerAddress === printer.address;
                return (
                  <Pressable
                    key={printer.address}
                    onPress={() => selectPrinter(printer)}
                    disabled={connecting}
                    style={[styles.printerRow, active && styles.printerRowOn]}>
                    <Icon
                      name={active ? 'check-circle' : 'circle-outline'}
                      size={20}
                      color={active ? colors.success : colors.textMuted}
                    />
                    <View style={styles.flex}>
                      <Text style={styles.rowName}>{printer.name}</Text>
                      <Text style={styles.rowAddr}>{printer.address}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {!loadingPrinters && !printers.length ? (
                <Text style={styles.muted}>
                  {useDesktop
                    ? 'No printers found. Install/add the USB POS printer in macOS or Windows, then Refresh.'
                    : 'No printers found. Pair in Bluetooth settings.'}
                </Text>
              ) : null}
            </ScrollView>
            <Button
              mode="outlined"
              icon="refresh"
              onPress={loadPrinters}
              loading={loadingPrinters}
              disabled={connecting}
              style={styles.refresh}>
              Refresh
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={connecting} onPress={() => setPrinterOpen(false)}>
              Close
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  flex: { flex: 1, minWidth: 0 },
  muted: { fontSize: 13, fontWeight: '400', color: colors.textMuted },
  dim: { opacity: 0.55 },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  bannerOk: { backgroundColor: colors.successLight },
  bannerErr: { backgroundColor: colors.errorLight },
  bannerText: { flex: 1, fontSize: 13, fontWeight: '400', color: colors.text },

  previewBlock: { alignItems: 'center', marginBottom: spacing.lg },
  previewCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewShop: {
    fontFamily: PRINTER_FONT,
    fontSize: 14,
    fontWeight: '400',
    color: '#000',
    textAlign: 'center',
    marginBottom: 10,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  previewProduct: {
    flex: 1,
    fontFamily: PRINTER_FONT,
    fontSize: 13,
    fontWeight: '400',
    color: '#000',
  },
  previewRight: {
    fontFamily: PRINTER_FONT,
    fontSize: 13,
    fontWeight: '400',
    color: '#000',
    textAlign: 'right',
  },
  previewDivider: { height: 1, backgroundColor: '#000', marginBottom: 10 },
  previewBarcode: { flexDirection: 'row', height: 26, width: '100%', backgroundColor: '#fff' },
  previewBarcodeEmpty: {
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 3,
  },
  previewDigits: {
    fontFamily: PRINTER_FONT,
    fontSize: 10,
    fontWeight: '400',
    color: '#000',
    textAlign: 'center',
    marginTop: 3,
    letterSpacing: 0.5,
  },
  previewCaption: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
  },

  block: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderLight,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    letterSpacing: 0.2,
  },
  metaLine: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
    lineHeight: 18,
  },

  twoCol: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1, marginBottom: spacing.md },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  chip: {
    minWidth: 40,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  chipText: { fontSize: 14, fontWeight: '400', color: colors.text },
  chipTextActive: { color: colors.primary },
  input: { backgroundColor: colors.surface },

  printerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  printerCardOn: {
    borderColor: colors.success,
    backgroundColor: colors.successLight,
  },
  printerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  printerTitle: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
  printerName: { fontSize: 15, fontWeight: '400', color: colors.text, marginTop: 1 },

  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: Platform.OS === 'ios' ? spacing.lg : spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  printBtn: { borderRadius: radius.md },
  printBtnContent: { paddingVertical: 8 },
  printBtnLabel: { fontSize: 15, fontWeight: '400' },

  dialog: {
    width: 440,
    maxWidth: '94%',
    alignSelf: 'center',
    borderRadius: radius.lg,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  printerList: { maxHeight: 260, marginTop: spacing.sm },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  printerRowOn: { backgroundColor: colors.successLight },
  rowName: { fontSize: 14, fontWeight: '400', color: colors.text },
  rowAddr: { fontSize: 12, fontWeight: '400', color: colors.textMuted, marginTop: 1 },
  refresh: { marginTop: spacing.sm, borderRadius: radius.md },
});
