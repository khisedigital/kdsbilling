import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { SearchProductResult } from '../../services/catalogService';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import { useT } from '../../i18n';
import { useLanguageStore } from '../../i18n/languageStore';
import { screenProductName } from '../../utils/productName';
import { formatQuantity, needsQuantityPrompt } from '../../utils/quantity';
import { variantLabel } from '../../utils/variantLabel';

type Props = {
  product: SearchProductResult;
  qtyInCart: number;
  width: number;
  onAdd: (product: SearchProductResult) => void;
  onIncrease: (variantId: string) => void;
  onDecrease: (variantId: string) => void;
  onEditQty: (product: SearchProductResult) => void;
  onEditProduct?: (product: SearchProductResult) => void;
};

function formatPrice(value: number) {
  return value % 1 === 0 ? String(value) : value.toFixed(2);
}

function ProductGridTile({
  product,
  qtyInCart,
  width,
  onAdd,
  onIncrease,
  onDecrease,
  onEditQty,
  onEditProduct,
}: Props) {
  const t = useT();
  useLanguageStore((s) => s.ui);
  const name = screenProductName(product.productName, product.productNameMr);
  const size = variantLabel(product.size, product.color);
  const outOfStock = (product.stockQty ?? 0) <= 0;
  const inCart = qtyInCart > 0;
  const weighed = needsQuantityPrompt(product);
  const qtyLabel = weighed
    ? formatQuantity(qtyInCart, product.uom)
    : qtyInCart % 1 === 0
      ? String(qtyInCart)
      : qtyInCart.toFixed(2);

  const fromBarcode = !!(product.scannedQuantity && product.scannedQuantity > 0);
  const canEditProduct = !!(onEditProduct && product.productId);

  const pressBody = () => {
    if (fromBarcode || !inCart) {
      onAdd(product);
      return;
    }
    if (weighed) onEditQty(product);
    else onIncrease(product.variantId);
  };

  return (
    <View style={[styles.tile, { width }, inCart && styles.tileInCart, outOfStock && !inCart && styles.tileOut]}>
      {canEditProduct ? (
        <Pressable
          onPress={() => onEditProduct?.(product)}
          style={styles.editBtn}
          hitSlop={6}
          accessibilityLabel={t('Edit {{name}}', { name })}>
          <Icon name="pencil" size={14} color={colors.primary} />
        </Pressable>
      ) : null}
      <Pressable
        onPress={pressBody}
        style={styles.body}
        accessibilityLabel={
          inCart
            ? t('Add more {{name}}', { name })
            : t('Add {{name}}', { name })
        }>
        <Text style={[styles.name, canEditProduct && styles.nameWithEdit]} numberOfLines={2}>
          {name}
        </Text>
        {size ? (
          <Text style={styles.variant} numberOfLines={1}>
            {size}
          </Text>
        ) : (
          <Text style={styles.variant} numberOfLines={1}>
            {outOfStock ? t('Out of stock') : product.uom?.code || ' '}
          </Text>
        )}
        <Text style={styles.price} numberOfLines={1}>
          ₹{formatPrice(Number(product.sellingPrice))}
        </Text>
      </Pressable>

      {inCart ? (
        weighed ? (
          <Pressable onPress={() => onEditQty(product)} style={styles.weightBar}>
            <Text style={styles.weightQty} numberOfLines={1}>{qtyLabel}</Text>
            <Text style={styles.weightHint}>{t('Edit')}</Text>
          </Pressable>
        ) : (
          <View style={styles.stepper}>
            <Pressable
              onPress={() => onDecrease(product.variantId)}
              style={styles.stepBtn}
              hitSlop={4}
              accessibilityLabel={t('Decrease')}>
              <Icon name="minus" size={16} color={colors.textOnPrimary} />
            </Pressable>
            <Text style={styles.stepQty} numberOfLines={1}>{qtyLabel}</Text>
            <Pressable
              onPress={() => (fromBarcode ? onAdd(product) : onIncrease(product.variantId))}
              style={styles.stepBtn}
              hitSlop={4}
              accessibilityLabel={fromBarcode ? t('Add scanned quantity') : t('Increase')}>
              <Icon name="plus" size={16} color={colors.textOnPrimary} />
            </Pressable>
          </View>
        )
      ) : (
        <Pressable
          onPress={() => onAdd(product)}
          style={styles.addBtn}
          accessibilityLabel={t('Add {{name}}', { name })}>
          <Icon name="plus" size={16} color={colors.textOnPrimary} />
          <Text style={styles.addText}>{t('Add')}</Text>
        </Pressable>
      )}
    </View>
  );
}

export default memo(ProductGridTile);

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tileInCart: {
    borderColor: colors.secondary,
    borderWidth: 1.5,
  },
  tileOut: { opacity: 0.7 },
  editBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  body: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    minHeight: 78,
  },
  name: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    lineHeight: 16,
    minHeight: 32,
  },
  nameWithEdit: {
    paddingRight: 22,
  },
  variant: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  price: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
    marginTop: spacing.xs,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.secondary,
    minHeight: 34,
  },
  addText: {
    fontSize: 13,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.secondary,
    minHeight: 34,
  },
  stepBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepQty: {
    flex: 1,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  weightBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.secondary,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  weightQty: {
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    color: colors.textOnPrimary,
  },
  weightHint: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textOnPrimary,
    opacity: 0.9,
  },
});
