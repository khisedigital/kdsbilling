import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { Camera, useCameraDevice, useCameraPermission, useCodeScanner } from 'react-native-vision-camera';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { matchBarcodeProduct, searchProducts } from '../../services/catalogService';
import { useProductAddToCart } from '../../hooks/useProductAddToCart';
import { formatQuantity } from '../../utils/quantity';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'BarcodeScanner'>;

export default function BarcodeScannerScreen({ navigation }: Props) {
  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [active, setActive] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const scannedRef = useRef<{ code: string; at: number } | null>(null);
  const busyRef = useRef(false);
  const { requestScanAdd } = useProductAddToCart();

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const handleBarcode = useCallback(async (code: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setActive(false);

    try {
      const results = await searchProducts(code);
      if (!results.length) {
        Alert.alert('Not found', `No product for barcode: ${code}`, [
          { text: 'Retry', onPress: () => { busyRef.current = false; setActive(true); } },
          { text: 'Close', onPress: () => navigation.goBack() },
        ]);
        return;
      }
      const p = matchBarcodeProduct(results, code) || results[0];
      requestScanAdd(p);
      const qty = p.scannedQuantity && p.scannedQuantity > 0 ? p.scannedQuantity : 1;
      setNotice(`${p.productName} · +${formatQuantity(qty, p.uom)}`);
      scannedRef.current = { code, at: Date.now() };
      busyRef.current = false;
      setActive(true);
    } catch {
      Alert.alert('Error', 'Failed to lookup product', [
        { text: 'OK', onPress: () => { busyRef.current = false; setActive(true); } },
      ]);
    }
  }, [navigation, requestScanAdd]);

  const codeScanner = useCodeScanner({
    codeTypes: ['ean-13', 'ean-8', 'code-128', 'code-39', 'qr', 'upc-a', 'upc-e'],
    onCodeScanned: (codes) => {
      const value = codes[0]?.value;
      if (!value) return;
      const now = Date.now();
      const prev = scannedRef.current;
      if (prev?.code === value && now - prev.at < 900) {
        scannedRef.current = { code: value, at: now };
        return;
      }
      scannedRef.current = { code: value, at: now };
      handleBarcode(value);
    },
  });

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <View style={styles.permIcon}>
          <Icon name="camera-off" size={40} color={colors.primary} />
        </View>
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>Allow camera to scan product barcodes</Text>
        <Button mode="contained" onPress={requestPermission} style={styles.btn} buttonColor={colors.primary}>
          Grant Permission
        </Button>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Icon name="camera-off" size={40} color={colors.textMuted} />
        <Text style={styles.permTitle}>No camera found</Text>
        <Button onPress={() => navigation.goBack()}>Go Back</Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive={active} codeScanner={codeScanner} />
      <View style={styles.dimTop} />
      <View style={styles.dimMiddle}>
        <View style={styles.dimSide} />
        <View style={styles.scanFrame}>
          <View style={[styles.corner, styles.cornerTL]} />
          <View style={[styles.corner, styles.cornerTR]} />
          <View style={[styles.corner, styles.cornerBL]} />
          <View style={[styles.corner, styles.cornerBR]} />
        </View>
        <View style={styles.dimSide} />
      </View>
      <View style={styles.dimBottom} />
      <View style={styles.overlay}>
        <View style={styles.hintBox}>
          <Icon name="barcode-scan" size={20} color="#fff" />
          <Text style={styles.hint} numberOfLines={2}>
            {notice || 'Scan adds the item to the bill'}
          </Text>
        </View>
        <Button mode="contained" onPress={() => navigation.goBack()} style={styles.btn} buttonColor={colors.primary}>
          Done
        </Button>
      </View>
    </View>
  );
}

const FRAME = 260;
const CORNER = 24;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xxl, backgroundColor: colors.background },
  permIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  permTitle: { ...typography.h2, marginBottom: spacing.sm },
  permSub: { ...typography.bodySm, textAlign: 'center', marginBottom: spacing.xl },
  dimTop: { flex: 1, backgroundColor: colors.overlay },
  dimMiddle: { flexDirection: 'row', height: FRAME },
  dimSide: { flex: 1, backgroundColor: colors.overlay },
  dimBottom: { flex: 1, backgroundColor: colors.overlay },
  scanFrame: { width: FRAME, height: FRAME, position: 'relative' },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.primary },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: radius.sm },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: radius.sm },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: radius.sm },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: radius.sm },
  overlay: { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center', paddingHorizontal: spacing.xl },
  hintBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    marginBottom: spacing.lg,
  },
  hint: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btn: { minWidth: 160 },
});
