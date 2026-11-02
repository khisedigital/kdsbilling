import React, { useCallback, useRef, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { FAB, Text } from 'react-native-paper';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import { fetchReturns, type ReturnListItem } from '../../services/businessService';
import { apiError } from '../../utils/apiError';
import { formatBillListDate, getCreatedAt } from '../../utils/formatDate';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'ReturnsList'>;

export default function ReturnsListScreen({ navigation }: Props) {
  const [items, setItems] = useState<ReturnListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const skipNextFocus = useRef(true);

  const load = useCallback(async () => {
    try {
      const result = await fetchReturns(1, 100);
      setItems(result?.items || []);
    } catch (err) {
      setItems([]);
      Alert.alert('Load failed', apiError(err, 'Could not load credit notes'));
    }
  }, []);

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

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  return (
    <View style={common.screen}>
      <View style={styles.hint}>
        <Text style={styles.hintText}>
          Credit notes created from sales returns. Tap a row to open the original bill.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(i) => i.id}
        contentContainerStyle={items.length ? common.listContent : styles.emptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.primary]} />}
        ListEmptyComponent={
          loading ? null : (
            <EmptyState
              icon="file-restore-outline"
              title="No credit notes yet"
              subtitle="Process a return from Sales or use New return"
            />
          )
        }
        renderItem={({ item }) => {
          const title = item.credit_note_number || item.return_number;
          const billNo = item.salesOrder?.bill_number || item.sales_order?.bill_number;
          const mode = (item.refund_mode || 'cash').replace('_', ' ');
          const amount = parseFloat(String(item.total_amount ?? item.refund_amount ?? 0));
          return (
            <ListRow
              title={title}
              subtitle={[
                billNo ? `Bill ${billNo}` : null,
                mode,
                formatBillListDate(getCreatedAt(item)),
              ].filter(Boolean).join(' · ')}
              icon="file-restore-outline"
              iconColor={colors.primary}
              iconBg={colors.primaryLight}
              right={`₹${amount.toFixed(2)}`}
              onPress={() => {
                const billId = item.sales_order_id || item.salesOrder?.id || item.sales_order?.id;
                if (billId) {
                  navigation.navigate('SaleDetail', { billId });
                }
              }}
            />
          );
        }}
      />

      <FAB
        icon="plus"
        label="New return"
        style={common.fab}
        color={colors.textOnPrimary}
        onPress={() => navigation.navigate('Return', {})}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hint: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  hintText: { ...typography.caption, color: colors.textSecondary },
  emptyList: { flexGrow: 1 },
});
