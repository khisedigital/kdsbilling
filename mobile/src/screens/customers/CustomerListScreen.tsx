import React, { useCallback, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { Button, Dialog, FAB, HelperText, Portal } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import EmptyState from '../../components/ui/EmptyState';
import ListRow from '../../components/ui/ListRow';
import ScreenSearch from '../../components/ui/ScreenSearch';
import { createCustomer, deleteCustomer, fetchCustomers, updateCustomer } from '../../services/businessService';
import { t as translate, useT } from '../../i18n';
import { useCartStore } from '../../store/cartStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing, dialogCard} from '../../theme/layout';

type Props = NativeStackScreenProps<MainStackParamList, 'CustomerList'>;

type Customer = {
  id: string;
  name: string;
  phone?: string;
  loyalty_points: number;
  store_credit_balance: number;
};

type DialogMode = 'add' | 'edit';

function apiError(err: unknown, fallback: string) {
  const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return translate(message || fallback);
}

export default function CustomerListScreen({ navigation, route }: Props) {
  const t = useT();
  const pickForBill = !!route.params?.pickForBill;
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [visible, setVisible] = useState(false);
  const [mode, setMode] = useState<DialogMode>('add');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const customerId = useCartStore((s) => s.customerId);
  const setCustomer = useCartStore((s) => s.setCustomer);

  const [listLoading, setListLoading] = useState(true);
  const skipNextFocus = React.useRef(true);

  const load = useCallback(async (query = '') => {
    try {
      const result = await fetchCustomers(query.trim() || undefined);
      setCustomers(result?.items || []);
    } catch (err) {
      setCustomers([]);
      Alert.alert(t('Load failed'), t(apiError(err, 'Could not load customers')));
    }
  }, [t]);

  React.useEffect(() => {
    setListLoading(true);
    const run = () => load(search).finally(() => setListLoading(false));
    if (!search.trim()) {
      run();
      return;
    }
    const timer = setTimeout(run, 280);
    return () => clearTimeout(timer);
  }, [load, search]);

  useFocusEffect(
    useCallback(() => {
      if (skipNextFocus.current) {
        skipNextFocus.current = false;
        return;
      }
      load(search);
    }, [load, search]),
  );

  const openAdd = () => {
    setMode('add');
    setEditingId(null);
    setName('');
    setPhone('');
    setError('');
    setVisible(true);
  };

  const openEdit = (customer: Customer) => {
    setMode('edit');
    setEditingId(customer.id);
    setName(customer.name);
    setPhone(customer.phone || '');
    setError('');
    setVisible(true);
  };

  const closeDialog = () => {
    if (loading) return;
    setVisible(false);
    setError('');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError(t('Name is required'));
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = { name: name.trim(), phone: phone.trim() || undefined };
      if (mode === 'add') {
        await createCustomer(payload);
      } else if (editingId) {
        await updateCustomer(editingId, payload);
        if (customerId === editingId) {
          setCustomer(editingId, name.trim());
        }
      }
      setVisible(false);
      await load(search);
    } catch (err) {
      setError(t(apiError(err, mode === 'add' ? 'Could not add customer' : 'Could not update customer')));
    } finally {
      setLoading(false);
    }
  };

  const confirmDelete = () => {
    if (!editingId) return;
    const customer = customers.find((c) => c.id === editingId);
    if (!customer) return;

    Alert.alert(
      t('Delete customer?'),
      t('Remove "{{name}}" from your customer list?', { name: customer.name }),
      [
        { text: t('Cancel'), style: 'cancel' },
        {
          text: t('Delete'),
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              await deleteCustomer(editingId);
              if (customerId === editingId) {
                setCustomer(null);
              }
              setVisible(false);
              await load(search);
            } catch (err) {
              setError(t(apiError(err, 'Could not delete customer')));
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  const handleUseForBilling = () => {
    if (!editingId) return;
    setCustomer(editingId, name.trim());
    setVisible(false);
    Alert.alert(t('Customer selected'), t('{{name}} is set for the current bill.', { name: name.trim() }));
  };

  return (
    <View style={common.screen}>
      <ScreenSearch value={search} onChangeText={setSearch} placeholder={t('Search customers...')} />
      <FlatList
        data={customers}
        keyExtractor={(i) => i.id}
        contentContainerStyle={customers.length ? common.listContent : styles.emptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => { setRefreshing(true); await load(search); setRefreshing(false); }}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          listLoading ? null : (
          <EmptyState icon="account-group-outline" title={search.trim() ? t('No matching customers') : t('No customers')} subtitle={search.trim() ? t('Try a different search') : t('Tap + to add your first customer')} />
          )
        }
        renderItem={({ item }) => {
          const isSelected = customerId === item.id;
          return (
            <ListRow
              title={item.name}
              subtitle={[item.phone, t('Pts {{points}}', { points: item.loyalty_points }), t('Credit ₹{{amount}}', { amount: parseFloat(String(item.store_credit_balance)).toFixed(0) })].filter(Boolean).join(' · ')}
              icon={isSelected ? 'account-check' : 'account-circle'}
              iconColor={isSelected ? colors.secondary : colors.primary}
              iconBg={isSelected ? colors.secondaryLight : colors.primaryLight}
              badge={isSelected ? { label: t('On bill'), color: colors.secondary, bg: colors.secondaryLight } : undefined}
              onPress={() => {
                if (pickForBill) {
                  setCustomer(item.id, item.name);
                  navigation.goBack();
                  return;
                }
                openEdit(item);
              }}
              onLongPress={() => {
                setCustomer(item.id, item.name);
                if (pickForBill) {
                  navigation.goBack();
                  return;
                }
                Alert.alert(t('Customer selected'), t('{{name}} is set for the current bill.', { name: item.name }));
              }}
            />
          );
        }}
      />

      <FAB icon="plus" style={common.fab} color={colors.textOnPrimary} onPress={openAdd} />

      <Portal>
        <Dialog visible={visible} onDismiss={closeDialog} style={styles.dialog}>
          <Dialog.Title>{mode === 'add' ? t('Add Customer') : t('Edit Customer')}</Dialog.Title>
          <Dialog.Content>
            <AppTextInput
              label={t('Name *')}
              value={name}
              onChangeText={setName}
              mode="outlined"
              style={styles.input}
              autoFocus={mode === 'add'}
            />
            <AppTextInput
              label={t('Phone')}
              value={phone}
              onChangeText={setPhone}
              mode="outlined"
              keyboardType="phone-pad"
              style={styles.input}
            />
            {error ? <HelperText type="error">{error}</HelperText> : null}
            {mode === 'edit' ? (
              <Button mode="outlined" icon="cart-check" onPress={handleUseForBilling} style={styles.useBtn} textColor={colors.secondary}>
                {t('Use for current bill')}
              </Button>
            ) : null}
          </Dialog.Content>
          <Dialog.Actions style={styles.dialogActions}>
            {mode === 'edit' ? (
              <Button textColor={colors.error} onPress={confirmDelete} disabled={loading}>
                {t('Delete')}
              </Button>
            ) : (
              <View />
            )}
            <View style={styles.dialogRight}>
              <Button onPress={closeDialog} disabled={loading}>{t('Cancel')}</Button>
              <Button onPress={handleSave} loading={loading} disabled={!name.trim()}>
                {mode === 'add' ? t('Add') : t('Save')}
              </Button>
            </View>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}

const styles = StyleSheet.create({
  emptyList: { flexGrow: 1 },
  dialog: { ...dialogCard },
  input: { marginBottom: spacing.sm, backgroundColor: colors.surface },
  useBtn: { marginTop: spacing.sm, borderColor: colors.secondary },
  dialogActions: { justifyContent: 'space-between', paddingHorizontal: spacing.md },
  dialogRight: { flexDirection: 'row', alignItems: 'center' },
});
