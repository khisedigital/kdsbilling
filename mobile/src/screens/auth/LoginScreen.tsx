import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  View,
} from 'react-native';
import { Button, HelperText, Text, TextInput } from 'react-native-paper';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { APP_DISPLAY_NAME } from '../../constants/branding';
import { formatMobileDisplay } from '../../utils/phone';
import { colors } from '../../theme/colors';
import { radius, spacing } from '../../theme/layout';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const login = useAuthStore((s) => s.login);
  const savedLogin = useAuthStore((s) => s.savedLogin);
  const clearSavedLogin = useAuthStore((s) => s.clearSavedLogin);
  const isReturning = !!savedLogin;

  const [shopCode, setShopCode] = useState(savedLogin?.shopCode ?? '');
  const [mobile, setMobile] = useState(savedLogin?.mobile ?? '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const brandOpacity = useRef(new Animated.Value(0)).current;
  const brandScale = useRef(new Animated.Value(0.92)).current;
  const formOpacity = useRef(new Animated.Value(0)).current;
  const formY = useRef(new Animated.Value(36)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(brandOpacity, {
          toValue: 1,
          duration: 480,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(brandScale, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(formOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(formY, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [brandOpacity, brandScale, formOpacity, formY]);

  const handleLogin = async () => {
    setError('');
    const code = (isReturning ? savedLogin!.shopCode : shopCode).trim();
    const phone = (isReturning ? savedLogin!.mobile : mobile).trim();
    if (!code || !phone || !password.trim()) {
      setError(isReturning ? 'Enter your password' : 'Fill all fields');
      return;
    }
    setLoading(true);
    try {
      await login(code, phone, password);
    } catch (err: unknown) {
      const e = err as { message?: string; response?: { data?: { error?: { message?: string } } } };
      setError(e?.response?.data?.error?.message || e?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const switchAccount = () => {
    clearSavedLogin();
    setShopCode('');
    setMobile('');
    setPassword('');
    setError('');
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor="#003087" />
      <View style={styles.backdrop} pointerEvents="none">
        <View style={styles.mesh} />
        <View style={styles.beam} />
        <View style={styles.orbTop} />
        <View style={styles.orbBottom} />
        <View style={styles.gridFade} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            {
              paddingTop: insets.top + spacing.xxl,
              paddingBottom: Math.max(insets.bottom, spacing.xl) + spacing.lg,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}>
          <Animated.View
            style={[
              styles.brandBlock,
              { opacity: brandOpacity, transform: [{ scale: brandScale }] },
            ]}>
            <View style={styles.logoRing}>
              <View style={styles.logoPlate}>
                <Image
                  source={require('../../assets/logo.png')}
                  style={styles.logo}
                  resizeMode="contain"
                  accessibilityLabel={APP_DISPLAY_NAME}
                />
              </View>
            </View>
            <Text style={styles.brand}>{APP_DISPLAY_NAME}</Text>
            <Text style={styles.tagline}>
              {isReturning ? 'Welcome back to your counter' : 'Fast billing for your shop'}
            </Text>
          </Animated.View>

          <Animated.View
            style={[
              styles.card,
              {
                opacity: formOpacity,
                transform: [{ translateY: formY }],
              },
            ]}>
            <View style={styles.cardAccent} />
            <Text style={styles.formTitle}>{isReturning ? 'Unlock register' : 'Sign in'}</Text>
            <Text style={styles.formSub}>
              {isReturning
                ? 'Enter your password to continue'
                : 'Shop code, mobile number and password'}
            </Text>

            {isReturning ? (
              <View style={styles.savedBox}>
                <View style={styles.savedAvatar}>
                  <Icon name="storefront-outline" size={22} color={colors.textOnPrimary} />
                </View>
                <View style={styles.savedMeta}>
                  <Text style={styles.savedShop}>{savedLogin!.shopCode}</Text>
                  <Text style={styles.savedPhone}>{formatMobileDisplay(savedLogin!.mobile)}</Text>
                </View>
                <Pressable
                  onPress={switchAccount}
                  hitSlop={10}
                  style={({ pressed }) => [styles.switchBtn, pressed && styles.pressed]}>
                  <Text style={styles.switch}>Switch</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  label="Shop code"
                  value={shopCode}
                  onChangeText={setShopCode}
                  mode="outlined"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus={false}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  left={<TextInput.Icon icon="storefront-outline" color={colors.primary} />}
                />
                <TextInput
                  label="Mobile number"
                  value={mobile}
                  onChangeText={setMobile}
                  mode="outlined"
                  keyboardType="phone-pad"
                  maxLength={10}
                  autoFocus={false}
                  style={styles.input}
                  outlineColor={colors.border}
                  activeOutlineColor={colors.primary}
                  left={<TextInput.Icon icon="cellphone" color={colors.primary} />}
                />
              </>
            )}

            <TextInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              mode="outlined"
              secureTextEntry={!showPassword}
              autoFocus={false}
              style={styles.input}
              outlineColor={colors.border}
              activeOutlineColor={colors.primary}
              left={<TextInput.Icon icon="lock-outline" color={colors.primary} />}
              right={
                <TextInput.Icon
                  icon={showPassword ? 'eye-off-outline' : 'eye-outline'}
                  onPress={() => setShowPassword((v) => !v)}
                />
              }
              onSubmitEditing={handleLogin}
            />

            {error ? (
              <HelperText type="error" visible style={styles.error}>
                {error}
              </HelperText>
            ) : null}

            <Button
              mode="contained"
              onPress={handleLogin}
              loading={loading}
              disabled={loading}
              buttonColor={colors.primary}
              textColor={colors.textOnPrimary}
              style={styles.btn}
              contentStyle={styles.btnContent}
              labelStyle={styles.btnLabel}
              icon={loading ? undefined : 'login'}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </Animated.View>

          <Text style={styles.footer}>Khise Digital Solution Pvt Ltd</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#003087' },
  flex: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  mesh: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.primary,
  },
  beam: {
    position: 'absolute',
    top: -80,
    left: -40,
    right: -40,
    height: 320,
    backgroundColor: colors.secondary,
    opacity: 0.28,
    transform: [{ rotate: '-8deg' }],
  },
  orbTop: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(255,255,255,0.10)',
    top: -70,
    right: -70,
  },
  orbBottom: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(30,144,255,0.22)',
    bottom: 120,
    left: -80,
  },
  gridFade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '42%',
    backgroundColor: 'rgba(0,27,72,0.18)',
  },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    justifyContent: 'center',
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: spacing.xxl,
  },
  logoRing: {
    padding: 6,
    borderRadius: radius.xl + 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    marginBottom: spacing.lg,
  },
  logoPlate: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#001B48',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.25,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  logo: { width: 72, height: 72 },
  brand: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.textOnPrimary,
    letterSpacing: -0.8,
    textAlign: 'center',
  },
  tagline: {
    marginTop: spacing.sm,
    fontSize: 15,
    lineHeight: 22,
    color: 'rgba(255,255,255,0.86)',
    textAlign: 'center',
    maxWidth: 280,
  },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#001B48',
        shadowOffset: { width: 0, height: 16 },
        shadowOpacity: 0.2,
        shadowRadius: 28,
      },
      android: { elevation: 12 },
      default: {},
    }),
  },
  cardAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: colors.secondary,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: colors.text,
    letterSpacing: -0.3,
    marginBottom: spacing.xs,
  },
  formSub: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.textMuted,
    marginBottom: spacing.xl,
  },
  savedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.primaryLight,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
    borderColor: 'rgba(0,82,212,0.14)',
  },
  savedAvatar: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedMeta: { flex: 1, minWidth: 0 },
  savedShop: { fontSize: 16, fontWeight: '700', color: colors.primary },
  savedPhone: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  switchBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  switch: { fontSize: 13, color: colors.primary, fontWeight: '700' },
  pressed: { opacity: 0.75 },
  input: { marginBottom: spacing.md, backgroundColor: colors.surface },
  error: { marginBottom: spacing.sm, marginTop: -spacing.xs },
  btn: { borderRadius: radius.md, marginTop: spacing.sm },
  btnContent: { paddingVertical: spacing.sm + 2 },
  btnLabel: { fontSize: 16, fontWeight: '700', letterSpacing: 0.2 },
  footer: {
    marginTop: spacing.xxl,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.55)',
  },
});
