import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Button, Dialog, Portal, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import BottomBar from '../../components/ui/BottomBar';
import { encodeBarcode } from '../../print/barcodeEncode';
import {
  DEMO_BARCODE,
  LABEL_HEIGHT_MM,
  LABEL_WIDTH_MM,
  printGapLabel,
  type GapLabelContent,
} from '../../print/gapLabel';
import {
  calibrateNativeLabelPrinter,
  connectNativeLabelPrinter,
  getNativeLabelPrinterStatus,
  isNativeLabelPrinterAvailable,
  listNativeLabelPrinters,
} from '../../print/labelPrinterNative';
import { getShopSettings } from '../../services/shopSettingsService';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

const DEMO: GapLabelContent = {
  shopName: 'My Shop',
  productName: 'Sample Product',
  detail: '500 g',
  barcode: DEMO_BARCODE,
  mrp: 'MRP: ₹120',
  price: '₹99',
};

type ListedPrinter = { name: string; address: string };

function BarcodeStrip({ value }: { value: string }) {
  let modules = '';
  try {
    modules = encodeBarcode(value);
  } catch {
    modules = '';
  }
  if (!modules) return <View style={styles.barcodeMissing} />;

  const quiet = 8;
  const runs: { bar: boolean; n: number }[] = [{ bar: false, n: quiet }];
  for (const ch of modules) {
    const bar = ch === '1';
    const last = runs[runs.length - 1];
    if (last.bar === bar) last.n += 1;
    else runs.push({ bar, n: 1 });
  }
  runs.push({ bar: false, n: quiet });

  return (
    <View style={styles.barcode}>
      {runs.map((run, index) => (
        <View
          key={index}
          style={{ flex: run.n, backgroundColor: run.bar ? '#000000' : '#FFFFFF' }}
        />
      ))}
    </View>
  );
}

export default function PrintLabelScreen() {
  const useSdk = isNativeLabelPrinterAvailable();
  const { width } = useWindowDimensions();
  const labelWidth = Math.min(width - spacing.lg * 2, 360);
  const labelHeight = labelWidth * (LABEL_HEIGHT_MM / LABEL_WIDTH_MM);

  const [label, setLabel] = useState<GapLabelContent>(DEMO);
  const [printerName, setPrinterName] = useState('Select printer');
  const [printerAddress, setPrinterAddress] = useState('');
  const [connected, setConnected] = useState(false);
  const [qty, setQty] = useState(1);
  const [qtyOpen, setQtyOpen] = useState(false);
  const [qtyDraft, setQtyDraft] = useState('1');
  const [printerOpen, setPrinterOpen] = useState(false);
  const [printers, setPrinters] = useState<ListedPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    getShopSettings()
      .then((shop) => {
        const name = shop.shopName?.trim();
        if (name) setLabel((current) => ({ ...current, shopName: name }));
      })
      .catch(() => {});

    if (!useSdk) return;
    getNativeLabelPrinterStatus()
      .then((status) => {
        setConnected(Boolean(status.connected));
        if (status.connected) {
          setPrinterName(status.name || 'Printer');
          setPrinterAddress(status.address || '');
        }
      })
      .catch(() => {});
  }, [useSdk]);

  const loadPrinters = useCallback(async () => {
    if (!useSdk) {
      Alert.alert(
        'Android only',
        'This thermal printer prints only through the Microlan SDK. Open KDSPOZ on your Android phone.',
      );
      return;
    }
    setLoadingPrinters(true);
    try {
      setPrinters(await listNativeLabelPrinters());
    } catch (err) {
      setPrinters([]);
      Alert.alert('Printers', err instanceof Error ? err.message : 'Could not list printers.');
    } finally {
      setLoadingPrinters(false);
    }
  }, [useSdk]);

  const openQty = () => {
    setQtyDraft(String(qty));
    setQtyOpen(true);
  };

  const saveQty = () => {
    const next = parseInt(qtyDraft, 10);
    if (!qtyDraft.trim() || Number.isNaN(next) || next < 1 || next > 99) {
      Alert.alert('Quantity', 'Enter a number from 1 to 99.');
      return;
    }
    setQty(next);
    setQtyOpen(false);
  };

  const openPrinter = () => {
    if (!useSdk) {
      Alert.alert(
        'Android only',
        'This thermal printer prints only through the Microlan SDK. Open KDSPOZ on your Android phone.',
      );
      return;
    }
    setPrinterOpen(true);
    loadPrinters();
  };

  const selectPrinter = async (printer: ListedPrinter) => {
    if (connecting) return;
    setConnecting(true);
    try {
      const status = await connectNativeLabelPrinter(printer.address);
      setConnected(Boolean(status.connected));
      setPrinterName(status.name || printer.name);
      setPrinterAddress(status.address || printer.address);
      setPrinterOpen(false);
    } catch (err) {
      setConnected(false);
      Alert.alert(
        'Connect failed',
        err instanceof Error
          ? err.message
          : 'Could not connect. Turn the printer on and close other print apps, then try again.',
      );
    } finally {
      setConnecting(false);
    }
  };

  const onCalibrate = async () => {
    if (calibrating || printing || connecting) return;
    if (!useSdk) {
      Alert.alert('Android only', 'Calibrate needs the Android app.');
      return;
    }
    if (!connected) {
      Alert.alert('Printer', 'Select and connect a Bluetooth printer first.');
      return;
    }
    setCalibrating(true);
    try {
      await calibrateNativeLabelPrinter();
      Alert.alert('Calibrate', 'Gap sensor learning started. Wait for the labels to feed, then print.');
    } catch (err) {
      Alert.alert('Calibrate failed', err instanceof Error ? err.message : 'Could not calibrate.');
    } finally {
      setCalibrating(false);
    }
  };

  const onPrint = async () => {
    if (printing) return;
    if (!useSdk) {
      Alert.alert(
        'Android only',
        'This gap-label printer needs the Android app. Open KDSPOZ on your phone.',
      );
      return;
    }
    if (!connected) {
      Alert.alert('Printer', 'Select and connect a Bluetooth printer first.');
      return;
    }
    setPrinting(true);
    try {
      await printGapLabel(label, qty);
      Alert.alert('Sent to printer', `${qty} label${qty === 1 ? '' : 's'} sent.`);
    } catch (err) {
      Alert.alert('Print failed', err instanceof Error ? err.message : 'Could not print.');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.body}>
        <View style={[styles.label, { width: labelWidth, height: labelHeight }]}>
          <Text style={styles.shop} numberOfLines={1}>{label.shopName}</Text>
          <Text style={styles.product} numberOfLines={1}>{label.productName}</Text>
          <Text style={styles.detail} numberOfLines={1}>{label.detail}</Text>
          <BarcodeStrip value={label.barcode} />
          <Text style={styles.digits}>{label.barcode}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.mrp}>{label.mrp}</Text>
            <Text style={styles.price}>{label.price}</Text>
          </View>
        </View>
        <Text style={styles.sizeCaption}>
          {useSdk
            ? `${LABEL_WIDTH_MM} × ${LABEL_HEIGHT_MM} mm · match roll size on Barcode label · sensor align`
            : 'Needs Android app + Microlan SDK'}
        </Text>
      </View>

      <BottomBar
        primary={{
          label: printing ? 'Printing…' : 'Print',
          icon: 'printer',
          onPress: onPrint,
          loading: printing,
          disabled: printing || connecting || calibrating,
        }}
        secondary={[
          {
            label: `Qty ${qty}`,
            icon: 'counter',
            onPress: openQty,
            disabled: printing || connecting || calibrating,
          },
          {
            label: calibrating ? '…' : 'Calibrate',
            icon: 'target',
            onPress: onCalibrate,
            disabled: printing || connecting || calibrating || !connected,
          },
        ]}>
        <Pressable
          onPress={openPrinter}
          disabled={printing || connecting}
          style={[styles.printerBtn, (printing || connecting) && styles.printerBtnDisabled]}>
          <Icon name="bluetooth" size={18} color={colors.primary} />
          <View style={styles.printerText}>
            <Text style={styles.printerCaption}>
              {connected ? 'Connected' : 'Bluetooth printer'}
            </Text>
            <Text style={styles.printerName} numberOfLines={1}>{printerName}</Text>
          </View>
          <Icon name="chevron-down" size={20} color={colors.textMuted} />
        </Pressable>
      </BottomBar>

      <Portal>
        <Dialog visible={qtyOpen} onDismiss={() => setQtyOpen(false)} style={styles.dialog}>
          <Dialog.Title>How many copies</Dialog.Title>
          <Dialog.Content>
            <TextInput
              label="Quantity"
              value={qtyDraft}
              onChangeText={setQtyDraft}
              keyboardType="number-pad"
              mode="outlined"
              autoFocus
            />
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setQtyOpen(false)}>Cancel</Button>
            <Button onPress={saveQty}>Save</Button>
          </Dialog.Actions>
        </Dialog>

        <Dialog visible={printerOpen} onDismiss={() => !connecting && setPrinterOpen(false)} style={styles.printerDialog}>
          <Dialog.Title>Bluetooth printer</Dialog.Title>
          <Dialog.Content style={styles.printerDialogContent}>
            <Text style={styles.hint}>
              Pair the printer in Android Bluetooth, then pick it here. Each print uses SIZE/GAP so the sensor pulls the label to the top before printing.
            </Text>
            {loadingPrinters || connecting ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.hint}>{connecting ? 'Connecting…' : 'Looking for printers…'}</Text>
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
                      name={active ? 'radiobox-marked' : 'radiobox-blank'}
                      size={20}
                      color={active ? colors.primary : colors.textMuted}
                    />
                    <View style={styles.printerRowText}>
                      <Text style={[styles.printerRowName, active && styles.printerRowNameOn]} numberOfLines={1}>
                        {printer.name}
                      </Text>
                      <Text style={styles.printerRowAddress} numberOfLines={1}>{printer.address}</Text>
                    </View>
                  </Pressable>
                );
              })}
              {!loadingPrinters && !printers.length ? (
                <Text style={styles.hint}>
                  No paired printers found. Pair the printer in Bluetooth settings, then refresh.
                </Text>
              ) : null}
            </ScrollView>
            <Button
              mode="outlined"
              icon="refresh"
              onPress={loadPrinters}
              loading={loadingPrinters}
              disabled={connecting}
              style={styles.refreshBtn}>
              Refresh list
            </Button>
          </Dialog.Content>
          <Dialog.Actions>
            <Button disabled={connecting} onPress={() => setPrinterOpen(false)}>Close</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  label: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'space-between',
  },
  shop: { fontSize: 11, color: '#000', textAlign: 'center' },
  product: { fontSize: 15, fontWeight: '700', color: '#000' },
  detail: { fontSize: 11, color: '#000' },
  barcode: { flexDirection: 'row', height: 46, width: '100%', backgroundColor: '#FFFFFF' },
  barcodeMissing: { height: 46 },
  digits: { fontSize: 10, color: '#000', textAlign: 'center', letterSpacing: 1 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  mrp: { fontSize: 11, color: '#000' },
  price: { fontSize: 16, fontWeight: '700', color: '#000' },
  sizeCaption: { marginTop: spacing.sm, fontSize: 13, color: colors.textMuted },
  printerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  printerBtnDisabled: { opacity: 0.55 },
  printerText: { flex: 1, minWidth: 0 },
  printerCaption: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  printerName: { fontSize: 14, fontWeight: '600', color: colors.text },
  dialog: {
    width: 420,
    maxWidth: '92%',
    alignSelf: 'center',
    borderRadius: radius.lg,
  },
  printerDialog: {
    width: 460,
    maxWidth: '94%',
    alignSelf: 'center',
    borderRadius: radius.lg,
  },
  printerDialogContent: { paddingBottom: spacing.sm },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  printerList: { maxHeight: 280 },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  printerRowOn: { backgroundColor: colors.primaryLight },
  printerRowText: { flex: 1, minWidth: 0 },
  printerRowName: { fontSize: 14, color: colors.text },
  printerRowNameOn: { fontWeight: '700', color: colors.primary },
  printerRowAddress: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  hint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  refreshBtn: { marginTop: spacing.sm, borderRadius: radius.md },
});
