import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native-paper';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import * as profileService from '../../services/profileService';
import { useAuthStore } from '../../store/authStore';
import { colors } from '../../theme/colors';
import { common, spacing, typography } from '../../theme/layout';
import { apiError } from '../../utils/apiError';

type Props = NativeStackScreenProps<MainStackParamList, 'Profile'>;

export default function ProfileScreen({}: Props) {
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
        if (alive) Alert.alert('Error', apiError(err, 'Could not load profile'));
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
      Alert.alert('Saved', 'Profile updated.');
    } catch (err) {
      Alert.alert('Error', apiError(err, 'Could not save profile'));
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      Alert.alert('Missing fields', 'Enter current and new password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Weak password', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'New password and confirmation do not match.');
      return;
    }

    setChangingPassword(true);
    try {
      await profileService.changePassword({ currentPassword, newPassword });
      Alert.alert('Password changed', 'Please sign in again with your new password.', [
        {
          text: 'OK',
          onPress: () => {
            logout();
          },
        },
      ]);
    } catch (err) {
      Alert.alert('Error', apiError(err, 'Could not change password'));
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
      <Text style={styles.title}>My Profile</Text>
      <Text style={styles.subtitle}>Update your name, mobile, and password</Text>

      <SectionCard title="Account" icon="account-circle-outline">
        <TextInput
          label="Name"
          mode="outlined"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />
        <TextInput
          label="Mobile"
          mode="outlined"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={10}
          style={styles.input}
        />
        {user?.role ? (
          <Text style={styles.meta}>Role: {user.role}</Text>
        ) : null}
        <Button mode="contained" onPress={handleSaveProfile} loading={saving} disabled={saving} style={styles.btn}>
          Save profile
        </Button>
      </SectionCard>

      <SectionCard title="Change password" icon="lock-reset" subtitle="You will be signed out after changing">
        <TextInput
          label="Current password"
          mode="outlined"
          value={currentPassword}
          onChangeText={setCurrentPassword}
          secureTextEntry
          style={styles.input}
        />
        <TextInput
          label="New password"
          mode="outlined"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          style={styles.input}
        />
        <TextInput
          label="Confirm new password"
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
          Update password
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
