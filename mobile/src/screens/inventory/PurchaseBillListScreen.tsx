import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { FAB } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { fetchPurchaseBills } from '../../services/inventoryService';
import type { PurchaseBill } from '../../services/inventoryService';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';
import { colors } from '../../theme/colors';
import { common } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'PurchaseBillList'>;

export default function PurchaseBillListScreen({ navigation }: Props) {
  const t = useT();
  const [bills, setBills] = useState<PurchaseBill[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const skipNextFocus = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await fetchPurchaseBills(1, { limit: 200 });
      setBills(result?.items || []);
    } catch (err) {
      setBills([]);
      Alert.alert(t('Load failed'), apiError(err, 'Could not load purchase bills'));
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

  const filtered = bills.filter((b) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      b.bill_number.toLowerCase().includes(q)
      || (b.supplier?.name || '').toLowerCase().includes(q)
      || (b.bill_date || '').toLowerCase().includes(q)
    );
  });

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search bill no. or supplier...')} />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={filtered.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="file-document-outline"
              title={search.trim() ? t('No matching bills') : t('No purchase bills')}
              subtitle={search.trim() ? t('Try a different search') : t('Record purchases to stock in inventory')}
            />
          )
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.bill_number}
            subtitle={`${item.supplier?.name || t('Supplier')} · ${item.bill_date}`}
            icon="truck-check"
            iconColor={colors.secondary}
            iconBg={colors.secondaryLight}
            right={`₹${parseFloat(String(item.total_amount)).toFixed(2)}`}
            onPress={() => navigation.navigate('PurchaseBillDetail', { billId: item.id })}
          />
        )}
      />
      <FAB icon="plus" label={t('Add')} style={common.fab} color={colors.textOnPrimary} onPress={() => navigation.navigate('PurchaseBillForm', {})} />
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
});
