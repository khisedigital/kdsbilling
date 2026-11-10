import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import AppTextInput from './ui/AppTextInput';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useT } from '../i18n';
import { colors } from '../theme/colors';
import { radius, spacing, typography } from '../theme/layout';

type Props = {
  values: string[];
  onChange: (values: string[]) => void;
  title?: string;
  hint?: string;
  addLabel?: string;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, '').slice(0, 18);
}

/** Extra plain barcodes for the same product/variant (manufacturer + store codes, etc.). */
export default function ExtraBarcodesEditor({
  values,
  onChange,
  title = 'Additional barcodes',
  hint = 'Optional · same item, different codes on boxes or stock',
  addLabel = 'Add barcode',
}: Props) {
  const t = useT();

  const updateAt = (index: number, barcode: string) => {
    const next = [...values];
    next[index] = digitsOnly(barcode);
    onChange(next);
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>{t(title)}</Text>
        {hint ? <Text style={styles.hint}>{t(hint)}</Text> : null}
      </View>
      {values.map((code, index) => (
        <View key={`extra-bc-${index}`} style={styles.row}>
          <AppTextInput
            label={t('Barcode {{n}}', { n: index + 2 })}
            value={code}
            onChangeText={(value) => updateAt(index, value)}
            keyboardType="number-pad"
            mode="outlined"
            dense
            placeholder={t('Scan or type')}
            style={styles.input}
          />
          <Pressable onPress={() => removeAt(index)} hitSlop={10} style={styles.remove}>
            <Icon name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ))}
      <Button mode="outlined" icon="plus" onPress={() => onChange([...values, ''])} style={styles.addBtn}>
        {t(addLabel)}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.sm },
  header: { marginBottom: spacing.sm },
  title: { fontSize: 14, fontWeight: '700', color: colors.text },
  hint: { ...typography.caption, marginTop: 2, color: colors.textMuted },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.sm },
  input: { flex: 1, backgroundColor: colors.surface },
  remove: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtn: { borderRadius: radius.md },
});
