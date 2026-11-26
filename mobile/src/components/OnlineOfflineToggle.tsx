import React from 'react';
import { ActivityIndicator, Alert, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../i18n';
import { useConnectivityStore } from '../offline/connectivityStore';
import { colors } from '../theme/colors';

interface OnlineOfflineToggleProps {
  pinned?: boolean;
}

export default function OnlineOfflineToggle({ pinned = false }: OnlineOfflineToggleProps) {
  const t = useT();
  const online = useConnectivityStore((s) => s.online);
  const syncing = useConnectivityStore((s) => s.syncing);
  const setOnline = useConnectivityStore((s) => s.setOnline);
  const setManualOffline = useConnectivityStore((s) => s.setManualOffline);

  const handleToggle = async () => {
    if (syncing) {
      Alert.alert(
        t('Sync in progress'),
        t('Please wait until sync completes before changing connection mode.')
      );
      return;
    }

    if (online) {
      // Switch from Online to Offline
      setManualOffline(true);
      setOnline(false);
    } else {
      // Switch from Offline to Online
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        Alert.alert(
          t('No internet connection'),
          t('Cannot switch to online mode without an active internet connection.')
        );
        return;
      }
      setManualOffline(false);
      setOnline(true);

    }
  };

  const statusLabel = syncing
    ? t('Syncing…')
    : online
      ? t('Online')
      : t('Offline');

  const accessibilityLabel = syncing
    ? t('Syncing in progress')
    : online
      ? t('Online mode: tap to switch to offline')
      : t('Offline mode: tap to switch to online');

  if (!pinned) {
    return (
      <TouchableOpacity
        onPress={() => void handleToggle()}
        style={[
          styles.iconBtn,
          syncing
            ? styles.syncingBorder
            : online
              ? styles.onlineBorder
              : styles.offlineBorder,
        ]}
        activeOpacity={0.8}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}>
        {syncing ? (
          <ActivityIndicator size={18} color={colors.primary} />
        ) : (
          <Icon
            name={online ? 'wifi' : 'wifi-off'}
            size={20}
            color={online ? '#059669' : '#D97706'}
          />
        )}
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => void handleToggle()}
      style={[
        styles.pillBtn,
        syncing
          ? styles.syncingPill
          : online
            ? styles.onlinePill
            : styles.offlinePill,
      ]}
      activeOpacity={0.8}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}>
      {syncing ? (
        <ActivityIndicator size={14} color={colors.primary} />
      ) : (
        <View style={[styles.dot, online ? styles.dotOnline : styles.dotOffline]} />
      )}
      <Icon
        name={syncing ? 'cloud-sync' : online ? 'wifi' : 'wifi-off'}
        size={16}
        color={syncing ? colors.primary : online ? '#059669' : '#D97706'}
      />
      <Text
        style={[
          styles.label,
          syncing
            ? styles.labelSyncing
            : online
              ? styles.labelOnline
              : styles.labelOffline,
        ]}>
        {statusLabel}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginRight: 6,
    gap: 6,
    borderWidth: 1,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
    borderWidth: 1,
  },
  onlinePill: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  offlinePill: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  syncingPill: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  onlineBorder: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
  },
  offlineBorder: {
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
  },
  syncingBorder: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotOnline: {
    backgroundColor: '#10B981',
  },
  dotOffline: {
    backgroundColor: '#F59E0B',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
  },
  labelOnline: {
    color: '#047857',
  },
  labelOffline: {
    color: '#B45309',
  },
  labelSyncing: {
    color: '#1D4ED8',
  },
});
