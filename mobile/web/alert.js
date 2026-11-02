import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native-web';

/**
 * react-native-web's Alert.alert is a no-op, so app-wide alerts would silently vanish.
 * Calls are queued here and rendered by <AlertHost /> with the same button semantics as React Native.
 */
const queue = [];
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener(queue[0] || null));
}

export const Alert = {
  alert(title, message, buttons, options) {
    const list = Array.isArray(buttons) && buttons.length ? buttons : [{ text: 'OK' }];
    queue.push({ title: title ?? '', message: message ?? '', buttons: list, options: options || {} });
    if (queue.length === 1) emit();
  },
  prompt(title, message) {
    Alert.alert(title, message);
  },
};

function close(button) {
  queue.shift();
  emit();
  if (button && typeof button.onPress === 'function') {
    setTimeout(() => button.onPress(), 0);
  }
}

export function AlertHost() {
  const [current, setCurrent] = useState(queue[0] || null);

  useEffect(() => {
    listeners.add(setCurrent);
    return () => listeners.delete(setCurrent);
  }, []);

  useEffect(() => {
    if (!current) return undefined;
    const cancelButton = current.buttons.find((b) => b.style === 'cancel');
    const primaryButton = [...current.buttons].reverse().find((b) => b.style !== 'cancel') || current.buttons[0];

    const onKey = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        close(primaryButton);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        if (cancelButton) close(cancelButton);
        else if (current.options.cancelable !== false) close(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [current]);

  if (!current) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => close(null)}>
      <View style={styles.backdrop}>
        <View style={styles.box} accessibilityRole="alert">
          {current.title ? <Text style={styles.title}>{current.title}</Text> : null}
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={styles.actions}>
            {current.buttons.map((button, index) => {
              const destructive = button.style === 'destructive';
              const cancel = button.style === 'cancel';
              const primary = !cancel && index === current.buttons.length - 1;
              return (
                <Pressable
                  key={`${button.text}-${index}`}
                  onPress={() => close(button)}
                  style={({ hovered }) => [
                    styles.button,
                    primary && styles.buttonPrimary,
                    destructive && styles.buttonDestructive,
                    hovered && styles.buttonHover,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      primary && styles.buttonTextPrimary,
                      destructive && styles.buttonTextPrimary,
                    ]}
                  >
                    {button.text || 'OK'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 27, 72, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 24,
    boxShadow: '0 18px 48px rgba(0, 27, 72, 0.25)',
  },
  title: { fontSize: 18, fontWeight: '700', color: '#001B48', marginBottom: 8 },
  message: { fontSize: 14, lineHeight: 21, color: '#3A4A66', marginBottom: 8 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 16 },
  button: {
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
  },
  buttonPrimary: { backgroundColor: '#0052D4', borderColor: '#0052D4' },
  buttonDestructive: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  buttonHover: { opacity: 0.88 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#001B48' },
  buttonTextPrimary: { color: '#FFFFFF' },
});
