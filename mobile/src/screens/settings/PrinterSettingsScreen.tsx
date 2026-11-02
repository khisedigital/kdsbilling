import React, { useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  Platform,
  PermissionsAndroid,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Portal,
  SegmentedButtons,
  Text,
  TextInput,
} from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import SectionCard from '../../components/ui/SectionCard';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { scanBluetoothPrinters } from '../../print/PrintService';
import { testPrint } from '../../print/receiptPrinter';
import {
  getPrinterSettings,
  savePrinterSettings,
  type PaperSize,
  type PrinterSettings,
  type PrinterType,
} from '../../store/printerStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type BtDevice = { name: string; address: string };

export default function PrinterSettingsScreen() {
  const [settings, setSettings] = useState<PrinterSettings>({
    type: 'bluetooth',
    paperSize: '80',
  });
  const [devices, setDevices] = useState<BtDevice[]>([]);
  const [search, setSearch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  // iOS does not resize the screen for the keyboard; pad the scroll content so the bottom stays reachable.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    getPrinterSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    if (saving) return;
    Keyboard.dismiss();
    setSaving(true);
    try {
      await savePrinterSettings(settings);
      Alert.alert('Saved', 'Printer settings saved.');
    } catch (err: unknown) {
      Alert.alert('Save failed', err instanceof Error ? err.message : 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleScan = async () => {
    if (Platform.OS === 'android' && Platform.Version >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      const scanOk = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED;
      const connectOk = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
      if (!scanOk || !connectOk) {
        Alert.alert('Permission', 'Bluetooth scan and connect permission required');
        return;
      }
    }
    setScanning(true);
    try {
      const list = await scanBluetoothPrinters();
      if (!list.length) {
        Alert.alert(
          'No devices',
          Platform.OS === 'ios'
            ? 'Turn the printer on and keep it close, then scan again. iPhone can only use printers that support Bluetooth LE (BLE); do not pair it in iPhone Settings.'
            : 'Pair printer in Bluetooth settings first, then scan again.',
        );
        return;
      }
      setDevices(list);
      setSearch('');
      setPickerOpen(true);
    } catch (err: unknown) {
      Alert.alert('Scan failed', err instanceof Error ? err.message : 'Bluetooth error');
    } finally {
      setScanning(false);
    }
  };

  const handleOpenPicker = async () => {
    if (devices.length) {
      setSearch('');
      setPickerOpen(true);
      return;
    }
    await handleScan();
  };

  const selectDevice = (device: BtDevice) => {
    setSettings({
      ...settings,
      bluetoothAddress: device.address,
      bluetoothName: device.name,
    });
    setPickerOpen(false);
  };

  const handleTest = async () => {
    if (testing) return;
    Keyboard.dismiss();
    setTesting(true);
    try {
      await savePrinterSettings(settings);
      await testPrint();
      Alert.alert('Success', 'Test print sent.');
    } catch (err: unknown) {
      Alert.alert('Print failed', err instanceof Error ? err.message : 'Error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const filteredDevices = devices.filter((d) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return d.name.toLowerCase().includes(q) || d.address.toLowerCase().includes(q);
  });

  const selectedLabel = settings.bluetoothName || 'Select Bluetooth printer';
  const selectedAddress = settings.bluetoothAddress || '';

  return (
    <>
      <ScrollView
        style={common.screen}
        contentContainerStyle={[common.screenPad, keyboardHeight > 0 && { paddingBottom: keyboardHeight + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        <Text style={styles.title}>Billing Printer</Text>
        <Text style={styles.subtitle}>
          Receipt / bill printer only. Barcode labels use a separate printer on the Barcode label screen.
        </Text>

        <SectionCard title="Printer type" icon="printer">
          <SegmentedButtons
            value={settings.type}
            onValueChange={(v) => setSettings({ ...settings, type: v as PrinterType })}
            buttons={[
              { value: 'bluetooth', label: 'Bluetooth', icon: 'bluetooth' },
              { value: 'network', label: 'Wi-Fi / LAN', icon: 'wifi' },
            ]}
          />
        </SectionCard>

        <SectionCard title="Paper size" icon="file-outline">
          <Text style={styles.paperHint}>
            Must match your printer roll (wrong size adds blank wrap lines)
          </Text>
          <SegmentedButtons
            value={settings.paperSize}
            onValueChange={(v) => setSettings({ ...settings, paperSize: v as PaperSize })}
            buttons={[
              { value: '58', label: '58mm' },
              { value: '80', label: '80mm' },
            ]}
          />
        </SectionCard>

        {settings.type === 'bluetooth' && (
          <SectionCard title="Bluetooth printer" icon="bluetooth">
            <Pressable onPress={handleOpenPicker}>
              <View pointerEvents="none">
                <TextInput
                  label="Selected printer"
                  value={selectedLabel}
                  mode="outlined"
                  editable={false}
                  style={styles.input}
                  right={<TextInput.Icon icon="chevron-down" />}
                />
              </View>
            </Pressable>

            {selectedAddress ? (
              <View style={styles.addressBox}>
                <Text style={styles.addressLabel}>Printer address</Text>
                <Text style={styles.addressValue} selectable>
                  {selectedAddress}
                </Text>
              </View>
            ) : (
              <Text style={styles.hint}>Scan and choose a printer. Address will appear here.</Text>
            )}

            <Button
              mode="outlined"
              onPress={handleScan}
              loading={scanning}
              icon="bluetooth"
              style={styles.scanBtn}
            >
              Scan printers
            </Button>
            <Button
              mode="contained-tonal"
              onPress={handleOpenPicker}
              icon="format-list-bulleted"
              disabled={scanning}
              style={styles.scanBtn}
            >
              Choose from list
            </Button>
          </SectionCard>
        )}

        {settings.type === 'network' && (
          <SectionCard title="Wi-Fi / LAN printer" icon="wifi">
            <Text style={styles.hint}>
              For Wi-Fi or Ethernet thermal receipt printers (ESC/POS). The phone and printer must be on the same network. Leave the port empty for most printers (9100).
            </Text>
            <TextInput
              label="Printer address (IP)"
              value={settings.networkHost || ''}
              onChangeText={(v) => setSettings({ ...settings, networkHost: v })}
              mode="outlined"
              style={styles.input}
              placeholder="192.168.1.50"
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
            />
            <TextInput
              label="Port (optional)"
              value={settings.networkPort ? String(settings.networkPort) : ''}
              placeholder="9100"
              onChangeText={(v) => setSettings({ ...settings, networkPort: parseInt(v, 10) || undefined })}
              keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'number-pad'}
              returnKeyType="done"
              mode="outlined"
              style={styles.input}
            />
          </SectionCard>
        )}

        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={handleSave}
            icon="content-save"
            loading={saving}
            disabled={saving || testing}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </Button>
          <Button
            mode="outlined"
            onPress={handleTest}
            icon="printer"
            loading={testing}
            disabled={saving || testing}
            style={styles.testBtn}
          >
            {testing ? 'Printing...' : 'Test Print'}
          </Button>
        </View>
      </ScrollView>

      <Portal>
        <Dialog
          visible={pickerOpen}
          onDismiss={() => setPickerOpen(false)}
          style={styles.dialog}
        >
          <Dialog.Title>Select Bluetooth printer</Dialog.Title>
          <Dialog.Content style={styles.dialogContent}>
            <ScreenSearch
              value={search}
              onChangeText={setSearch}
              placeholder="Search name or address..."
              embedded
            />
            <ScrollView style={styles.deviceScroll} keyboardShouldPersistTaps="handled">
              {filteredDevices.map((d) => {
                const active = settings.bluetoothAddress === d.address;
                return (
                  <Pressable
                    key={d.address}
                    onPress={() => selectDevice(d)}
                    style={[styles.deviceRow, active && styles.deviceRowOn]}
                  >
                    <View style={styles.deviceText}>
                      <Text style={[styles.deviceName, active && styles.deviceNameOn]} numberOfLines={1}>
                        {d.name || 'Unknown printer'}
                      </Text>
                      <Text style={styles.deviceAddress} numberOfLines={1}>
                        {d.address}
                      </Text>
                    </View>
                    {active ? <Icon name="check" size={22} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
              {!filteredDevices.length ? <Text style={styles.noMatch}>No matching printers</Text> : null}
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setPickerOpen(false)}>Cancel</Button>
            <Button onPress={handleScan} loading={scanning}>
              Rescan
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.h1, fontSize: 22 },
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  paperHint: { ...typography.caption, marginBottom: spacing.sm, textTransform: 'none', letterSpacing: 0 },
  scanBtn: { borderRadius: radius.md, marginBottom: spacing.sm },
  hint: { ...typography.bodySm, marginBottom: spacing.md },
  addressBox: {
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  addressLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  addressValue: {
    ...typography.body,
    fontWeight: '600',
    color: colors.primary,
    fontVariant: ['tabular-nums'],
  },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
  testBtn: { marginTop: spacing.sm },
  dialog: { borderRadius: radius.lg, backgroundColor: colors.surface },
  dialogContent: { maxHeight: 420, paddingHorizontal: spacing.lg },
  deviceScroll: { maxHeight: 320 },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
    gap: spacing.sm,
  },
  deviceRowOn: { backgroundColor: colors.primaryLight, borderRadius: radius.sm },
  deviceText: { flex: 1, minWidth: 0 },
  deviceName: { ...typography.h3, fontSize: 15 },
  deviceNameOn: { color: colors.primary },
  deviceAddress: { ...typography.caption, marginTop: 2, textTransform: 'none', letterSpacing: 0 },
  noMatch: { ...typography.bodySm, marginTop: spacing.md, textAlign: 'center' },
});
