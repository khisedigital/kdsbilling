import React, { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import { useT, useLanguageStore, type AppLanguage } from '../../i18n';
import * as shopSettingsService from '../../services/shopSettingsService';
import { pickImage } from '../../utils/pickImage';
import { useAuthStore } from '../../store/authStore';
import { colors } from '../../theme/colors';
import { common, radius, spacing, typography } from '../../theme/layout';
import { apiError } from '../../utils/apiError';
import { normalizeMobile } from '../../utils/phone';

type Props = NativeStackScreenProps<MainStackParamList, 'ShopSettings'>;

export default function ShopSettingsScreen({}: Props) {
  const t = useT();
  const billLanguage = useLanguageStore((s) => s.bill);
  const setBillLanguage = useLanguageStore((s) => s.setBill);
  const updateTenant = useAuthStore((s) => s.updateTenant);

  const [shopName, setShopName] = useState('');
  const [shopNameMr, setShopNameMr] = useState('');
  const [address, setAddress] = useState('');
  const [addressMr, setAddressMr] = useState('');
  const [city, setCity] = useState('');
  const [gstin, setGstin] = useState('');
  const [phone, setPhone] = useState('');
  const [billFooter, setBillFooter] = useState('Thank you!');
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [shopCode, setShopCode] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const applySettings = (s: shopSettingsService.ShopSettings) => {
    setShopName(s.shopName || '');
    setShopNameMr(s.shopNameMr || '');
    setAddress(s.address || '');
    setAddressMr(s.addressMr || '');
    setCity(s.city || '');
    setGstin(s.gstin || '');
    setPhone(s.phone || '');
    setBillFooter(s.billFooter || 'Thank you!');
    setLogoUrl(s.logoUrl);
    setShopCode(s.shopCode || '');
    updateTenant({ name: s.shopName });
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const settings = await shopSettingsService.getShopSettings();
        if (alive) applySettings(settings);
      } catch (err) {
        if (alive) Alert.alert(t('Error'), apiError(err, 'Could not load shop settings'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!shopName.trim()) {
      Alert.alert(t('Required'), t('Shop name is required.'));
      return;
    }
    if (phone.trim() && !normalizeMobile(phone)) {
      Alert.alert(t('Invalid phone'), t('Enter a valid 10-digit shop phone.'));
      return;
    }

    setSaving(true);
    try {
      const settings = await shopSettingsService.updateShopSettings({
        shopName: shopName.trim(),
        shopNameMr: shopNameMr.trim(),
        address: address.trim(),
        addressMr: addressMr.trim(),
        city: city.trim(),
        gstin: gstin.trim(),
        phone: phone.trim(),
        billFooter: billFooter.trim(),
      });
      applySettings(settings);
      Alert.alert(t('Saved'), t('Shop bill settings updated.'));
    } catch (err) {
      Alert.alert(t('Error'), apiError(err, 'Could not save shop settings'));
    } finally {
      setSaving(false);
    }
  };

  const handlePickLogo = async () => {
    let image;
    try {
      image = await pickImage();
    } catch (err) {
      Alert.alert(t('Picker error'), err instanceof Error ? t(err.message) : t('Could not open image picker'));
      return;
    }
    if (!image) return;

    setUploading(true);
    try {
      const settings = await shopSettingsService.uploadShopLogo(
        image.uri,
        image.fileName,
        image.type,
        image.file
      );
      applySettings(settings);
      Alert.alert(t('Uploaded'), t('Shop logo updated for bills.'));
    } catch (err) {
      Alert.alert(t('Upload failed'), apiError(err, 'Could not upload logo'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = () => {
    Alert.alert(t('Remove logo'), t('Remove the logo from printed bills?'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Remove'),
        style: 'destructive',
        onPress: async () => {
          setUploading(true);
          try {
            const settings = await shopSettingsService.removeShopLogo();
            applySettings(settings);
          } catch (err) {
            Alert.alert(t('Error'), apiError(err, 'Could not remove logo'));
          } finally {
            setUploading(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={[common.screen, styles.center]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  const previewLogo = shopSettingsService.resolveUploadUrl(logoUrl);

  return (
    <ScrollView style={common.screen} contentContainerStyle={common.screenPad} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('Shop & Bill Settings')}</Text>
      <Text style={styles.subtitle}>{t('These details appear on printed bills')}</Text>

      <SectionCard
        title={t('Bill language')}
        icon="translate"
        subtitle={t('Printed bills and the printer test use this language. The switch at the top changes only the screen.')}>
        <View style={styles.row}>
          {(['en', 'mr'] as AppLanguage[]).map((lang) => (
            <Button
              key={lang}
              mode={billLanguage === lang ? 'contained' : 'outlined'}
              onPress={() => setBillLanguage(lang)}
              style={styles.rowBtn}>
              {lang === 'en' ? 'English' : 'मराठी'}
            </Button>
          ))}
        </View>
      </SectionCard>

      <SectionCard title={t('Shop logo')} icon="image-outline" subtitle={t('Shown on A4 bills')}>
        {previewLogo ? (
          <Image source={{ uri: previewLogo }} style={styles.logo} resizeMode="contain" />
        ) : (
          <Text style={styles.hint}>{t('No logo uploaded yet')}</Text>
        )}
        <View style={styles.row}>
          <Button mode="contained" onPress={handlePickLogo} loading={uploading} disabled={uploading} style={styles.rowBtn}>
            {logoUrl ? t('Change logo') : t('Upload logo')}
          </Button>
          {logoUrl ? (
            <Button mode="outlined" onPress={handleRemoveLogo} disabled={uploading} style={styles.rowBtn}>
              {t('Remove')}
            </Button>
          ) : null}
        </View>
      </SectionCard>

      <SectionCard title={t('Bill header')} icon="storefront-outline">
        <AppTextInput
          label={t('Shop name')}
          mode="outlined"
          value={shopName}
          onChangeText={setShopName}
          style={styles.input}
        />
        {shopCode ? <Text style={styles.meta}>{t('Shop code')}: {shopCode}</Text> : null}
        <AppTextInput
          label={t('Address')}
          mode="outlined"
          value={address}
          onChangeText={setAddress}
          multiline
          style={styles.input}
        />
        <Text style={styles.hint}>
          {t('Used on bills and labels when bill language is Marathi. Leave blank to keep the English name and address.')}
        </Text>
        <AppTextInput
          label={t('Shop name (Marathi)')}
          mode="outlined"
          value={shopNameMr}
          onChangeText={setShopNameMr}
          placeholder={t('दुकानाचे नाव')}
          maxLength={150}
          style={styles.input}
        />
        <AppTextInput
          label={t('Address (Marathi)')}
          mode="outlined"
          value={addressMr}
          onChangeText={setAddressMr}
          placeholder={t('पत्ता')}
          multiline
          maxLength={500}
          style={styles.input}
        />
        <AppTextInput
          label={t('City')}
          mode="outlined"
          value={city}
          onChangeText={setCity}
          style={styles.input}
        />
        <AppTextInput
          label={t('Shop phone')}
          mode="outlined"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={10}
          style={styles.input}
        />
        <AppTextInput
          label="GSTIN"
          mode="outlined"
          value={gstin}
          onChangeText={setGstin}
          autoCapitalize="characters"
          style={styles.input}
        />
        <AppTextInput
          label={t('Bill footer')}
          mode="outlined"
          value={billFooter}
          onChangeText={setBillFooter}
          placeholder={t('Thank you!')}
          style={styles.input}
        />
        <Button mode="contained" onPress={handleSave} loading={saving} disabled={saving} style={styles.btn}>
          {t('Save settings')}
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
  hint: { ...typography.bodySm, marginBottom: spacing.md },
  meta: { ...typography.caption, marginBottom: spacing.sm, textTransform: 'none', letterSpacing: 0 },
  logo: {
    width: '100%',
    height: 96,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowBtn: { flexGrow: 1 },
});
