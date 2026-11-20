import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, SegmentedButtons, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import SectionCard from '../../components/ui/SectionCard';
import { listSystemPrinters } from '../../print/PrintService';
import { testPrint, wakePrinterOnClick } from '../../print/receiptPrinter';
import { getDesktopBridge } from '../../desktop/bridge';
import { receiptCharsForPaper } from '../../print/escpos';
import {
  getPrinterSettings,
  resolvePaperSize,
  savePrinterSettings,
  type PaperSize,
  type PrinterSettings,
  type PrinterType,
} from '../../store/printerStore';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';

type SystemPrinter = { name: string; displayName: string; isDefault: boolean };

export default function PrinterSettingsScreen() {
  const t = useT();
  const isDesktopApp = Boolean(getDesktopBridge());
  const [settings, setSettings] = useState<PrinterSettings>({
    type: 'system',
    paperSize: '80',
  });
  const [printers, setPrinters] = useState<SystemPrinter[]>([]);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const refreshPrinters = useCallback(async () => {
    setLoadingPrinters(true);
    try {
      setPrinters(await listSystemPrinters());
    } catch (err: unknown) {
      Alert.alert(t('Printers'), err instanceof Error ? t(err.message) : t('Could not list printers'));
    } finally {
      setLoadingPrinters(false);
    }
  }, [t]);

  useEffect(() => {
    getPrinterSettings().then((s) => {
      setSettings(s);
      setLoading(false);
    });
    refreshPrinters();
  }, [refreshPrinters]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await savePrinterSettings(settings);
      Alert.alert(t('Saved'), t('Printer settings saved.'));
    } catch (err: unknown) {
      Alert.alert(t('Save failed'), err instanceof Error ? t(err.message) : t('Error'));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = () => {
    // Do not bail when testing — every tap must queue a slip (5 taps → 5 prints).
    // Wake CUPS on click so paper can move before encode finishes.
    wakePrinterOnClick();
    setTesting(true);
    void (async () => {
      try {
        await savePrinterSettings(settings);
        wakePrinterOnClick();
        await testPrint();
        if (settings.paperSize === 'a4' && settings.type === 'system' && !settings.systemPrinterName) {
          Alert.alert(t('Test print ready'), t('Choose a printer or Save as PDF in the print dialog.'));
        } else {
          Alert.alert(t('Success'), t('Test print sent.'));
        }
      } catch (err: unknown) {
        Alert.alert(t('Print failed'), err instanceof Error ? t(err.message) : t('Error'));
      } finally {
        setTesting(false);
      }
    })();
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const renderPrinterList = (allowAsk: boolean) => (
    <>
      {allowAsk ? (
        <Pressable
          onPress={() => setSettings({ ...settings, systemPrinterName: undefined })}
          style={[styles.printerRow, !settings.systemPrinterName && styles.printerRowOn]}
        >
          <Icon
            name={!settings.systemPrinterName ? 'radiobox-marked' : 'radiobox-blank'}
            size={20}
            color={!settings.systemPrinterName ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.printerName, !settings.systemPrinterName && styles.printerNameOn]}>
            {t('Ask every time (show print dialog)')}
          </Text>
        </Pressable>
      ) : null}
      {printers.map((p) => {
        const active = settings.systemPrinterName === p.name;
        return (
          <Pressable
            key={p.name}
            onPress={() => setSettings({ ...settings, systemPrinterName: p.name })}
            style={[styles.printerRow, active && styles.printerRowOn]}
          >
            <Icon
              name={active ? 'radiobox-marked' : 'radiobox-blank'}
              size={20}
              color={active ? colors.primary : colors.textMuted}
            />
            <Text style={[styles.printerName, active && styles.printerNameOn]} numberOfLines={1}>
              {p.displayName}
            </Text>
            {p.isDefault ? <Text style={styles.defaultTag}>{t('Default')}</Text> : null}
          </Pressable>
        );
      })}
      {!printers.length && !loadingPrinters ? (
        <Text style={styles.hint}>{t('No online printers found. Turn the printer on, then Refresh.')}</Text>
      ) : null}
      <Button
        mode="outlined"
        icon="refresh"
        onPress={refreshPrinters}
        loading={loadingPrinters}
        style={styles.refreshBtn}
      >
        {t('Refresh list')}
      </Button>
    </>
  );

  return (
    <ScrollView style={common.screen} contentContainerStyle={[common.screenPad, styles.page]}>
      <Text style={styles.title}>{t('Billing Printer')}</Text>
      <Text style={styles.subtitle}>
        {t('Receipt / bill printer only. Barcode labels use a separate printer on the Barcode label screen.')}
      </Text>

      <SectionCard title={t('Paper size')} icon="file-outline">
        <Text style={styles.paperHint}>
          {t('Choose the paper your printer uses. This selects the print engine — save after changing.')}
        </Text>
        <SegmentedButtons
          value={resolvePaperSize(settings.paperSize)}
          onValueChange={(v) => {
            const paperSize = resolvePaperSize(v);
            // A4 → normal printer; 58/80 → POS thermal transport.
            const next: PrinterSettings = paperSize === 'a4'
              ? { ...settings, paperSize, type: 'system' }
              : { ...settings, paperSize };
            setSettings(next);
            // Persist immediately so the next Print uses this size (no need to tap Save first).
            void savePrinterSettings(next);
          }}
          buttons={[
            { value: '58', label: t('58mm POS') },
            { value: '80', label: t('80mm POS') },
            { value: 'a4', label: t('A4 office') },
          ]}
        />
        {settings.paperSize === '58' || settings.paperSize === '80' ? (
          <Text style={styles.paperActive}>
            {t('Bills print at {{size}} mm ({{cols}} characters per line). Tap Test Print to verify.', {
              size: settings.paperSize,
              cols: receiptCharsForPaper(settings.paperSize),
            })}
          </Text>
        ) : null}
        <Text style={styles.a4Hint}>
          {settings.paperSize === 'a4'
            ? t('A4 uses a normal printer (HTML). Pick a laser/inkjet/PDF under Office printer.')
            : isDesktopApp
              ? t('{{size}} mm POS uses ESC/POS (same as the phone). Connect via Bluetooth, USB, or Wi‑Fi.', { size: settings.paperSize })
              : t('{{size}} mm POS: use Wi‑Fi / LAN here, or open the desktop app for Bluetooth / USB.', { size: settings.paperSize })}
        </Text>
      </SectionCard>

      {settings.paperSize !== 'a4' ? (
        <SectionCard title={t('POS printer connection')} icon="printer">
          <SegmentedButtons
            value={settings.type === 'system' || settings.type === 'bluetooth' || settings.type === 'network' ? settings.type : 'network'}
            onValueChange={(v) => setSettings({ ...settings, type: v as PrinterType })}
            buttons={[
              { value: 'network', label: t('Wi-Fi'), icon: 'wifi' },
              { value: 'bluetooth', label: t('Bluetooth'), icon: 'bluetooth' },
              { value: 'system', label: t('USB'), icon: 'usb' },
            ]}
          />
          <Text style={[styles.hint, { marginTop: spacing.sm }]}>
            {settings.type === 'network'
              ? t('Recommended for Mac, Windows and phone: put the printer on Wi‑Fi/LAN and use port 9100. Same method as most shop POS apps — reliable for many bills in a row.')
              : settings.type === 'bluetooth'
                ? isDesktopApp
                  ? t('Fallback when there is no Wi‑Fi printer. Pair in system Bluetooth, then select below.')
                  : t('Phone fallback when the printer has no Wi‑Fi. Prefer Wi‑Fi / LAN (port 9100) if the printer supports it.')
                : isDesktopApp
                  ? t('USB thermal (58/80 mm): we hold the cable for the whole print burst so bills do not collide. A4 office printers use a different path and are unaffected. Wi‑Fi :9100 is still best if the printer has it.')
                  : t('USB needs the desktop app. On a phone use Wi‑Fi (9100) or Bluetooth.')}
          </Text>
        </SectionCard>
      ) : (
        <SectionCard title={t('Office printer (A4)')} icon="printer">
          <Text style={styles.hint}>
            {isDesktopApp
              ? t('Any normal printer from System Settings. Optional: choose one for silent print, or Ask every time.')
              : t('The browser print dialog opens for each bill (Save as PDF works too).')}
          </Text>
          {isDesktopApp ? renderPrinterList(true) : null}
        </SectionCard>
      )}

      {settings.paperSize !== 'a4' && settings.type === 'bluetooth' && isDesktopApp ? (
        <SectionCard title={t('Bluetooth POS printer')} icon="bluetooth">
          <Text style={styles.hint}>
            {t('Pair the printer in system Bluetooth first, then select it here (required).')}
          </Text>
          {printers.map((p) => {
            const active = settings.bluetoothAddress === p.name;
            return (
              <Pressable
                key={`bt-${p.name}`}
                onPress={() =>
                  setSettings({
                    ...settings,
                    type: 'bluetooth',
                    bluetoothAddress: p.name,
                    bluetoothName: p.displayName || p.name,
                  })
                }
                style={[styles.printerRow, active && styles.printerRowOn]}
              >
                <Icon
                  name={active ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={active ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.printerName, active && styles.printerNameOn]} numberOfLines={1}>
                  {p.displayName}
                </Text>
                {p.isDefault ? <Text style={styles.defaultTag}>{t('Default')}</Text> : null}
              </Pressable>
            );
          })}
          {!printers.length && !loadingPrinters ? (
            <Text style={styles.hint}>{t('No online printers found. Turn the POS printer on, then Refresh.')}</Text>
          ) : null}
          <Button
            mode="outlined"
            icon="refresh"
            onPress={refreshPrinters}
            loading={loadingPrinters}
            style={styles.refreshBtn}
          >
            {t('Refresh list')}
          </Button>
        </SectionCard>
      ) : null}

      {settings.paperSize !== 'a4' && settings.type === 'bluetooth' && !isDesktopApp ? (
        <SectionCard title={t('Bluetooth POS printer')} icon="bluetooth">
          <Text style={styles.hint}>
            {t('Open this screen in the KDSPOZ desktop app after pairing the printer in system Bluetooth. In the browser, use Wi‑Fi / LAN instead.')}
          </Text>
        </SectionCard>
      ) : null}

      {settings.paperSize !== 'a4' && settings.type === 'system' && isDesktopApp ? (
        <SectionCard title={t('USB / installed POS printer')} icon="printer">
          <Text style={styles.hint}>
            {t('Select the thermal printer by name (required for 58/80 mm). On Windows use driver “Generic / Text Only”. Red light = cover/paper/error — close cover, check paper, Resume the queue in Windows Printers, then print again.')}
          </Text>
          {renderPrinterList(false)}
        </SectionCard>
      ) : null}

      {settings.paperSize !== 'a4' && settings.type === 'network' && (
        <SectionCard title={t('Wi-Fi / LAN printer')} icon="wifi">
          <Text style={styles.hint}>
            {t('Enter the printer IP from its self‑test ticket. Leave port empty for 9100. Phone, Mac and Windows all use this same raw ESC/POS link.')}
          </Text>
          <AppTextInput
            label={t('Printer address (IP)')}
            value={settings.networkHost || ''}
            onChangeText={(v) => setSettings({ ...settings, networkHost: v, type: 'network' })}
            mode="outlined"
            style={styles.input}
            placeholder="192.168.1.50"
          />
          <AppTextInput
            label={t('Port (optional)')}
            value={settings.networkPort ? String(settings.networkPort) : ''}
            placeholder="9100"
            onChangeText={(v) =>
              setSettings({ ...settings, networkPort: parseInt(v, 10) || 9100, type: 'network' })
            }
            keyboardType="number-pad"
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
          {saving ? t('Saving...') : t('Save Settings')}
        </Button>
        <Button
          mode="outlined"
          onPress={handleTest}
          icon="printer"
          loading={testing}
          disabled={saving}
        >
          {testing ? t('Printing...') : t('Test Print')}
        </Button>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  page: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { ...typography.h1, fontSize: 22 },
  subtitle: { ...typography.bodySm, marginBottom: spacing.xl },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  paperHint: { ...typography.caption, marginBottom: spacing.sm, textTransform: 'none', letterSpacing: 0 },
  paperActive: {
    ...typography.bodySm,
    marginTop: spacing.sm,
    color: colors.primary,
    fontWeight: '700',
  },
  a4Hint: { ...typography.bodySm, marginTop: spacing.sm },
  hint: { ...typography.bodySm, marginBottom: spacing.md },
  printerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  printerRowOn: { backgroundColor: colors.primaryLight, borderRadius: radius.sm },
  printerName: { ...typography.h3, fontSize: 15, flex: 1 },
  printerNameOn: { color: colors.primary },
  defaultTag: { ...typography.caption, color: colors.primary },
  refreshBtn: { marginTop: spacing.md, alignSelf: 'flex-start' },
  actions: { marginTop: spacing.xl, gap: spacing.sm, flexDirection: 'row' },
});
