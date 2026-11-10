import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Dialog, HelperText, Portal, Text } from 'react-native-paper';
import AppTextInput from './AppTextInput';
import { useT } from '../../i18n';
import { colors } from '../../theme/colors';
import { dialogCard, spacing, typography } from '../../theme/layout';

export type BulkImportResult = {
  success: number;
  skipped?: number;
  failed: number;
  errors?: { row: number; message: string }[];
};

type Mode = 'name' | 'supplier';

type Props = {
  visible: boolean;
  title: string;
  entityLabel: string;
  mode?: Mode;
  loading?: boolean;
  onDismiss: () => void;
  onImport: (rows: Record<string, string>[]) => Promise<BulkImportResult>;
};

function parseNameLines(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name });
  }
  return rows;
}

/** name | phone | email  — also accepts commas or tabs */
function parseSupplierLines(text: string): Record<string, string>[] {
  const rows: Record<string, string>[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/[|,\t]/).map((p) => p.trim());
    const name = parts[0] || '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name,
      phone: parts[1] || '',
      email: parts[2] || '',
    });
  }
  return rows;
}

export default function BulkImportDialog({
  visible,
  title,
  entityLabel,
  mode = 'name',
  loading = false,
  onDismiss,
  onImport,
}: Props) {
  const t = useT();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<BulkImportResult | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) {
      setText('');
      setError('');
      setResult(null);
      setSaving(false);
    }
  }, [visible]);

  const previewCount = useMemo(() => {
    const rows = mode === 'supplier' ? parseSupplierLines(text) : parseNameLines(text);
    return rows.length;
  }, [text, mode]);

  const kind = t(entityLabel);
  const hint =
    mode === 'supplier'
      ? t('One supplier per line. Optional: Name | Phone | Email')
      : t('One {{kind}} name per line', { kind });

  const handleImport = async () => {
    const rows = mode === 'supplier' ? parseSupplierLines(text) : parseNameLines(text);
    if (!rows.length) {
      setError(t('Paste at least one {{kind}} name', { kind }));
      return;
    }
    setSaving(true);
    setError('');
    setResult(null);
    try {
      const summary = await onImport(rows);
      setResult(summary);
      if (summary.failed === 0) {
        // Keep dialog open briefly with summary; user closes after reading.
      }
    } catch (err) {
      const message = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
        ?.message;
      setError(message ? t(message) : t('Could not import {{kind}}', { kind }));
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || saving;
  const done = !!result && result.failed === 0 && result.success + (result.skipped || 0) > 0;

  return (
    <Portal>
      <Dialog visible={visible} onDismiss={() => !busy && onDismiss()} style={styles.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Content>
          <Text style={styles.hint}>{hint}</Text>
          <AppTextInput
            label={t('Paste {{kind}} list', { kind })}
            value={text}
            onChangeText={(value) => {
              setText(value);
              setError('');
              setResult(null);
            }}
            mode="outlined"
            multiline
            numberOfLines={8}
            style={styles.input}
            placeholder={
              mode === 'supplier'
                ? 'Acme Traders | 9876543210 | acme@mail.com\nFresh Foods'
                : 'Snacks\nBeverages\nDairy'
            }
            disabled={busy || done}
          />
          <Text style={styles.count}>
            {previewCount
              ? t('{{count}} {{kind}} ready', { count: previewCount, kind })
              : t('No rows yet')}
          </Text>
          {error ? <HelperText type="error" visible>{error}</HelperText> : null}
          {result ? (
            <View style={styles.resultBox}>
              <Text style={styles.resultText}>
                {t('Added {{count}}', { count: result.success })}
                {result.skipped ? t(' · skipped {{count}} existing', { count: result.skipped }) : ''}
                {result.failed ? t(' · failed {{count}}', { count: result.failed }) : ''}
              </Text>
              {(result.errors || []).slice(0, 3).map((item) => (
                <Text key={`${item.row}-${item.message}`} style={styles.resultErr}>
                  {t('Row {{row}}: {{message}}', { row: item.row, message: t(item.message) })}
                </Text>
              ))}
            </View>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={onDismiss} disabled={busy}>
            {done ? t('Done') : t('Cancel')}
          </Button>
          {!done ? (
            <Button mode="contained" onPress={handleImport} loading={busy} disabled={!previewCount || busy}>
              {t('Import')}
            </Button>
          ) : null}
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  dialog: { ...dialogCard },
  hint: { ...typography.bodySm, marginBottom: spacing.sm, color: colors.textSecondary },
  input: {
    minHeight: 140,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  count: { ...typography.caption, marginTop: 4 },
  resultBox: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.secondaryLight,
  },
  resultText: { fontSize: 13, fontWeight: '700', color: colors.secondary },
  resultErr: { ...typography.caption, color: colors.error, marginTop: 2 },
});
