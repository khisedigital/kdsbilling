import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import * as profileService from '../../services/profileService';
import { useAuthStore } from '../../store/authStore';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';
import { useT } from '../../i18n';
import { apiError } from '../../utils/apiError';

type Props = NativeStackScreenProps<MainStackParamList, 'Profile'>;

export default function ProfileScreen({}: Props) {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const updateLocalUser = useAuthStore((s) => s.updateLocalUser);
  const logout = useAuthStore((s) => s.logout);

  const [name, setName] = useState(user?.name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const profile = await profileService.getProfile();
        if (!alive) return;
        setName(profile.name || '');
        setPhone(profile.phone || '');
        updateLocalUser({
          name: profile.name,
          phone: profile.phone,
          email: profile.email,
        });
      } catch (err) {
        if (alive) Alert.alert(t('Error'), apiError(err, t('Could not load profile')));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [updateLocalUser]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const profile = await profileService.updateProfile({ name, phone });
      updateLocalUser({
        name: profile.name,
        phone: profile.phone,
        email: profile.email,
      });
      Alert.alert(t('Saved'), t('Profile updated.'));
    } catch (err) {
      Alert.alert(t('Error'), apiError(err, t('Could not save profile')));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert(t('Missing fields'), t('Enter current and new password.'));
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert(t('Weak password'), t('New password must be at least 6 characters.'));
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert(t('Mismatch'), t('New password and confirmation do not match.'));
      return;
    }

    setChangingPassword(true);
    try {
      await profileService.changePassword({ currentPassword, newPassword });
      Alert.alert(t('Password changed'), t('Please sign in again with your new password.'), [
        {
          text: t('OK'),
          onPress: () => {
            logout();
          },
        },
      ]);
    } catch (err) {
      Alert.alert(t('Error'), apiError(err, t('Could not change password')));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  return (
    <ScrollView style={common.screen} contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('My Profile')}</Text>
      <Text style={styles.subtitle}>{t('Update your name, mobile, and password')}</Text>

      <SectionCard title={t('Account')} icon="account-circle-outline">
        <AppTextInput
          label={t('Name')}
          mode="outlined"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <AppTextInput
          label={t('Mobile')}
          mode="outlined"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={10}
          style={styles.input}
        />
        {user?.role ? (
          <Text style={styles.meta}>{t('Role')}: {t(user.role)}</Text>
        ) : null}
        <Button mode="contained" onPress={handleSaveProfile} loading={saving} disabled={saving} style={styles.btn}>
          {t('Save profile')}
        </Button>
      </SectionCard>

      <SectionCard title={t('Change password')} icon="lock-reset" subtitle={t('You will be signed out after changing')}>
        <AppTextInput
          label={t('Current password')}
          mode="outlined"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          style={styles.input}
        />
        <AppTextInput
          label={t('New password')}
          mode="outlined"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          style={styles.input}
        />
        <AppTextInput
          label={t('Confirm new password')}
          mode="outlined"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          secureTextEntry
          style={styles.input}
        />
        <Button
          mode="contained"
          onPress={handleChangePassword}
          loading={changingPassword}
          disabled={changingPassword}
          style={styles.btn}
        >
          {t('Update password')}
        </Button>
      </SectionCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySm, marginBottom: spacing.lg },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  btn: { marginTop: spacing.sm },
  meta: { ...typography.caption, marginBottom: spacing.sm, textTransform: 'none', letterSpacing: 0 },
});
