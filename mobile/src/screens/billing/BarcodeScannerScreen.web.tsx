import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput as NativeTextInput, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { matchBarcodeProduct, searchProducts } from '../../services/catalogService';
import { useProductAddToCart } from '../../hooks/useProductAddToCart';
import { formatQuantity } from '../../utils/quantity';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'BarcodeScanner'>;

/**
 * Desktop: USB / Bluetooth-HID barcode scanners type the code followed by Enter,
 * so scanning is a focused text field instead of the camera.
 */
export default function BarcodeScannerScreen({ navigation }: Props) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<NativeTextInput>(null);
  const { requestScanAdd } = useProductAddToCart();

  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    refocus();
  }, [refocus]);

  const handleSubmit = useCallback(async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const results = await searchProducts(value);
      if (!results.length) {
        setNotice(null);
        setMessage(`No product for barcode: ${value}`);
        setCode('');
        refocus();
        return;
      }
      const product = matchBarcodeProduct(results, value) || results[0];
      requestScanAdd(product);
      const qty = product.scannedQuantity && product.scannedQuantity > 0 ? product.scannedQuantity : 1;
      setMessage(null);
      setNotice(`${product.productName} · +${formatQuantity(qty, product.uom)}`);
      setCode('');
      refocus();
    } catch {
      setMessage('Failed to look up product. Check your connection and try again.');
      refocus();
    } finally {
      setBusy(false);
    }
  }, [busy, code, refocus, requestScanAdd]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Icon name="barcode-scan" size={44} color={colors.primary} />
        </View>
        <Text style={styles.title}>Scan barcode</Text>
        <Text style={styles.sub}>
          Each scan adds the item to the bill automatically. Scan the next item, or close when done.
        </Text>

        <TextInput
          ref={inputRef}
          mode="outlined"
          label="Barcode"
          value={code}
          onChangeText={setCode}
          onSubmitEditing={handleSubmit}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
          right={<TextInput.Icon icon="keyboard-return" onPress={handleSubmit} />}
        />

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {message ? <Text style={styles.error}>{message}</Text> : null}

        <View style={styles.actions}>
          <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.btn}>
            Close
          </Button>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={busy}
            disabled={!code.trim() || busy}
            buttonColor={colors.primary}
            style={styles.btn}
          >
            Add to bill
          </Button>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    alignItems: 'center',
    padding: spacing.xxl,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconWrap: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { ...typography.h2, marginBottom: spacing.sm },
  sub: { ...typography.bodySm, textAlign: 'center', marginBottom: spacing.xl },
  input: { alignSelf: 'stretch', backgroundColor: colors.surface },
  notice: { color: colors.success, marginTop: spacing.md, textAlign: 'center', fontWeight: '700' },
  error: { color: colors.error, marginTop: spacing.md, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, alignSelf: 'stretch' },
  btn: { flex: 1 },
});
