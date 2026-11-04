import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { Button, Checkbox, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ProductSearchField from '../../components/ProductSearchField';
import { encodeBarcode } from '../../print/barcodeEncode';
import {
  isDesktopLabelPrintAvailable,
  isGapLabelPrintAvailable,
  LABEL_HEIGHT_OPTIONS,
  LABEL_WIDTH_MM,
  normalizeLabelHeightMm,
  printGapLabel,
  type GapLabelContent,
  type LabelHeightMm,
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
  fetchProductBarcodeStatus,
  generateBarcodes,
  type ProductBarcodeStatus,
  type SearchProductResult,
  type VariantBarcodeStatus,
  type VariantBarcodeStatusKind,
} from '../../services/catalogService';
import { getShopSettings } from '../../services/shopSettingsService';
import {
  getLabelPrinterSettings,
  saveLabelPrinterSettings,
  type LabelPrinterSettings,
} from '../../store/printerStore';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import { formatQuantity, getQuantityPresets, parseQuantityForUom, quantityHint, type UomInfo } from '../../utils/quantity';
import { productDisplayName, variantLabel } from '../../utils/variantLabel';

type ListedPrinter = { name: string; address: string };

type VariantRow = VariantBarcodeStatus & {
  selected: boolean;
  labelQty: string;
  rowKey: string;
  packQuantity: number | null;
};

type LastPrintJob = {
  labels: GapLabelContent[];
  copiesPerLabel: number[];
};

function formatMoney(value?: number | null): string {
  if (value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusMeta(status: VariantBarcodeStatusKind): {
  label: string;
  color: string;
  bg: string;
  printable: boolean;
} {
  if (status === 'available') {
    return { label: 'Available', color: colors.secondary, bg: colors.secondaryLight, printable: true };
  }
  if (status === 'duplicate') {
    return { label: 'Duplicate', color: colors.warning, bg: colors.warningLight, printable: false };
  }
  return { label: 'Missing', color: colors.error, bg: colors.errorLight, printable: false };
}

function expandLabelRows(
  data: ProductBarcodeStatus,
  extras: { variantId: string; barcode?: string | null; quantity: number }[] = [],
): Array<VariantBarcodeStatus & { rowKey: string; packQuantity: number | null }> {
  const rows: Array<VariantBarcodeStatus & { rowKey: string; packQuantity: number | null }> = [];
  for (const variant of data.variants) {
    rows.push({ ...variant, rowKey: variant.variantId, packQuantity: null });
    if (data.hasVariants) continue;
    const packs = [...(variant.quantityBarcodes || [])];
    for (const extra of extras) {
      if (extra.variantId !== variant.variantId) continue;
      if (packs.some((pack) => sameQty(pack.quantity, extra.quantity))) continue;
      const code = String(extra.barcode || '').trim();
      packs.push({
        quantity: extra.quantity,
        barcode: code || null,
        barcodeType: /^KDSPOZ/i.test(code) ? 'code128' : /^\d{8,18}$/.test(code) ? 'ean13' : code ? 'other' : null,
        status: code ? 'available' : 'missing',
      });
    }
    for (const pack of packs) {
      rows.push({
        ...variant,
        rowKey: `${variant.variantId}:${pack.quantity}`,
        barcode: pack.barcode,
        barcodeType: pack.barcodeType,
        status: pack.status,
        packQuantity: pack.quantity,
      });
    }
  }
  return rows;
}

function packPresets(uom?: UomInfo | null): { label: string; quantity: number }[] {
  const code = (uom?.code || '').toLowerCase();
  const count = uom?.type === 'count' || ['pcs', 'pc', 'piece', 'pieces', 'nos', 'unit'].includes(code);
  if (!count) return getQuantityPresets(uom);
  return [
    { label: '2', quantity: 2 },
    { label: '5', quantity: 5 },
    { label: '10', quantity: 10 },
    { label: '12', quantity: 12 },
  ];
}

function sameQty(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.0001;
}

function rowTitle(row: VariantRow, hasVariants: boolean, uom?: UomInfo | null): string {
  if (row.packQuantity) return formatQuantity(row.packQuantity, uom);
  if (!hasVariants) return formatQuantity(1, uom);
  return variantLabel(row.size, row.color) || 'Default';
}

function itemQtyLabel(row: VariantRow, uom?: UomInfo | null): string {
  const qty = row.packQuantity && row.packQuantity > 0 ? row.packQuantity : 1;
  return formatQuantity(qty, uom);
}

/** 1 kg at ₹70 prints ₹35 on a 500 g label. Unit price is for one full unit. */
function priceForQty(unitPrice: number | null | undefined, row: VariantRow): number | null {
  if (unitPrice == null || Number.isNaN(Number(unitPrice))) return null;
  const factor = row.packQuantity && row.packQuantity > 0 ? row.packQuantity : 1;
  return Math.round(Number(unitPrice) * factor * 100) / 100;
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

export default function BarcodeLabelScreen() {
  const useSdk = isNativeLabelPrinterAvailable();
  const useDesktop = isDesktopLabelPrintAvailable();
  const canPrint = isGapLabelPrintAvailable();
  const { width: winW } = useWindowDimensions();
  const previewW = Math.min(winW - spacing.lg * 2, 340);

  const [shopName, setShopName] = useState('My Shop');
  const [labelHeightMm, setLabelHeightMm] = useState<LabelHeightMm>(28);
  const previewH = previewW * (labelHeightMm / LABEL_WIDTH_MM);
  const [productMeta, setProductMeta] = useState<ProductBarcodeStatus | null>(null);
  const [rows, setRows] = useState<VariantRow[]>([]);
  const rowsRef = useRef<VariantRow[]>([]);
  rowsRef.current = rows;
  const extraPacksRef = useRef<{ variantId: string; barcode?: string | null; quantity: number }[]>([]);
  const searchUomRef = useRef<ProductBarcodeStatus['uom']>(null);
  const [loadingProduct, setLoadingProduct] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [previewRowKey, setPreviewRowKey] = useState<string | null>(null);
  const [packDraft, setPackDraft] = useState('');
  const [addingPack, setAddingPack] = useState(false);
  const [lastJob, setLastJob] = useState<LastPrintJob | null>(null);

  const [printerName, setPrinterName] = useState('Tap to select');
  const [printerAddress, setPrinterAddress] = useState('');
  const [connected, setConnected] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printers, setPrinters] = useState<ListedPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const applyDesktopLabelPrinter = useCallback((settings: LabelPrinterSettings) => {
    setLabelHeightMm(normalizeLabelHeightMm(settings.labelHeightMm));
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
    setPrinterName('Select label printer');
    setPrinterAddress('');
  }, []);

  const showStatus = useCallback((type: 'ok' | 'err', text: string) => {
    setStatus({ type, text });
  }, []);

  const persistLabelHeight = useCallback(
    async (heightMm: LabelHeightMm) => {
      setLabelHeightMm(heightMm);
      try {
        const current = await getLabelPrinterSettings();
        await saveLabelPrinterSettings({
          ...current,
          labelHeightMm: heightMm,
        });
        showStatus(
          'ok',
          `Label size set to ${LABEL_WIDTH_MM}×${heightMm} mm. Print one test label to check alignment.`,
        );
      } catch (err) {
        showStatus('err', err instanceof Error ? err.message : 'Could not save label size.');
      }
    },
    [showStatus],
  );

  const applyBarcodeStatus = useCallback((
    data: ProductBarcodeStatus,
    opts?: { preferSelectAvailable?: boolean; preserveRows?: VariantRow[]; selectPackQty?: number },
  ) => {
    const preferSelectAvailable = opts?.preferSelectAvailable !== false;
    const expanded = expandLabelRows(data, extraPacksRef.current);
    const previous = new Map((opts?.preserveRows || []).map((row) => [row.rowKey, row]));
    const uom = data.uom || searchUomRef.current || null;
    setProductMeta({ ...data, uom });
    setRows(
      expanded.map((v) => {
        const printable = v.status === 'available' && Boolean(v.barcode);
        const prev = previous.get(v.rowKey);
        const picked = sameQty(v.packQuantity, opts?.selectPackQty);
        return {
          ...v,
          selected: picked
            ? printable
            : prev
              ? printable && prev.selected
              : preferSelectAvailable
                ? printable
                : false,
          labelQty: prev?.labelQty && Number(prev.labelQty) > 0 ? prev.labelQty : '1',
        };
      }),
    );
    setPreviewRowKey((current) => {
      if (opts?.selectPackQty != null) {
        const match = expanded.find((v) => sameQty(v.packQuantity, opts.selectPackQty));
        if (match) return match.rowKey;
      }
      if (current && expanded.some((v) => v.rowKey === current)) return current;
      const firstPrintable = expanded.find((v) => v.status === 'available' && v.barcode);
      return firstPrintable?.rowKey || expanded[0]?.rowKey || null;
    });
  }, []);

  const loadBarcodeStatus = useCallback(
    async (productId: string, preserveSelection = false, selectPackQty?: number) => {
      setLoadingProduct(true);
      setStatus(null);
      try {
        const data = await fetchProductBarcodeStatus(productId);
        const preserveRows = preserveSelection ? rowsRef.current : undefined;
        applyBarcodeStatus(data, {
          preferSelectAvailable: !preserveSelection,
          preserveRows,
          selectPackQty,
        });
      } catch (err) {
        setProductMeta(null);
        setRows([]);
        showStatus('err', err instanceof Error ? err.message : 'Could not load barcodes.');
      } finally {
        setLoadingProduct(false);
      }
    },
    [applyBarcodeStatus, showStatus],
  );

  const onSelectProduct = async (item: SearchProductResult) => {
    if (!item.productId) {
      showStatus('err', 'Selected product has no id.');
      return;
    }
    extraPacksRef.current = (item.quantityBarcodes || []).map((pack) => ({
      variantId: item.variantId,
      barcode: pack.barcode,
      quantity: Number(pack.quantity),
    }));
    searchUomRef.current = item.uom || null;
    await loadBarcodeStatus(item.productId);
  };

  const clearProduct = () => {
    setProductMeta(null);
    setRows([]);
    extraPacksRef.current = [];
    searchUomRef.current = null;
    setPreviewRowKey(null);
    setPackDraft('');
  };

  useEffect(() => {
    getShopSettings()
      .then((shop) => {
        const name = shop.shopName?.trim();
        if (name) setShopName(name);
      })
      .catch(() => {});

    getLabelPrinterSettings()
      .then((settings) => {
        setLabelHeightMm(normalizeLabelHeightMm(settings.labelHeightMm));
        if (useDesktop) applyDesktopLabelPrinter(settings);
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
    }
  }, [useSdk, useDesktop, applyDesktopLabelPrinter]);

  const printableRows = useMemo(
    () => rows.filter((r) => r.selected && r.status === 'available' && r.barcode),
    [rows],
  );

  const totalLabels = useMemo(
    () =>
      printableRows.reduce((sum, row) => {
        const n = Number(row.labelQty);
        return sum + (Number.isNaN(n) || n <= 0 ? 0 : Math.floor(n));
      }, 0),
    [printableRows],
  );

  const missingCount = useMemo(
    () => rows.filter((r) => r.status === 'missing').length,
    [rows],
  );

  const letterCount = useMemo(
    () => rows.filter((r) => r.barcodeType === 'code128').length,
    [rows],
  );

  const previewRow = useMemo(() => {
    if (!rows.length) return null;
    return rows.find((r) => r.rowKey === previewRowKey) || printableRows[0] || rows[0];
  }, [rows, previewRowKey, printableRows]);

  const previewName = useMemo(() => {
    if (!productMeta || !previewRow) return 'Product';
    return productDisplayName(productMeta.productName, previewRow.size, previewRow.color);
  }, [productMeta, previewRow]);

  const previewQty = useMemo(() => {
    if (!previewRow) return '';
    return itemQtyLabel(previewRow, productMeta?.uom);
  }, [productMeta, previewRow]);

  const updateRow = (rowKey: string, patch: Partial<VariantRow>) => {
    setRows((prev) => prev.map((row) => (row.rowKey === rowKey ? { ...row, ...patch } : row)));
  };

  const selectAllPrintable = () => {
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        selected: row.status === 'available' && Boolean(row.barcode),
      })),
    );
  };

  const selectNone = () => {
    setRows((prev) => prev.map((row) => ({ ...row, selected: false })));
  };

  const needsNumberBarcode = (row: VariantRow) => row.status === 'missing' || row.barcodeType === 'code128';

  const onGenerateMissing = async () => {
    if (!productMeta || generating) return;
    const unitIds = [...new Set(
      rows.filter((r) => !r.packQuantity && needsNumberBarcode(r)).map((r) => r.variantId),
    )];
    const packs = rows.filter((r) => r.packQuantity && needsNumberBarcode(r));
    if (!unitIds.length && !packs.length) {
      showStatus('ok', 'Already has number barcodes.');
      return;
    }
    setGenerating(true);
    setStatus(null);
    try {
      const generated = unitIds.length ? await generateBarcodes(unitIds) : [];
      const packResult = packs.length
        ? await ensureQuantityBarcodes(packs.map((r) => ({ variantId: r.variantId, quantity: r.packQuantity as number })))
        : [];
      const created = generated.filter((r) => r.generated).length + packResult.filter((r) => r.generated).length;
      await loadBarcodeStatus(productMeta.productId, true);
      showStatus(
        'ok',
        created
          ? `Generated ${created} number barcode${created === 1 ? '' : 's'}. Print new labels — old letter stickers will not scan.`
          : 'No new barcodes needed',
      );
    } catch (err) {
      showStatus('err', err instanceof Error ? err.message : 'Could not generate barcodes.');
    } finally {
      setGenerating(false);
    }
  };

  const addPackQuantity = async (qty: number) => {
    if (!productMeta || productMeta.hasVariants || addingPack || generating) return;
    const variantId = productMeta.variants[0]?.variantId;
    if (!variantId || !(qty > 0)) {
      showStatus('err', 'Enter a quantity greater than 0.');
      return;
    }
    const existing = rows.find((row) => sameQty(row.packQuantity, qty));
    if (existing) {
      const printable = existing.status === 'available' && Boolean(existing.barcode);
      updateRow(existing.rowKey, { selected: printable });
      setPreviewRowKey(existing.rowKey);
      return;
    }
    setAddingPack(true);
    setStatus(null);
    try {
      const created = await ensureQuantityBarcodes([{ variantId, quantity: qty }]);
      const saved = created[0];
      if (saved?.barcode) {
        extraPacksRef.current = [
          ...extraPacksRef.current.filter((pack) => !(pack.variantId === variantId && sameQty(pack.quantity, Number(saved.quantity)))),
          { variantId, barcode: saved.barcode, quantity: Number(saved.quantity) },
        ];
      }
      setPackDraft('');
      await loadBarcodeStatus(productMeta.productId, true, Number(saved?.quantity ?? qty));
    } catch (err) {
      showStatus('err', err instanceof Error ? err.message : 'Could not add that quantity.');
    } finally {
      setAddingPack(false);
    }
  };

  const addCustomPack = () => {
    if (!productMeta) return;
    const parsed = parseQuantityForUom(packDraft, productMeta.uom);
    if (parsed == null || !(parsed > 0)) {
      showStatus('err', productMeta.uom ? quantityHint(productMeta.uom) : 'Enter a quantity greater than 0.');
      return;
    }
    addPackQuantity(parsed);
  };

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

      const current = await getLabelPrinterSettings();
      const next: LabelPrinterSettings = {
        ...current,
        type: 'system',
        systemPrinterName: printer.address,
        labelHeightMm,
      };
      await saveLabelPrinterSettings(next);
      applyDesktopLabelPrinter(next);
      setPrinterOpen(false);
      showStatus('ok', `Label printer · ${printer.name}`);
    } catch (err) {
      setConnected(false);
      showStatus('err', err instanceof Error ? err.message : 'Connect failed.');
    } finally {
      setConnecting(false);
    }
  };

  const buildLabelContent = (row: VariantRow): GapLabelContent => {
    if (!productMeta) throw new Error('Select a product first.');
    const barcode = (row.barcode || '').trim();
    if (!barcode) throw new Error(`Barcode missing for ${variantLabel(row.size, row.color) || row.sku}`);
    return {
      shopName,
      productName: productDisplayName(productMeta.productName, row.size, row.color),
      detail: itemQtyLabel(row, productMeta.uom),
      barcode,
      mrp: '',
      price: '',
    };
  };

  const runPrintJob = async (job: LastPrintJob) => {
    for (let i = 0; i < job.labels.length; i += 1) {
      const copies = job.copiesPerLabel[i] || 1;
      await printGapLabel(job.labels[i], copies);
    }
  };

  const onPrint = async () => {
    if (printing || connecting || generating) return;
    if (!productMeta) {
      showStatus('err', 'Select a product first.');
      return;
    }
    if (!printableRows.length) {
      showStatus('err', 'Select at least one variant with an available barcode.');
      return;
    }
    if (totalLabels <= 0) {
      showStatus('err', 'Set label quantity (1–99) for selected variants.');
      return;
    }
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
        useDesktop ? 'Select your USB label printer first.' : 'Connect a printer first.',
      );
      return;
    }

    const blocked = rows.filter((r) => r.selected && r.status !== 'available');
    if (blocked.length) {
      showStatus('err', 'Resolve missing/duplicate barcodes before printing selected variants.');
      return;
    }
    const letterSelected = printableRows.filter((r) => r.barcodeType === 'code128');
    if (letterSelected.length) {
      showStatus('err', 'Selected labels use letter barcodes. Generate number barcodes first so the scanner can read them.');
      return;
    }

    setPrinting(true);
    setStatus(null);
    try {
      const labels: GapLabelContent[] = [];
      const copiesPerLabel: number[] = [];
      for (const row of printableRows) {
        const copies = Math.floor(Number(row.labelQty));
        if (!(copies > 0) || copies > 99) {
          throw new Error(`Invalid label qty for ${variantLabel(row.size, row.color) || row.sku}`);
        }
        labels.push(buildLabelContent(row));
        copiesPerLabel.push(copies);
      }
      const job = { labels, copiesPerLabel };
      await runPrintJob(job);
      setLastJob(job);
      showStatus(
        'ok',
        `Printed ${totalLabels} label${totalLabels === 1 ? '' : 's'} · inventory unchanged`,
      );
    } catch (err) {
      showStatus('err', err instanceof Error ? err.message : 'Print failed.');
    } finally {
      setPrinting(false);
    }
  };

  const onReprint = async () => {
    if (!lastJob || printing) return;
    if (!connected) {
      showStatus('err', 'Connect / select a label printer first.');
      return;
    }
    setPrinting(true);
    setStatus(null);
    try {
      await runPrintJob(lastJob);
      const total = lastJob.copiesPerLabel.reduce((a, b) => a + b, 0);
      showStatus('ok', `Reprinted ${total} label${total === 1 ? '' : 's'}`);
    } catch (err) {
      showStatus('err', err instanceof Error ? err.message : 'Reprint failed.');
    } finally {
      setPrinting(false);
    }
  };

  const printLabel =
    printing
      ? 'Printing…'
      : !productMeta
        ? 'Select product'
        : !connected
          ? useDesktop
            ? 'Select USB printer'
            : 'Connect printer'
          : totalLabels > 0
            ? `Print · ${totalLabels} label${totalLabels === 1 ? '' : 's'}`
            : productMeta.hasVariants
              ? 'Select variants'
              : 'Select a quantity';

  const selectedLabel = productMeta
    ? `${productMeta.productName}${productMeta.hasVariants ? ` · ${rows.length} variants` : ''}`
    : undefined;

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
            productName={previewName}
            qtyLabel={previewQty}
            price=""
            barcode={previewRow?.barcode || ''}
            width={previewW}
            height={previewH}
          />
          <Text style={styles.previewCaption}>
            {LABEL_WIDTH_MM}×{labelHeightMm} mm · preview only (no barcode is auto-generated)
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Label size</Text>
          <Text style={styles.muted}>
            Match the sticker roll in the printer. Wrong height skips a blank label between prints.
          </Text>
          <View style={styles.sizeRow}>
            {LABEL_HEIGHT_OPTIONS.map((heightMm) => {
              const active = labelHeightMm === heightMm;
              return (
                <Pressable
                  key={heightMm}
                  onPress={() => persistLabelHeight(heightMm)}
                  style={[styles.sizeChip, active && styles.sizeChipOn]}>
                  <Text style={[styles.sizeChipText, active && styles.sizeChipTextOn]}>
                    {LABEL_WIDTH_MM}×{heightMm} mm
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>1 · Product</Text>
          <ProductSearchField
            groupByProduct
            onSelect={onSelectProduct}
            selectedLabel={selectedLabel}
          />
          {productMeta ? (
            <View style={styles.productActions}>
              <Text style={styles.metaLine}>
                {productMeta.hasVariants
                  ? `${rows.length} active variant${rows.length === 1 ? '' : 's'} · each needs its own barcode`
                  : 'Single product · uses its variant barcode'}
              </Text>
              <Pressable onPress={clearProduct} hitSlop={8}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={styles.muted}>Search by name, SKU or barcode</Text>
          )}
          {loadingProduct ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.muted}>Loading barcodes…</Text>
            </View>
          ) : null}
        </View>

        {rows.length ? (
          <View style={styles.block}>
            <View style={styles.tableHeader}>
              <Text style={styles.blockTitle}>{productMeta?.hasVariants ? '2 · Variants' : '2 · Quantity'}</Text>
              <View style={styles.headerActions}>
                <Pressable onPress={selectAllPrintable} disabled={printing || generating}>
                  <Text style={styles.link}>Select all</Text>
                </Pressable>
                <Text style={styles.dot}>·</Text>
                <Pressable onPress={selectNone} disabled={printing || generating}>
                  <Text style={styles.link}>Select none</Text>
                </Pressable>
              </View>
            </View>

            {missingCount > 0 || letterCount > 0 ? (
              <Button
                mode="outlined"
                icon="barcode"
                onPress={onGenerateMissing}
                loading={generating}
                disabled={generating || printing}
                style={styles.generateBtn}>
                {letterCount > 0 && missingCount === 0
                  ? `Convert to number barcodes (${letterCount})`
                  : `Generate number barcodes (${missingCount + letterCount})`}
              </Button>
            ) : null}

            {productMeta && !productMeta.hasVariants ? (
              <View style={styles.packBlock}>
                <Text style={styles.tableHint}>
                  Tap a quantity to print that pack. Labels is how many stickers. Printing does not change stock.
                </Text>
                <View style={styles.sizeRow}>
                  {packPresets(productMeta.uom).map((preset) => {
                    const existing = rows.find((row) => sameQty(row.packQuantity, preset.quantity));
                    const on = Boolean(existing?.selected);
                    return (
                      <Pressable
                        key={preset.label}
                        onPress={() => addPackQuantity(preset.quantity)}
                        disabled={addingPack || printing || generating}
                        style={[styles.sizeChip, on && styles.sizeChipOn]}>
                        <Text style={[styles.sizeChipText, on && styles.sizeChipTextOn]}>{preset.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.packAddRow}>
                  <TextInput
                    value={packDraft}
                    onChangeText={setPackDraft}
                    placeholder={productMeta.uom ? quantityHint(productMeta.uom) : 'Quantity'}
                    mode="outlined"
                    dense
                    disabled={addingPack || printing || generating}
                    style={styles.packInput}
                    onSubmitEditing={addCustomPack}
                  />
                  <Button
                    mode="contained"
                    onPress={addCustomPack}
                    loading={addingPack}
                    disabled={addingPack || printing || generating}>
                    Add qty
                  </Button>
                </View>
              </View>
            ) : (
              <Text style={styles.tableHint}>
                Labels print only for selected variants with Available barcodes. Printing never changes stock or prices.
              </Text>
            )}

            {rows.map((row) => {
              const meta = statusMeta(row.status);
              const name = productMeta
                ? rowTitle(row, productMeta.hasVariants, productMeta.uom)
                : 'Default';
              const disabledSelect = !meta.printable;
              return (
                <View
                  key={row.rowKey}
                  style={[
                    styles.variantCard,
                    previewRowKey === row.rowKey && styles.variantCardActive,
                  ]}>
                  <Pressable onPress={() => setPreviewRowKey(row.rowKey)} style={styles.variantTop}>
                    <Checkbox
                      status={row.selected ? 'checked' : 'unchecked'}
                      disabled={disabledSelect || printing || generating}
                      onPress={() => {
                        if (disabledSelect) return;
                        updateRow(row.rowKey, { selected: !row.selected });
                        setPreviewRowKey(row.rowKey);
                      }}
                    />
                    <View style={styles.flex}>
                      <Text style={styles.variantName}>{name}</Text>
                      <Text style={styles.variantSku}>SKU {row.sku}</Text>
                      <Text style={styles.variantPrice}>
                        MRP {row.mrp != null && row.mrp > 0 ? formatMoney(priceForQty(row.mrp, row)) : '—'}
                        {'  ·  '}
                        Sell {formatMoney(priceForQty(row.sellingPrice, row))}
                      </Text>
                      <Text style={styles.variantBarcode} numberOfLines={1}>
                        {row.barcode || 'No barcode'}
                        {row.barcodeType ? ` · ${row.barcodeType.toUpperCase()}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: meta.bg }]}>
                      <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </Pressable>
                  <View style={styles.qtyRow}>
                    <Text style={styles.qtyLabel}>Labels</Text>
                    <TextInput
                      value={row.labelQty}
                      onChangeText={(v) =>
                        updateRow(row.rowKey, {
                          labelQty: v,
                          selected: meta.printable ? true : row.selected,
                        })
                      }
                      onFocus={() => setPreviewRowKey(row.rowKey)}
                      keyboardType="number-pad"
                      mode="outlined"
                      dense
                      disabled={disabledSelect || printing || generating}
                      style={styles.qtyInput}
                    />
                  </View>
                  {row.status === 'missing' ? (
                    <Text style={styles.warnLine}>Generate a number barcode before printing this row.</Text>
                  ) : null}
                  {row.barcodeType === 'code128' ? (
                    <Text style={styles.warnLine}>
                      Letter barcode — scanners cannot read it. Convert to a number barcode, then print again.
                    </Text>
                  ) : null}
                  {row.status === 'duplicate' ? (
                    <Text style={styles.warnLine}>
                      Duplicate barcode detected — fix the assignment before printing.
                    </Text>
                  ) : null}
                </View>
              );
            })}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total labels</Text>
              <Text style={styles.totalValue}>{totalLabels}</Text>
            </View>
          </View>
        ) : null}

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
              {connected ? 'Label printer ready' : '3 · Label printer'}
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

        {lastJob ? (
          <Button
            mode="text"
            icon="printer-outline"
            onPress={onReprint}
            disabled={printing || connecting}
            style={styles.reprintBtn}>
            Reprint last labels
          </Button>
        ) : null}

        <View style={{ height: 110 }} />
      </ScrollView>

      <View style={styles.footer}>
        <Button
          mode="contained"
          onPress={onPrint}
          loading={printing}
          disabled={printing || connecting || generating || !connected || !totalLabels}
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
          <Dialog.Title>Label printer</Dialog.Title>
          <Dialog.Content>
            <Text style={styles.muted}>
              {useDesktop
                ? 'Choose the sticker / gap-label printer only. Billing uses a separate printer under Billing Printer.'
                : 'Paired Bluetooth label printers (separate from the billing printer).'}
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
                    ? 'No printers found. Install/add the USB label printer in macOS or Windows, then Refresh.'
                    : 'No printers found. Pair the label printer in Bluetooth settings.'}
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
  link: { fontSize: 13, fontWeight: '700', color: colors.primary },
  dot: { color: colors.textMuted, marginHorizontal: 4 },

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
  sizeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  sizeChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: colors.surface,
  },
  sizeChipOn: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight,
  },
  sizeChipText: { fontSize: 14, fontWeight: '600', color: colors.text },
  sizeChipTextOn: { color: colors.primary },
  previewCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  previewShop: {
    fontSize: 16,
    fontWeight: '700',
    color: '#000',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 0.3,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  previewProduct: { flex: 1, fontSize: 15, fontWeight: '700', color: '#000' },
  previewRight: { fontSize: 16, fontWeight: '700', color: '#000', textAlign: 'right' },
  previewDivider: { height: 2, backgroundColor: '#000', marginBottom: 8 },
  previewBarcode: { flexDirection: 'row', height: 30, width: '100%', backgroundColor: '#fff' },
  previewBarcodeEmpty: {
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: 3,
  },
  previewDigits: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
    color: '#000',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 0.5,
  },
  previewCaption: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '400',
    color: colors.textMuted,
    textAlign: 'center',
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
  metaLine: { flex: 1, fontSize: 12, fontWeight: '400', color: colors.textMuted, lineHeight: 18 },
  productActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  generateBtn: { marginBottom: spacing.sm, borderRadius: radius.md },
  tableHint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 17 },

  variantCard: {
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  variantCardActive: { borderColor: colors.primary, backgroundColor: colors.primaryLight },
  variantTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  variantName: { fontSize: 15, fontWeight: '700', color: colors.text },
  variantSku: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  variantPrice: { fontSize: 12, color: colors.textSecondary, marginTop: 4, fontWeight: '600' },
  variantBarcode: { fontSize: 11, color: colors.secondary, marginTop: 2, fontWeight: '600' },
  statusPill: {
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  statusText: { fontSize: 11, fontWeight: '700' },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingLeft: 40,
  },
  packBlock: { marginBottom: spacing.sm },
  packAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  packInput: { flex: 1, backgroundColor: colors.surface },
  qtyLabel: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  qtyInput: { width: 88, backgroundColor: colors.surface },
  warnLine: { marginTop: 6, marginLeft: 40, fontSize: 11, color: colors.error, fontWeight: '600' },

  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  totalLabel: { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  totalValue: { fontSize: 20, fontWeight: '800', color: colors.primary },

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
  reprintBtn: { marginTop: spacing.sm },

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
