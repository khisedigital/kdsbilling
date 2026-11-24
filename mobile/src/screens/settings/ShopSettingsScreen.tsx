import React, { useEffect, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ActivityIndicator, Button, Chip, HelperText, Text } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AppTextInput from '../../components/ui/AppTextInput';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { MainStackParamList } from '../../navigation/MainNavigator';
import SectionCard from '../../components/ui/SectionCard';
import { useT, useLanguageStore, type AppLanguage } from '../../i18n';
import * as shopSettingsService from '../../services/shopSettingsService';
import { pickImage } from '../../utils/pickImage';
import { useAuthStore } from '../../store/authStore';
import { colors } from '../../theme/colors';
import { useAutoMarathi } from '../../hooks/useAutoMarathi';
import { useKeyboardOverlap } from '../../hooks/useKeyboardOverlap';
import { common, radius, spacing, typography } from '../../theme/layout';
import { apiError } from '../../utils/apiError';
import { normalizeMobile } from '../../utils/phone';

type Props = NativeStackScreenProps<MainStackParamList, 'ShopSettings'>;

interface InvoiceTitleOption {
  key: string;
  label: string;
  labelMr: string;
  desc: string;
}

const INVOICE_TITLES: InvoiceTitleOption[] = [
  { key: 'TAX INVOICE', label: 'TAX INVOICE', labelMr: 'टॅक्स इनव्हॉइस', desc: 'Standard GST registered' },
  { key: 'BILL OF SUPPLY', label: 'BILL OF SUPPLY', labelMr: 'बिल ऑफ सप्लाय', desc: 'Composition or tax-exempt' },
  { key: 'RETAIL INVOICE', label: 'RETAIL INVOICE', labelMr: 'किरकोळ बिल', desc: 'Standard retail sales' },
  { key: 'CASH MEMO', label: 'CASH MEMO', labelMr: 'कॅश मेमो', desc: 'Direct counter cash sales' },
  { key: 'ESTIMATE', label: 'ESTIMATE', labelMr: 'अंदाज पत्रक (कोटेशन)', desc: 'Estimate / quotation' },
  { key: 'CUSTOM', label: 'Custom Title', labelMr: 'इतर शीर्षक', desc: 'User defined header title' },
];

const TERMS_PRESETS: Record<string, { en: string; mr: string; label: string }> = {
  clothing: {
    label: 'Clothing / Garments',
    en: '1. Exchange within 7 days with original bill.\n2. No exchange on discounted items.\n3. Altered or washed garments will not be accepted.',
    mr: '१. बिलासह ७ दिवसांच्या आत बदलून मिळेल.\n२. डिस्काउंट वस्तूंवर परतावा किंवा बदल मिळणार नाही.\n३. वापरलेले किंवा धुतलेले कपडे बदलून मिळणार नाहीत.',
  },
  grocery: {
    label: 'Kirana / Grocery',
    en: '1. Please verify items and cash balance at counter.\n2. Expiry return accepted within 3 days with bill.\n3. Opened or damaged packets cannot be returned.',
    mr: '१. कृपया काउंटरवर वस्तू आणि सुट्टे पैसे तपासून घ्यावेत.\n२. बिलासह ३ दिवसांच्या आत एक्सपायरी परतावा स्वीकारला जाईल.\n३. उघडलेले पाकीट बदलून मिळणार नाही.',
  },
  pharmacy: {
    label: 'Pharmacy / Medical',
    en: '1. Medicines once sold cannot be taken back.\n2. Cold-chain / refrigerated medicines cannot be returned.\n3. Doctor prescription mandatory for schedule drugs.',
    mr: '१. औषधे एकदा विकल्यानंतर परत घेतली जाणार नाहीत.\n२. फ्रिजमधील औषधे परत घेतली जाणार नाहीत.\n३. डॉक्टरांच्या प्रिस्क्रिप्शनशिवाय औषधे दिली जाणार नाहीत.',
  },
  restaurant: {
    label: 'Restaurant / Cafe',
    en: '1. Taxes extra as applicable.\n2. Food once prepared and served will not be cancelled or replaced.\n3. Outside food and drinks not allowed.',
    mr: '१. नियमांनुसार कर आकारले जातील.\n२. सर्व्ह केलेले अन्न रद्द किंवा बदलून दिले जाणार नाही.\n३. बाहेरील अन्न किंवा पेये आणण्यास मनाई आहे.',
  },
  electronics: {
    label: 'Electronics / Mobile',
    en: '1. Manufacturer warranty applies to all electronic goods.\n2. Physical or water damage not covered under warranty.\n3. Original bill & box mandatory for claims.',
    mr: '१. वॉरंटी थेट कंपनीच्या सर्व्हिस सेंटरकडून दिली जाईल.\n२. पडल्यामुळे किंवा पाण्यामुळे झालेले नुकसान वॉरंटीत धरले जात नाही.\n३. वॉरंटीसाठी मूळ बिल आणि बॉक्स आवश्यक आहे.',
  },
  retail: {
    label: 'General Retail',
    en: '1. Goods once sold will be exchanged within 7 days with bill.\n2. Subject to local jurisdiction.\n3. Thank you for shopping with us!',
    mr: '१. बिलासह ७ दिवसांच्या आत वस्तू बदलून मिळेल.\n२. वाद झाल्यास स्थानिक न्यायक्षेत्र लागू राहील.\n३. खरेदीबद्दल धन्यवाद!',
  },
};

export default function ShopSettingsScreen({}: Props) {
  const t = useT();
  const keyboardOverlap = useKeyboardOverlap();
  const billLanguage = useLanguageStore((s) => s.bill);
  const setBillLanguage = useLanguageStore((s) => s.setBill);
  const updateTenant = useAuthStore((s) => s.updateTenant);

  // Shop details
  const [shopName, setShopName] = useState('');
  const [shopNameMr, setShopNameMr] = useState('');
  const [shopCode, setShopCode] = useState('');
  const [address, setAddress] = useState('');
  const [addressMr, setAddressMr] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [pincode, setPincode] = useState('');
  const [phone, setPhone] = useState('');
  const [secondaryPhone, setSecondaryPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');

  // Registrations & Tax details
  const [gstin, setGstin] = useState('');
  const [fssai, setFssai] = useState('');
  const [drugLicense, setDrugLicense] = useState('');
  const [tradeLicense, setTradeLicense] = useState('');
  const [pan, setPan] = useState('');

  // Invoice Title
  const [selectedTitlePreset, setSelectedTitlePreset] = useState('TAX INVOICE');
  const [customInvoiceTitle, setCustomInvoiceTitle] = useState('');
  const [customInvoiceTitleMr, setCustomInvoiceTitleMr] = useState('');

  // Payment (UPI)
  const [upiId, setUpiId] = useState('');

  // Bill Footer & Terms
  const [billFooter, setBillFooter] = useState('Thank you!');
  const [terms, setTerms] = useState('');
  const [termsMr, setTermsMr] = useState('');

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  // Transliteration hooks
  const { translating: translatingShopMr, onMarathiChange: onShopNameMrChange } = useAutoMarathi(
    shopName,
    shopNameMr,
    setShopNameMr,
  );
  const { translating: translatingAddrMr, onMarathiChange: onAddressMrChange } = useAutoMarathi(
    address,
    addressMr,
    setAddressMr,
    { delayMs: 700 },
  );
  const { translating: translatingTermsMr, onMarathiChange: onTermsMrChange } = useAutoMarathi(
    terms,
    termsMr,
    setTermsMr,
    { delayMs: 800 },
  );

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const applySettings = (s: shopSettingsService.ShopSettings) => {
    setShopName(s.shopName || '');
    setShopNameMr(s.shopNameMr || '');
    setShopCode(s.shopCode || '');
    setAddress(s.address || '');
    setAddressMr(s.addressMr || '');
    setCity(s.city || '');
    setState(s.state || '');
    setStateCode(s.stateCode || '');
    setPincode(s.pincode || '');
    setPhone(s.phone || '');
    setSecondaryPhone(s.secondaryPhone || '');
    setEmail(s.email || '');
    setWebsite(s.website || '');

    setGstin(s.gstin || '');
    setFssai(s.fssai || '');
    setDrugLicense(s.drugLicense || '');
    setTradeLicense(s.tradeLicense || '');
    setPan(s.pan || '');

    const currentTitle = s.invoiceTitle || '';
    const match = INVOICE_TITLES.find((tOpt) => tOpt.key === currentTitle);
    if (match && match.key !== 'CUSTOM') {
      setSelectedTitlePreset(match.key);
      setCustomInvoiceTitle('');
      setCustomInvoiceTitleMr('');
    } else if (currentTitle) {
      setSelectedTitlePreset('CUSTOM');
      setCustomInvoiceTitle(currentTitle);
      setCustomInvoiceTitleMr(s.invoiceTitleMr || '');
    } else {
      setSelectedTitlePreset(s.gstin ? 'TAX INVOICE' : 'RETAIL INVOICE');
    }

    setUpiId(s.upiId || '');
    setBillFooter(s.billFooter || 'Thank you!');
    setTerms(s.terms || '');
    setTermsMr(s.termsMr || '');
    setLogoUrl(s.logoUrl);

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

  const handleSelectTitlePreset = (presetKey: string) => {
    setSelectedTitlePreset(presetKey);
    const preset = INVOICE_TITLES.find((p) => p.key === presetKey);
    if (preset && presetKey !== 'CUSTOM') {
      setCustomInvoiceTitle(preset.label);
      setCustomInvoiceTitleMr(preset.labelMr);
    }
  };

  const handleApplyTermsPreset = (presetKey: string) => {
    const p = TERMS_PRESETS[presetKey];
    if (!p) return;
    setTerms(p.en);
    setTermsMr(p.mr);
  };

  const handleClearTerms = () => {
    setTerms('');
    setTermsMr('');
  };

  const handleSave = async () => {
    if (!shopName.trim()) {
      Alert.alert(t('Required'), t('Shop name is required.'));
      return;
    }
    if (phone.trim() && !normalizeMobile(phone)) {
      Alert.alert(t('Invalid phone'), t('Enter a valid 10-digit shop phone.'));
      return;
    }
    if (secondaryPhone.trim() && !normalizeMobile(secondaryPhone)) {
      Alert.alert(t('Invalid phone'), t('Enter a valid 10-digit secondary / WhatsApp phone.'));
      return;
    }

    const cleanGstin = gstin.trim().toUpperCase();
    if (cleanGstin && cleanGstin.length !== 15) {
      Alert.alert(t('Notice'), t('GSTIN is typically 15 alphanumeric characters (e.g. 27ABCDE1234F1Z5). Please double check if intentional.'));
    }

    const cleanPan = pan.trim().toUpperCase();
    if (cleanPan && cleanPan.length !== 10) {
      Alert.alert(t('Notice'), t('PAN is typically 10 characters (e.g. ABCDE1234F).'));
    }

    let finalInvoiceTitle = '';
    let finalInvoiceTitleMr = '';
    if (selectedTitlePreset === 'CUSTOM') {
      finalInvoiceTitle = customInvoiceTitle.trim();
      finalInvoiceTitleMr = customInvoiceTitleMr.trim();
    } else {
      const match = INVOICE_TITLES.find((item) => item.key === selectedTitlePreset);
      if (match) {
        finalInvoiceTitle = match.label;
        finalInvoiceTitleMr = match.labelMr;
      }
    }

    setSaving(true);
    try {
      const settings = await shopSettingsService.updateShopSettings({
        shopName: shopName.trim(),
        shopNameMr: shopNameMr.trim(),
        address: address.trim(),
        addressMr: addressMr.trim(),
        city: city.trim(),
        state: state.trim(),
        stateCode: stateCode.trim(),
        pincode: pincode.trim(),
        phone: phone.trim(),
        secondaryPhone: secondaryPhone.trim(),
        email: email.trim(),
        website: website.trim(),

        gstin: cleanGstin,
        fssai: fssai.trim(),
        drugLicense: drugLicense.trim(),
        tradeLicense: tradeLicense.trim(),
        pan: cleanPan,

        invoiceTitle: finalInvoiceTitle,
        invoiceTitleMr: finalInvoiceTitleMr,

        upiId: upiId.trim(),
        billFooter: billFooter.trim(),
        terms: terms.trim(),
        termsMr: termsMr.trim(),
      });
      applySettings(settings);
      Alert.alert(t('Saved'), t('Shop and bill settings updated successfully.'));
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
        image.file,
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
    <ScrollView
      style={common.screen}
      contentContainerStyle={[common.screenPad, keyboardOverlap > 0 && { paddingBottom: keyboardOverlap + spacing.xl }]}
      keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>{t('Shop & Bill Settings')}</Text>
      <Text style={styles.subtitle}>
        {t('Customize your business profile, tax registrations, invoice headers, and bill footer for all printed bills.')}
      </Text>

      {/* 1. TAX & BUSINESS REGISTRATIONS */}
      <SectionCard
        title={t('Tax & Business Registrations')}
        icon="file-document-outline"
        subtitle={t('Add your business registration numbers. Only filled numbers appear on customer bills.')}>
        <View style={styles.regFieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>GSTIN (GST Number)</Text>
            {gstin ? <Icon name="check-decagram" size={18} color={colors.success} /> : null}
          </View>
          <AppTextInput
            label="GSTIN"
            mode="outlined"
            value={gstin}
            onChangeText={setGstin}
            autoCapitalize="characters"
            maxLength={15}
            placeholder="e.g. 27ABCDE1234F1Z5"
            style={styles.input}
          />
          <HelperText type="info" style={styles.helper}>
            {t('15-digit Goods & Services Tax Identification Number (for GST-registered businesses)')}
          </HelperText>
        </View>

        <View style={styles.regFieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>FSSAI License / Registration No.</Text>
          </View>
          <AppTextInput
            label={t('FSSAI Number')}
            mode="outlined"
            value={fssai}
            onChangeText={setFssai}
            keyboardType="number-pad"
            maxLength={14}
            placeholder="e.g. 11521000000123"
            style={styles.input}
          />
          <HelperText type="info" style={styles.helper}>
            {t('14-digit FSSAI license for food items, restaurants, grocery & bakeries')}
          </HelperText>
        </View>

        <View style={styles.regFieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Drug License No. (DL No.)</Text>
          </View>
          <AppTextInput
            label={t('Drug License Number')}
            mode="outlined"
            value={drugLicense}
            onChangeText={setDrugLicense}
            placeholder="e.g. MH-TZ1-123456 / 20B, 21B"
            style={styles.input}
          />
          <HelperText type="info" style={styles.helper}>
            {t('Required for pharmacies, chemists, and medical supply stores')}
          </HelperText>
        </View>

        <View style={styles.regFieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>Shop Act / Gumasta / Trade License / MSME</Text>
          </View>
          <AppTextInput
            label={t('Trade License / Shop Act Number')}
            mode="outlined"
            value={tradeLicense}
            onChangeText={setTradeLicense}
            placeholder="e.g. KL-2023-987654 / UDYAM-MH-0001"
            style={styles.input}
          />
          <HelperText type="info" style={styles.helper}>
            {t('Municipal Shop & Establishment registration, Gumasta, or MSME / Udyam number')}
          </HelperText>
        </View>

        <View style={styles.regFieldBlock}>
          <View style={styles.fieldHeader}>
            <Text style={styles.fieldLabel}>PAN Number</Text>
          </View>
          <AppTextInput
            label="PAN"
            mode="outlined"
            value={pan}
            onChangeText={setPan}
            autoCapitalize="characters"
            maxLength={10}
            placeholder="e.g. ABCDE1234F"
            style={styles.input}
          />
          <HelperText type="info" style={styles.helper}>
            {t('10-character Permanent Account Number')}
          </HelperText>
        </View>
      </SectionCard>

      {/* 2. INVOICE TITLE & LANGUAGE */}
      <SectionCard
        title={t('Invoice Header Title & Language')}
        icon="receipt-text-outline"
        subtitle={t('Select standard bill header title suited to your tax scheme or business type')}>
        <Text style={styles.fieldLabel}>{t('Bill Document Title')}</Text>
        <View style={styles.chipRow}>
          {INVOICE_TITLES.map((item) => {
            const isSelected = selectedTitlePreset === item.key;
            return (
              <Chip
                key={item.key}
                selected={isSelected}
                onPress={() => handleSelectTitlePreset(item.key)}
                style={[styles.chip, isSelected && styles.chipActive]}
                textStyle={[styles.chipText, isSelected && styles.chipTextActive]}>
                {t(item.label)}
              </Chip>
            );
          })}
        </View>

        {selectedTitlePreset === 'CUSTOM' ? (
          <View style={styles.row}>
            <AppTextInput
              label={t('Custom Title (English)')}
              mode="outlined"
              value={customInvoiceTitle}
              onChangeText={setCustomInvoiceTitle}
              placeholder="e.g. PROFORMA INVOICE"
              style={[styles.input, styles.halfInput]}
            />
            <AppTextInput
              label={t('Custom Title (Marathi)')}
              mode="outlined"
              value={customInvoiceTitleMr}
              onChangeText={setCustomInvoiceTitleMr}
              placeholder="उदा. तात्पुरते बिल"
              style={[styles.input, styles.halfInput]}
            />
          </View>
        ) : null}

        <View style={styles.dividerSpacing} />

        <Text style={styles.fieldLabel}>{t('Printed Bill Language')}</Text>
        <Text style={styles.hint}>
          {t('Thermal and A4 bills print in this language. The switch at the top changes only screen language.')}
        </Text>
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

      {/* 3. SHOP NAME & ADDRESS */}
      <SectionCard title={t('Shop Name & Address')} icon="storefront-outline">
        <AppTextInput
          label={t('Shop name (English)')}
          mode="outlined"
          value={shopName}
          onChangeText={setShopName}
          maxLength={150}
          style={styles.input}
        />
        {shopCode ? (
          <Text style={styles.meta}>
            {t('Shop code')}: <Text style={{ fontWeight: '700' }}>{shopCode}</Text>
          </Text>
        ) : null}

        <AppTextInput
          label={translatingShopMr ? t('Shop name (Marathi) · translating…') : t('Shop name (Marathi)')}
          mode="outlined"
          value={shopNameMr}
          onChangeText={onShopNameMrChange}
          placeholder={t('दुकानाचे नाव')}
          maxLength={150}
          style={styles.input}
        />

        <AppTextInput
          label={t('Address (English)')}
          mode="outlined"
          value={address}
          onChangeText={setAddress}
          multiline
          numberOfLines={2}
          style={styles.input}
        />

        <AppTextInput
          label={translatingAddrMr ? t('Address (Marathi) · translating…') : t('Address (Marathi)')}
          mode="outlined"
          value={addressMr}
          onChangeText={onAddressMrChange}
          placeholder={t('पत्ता')}
          multiline
          numberOfLines={2}
          maxLength={500}
          style={styles.input}
        />

        <View style={styles.row}>
          <AppTextInput
            label={t('City')}
            mode="outlined"
            value={city}
            onChangeText={setCity}
            style={[styles.input, styles.halfInput]}
          />
          <AppTextInput
            label={t('Pincode')}
            mode="outlined"
            value={pincode}
            onChangeText={setPincode}
            keyboardType="number-pad"
            maxLength={6}
            style={[styles.input, styles.halfInput]}
          />
        </View>

        <View style={styles.row}>
          <AppTextInput
            label={t('State')}
            mode="outlined"
            value={state}
            onChangeText={setState}
            placeholder={t('e.g. Maharashtra')}
            style={[styles.input, styles.halfInput]}
          />
          <AppTextInput
            label={t('State Code (GST)')}
            mode="outlined"
            value={stateCode}
            onChangeText={setStateCode}
            keyboardType="number-pad"
            maxLength={2}
            placeholder="e.g. 27"
            style={[styles.input, styles.halfInput]}
          />
        </View>
      </SectionCard>

      {/* 4. CONTACT & DIGITAL PRESENCE */}
      <SectionCard title={t('Contact & Support')} icon="phone-outline">
        <View style={styles.row}>
          <AppTextInput
            label={t('Primary Shop Phone')}
            mode="outlined"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            maxLength={10}
            style={[styles.input, styles.halfInput]}
          />
          <AppTextInput
            label={t('Secondary / WhatsApp Phone')}
            mode="outlined"
            value={secondaryPhone}
            onChangeText={setSecondaryPhone}
            keyboardType="phone-pad"
            maxLength={10}
            style={[styles.input, styles.halfInput]}
          />
        </View>

        <View style={styles.row}>
          <AppTextInput
            label={t('Shop Email')}
            mode="outlined"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            style={[styles.input, styles.halfInput]}
          />
          <AppTextInput
            label={t('Website / Social Link')}
            mode="outlined"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            placeholder="e.g. www.myshop.com"
            style={[styles.input, styles.halfInput]}
          />
        </View>
      </SectionCard>

      {/* 5. UPI PAYMENT DETAILS */}
      <SectionCard
        title={t('UPI Payment on Bills')}
        icon="qrcode-scan"
        subtitle={t('Print your UPI ID on bills so customers can easily scan & pay digitally')}>
        <AppTextInput
          label="UPI ID / VPA"
          mode="outlined"
          value={upiId}
          onChangeText={setUpiId}
          autoCapitalize="none"
          placeholder="e.g. yourshop@upi or 9876543210@okaxis"
          style={styles.input}
        />
        <Text style={styles.hint}>
          {t('When entered, "UPI: yourshop@upi" appears before the footer on printed receipts.')}
        </Text>
      </SectionCard>

      {/* 6. BILL FOOTER & TERMS & CONDITIONS */}
      <SectionCard
        title={t('Bill Footer & Terms and Conditions')}
        icon="text-box-outline"
        subtitle={t('Custom greeting and policy terms printed at the bottom of bills')}>
        <AppTextInput
          label={t('Bill footer message')}
          mode="outlined"
          value={billFooter}
          onChangeText={setBillFooter}
          placeholder={t('Thank you! Visit Again')}
          style={styles.input}
        />

        <View style={styles.dividerSpacing} />

        <View style={styles.fieldHeader}>
          <Text style={styles.fieldLabel}>{t('Terms & Conditions / Return Policy')}</Text>
        </View>

        <Text style={styles.hint}>
          {t('Quick presets: tap a business category below to auto-fill common policy terms:')}
        </Text>
        <View style={styles.presetButtonsRow}>
          {Object.entries(TERMS_PRESETS).map(([pKey, pVal]) => (
            <TouchableOpacity
              key={pKey}
              onPress={() => handleApplyTermsPreset(pKey)}
              style={styles.presetBtn}>
              <Text style={styles.presetBtnText}>{pVal.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={handleClearTerms} style={[styles.presetBtn, styles.clearBtn]}>
            <Text style={[styles.presetBtnText, styles.clearBtnText]}>{t('Clear')}</Text>
          </TouchableOpacity>
        </View>

        <AppTextInput
          label={t('Terms & Conditions (English)')}
          mode="outlined"
          value={terms}
          onChangeText={setTerms}
          multiline
          numberOfLines={3}
          placeholder={t('e.g. 1. Exchange within 7 days with bill. 2. No return without bill.')}
          style={styles.input}
        />

        <AppTextInput
          label={translatingTermsMr ? t('Terms (Marathi) · translating…') : t('Terms & Conditions (Marathi)')}
          mode="outlined"
          value={termsMr}
          onChangeText={onTermsMrChange}
          multiline
          numberOfLines={3}
          placeholder={t('उदा. १. बिलासह ७ दिवसांच्या आत वस्तू बदलून मिळेल.')}
          style={styles.input}
        />
      </SectionCard>

      {/* 7. SHOP LOGO */}
      <SectionCard title={t('Shop logo')} icon="image-outline" subtitle={t('Shown on A4 bills and thermal headers')}>
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

      {/* SAVE BUTTON */}
      <Button
        mode="contained"
        onPress={handleSave}
        loading={saving}
        disabled={saving}
        icon="content-save-outline"
        contentStyle={styles.saveBtnContent}
        style={styles.saveBtn}>
        {t('Save all settings')}
      </Button>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: 'center', alignItems: 'center' },
  title: { ...typography.h1, marginBottom: spacing.xs },
  subtitle: { ...typography.bodySm, marginBottom: spacing.lg, color: colors.textSecondary },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  halfInput: { flex: 1 },
  fieldLabel: { ...typography.bodySm, fontWeight: '700', marginBottom: spacing.xs, color: colors.text },
  fieldHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 },
  regFieldBlock: { marginBottom: spacing.sm },
  helper: { marginTop: -spacing.xs, marginBottom: spacing.xs, color: colors.textMuted },
  hint: { ...typography.bodySm, marginBottom: spacing.md, color: colors.textMuted },
  meta: { ...typography.caption, marginBottom: spacing.sm, textTransform: 'none', letterSpacing: 0, color: colors.textSecondary },
  logo: {
    width: '100%',
    height: 96,
    marginBottom: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  rowBtn: { flexGrow: 1 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  chip: { backgroundColor: colors.surfaceVariant, marginBottom: 2 },
  chipActive: { backgroundColor: colors.primaryLight },
  chipText: { color: colors.textSecondary, fontSize: 12 },
  chipTextActive: { color: colors.primary, fontWeight: '700' },
  reqBadge: { backgroundColor: colors.warningLight },
  dividerSpacing: { height: 1, backgroundColor: colors.borderLight, marginVertical: spacing.md },
  presetButtonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.md },
  presetBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceVariant,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  presetBtnText: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  clearBtn: { backgroundColor: colors.errorLight, borderColor: colors.errorLight },
  clearBtnText: { color: colors.error },
  saveBtn: { marginTop: spacing.md, marginBottom: spacing.xl },
  saveBtnContent: { paddingVertical: spacing.xs },
});
