import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { makerworldSession, MakerworldAuthError } from '@/api/makerworldAccount';
import { useMakerworldAccount } from '@/store/makerworldAccountStore';
import { useTheme } from '@/theme';
import { fontSize, fontWeight, spacing } from '@/theme/tokens';
import { useCatalogStrings } from '@/screens/makerworldCatalogStrings';

const SIGN_IN_URL = 'https://makerworld.com/';
const POLL_MS = 1500;

/** Opens makerworld.com; as soon as the user has signed in there, picks up the session and closes. */
export function MakerWorldSignInSheet({ visible, onClose, onSignedIn }: {
  visible: boolean;
  onClose: () => void;
  onSignedIn?: (name: string) => void;
}) {
  const s = useCatalogStrings();
  const { colors } = useTheme();
  const signIn = useMakerworldAccount(state => state.signIn);
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const rejected = useRef<string | null>(null);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const token = await makerworldSession.readWebViewToken();
      if (!token || token === rejected.current) return;
      setChecking(true);
      try {
        const user = await signIn(token);
        onSignedIn?.(user.name);
        onClose();
      } catch (error) {
        // A stale cookie from an old session: wait for a fresh sign-in.
        if (error instanceof MakerworldAuthError) rejected.current = token;
      } finally {
        setChecking(false);
      }
    } finally {
      busy.current = false;
    }
  }, [signIn, onSignedIn, onClose]);

  useEffect(() => {
    if (!visible) return;
    rejected.current = null;
    void check();
    const timer = setInterval(() => void check(), POLL_MS);
    return () => clearInterval(timer);
  }, [visible, check]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.flex}>
              <Text style={[styles.title, { color: colors.text }]}>{s.signInTitle}</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{s.signInHint}</Text>
            </View>
            {checking ? <ActivityIndicator color={colors.accent} /> : null}
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel={s.close}>
              <X size={22} color={colors.text} />
            </Pressable>
          </View>
          {visible ? (
            <WebView
              source={{ uri: SIGN_IN_URL }}
              sharedCookiesEnabled
              onNavigationStateChange={() => void check()}
              startInLoadingState
              style={styles.flex}
            />
          ) : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  hint: { fontSize: fontSize.sm, marginTop: 2 },
});
