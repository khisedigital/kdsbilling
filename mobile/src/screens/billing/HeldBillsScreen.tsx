import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import { useT } from '../../i18n';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { deleteHeldBill, fetchHeldBills } from '../../services/businessService';
import { useCartStore, type CartItem } from '../../store/cartStore';
import { apiError } from '../../utils/apiError';
import { formatBillListDate, getCreatedAt } from '../../utils/formatDate';
import { colors } from '../../theme/colors';
import { common } from '../../theme/layout';

type HeldCart = {
  items?: CartItem[];
  customerId?: string | null;
  customerName?: string | null;
  billDiscountAmount?: number;
  billDiscountPercent?: number;
  offerId?: string | null;
};

type HeldBillRow = {
  id: string;
  name: string;
  created_at?: string;
  createdAt?: string;
  customer_id?: string | null;
  customerId?: string | null;
  cart_data?: HeldCart | string | null;
  cartData?: HeldCart | string | null;
};

function readHeldCart(item: HeldBillRow): HeldCart {
  const raw = item.cart_data ?? item.cartData;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as HeldCart;
    } catch {
      return {};
    }
  }
  return raw;
}

type Props = NativeStackScreenProps<MainStackParamList, 'HeldBills'>;

export default function HeldBillsScreen({ navigation }: Props) {
  const t = useT();
  const [held, setHeld] = useState<HeldBillRow[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const skipNextFocus = useRef(true);
  const loadCart = useCartStore((s) => s.loadCart);
  const cartItems = useCartStore((s) => s.items);
  const resumedHeldId = useCartStore((s) => s.resumedHeldId);

  const load = useCallback(async () => {
    try {
      setHeld(await fetchHeldBills());
    } catch (err) {
      Alert.alert(t('Load failed'), apiError(err, 'Could not load held bills'));
    }
  }, [t]);

  React.useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load();
    }, [load]),
  );

  const applyResume = (item: HeldBillRow) => {
    const cartData = readHeldCart(item);
    const customerId = cartData.customerId || item.customer_id || item.customerId || null;
    loadCart(
      cartData.items || [],
      customerId,
      cartData.customerName || null,
      {
        billDiscountAmount: cartData.billDiscountAmount,
        billDiscountPercent: cartData.billDiscountPercent,
        offerId: cartData.offerId,
        resumedHeldId: item.id,
      },
    );
    navigation.navigate('Billing');
  };

  const resume = (item: HeldBillRow) => {
    if (cartItems.length && resumedHeldId !== item.id) {
      Alert.alert(
        t('Replace current bill?'),
        t('Resuming this held bill will replace items currently on New Bill.'),
        [
          { text: t('Cancel'), style: 'cancel' },
          { text: t('Replace'), style: 'destructive', onPress: () => applyResume(item) },
        ],
      );
      return;
    }
    applyResume(item);
  };

  const cancelHeld = async (id: string) => {
    try {
      await deleteHeldBill(id);
      if (useCartStore.getState().resumedHeldId === id) {
        useCartStore.getState().clear();
      }
      setHeld((rows) => rows.filter((row) => row.id !== id));
    } catch (err) {
      Alert.alert(t('Cancel failed'), apiError(err, 'Could not cancel held bill'));
    }
  };

  const confirmCancel = (item: HeldBillRow) => {
    const openOnCounter = resumedHeldId === item.id;
    Alert.alert(
      t('Cancel held bill?'),
      openOnCounter
        ? t('"{{name}}" will be removed, and the items currently on the bill will be cleared.', { name: item.name })
        : t('"{{name}}" will be removed from held bills.', { name: item.name }),
      [
        { text: t('Keep'), style: 'cancel' },
        { text: t('Cancel bill'), style: 'destructive', onPress: () => cancelHeld(item.id) },
      ],
    );
  };

  const filtered = held.filter((h) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const when = formatBillListDate(getCreatedAt(h));
    return h.name.toLowerCase().includes(q) || when.toLowerCase().includes(q);
  });

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search held bills...')} />
      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} colors={[colors.primary]} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="pause-circle-outline"
              title={search.trim() ? t('No matching held bills') : t('No held bills')}
              subtitle={search.trim() ? t('Try a different search') : t('Hold a bill from billing. Cancel it here if you do not want to sell it.')}
            />
          )
        }
        renderItem={({ item }) => {
          const openOnCounter = resumedHeldId === item.id;
          return (
            <ListRow
              title={item.name}
              subtitle={formatBillListDate(getCreatedAt(item))}
              icon="pause-circle"
              iconColor={colors.warning}
              iconBg={colors.warningLight}
              badge={openOnCounter
                ? { label: t('On bill'), color: colors.secondary, bg: colors.secondaryLight }
                : { label: t('Held'), color: colors.warning, bg: colors.warningLight }}
              onPress={() => resume(item)}
              trailing={(
                <Pressable
                  onPress={() => confirmCancel(item)}
                  hitSlop={8}
                  accessibilityLabel={t('Cancel {{name}}', { name: item.name })}
                  style={styles.cancelBtn}>
                  <Icon name="close-circle-outline" size={22} color={colors.error} />
                </Pressable>
              )}
            />
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  cancelBtn: { padding: 4 },
});
