import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput as NativeTextInput, View } from 'react-native';
import { Button, Text, TextInput } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { useT } from '../../i18n';
import { matchBarcodeProduct, searchProducts } from '../../services/catalogService';
import { useProductAddToCart } from '../../hooks/useProductAddToCart';
import { screenProductName } from '../../utils/productName';
import { formatQuantity } from '../../utils/quantity';
import { colors } from '../../theme/colors';
import { radius, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'BarcodeScanner'>;

function numericScan(value: string) {
  return value.replace(/\D/g, '').slice(0, 18);
}

/**
 * Desktop: USB / Bluetooth-HID barcode scanners type the code followed by Enter,
 * so scanning is a focused text field instead of the camera.
 */
export default function BarcodeScannerScreen({ navigation, route }: Props) {
  const t = useT();
  const purpose = route.params?.purpose || 'bill';
  const capture = purpose === 'capture';
  const productList = purpose === 'productList';
  const priceManagement = purpose === 'priceManagement';
  const [code, setCode] = useState('');
  const [lastMiss, setLastMiss] = useState('');
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

  const openAddWithBarcode = useCallback((raw: string) => {
    const digits = numericScan(raw);
    if (!digits) {
      setMessage(t('Scan a number barcode'));
      return false;
    }
    navigation.navigate('ProductForm', {
      ...(route.params?.productId ? { productId: route.params.productId } : {}),
      scannedBarcode: digits,
      scanTarget: route.params?.scanTarget || 'primary',
      scanNonce: Date.now(),
    }, { merge: true, pop: true });
    return true;
  }, [navigation, route.params?.productId, route.params?.scanTarget, t]);

  const handleSubmit = useCallback(async () => {
    const value = code.trim();
    if (!value || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (capture) {
        openAddWithBarcode(value);
        return;
      }

      const results = await searchProducts(value);
      const product = results.length
        ? (matchBarcodeProduct(results, value) || results[0])
        : null;

      if (productList) {
        if (product?.productId) {
          navigation.navigate('ProductDetail', { productId: product.productId }, { pop: true });
          return;
        }
        openAddWithBarcode(value);
        return;
      }

      if (priceManagement) {
        if (product?.productId) {
          navigation.navigate('PriceManagement', {
            scannedProductId: product.productId,
            scanNonce: Date.now(),
          }, { pop: true });
          return;
        }
        setNotice(null);
        setMessage(t('No product for barcode: {{code}}', { code: value }));
        setLastMiss(value);
        setCode('');
        refocus();
        return;
      }

      if (!product) {
        setNotice(null);
        setMessage(t('No product for barcode: {{code}}', { code: value }));
        setLastMiss(value);
        setCode('');
        refocus();
        return;
      }
      requestScanAdd(product);
      const qty = product.scannedQuantity && product.scannedQuantity > 0 ? product.scannedQuantity : 1;
      setMessage(null);
      setNotice(`${screenProductName(product.productName, product.productNameMr)} · +${formatQuantity(qty, product.uom)}`);
      setCode('');
      refocus();
    } catch {
      setMessage(t('Failed to look up product. Check your connection and try again.'));
      refocus();
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    capture,
    code,
    navigation,
    openAddWithBarcode,
    priceManagement,
    productList,
    refocus,
    requestScanAdd,
    t,
  ]);

  const subtitle = capture
    ? t('Point the camera at the product barcode')
    : productList
      ? t('Scan to find a product, or add a new one')
      : priceManagement
        ? t('Scan a barcode to edit price and stock')
        : t('Each scan adds the item to the bill automatically. Scan the next item, or close when done.');

  const primaryLabel = capture || productList
    ? (productList && !capture ? t('Find / add') : t('Use barcode'))
    : priceManagement
      ? t('Find product')
      : t('Add to bill');

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Icon name="barcode-scan" size={44} color={colors.primary} />
        </View>
        <Text style={styles.title}>{t('Scan barcode')}</Text>
        <Text style={styles.sub}>{subtitle}</Text>

        <AppTextInput
          ref={inputRef}
          mode="outlined"
          label={t('Barcode')}
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
        {message ? (
          <View style={styles.messageBlock}>
            <Text style={styles.error}>{message}</Text>
            {!capture && !productList && lastMiss ? (
              <Button mode="text" onPress={() => openAddWithBarcode(lastMiss)} compact>
                {t('Add product')}
              </Button>
            ) : null}
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button mode="outlined" onPress={() => navigation.goBack()} style={styles.btn}>
            {t('Close')}
          </Button>
          <Button
            mode="contained"
            onPress={handleSubmit}
            loading={busy}
            disabled={!code.trim() || busy}
            buttonColor={colors.primary}
            style={styles.btn}
          >
            {primaryLabel}
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
  messageBlock: { marginTop: spacing.md, alignItems: 'center', gap: spacing.xs },
  error: { color: colors.error, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, alignSelf: 'stretch' },
  btn: { flex: 1 },
});
