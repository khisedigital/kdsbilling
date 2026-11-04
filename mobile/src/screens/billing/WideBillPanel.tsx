import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { printDraftReceipt } from '../../print/receiptPrinter';
import {
  createBill,
  createCustomer,
  deleteHeldBill,
  fetchCustomers,
  holdBill,
  previewBill,
  type BillDetail,
} from '../../services/businessService';
import { useCartStore, type CartItem } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';
import { apiError } from '../../utils/apiError';
import { variantLabel } from '../../utils/variantLabel';

type DiscountMode = 'amount' | 'percent';
type PanelView = 'bill' | 'customer' | 'hold';

type CustomerRow = {
  id: string;
  name: string;
  phone?: string;
};

type BillPreview = {
  items: Array<{
    variantId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    discountAmount?: number;
  }>;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  exactTotal?: number;
  totalAmount: number;
};

const PAYMENT_MODES = [
  { id: 'cash', label: 'Cash', icon: 'cash' },
  { id: 'upi', label: 'UPI', icon: 'qrcode-scan' },
  { id: 'card', label: 'Card', icon: 'credit-card-outline' },
  { id: 'credit', label: 'Credit', icon: 'account-clock-outline' },
  { id: 'store_credit', label: 'Wallet', icon: 'wallet-outline' },
] as const;

function round2(n: number) {
  return Math.round(Number(n) * 100) / 100;
}

function nearestRupee(amount: number) {
  return Math.round(amount);
}

function cartQtyStep(uomCode?: string) {
  const code = (uomCode || '').toLowerCase();
  if (code === 'g' || code === 'ml') return 50;
  return 1;
}

function money(n: number) {
  return `₹${round2(n).toFixed(2)}`;
}

export default function WideBillPanel() {
  const items = useCartStore((s) => s.items);
  const updateQty = useCartStore((s) => s.updateQty);
  const updatePrice = useCartStore((s) => s.updatePrice);
  const removeItem = useCartStore((s) => s.removeItem);
  const clearCart = useCartStore((s) => s.clear);
  const customerId = useCartStore((s) => s.customerId);
  const customerName = useCartStore((s) => s.customerName);
  const setCustomer = useCartStore((s) => s.setCustomer);
  const billDiscountAmount = useCartStore((s) => s.billDiscountAmount);
  const billDiscountPercent = useCartStore((s) => s.billDiscountPercent);
  const setBillDiscount = useCartStore((s) => s.setBillDiscount);
  const offerId = useCartStore((s) => s.offerId);

  const [view, setView] = useState<PanelView>('bill');
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [exactTotal, setExactTotal] = useState(0);
  const [roundOffAmount, setRoundOffAmount] = useState(0);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [payMode, setPayMode] = useState<string>('cash');
  const [payAmount, setPayAmount] = useState('');
  const [splitExtra, setSplitExtra] = useState<{ mode: string; amount: string }[]>([]);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountMode, setDiscountMode] = useState<DiscountMode>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [discountError, setDiscountError] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [holding, setHolding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState('');
  /** Inline qty drafts so typing is not wiped / does not remove the line at 0. */
  const [qtyDrafts, setQtyDrafts] = useState<Record<string, string>>({});
  /** Inline rate drafts so preview is not recalculated on every keystroke. */
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const requestId = useRef(0);
  const splitExtraRef = useRef(splitExtra);
  splitExtraRef.current = splitExtra;

  const totalDue = round2(exactTotal + roundOffAmount);
  const nearestTarget = nearestRupee(exactTotal);
  const suggestedOff = round2(nearestTarget - exactTotal);
  const canRound = exactTotal > 0 && Math.abs(suggestedOff) >= 0.01;
  const isRounded = Math.abs(roundOffAmount) >= 0.01;
  const isSplit = splitExtra.length > 0;
  const hasItems = items.length > 0;
  const hasBillDiscount = billDiscountPercent > 0 || billDiscountAmount > 0;

  const payments = useMemo(
    () => [{ mode: payMode, amount: payAmount }, ...splitExtra],
    [payMode, payAmount, splitExtra],
  );
  const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const balance = Math.max(0, totalDue - totalPaid);
  const change = Math.max(0, totalPaid - totalDue);
  const discountApplied = round2(preview?.discountAmount ?? 0);

  const syncPrimaryAmount = useCallback((due: number, extras = splitExtraRef.current) => {
    const other = extras.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    setPayAmount(round2(Math.max(0, due - other)).toFixed(2));
  }, []);

  const defaultSplitMode = (main: string) =>
    PAYMENT_MODES.find((m) => m.id !== main)?.id || 'upi';

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 2800);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!confirmClear) return;
    const timer = setTimeout(() => setConfirmClear(false), 2500);
    return () => clearTimeout(timer);
  }, [confirmClear]);

  useEffect(() => {
    if (hasItems) return;
    setView('bill');
    setDiscountOpen(false);
    setSplitExtra([]);
    setRoundOffAmount(0);
    setExactTotal(0);
    setPreview(null);
    setPayAmount('');
    setError('');
  }, [hasItems]);

  const loadPreview = useCallback(async () => {
    if (!items.length) {
      setPreview(null);
      setExactTotal(0);
      setRoundOffAmount(0);
      setLoadingPreview(false);
      return;
    }
    const id = ++requestId.current;
    setLoadingPreview(true);
    setError('');
    try {
      const result = (await previewBill({
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          discountPercent: item.discountPercent,
          isCustom: item.isCustom === true,
          productName: item.productName,
        })),
        billDiscountAmount,
        billDiscountPercent,
        offerId,
        roundOffAmount: 0,
      })) as BillPreview;
      if (id !== requestId.current) return;
      const exact = round2(Number(result.exactTotal ?? result.totalAmount ?? 0));
      setPreview(result);
      setExactTotal(exact);
      setRoundOffAmount(0);
      syncPrimaryAmount(exact, []);
      setSplitExtra([]);
    } catch (err) {
      if (id !== requestId.current) return;
      setPreview(null);
      setError(apiError(err, 'Could not load bill totals'));
    } finally {
      if (id === requestId.current) setLoadingPreview(false);
    }
  }, [items, billDiscountAmount, billDiscountPercent, offerId, syncPrimaryAmount]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (view !== 'customer') return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      setCustomerLoading(true);
      setCustomerError('');
      try {
        const result = await fetchCustomers(customerQuery.trim() || undefined);
        if (!cancelled) setCustomers(result?.items || []);
      } catch (err) {
        if (!cancelled) {
          setCustomers([]);
          setCustomerError(apiError(err, 'Could not load customers'));
        }
      } finally {
        if (!cancelled) setCustomerLoading(false);
      }
    }, customerQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [view, customerQuery]);

  const formatCartQty = (item: CartItem) => {
    const qty = item.quantity;
    if (!item.allowDecimalQty) {
      return qty % 1 === 0 ? String(qty) : qty.toFixed(2);
    }
    // Plain number for the inline input (no "kg"/"g" suffix).
    if (Number.isInteger(qty)) return String(qty);
    return String(Math.round(qty * 1000) / 1000);
  };

  const clearQtyDraft = (variantId: string) => {
    setQtyDrafts((prev) => {
      if (!(variantId in prev)) return prev;
      const next = { ...prev };
      delete next[variantId];
      return next;
    });
  };

  const stepQty = (item: CartItem, direction: 1 | -1) => {
    clearQtyDraft(item.variantId);
    const step = item.allowDecimalQty ? cartQtyStep(item.uom?.code) : 1;
    const next = Math.round((item.quantity + direction * step) * 1000) / 1000;
    updateQty(item.variantId, next);
  };

  const commitInlineQty = (item: CartItem, raw: string) => {
    const cleaned = raw.trim().replace(',', '.');
    const parsed = parseFloat(cleaned);
    if (!cleaned || Number.isNaN(parsed) || parsed <= 0) {
      clearQtyDraft(item.variantId);
      return;
    }
    const next = item.allowDecimalQty
      ? Math.round(parsed * 1000) / 1000
      : Math.max(1, Math.round(parsed));
    updateQty(item.variantId, next);
    clearQtyDraft(item.variantId);
  };

  // Draft only while typing — commit on blur so preview/split/round-off are not reset every keystroke.
  const onInlineQtyChange = (item: CartItem, value: string) => {
    const sanitized = item.allowDecimalQty
      ? value.replace(/[^0-9.,]/g, '')
      : value.replace(/[^0-9]/g, '');
    setQtyDrafts((prev) => ({ ...prev, [item.variantId]: sanitized }));
  };

  const clearPriceDraft = (variantId: string) => {
    setPriceDrafts((prev) => {
      if (!(variantId in prev)) return prev;
      const next = { ...prev };
      delete next[variantId];
      return next;
    });
  };

  const commitInlinePrice = (item: CartItem, raw: string) => {
    const cleaned = raw.trim().replace(',', '.');
    const parsed = parseFloat(cleaned);
    if (!cleaned || Number.isNaN(parsed) || parsed < 0) {
      clearPriceDraft(item.variantId);
      return;
    }
    updatePrice(item.variantId, parsed);
    clearPriceDraft(item.variantId);
  };

  const onInlinePriceChange = (item: CartItem, value: string) => {
    setPriceDrafts((prev) => ({ ...prev, [item.variantId]: value.replace(/[^0-9.,]/g, '') }));
  };

  const applyDiscount = () => {
    const raw = discountInput.trim().replace(',', '.');
    if (!raw) {
      setBillDiscount(0, 0);
      setDiscountError('');
      setDiscountOpen(false);
      return;
    }
    const value = parseFloat(raw);
    if (Number.isNaN(value) || value < 0) {
      setDiscountError('Enter a valid number');
      return;
    }
    if (discountMode === 'percent') {
      if (value > 100) {
        setDiscountError('Percent cannot exceed 100');
        return;
      }
      setBillDiscount(0, Math.round(value * 100) / 100);
    } else {
      setBillDiscount(Math.round(value * 100) / 100, 0);
    }
    setDiscountError('');
    setDiscountOpen(false);
  };

  const openDiscount = () => {
    if (billDiscountPercent > 0) {
      setDiscountMode('percent');
      setDiscountInput(String(billDiscountPercent));
    } else if (billDiscountAmount > 0) {
      setDiscountMode('amount');
      setDiscountInput(String(billDiscountAmount));
    } else {
      setDiscountMode('amount');
      setDiscountInput('');
    }
    setDiscountError('');
    setDiscountOpen(true);
    setView('bill');
  };

  const onRoundPress = () => {
    setError('');
    if (isRounded) {
      setRoundOffAmount(0);
      syncPrimaryAmount(exactTotal);
      return;
    }
    if (!canRound) return;
    const nextDue = round2(exactTotal + suggestedOff);
    setRoundOffAmount(suggestedOff);
    syncPrimaryAmount(nextDue);
  };

  const openSplit = () => {
    const next = [{ mode: defaultSplitMode(payMode), amount: '' }];
    setSplitExtra(next);
    syncPrimaryAmount(totalDue, next);
  };

  const clearSplit = () => {
    setSplitExtra([]);
    syncPrimaryAmount(totalDue, []);
  };

  const updateSplitAmount = (idx: number, value: string) => {
    setSplitExtra((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], amount: value };
      syncPrimaryAmount(totalDue, next);
      return next;
    });
  };

  const updateSplitMode = (idx: number, mode: string) => {
    setSplitExtra((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], mode };
      return next;
    });
  };

  const clearBill = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    clearCart();
    setConfirmClear(false);
    setNotice('Bill cleared');
  };

  const selectCustomer = (customer: CustomerRow) => {
    setCustomer(customer.id, customer.name);
    setView('bill');
    setNewCustomerOpen(false);
  };

  const saveNewCustomer = async () => {
    if (!newName.trim()) {
      setCustomerError('Name is required');
      return;
    }
    setSavingCustomer(true);
    setCustomerError('');
    try {
      const created = await createCustomer({
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
      });
      if (created?.id) setCustomer(created.id, created.name || newName.trim());
      setNewName('');
      setNewPhone('');
      setNewCustomerOpen(false);
      setView('bill');
    } catch (err) {
      setCustomerError(apiError(err, 'Could not add customer'));
    } finally {
      setSavingCustomer(false);
    }
  };

  const submitHold = async () => {
    if (!items.length || holding) return;
    setHolding(true);
    setError('');
    try {
      await holdBill(
        holdName.trim() || `Hold ${new Date().toLocaleTimeString()}`,
        {
          items,
          customerId,
          customerName,
          billDiscountAmount,
          billDiscountPercent,
          offerId,
        },
        customerId || undefined,
      );
      clearCart();
      setHoldName('');
      setView('bill');
      setNotice('Bill held. Resume it from Held bills.');
    } catch (err) {
      setError(apiError(err, 'Could not hold bill'));
    } finally {
      setHolding(false);
    }
  };

  const buildDraftBill = (): BillDetail | null => {
    if (!preview) return null;
    const paidRows = payments
      .filter((p) => parseFloat(p.amount) > 0)
      .map((p, idx) => ({
        id: `pay-${idx}`,
        payment_mode: p.mode,
        amount: parseFloat(p.amount),
      }));
    const paid = paidRows.reduce((sum, p) => sum + Number(p.amount), 0);
    return {
      id: 'draft',
      bill_number: 'DRAFT',
      status: 'draft',
      subtotal: preview.subtotal,
      discount_amount: preview.discountAmount,
      tax_amount: preview.taxAmount,
      round_off_amount: roundOffAmount,
      total_amount: totalDue,
      paid_amount: paid,
      change_amount: Math.max(0, paid - totalDue),
      created_at: new Date().toISOString(),
      customer: customerId
        ? { id: customerId, name: customerName || 'Customer' }
        : customerName
          ? { id: '', name: customerName }
          : null,
      items: preview.items.map((line, idx) => ({
        id: `item-${idx}`,
        product_name: line.productName,
        sku: '',
        variant_id: line.variantId,
        quantity: line.quantity,
        unit_price: line.unitPrice,
        discount_amount: line.discountAmount || 0,
        line_total: line.lineTotal,
      })),
      payments: paidRows,
    };
  };

  const handlePrint = async () => {
    setError('');
    const draft = buildDraftBill();
    if (!draft) {
      setError('Bill not ready to print');
      return;
    }
    setPrinting(true);
    try {
      await printDraftReceipt(draft);
    } catch (err) {
      Alert.alert('Print failed', apiError(err, 'Could not print receipt.'));
    } finally {
      setPrinting(false);
    }
  };

  const handlePay = async () => {
    setError('');
    if (!preview) {
      setError('Bill not ready');
      return;
    }
    const needsCustomer = payments.some(
      (p) => parseFloat(p.amount) > 0 && (p.mode === 'credit' || p.mode === 'store_credit'),
    );
    if (needsCustomer && !customerId) {
      setError('Select a customer for credit or wallet');
      setView('customer');
      return;
    }
    if (totalPaid < totalDue - 0.01) {
      setError(`Need ${money(balance)} more`);
      return;
    }
    setSaving(true);
    try {
      await createBill({
        customerId,
        items: items.map((item) => ({
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountAmount: item.discountAmount,
          discountPercent: item.discountPercent,
          isCustom: item.isCustom === true,
          productName: item.productName,
        })),
        billDiscountAmount,
        billDiscountPercent,
        offerId,
        roundOffAmount,
        heldBillId: useCartStore.getState().resumedHeldId || undefined,
        payments: (payments.some((p) => parseFloat(p.amount) > 0)
          ? payments.filter((p) => parseFloat(p.amount) > 0)
          : [{ mode: payMode, amount: '0' }]
        ).map((p) => ({ mode: p.mode, amount: parseFloat(p.amount) })),
      });
      const heldId = useCartStore.getState().resumedHeldId;
      if (heldId) {
        try {
          await deleteHeldBill(heldId);
        } catch {
          // The sale is already saved. A newer server removes the hold during checkout.
        }
      }
      clearCart();
      setNotice(change > 0.01 ? `Sale saved · return ${money(change)}` : 'Sale saved');
    } catch (err) {
      setError(apiError(err, 'Payment failed'));
    } finally {
      setSaving(false);
    }
  };

  const renderLine = ({ item }: { item: CartItem }) => {
    const size = variantLabel(item.size, item.color);
    const qtyValue =
      qtyDrafts[item.variantId] !== undefined
        ? qtyDrafts[item.variantId]
        : formatCartQty(item);
    const priceValue =
      priceDrafts[item.variantId] !== undefined
        ? priceDrafts[item.variantId]
        : round2(item.unitPrice).toFixed(2);
    return (
      <View style={styles.tableRow}>
        <View style={styles.colProduct}>
          <Text style={styles.lineName} numberOfLines={2}>
            {item.productName}
            {item.isCustom ? ' · Custom' : size ? ` · ${size}` : ''}
          </Text>
          {item.uom?.code ? <Text style={styles.lineMeta}>{item.uom.code}</Text> : null}
        </View>
        <View style={styles.rateCell}>
          <Text style={styles.ratePrefix}>₹</Text>
          <TextInput
            value={priceValue}
            onChangeText={(value) => onInlinePriceChange(item, value)}
            onBlur={() => commitInlinePrice(item, priceValue)}
            onSubmitEditing={() => commitInlinePrice(item, priceValue)}
            keyboardType="decimal-pad"
            selectTextOnFocus
            style={styles.rateInput}
            accessibilityLabel={`Price for ${item.productName}`}
          />
        </View>
        <View style={styles.colQty}>
          <View style={styles.qtyInline}>
            <Pressable
              onPress={() => stepQty(item, -1)}
              hitSlop={6}
              style={styles.qtyBtn}
              accessibilityLabel={`Decrease ${item.productName}`}>
              <Icon name="minus" size={16} color={colors.primary} />
            </Pressable>
            <TextInput
              value={qtyValue}
              onChangeText={(value) => onInlineQtyChange(item, value)}
              onBlur={() => commitInlineQty(item, qtyValue)}
              onSubmitEditing={() => commitInlineQty(item, qtyValue)}
              keyboardType={item.allowDecimalQty ? 'decimal-pad' : 'number-pad'}
              selectTextOnFocus
              style={styles.qtyInput}
              accessibilityLabel={`Quantity for ${item.productName}`}
            />
            <Pressable
              onPress={() => stepQty(item, 1)}
              hitSlop={6}
              style={styles.qtyBtn}
              accessibilityLabel={`Increase ${item.productName}`}>
              <Icon name="plus" size={16} color={colors.primary} />
            </Pressable>
          </View>
        </View>
        <Text style={styles.colAmount}>{money(item.unitPrice * item.quantity)}</Text>
        <Pressable
          onPress={() => {
            clearQtyDraft(item.variantId);
            clearPriceDraft(item.variantId);
            removeItem(item.variantId);
          }}
          hitSlop={8}
          style={styles.removeBtn}
          accessibilityLabel={`Remove ${item.productName}`}>
          <Icon name="close" size={16} color={colors.textMuted} />
        </Pressable>
      </View>
    );
  };

  const discountLabel = billDiscountPercent > 0
    ? `${billDiscountPercent}% off`
    : billDiscountAmount > 0
      ? `${money(billDiscountAmount)} off`
      : 'Discount';

  return (
    <View style={styles.pane}>
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.headTitle} numberOfLines={1}>
            {customerName || 'Walk-in'}
          </Text>
          <Text style={styles.headCount}>
            {items.length} {items.length === 1 ? 'item' : 'items'}
            {hasBillDiscount ? ` · ${discountLabel}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={openDiscount}
          disabled={!hasItems || view !== 'bill'}
          hitSlop={6}
          style={[
            styles.headIconBtn,
            (discountOpen || hasBillDiscount) && styles.headIconBtnOn,
            (!hasItems || view !== 'bill') && styles.actionOff,
          ]}
          accessibilityLabel={discountLabel}>
          <Icon name="percent" size={16} color={hasBillDiscount ? colors.secondary : colors.primary} />
        </Pressable>
        <Pressable
          onPress={clearBill}
          disabled={!hasItems}
          hitSlop={6}
          style={[styles.headIconBtn, confirmClear && styles.headIconBtnDanger, !hasItems && styles.actionOff]}
          accessibilityLabel={confirmClear ? 'Confirm clear' : 'Clear bill'}>
          <Icon name="trash-can-outline" size={16} color={confirmClear ? colors.error : colors.textMuted} />
        </Pressable>
      </View>

      {notice ? (
        <View style={styles.notice}>
          <Icon name="check-circle-outline" size={14} color={colors.success} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <View style={styles.tabRow}>
        <Pressable
          onPress={() => {
            setError('');
            setView('bill');
          }}
          style={[styles.tab, view === 'bill' && styles.tabOn]}>
          <Icon
            name="cart-outline"
            size={15}
            color={view === 'bill' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabText, view === 'bill' && styles.tabTextOn]}>Items</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setError('');
            setView('customer');
          }}
          style={[styles.tab, view === 'customer' && styles.tabOn]}>
          <Icon
            name={customerId ? 'account-check' : 'account-outline'}
            size={15}
            color={view === 'customer' || customerId ? colors.primary : colors.textMuted}
          />
          <Text
            style={[styles.tabText, (view === 'customer' || !!customerId) && styles.tabTextOn]}
            numberOfLines={1}>
            {customerName || 'Customer'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            if (!hasItems) return;
            setError('');
            setView('hold');
          }}
          disabled={!hasItems}
          style={[styles.tab, view === 'hold' && styles.tabOn, !hasItems && styles.actionOff]}>
          <Icon
            name="pause-circle-outline"
            size={15}
            color={view === 'hold' ? colors.primary : colors.textMuted}
          />
          <Text style={[styles.tabText, view === 'hold' && styles.tabTextOn]}>Hold</Text>
        </Pressable>
      </View>

      {view === 'customer' ? (
        <View style={styles.subView}>
          <View style={styles.searchBox}>
            <Icon name="magnify" size={18} color={colors.textMuted} />
            <TextInput
              value={customerQuery}
              onChangeText={setCustomerQuery}
              placeholder="Search name or phone"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              autoCorrect={false}
            />
          </View>
          <Pressable
            onPress={() => {
              setCustomer(null, null);
              setView('bill');
            }}
            style={styles.walkIn}>
            <Icon name="account-outline" size={18} color={colors.primary} />
            <Text style={styles.walkInText}>Use walk-in customer</Text>
          </Pressable>
          {customerLoading ? (
            <ActivityIndicator color={colors.primary} style={styles.subSpinner} />
          ) : (
            <FlatList
              data={customers}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              style={styles.fill}
              contentContainerStyle={styles.customerListContent}
              ListEmptyComponent={
                <Text style={styles.emptyHint}>
                  {customerError || 'No customers found'}
                </Text>
              }
              renderItem={({ item }) => {
                const selected = item.id === customerId;
                return (
                  <Pressable
                    onPress={() => selectCustomer(item)}
                    style={[styles.customerRow, selected && styles.customerRowOn]}>
                    <Icon
                      name={selected ? 'account-check' : 'account-circle-outline'}
                      size={20}
                      color={selected ? colors.primary : colors.textMuted}
                    />
                    <View style={styles.fill}>
                      <Text style={styles.customerName} numberOfLines={1}>{item.name}</Text>
                      {item.phone ? <Text style={styles.lineMeta}>{item.phone}</Text> : null}
                    </View>
                  </Pressable>
                );
              }}
            />
          )}
          {newCustomerOpen ? (
            <View style={styles.inlineForm}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Customer name"
                placeholderTextColor={colors.textMuted}
                style={styles.field}
              />
              <TextInput
                value={newPhone}
                onChangeText={setNewPhone}
                placeholder="Phone (optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="phone-pad"
                style={styles.field}
              />
              {customerError ? <Text style={styles.errorText}>{customerError}</Text> : null}
              <View style={styles.inlineFormActions}>
                <Pressable
                  onPress={() => {
                    setNewCustomerOpen(false);
                    setCustomerError('');
                  }}
                  style={styles.secondaryBtn}>
                  <Text style={styles.secondaryBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={saveNewCustomer}
                  disabled={savingCustomer}
                  style={[styles.primaryBtn, styles.inlinePrimary, savingCustomer && styles.disabled]}>
                  <Text style={styles.primaryBtnText}>{savingCustomer ? 'Saving…' : 'Save customer'}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable
              onPress={() => {
                setCustomerError('');
                setNewCustomerOpen(true);
              }}
              style={styles.addCustomerFab}
              accessibilityLabel="Add customer">
              <Icon name="plus" size={26} color={colors.textOnPrimary} />
            </Pressable>
          )}
        </View>
      ) : view === 'hold' ? (
        <View style={styles.subView}>
          <Text style={styles.formTitle}>Hold this bill</Text>
          <Text style={styles.formHint}>
            Save {items.length} {items.length === 1 ? 'item' : 'items'} and start a fresh bill. Resume it from Held bills.
          </Text>
          <TextInput
            value={holdName}
            onChangeText={setHoldName}
            placeholder="Name, e.g. Table 3"
            placeholderTextColor={colors.textMuted}
            style={styles.field}
          />
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          <Pressable
            onPress={submitHold}
            disabled={holding || !hasItems}
            style={[styles.primaryBtn, (holding || !hasItems) && styles.disabled]}>
            {holding ? <ActivityIndicator color={colors.textOnPrimary} /> : <Text style={styles.primaryBtnText}>Hold bill</Text>}
          </Pressable>
        </View>
      ) : (
        <>
          {discountOpen ? (
            <View style={styles.discountBox}>
              <View style={styles.modeRow}>
                <Pressable
                  onPress={() => {
                    setDiscountMode('amount');
                    setDiscountError('');
                  }}
                  style={[styles.modeBtn, discountMode === 'amount' && styles.modeBtnOn]}>
                  <Text style={[styles.modeText, discountMode === 'amount' && styles.modeTextOn]}>₹ Amount</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setDiscountMode('percent');
                    setDiscountError('');
                  }}
                  style={[styles.modeBtn, discountMode === 'percent' && styles.modeBtnOn]}>
                  <Text style={[styles.modeText, discountMode === 'percent' && styles.modeTextOn]}>% Percent</Text>
                </Pressable>
              </View>
              <TextInput
                value={discountInput}
                onChangeText={(value) => {
                  setDiscountInput(value);
                  setDiscountError('');
                }}
                placeholder={discountMode === 'percent' ? 'Discount %' : 'Discount ₹'}
                placeholderTextColor={colors.textMuted}
                keyboardType="decimal-pad"
                style={styles.field}
              />
              {discountError ? <Text style={styles.errorText}>{discountError}</Text> : null}
              <View style={styles.discountActions}>
                <Pressable
                  onPress={() => {
                    setBillDiscount(0, 0);
                    setDiscountInput('');
                    setDiscountOpen(false);
                  }}
                  disabled={!hasBillDiscount && !discountInput}>
                  <Text style={styles.dangerText}>Remove</Text>
                </Pressable>
                <View style={styles.discountRight}>
                  <Pressable onPress={() => setDiscountOpen(false)}>
                    <Text style={styles.linkText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={applyDiscount} style={styles.smallPrimary}>
                    <Text style={styles.smallPrimaryText}>Apply</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          ) : null}

          {hasItems ? (
            <View style={styles.fill}>
              <View style={styles.tableHeader}>
                <Text style={[styles.th, styles.colProduct]}>Product</Text>
                <Text style={[styles.th, styles.colRateHead]}>Rate</Text>
                <Text style={[styles.th, styles.colQtyHead]}>Qty</Text>
                <Text style={[styles.th, styles.colAmountHead]}>Amount</Text>
                <View style={styles.thRemove} />
              </View>
              <FlatList
                data={items}
                keyExtractor={(item) => item.variantId}
                renderItem={renderLine}
                style={styles.fill}
                contentContainerStyle={styles.listContent}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          ) : (
            <View style={styles.empty}>
              <Icon name="cart-outline" size={36} color={colors.primary} />
              <Text style={styles.emptyTitle}>No items yet</Text>
              <Text style={styles.emptyHint}>
                Tap a product on the left to add it here. Edit quantity in the Qty column, then take payment.
              </Text>
            </View>
          )}

          {hasItems ? (
            <View style={styles.footer}>
              <View style={styles.totalBlock}>
                <View style={styles.sumRow}>
                  <Text style={styles.sumLbl}>Subtotal</Text>
                  <Text style={styles.sumVal}>{money(Number(preview?.subtotal) || items.reduce((s, i) => s + i.unitPrice * i.quantity, 0))}</Text>
                </View>
                {Number(preview?.taxAmount) > 0 ? (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLbl}>Tax</Text>
                    <Text style={styles.sumVal}>{money(Number(preview?.taxAmount))}</Text>
                  </View>
                ) : null}
                {discountApplied > 0 ? (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLbl}>Discount</Text>
                    <Text style={styles.discVal}>−{money(discountApplied)}</Text>
                  </View>
                ) : null}
                {isRounded ? (
                  <View style={styles.sumRow}>
                    <Text style={styles.sumLbl}>Round off</Text>
                    <Text style={styles.sumVal}>
                      {roundOffAmount > 0 ? '+' : '−'}{money(Math.abs(roundOffAmount))}
                    </Text>
                  </View>
                ) : null}
                <View style={styles.dueRow}>
                  <View>
                    <Text style={styles.dueLbl}>Amount due</Text>
                    {loadingPreview ? <Text style={styles.lineMeta}>Updating…</Text> : null}
                  </View>
                  <Text style={styles.dueAmt}>{money(totalDue || Number(preview?.totalAmount) || 0)}</Text>
                </View>
              </View>

              <ScrollView
                style={styles.payScroll}
                contentContainerStyle={styles.payScrollContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled>
                <Text style={styles.sectionLbl}>Pay with</Text>
                <View style={styles.payModes}>
                  {PAYMENT_MODES.map((mode) => {
                    const on = payMode === mode.id;
                    return (
                      <Pressable
                        key={mode.id}
                        onPress={() => {
                          setPayMode(mode.id);
                          setSplitExtra((prev) =>
                            prev.map((p) => (p.mode === mode.id ? { ...p, mode: defaultSplitMode(mode.id) } : p)),
                          );
                        }}
                        style={[styles.payMode, on && styles.payModeOn]}>
                        <Icon name={mode.icon} size={16} color={on ? colors.primary : colors.textMuted} />
                        <Text style={[styles.payModeText, on && styles.payModeTextOn]}>{mode.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <View style={styles.amountRow}>
                  <View style={styles.amountBox}>
                    <Text style={styles.rupee}>₹</Text>
                    <TextInput
                      value={payAmount}
                      onChangeText={setPayAmount}
                      keyboardType="decimal-pad"
                      placeholder="0.00"
                      placeholderTextColor={colors.textMuted}
                      style={styles.amountInput}
                    />
                  </View>
                  <Pressable
                    onPress={onRoundPress}
                    disabled={!canRound && !isRounded}
                    style={[styles.roundBtn, isRounded && styles.roundBtnOn, !canRound && !isRounded && styles.disabled]}>
                    <Text style={[styles.roundText, isRounded && styles.roundTextOn]}>
                      {isRounded ? 'Undo round' : canRound ? `Round ${money(nearestTarget)}` : 'Exact'}
                    </Text>
                  </Pressable>
                </View>

                {!isSplit ? (
                  <Pressable onPress={openSplit} style={styles.linkRow}>
                    <Icon name="call-split" size={16} color={colors.primary} />
                    <Text style={styles.linkText}>Split payment</Text>
                  </Pressable>
                ) : (
                  <View style={styles.splitBox}>
                    <View style={styles.splitHead}>
                      <Text style={styles.splitTitle}>Also paying with</Text>
                      <Pressable onPress={clearSplit}>
                        <Text style={styles.linkText}>Remove</Text>
                      </Pressable>
                    </View>
                    {splitExtra.map((part, idx) => (
                      <View key={`${part.mode}-${idx}`}>
                        <View style={styles.payModes}>
                          {PAYMENT_MODES.filter((mode) => mode.id !== payMode).map((mode) => {
                            const on = part.mode === mode.id;
                            return (
                              <Pressable
                                key={mode.id}
                                onPress={() => updateSplitMode(idx, mode.id)}
                                style={[styles.payMode, on && styles.payModeOn]}>
                                <Text style={[styles.payModeText, on && styles.payModeTextOn]}>{mode.label}</Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <View style={styles.amountBox}>
                          <Text style={styles.rupee}>₹</Text>
                          <TextInput
                            value={part.amount}
                            onChangeText={(value) => updateSplitAmount(idx, value)}
                            keyboardType="decimal-pad"
                            placeholder="Split amount"
                            placeholderTextColor={colors.textMuted}
                            style={styles.amountInput}
                          />
                        </View>
                      </View>
                    ))}
                  </View>
                )}

              </ScrollView>
              {change > 0.01 ? (
                <Text style={styles.changeText}>Return change {money(change)}</Text>
              ) : balance > 0.01 ? (
                <Text style={styles.errorText}>Still due {money(balance)}</Text>
              ) : (
                <Text style={styles.readyText}>Ready to complete</Text>
              )}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              <View style={styles.payActions}>
                <Pressable
                  onPress={handlePrint}
                  disabled={!preview || saving || printing}
                  style={[styles.printBtn, (!preview || saving || printing) && styles.disabled]}>
                  <Icon name="printer" size={16} color={colors.primary} />
                  <Text style={styles.printBtnText}>{printing ? 'Printing…' : 'Print'}</Text>
                </Pressable>
                <Pressable
                  onPress={handlePay}
                  disabled={!preview || saving || printing || loadingPreview}
                  style={[styles.saveBtn, (!preview || saving || printing || loadingPreview) && styles.disabled]}>
                  {saving ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.saveBtnText}>Complete {money(totalDue)}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  pane: {
    flex: 2,
    minWidth: 320,
    minHeight: 0,
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: { flex: 1, minHeight: 0 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  headText: { flex: 1, minWidth: 0 },
  headTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  headCount: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginTop: 1 },
  headIconBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  headIconBtnOn: { backgroundColor: colors.primaryLight },
  headIconBtnDanger: { backgroundColor: colors.errorLight },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.successLight,
  },
  noticeText: { flex: 1, fontSize: 12, fontWeight: '600', color: colors.success },
  tabRow: {
    flexDirection: 'row',
    gap: 2,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xs,
    padding: 2,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
  },
  tab: {
    flex: 1,
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
    borderRadius: radius.sm,
  },
  tabOn: {
    backgroundColor: colors.surface,
  },
  tabText: { fontSize: 11, fontWeight: '700', color: colors.textMuted, flexShrink: 1 },
  tabTextOn: { color: colors.primary },
  actionOff: { opacity: 0.45 },
  dangerText: { color: colors.error, fontSize: 12, fontWeight: '700' },
  customerListContent: { paddingBottom: 64 },
  addCustomerFab: {
    position: 'absolute',
    right: spacing.sm,
    bottom: spacing.sm,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 4,
  },
  inlineFormActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  secondaryBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceVariant,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700', color: colors.text },
  inlinePrimary: { flex: 1.4, marginTop: 0 },
  listContent: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginHorizontal: spacing.sm,
    paddingVertical: 6,
    paddingHorizontal: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceVariant,
    borderTopLeftRadius: radius.sm,
    borderTopRightRadius: radius.sm,
  },
  th: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  thRemove: { width: 24 },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 8.16, // +2% vs previous 8
    paddingHorizontal: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  colProduct: { flex: 1.4, minWidth: 0 },
  colRateHead: { width: 104, textAlign: 'right' },
  colQtyHead: { width: 128, textAlign: 'center' },
  colAmountHead: { width: 78, textAlign: 'right' },
  rateCell: {
    width: 104,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  ratePrefix: { fontSize: 12, fontWeight: '700', color: colors.textSecondary },
  rateInput: {
    width: 78,
    height: 28.56,
    paddingVertical: 0,
    paddingHorizontal: 6,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  colQty: { width: 128, alignItems: 'center' },
  colAmount: {
    width: 78,
    fontSize: 13,
    fontWeight: '800',
    color: colors.secondary,
    textAlign: 'right',
  },
  qtyInline: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceVariant,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  qtyBtn: {
    width: 28.56, // +2%
    height: 28.56,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyInput: {
    width: 53,
    height: 28.56, // +2%
    paddingVertical: 0,
    paddingHorizontal: 4,
    marginHorizontal: 2,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: colors.primary,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  lineName: { fontSize: 13, fontWeight: '700', color: colors.text },
  lineMeta: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  removeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    gap: spacing.xs,
  },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginTop: spacing.xs },
  emptyHint: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
    backgroundColor: colors.surface,
  },
  totalBlock: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
    gap: 2,
  },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between' },
  sumLbl: { fontSize: 11, color: colors.textMuted },
  sumVal: { fontSize: 11, fontWeight: '700', color: colors.text },
  discVal: { fontSize: 11, fontWeight: '700', color: colors.secondary },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
    paddingTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.borderLight,
  },
  dueLbl: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  dueAmt: { fontSize: 22, fontWeight: '800', color: colors.primary, letterSpacing: -0.3 },
  payScroll: { maxHeight: 160, flexGrow: 0 },
  payScrollContent: { paddingHorizontal: spacing.sm, paddingTop: spacing.xs, paddingBottom: 2 },
  sectionLbl: {
    marginTop: spacing.xs,
    marginBottom: 2,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  payModes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  payMode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  payModeOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  payModeText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  payModeTextOn: { color: colors.primary },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  amountBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
  },
  rupee: { fontSize: 13, fontWeight: '800', color: colors.textMuted },
  amountInput: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text, paddingVertical: 0 },
  roundBtn: {
    height: 34,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnOn: { backgroundColor: colors.primaryLight },
  roundText: { fontSize: 11, fontWeight: '700', color: colors.text },
  roundTextOn: { color: colors.primary },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
  },
  linkText: { fontSize: 12, fontWeight: '700', color: colors.primary },
  splitBox: {
    marginTop: 2,
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  splitHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  splitTitle: { fontSize: 12, fontWeight: '700', color: colors.text },
  changeText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.secondaryDark,
    marginHorizontal: spacing.sm,
    marginBottom: 2,
  },
  readyText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.success,
    marginHorizontal: spacing.sm,
    marginBottom: 2,
  },
  errorText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.error,
    marginHorizontal: spacing.sm,
    marginBottom: 2,
  },
  payActions: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: 2,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  printBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.surface,
  },
  printBtnText: { fontSize: 13, fontWeight: '800', color: colors.primary },
  saveBtn: {
    flex: 1,
    minHeight: 40,
    borderRadius: radius.md,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 14, fontWeight: '800', color: colors.textOnPrimary },
  disabled: { opacity: 0.5 },
  subView: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    position: 'relative',
    overflow: 'hidden',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 0 },
  walkIn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  walkInText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  subSpinner: { marginTop: spacing.lg },
  customerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderLight,
  },
  customerRowOn: { backgroundColor: colors.primaryLight, borderRadius: radius.sm, paddingHorizontal: spacing.sm },
  customerName: { fontSize: 14, fontWeight: '700', color: colors.text },
  inlineForm: { gap: spacing.sm, marginTop: spacing.sm },
  formTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  formHint: { fontSize: 13, color: colors.textMuted, lineHeight: 18, marginTop: spacing.xs, marginBottom: spacing.md },
  field: {
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceVariant,
    paddingHorizontal: spacing.md,
    fontSize: 15,
    color: colors.text,
  },
  primaryBtn: {
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '800', color: colors.textOnPrimary },
  discountBox: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm },
  modeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBtnOn: { backgroundColor: colors.primaryLight, borderColor: colors.primary },
  modeText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  modeTextOn: { color: colors.primary },
  discountActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  discountRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  smallPrimary: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  smallPrimaryText: { fontSize: 13, fontWeight: '800', color: colors.textOnPrimary },
});
