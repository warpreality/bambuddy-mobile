import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, Heart } from 'lucide-react-native';
import {
  makerworldAccountApi,
  MakerworldAuthError,
  socialState,
  toggledState,
  type DesignSocialState,
} from '@/api/makerworldAccount';
import { formatCount } from '@/api/makerworldCatalog';
import { useToast } from '@/contexts/ToastContext';
import { useMakerworldAccount } from '@/store/makerworldAccountStore';
import { useTheme } from '@/theme';
import { fontSize, fontWeight, spacing } from '@/theme/tokens';
import { fill, useCatalogStrings } from '@/screens/makerworldCatalogStrings';
import { MakerWorldSignInSheet } from './MakerWorldSignInSheet';

type Field = 'like' | 'collect';

/** Like and bookmark buttons that write to the user's MakerWorld account. */
export function MakerWorldSocialBar({ designId, initial }: { designId: number; initial: Partial<DesignSocialState> }) {
  const s = useCatalogStrings();
  const { colors } = useTheme();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const token = useMakerworldAccount(state => state.token);
  const uid = useMakerworldAccount(state => state.user?.uid ?? null);
  const load = useMakerworldAccount(state => state.load);
  const expire = useMakerworldAccount(state => state.expire);
  const [signInOpen, setSignInOpen] = useState(false);
  const [pending, setPending] = useState<Field | null>(null);
  const [override, setOverride] = useState<DesignSocialState | null>(null);
  useEffect(() => { void load(); }, [load]);

  const query = useQuery({
    queryKey: ['makerworldSocial', designId, uid],
    queryFn: ({ signal }) => makerworldAccountApi.design(token!, designId, signal),
    enabled: Boolean(token),
    staleTime: 60 * 1000,
  });
  useEffect(() => {
    if (query.error instanceof MakerworldAuthError) void expire();
  }, [query.error, expire]);
  useEffect(() => { setOverride(null); }, [designId, uid]);

  const state = override ?? (token && query.data ? query.data : socialState({ ...initial, hasLike: false, hasCollect: false }));

  const toggle = async (field: Field) => {
    if (!token) { setSignInOpen(true); return; }
    if (pending || !query.data && !override) return;
    const before = state;
    const after = toggledState(before, field);
    setOverride(after);
    setPending(field);
    try {
      if (field === 'like') await makerworldAccountApi.setLike(token, designId, after.hasLike);
      else await makerworldAccountApi.setCollected(token, designId, after.hasCollect);
      queryClient.setQueryData(['makerworldSocial', designId, uid], after);
      if (field === 'collect') void queryClient.invalidateQueries({ queryKey: ['makerworldBookmarks'] });
    } catch (error) {
      setOverride(before);
      if (error instanceof MakerworldAuthError) {
        await expire();
        showToast(s.sessionExpired, 'error');
      } else {
        showToast(s.actionFailed, 'error');
      }
    } finally {
      setPending(null);
    }
  };

  const loadingState = Boolean(token) && query.isPending && !override;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Chip
          active={state.hasLike}
          activeColor={colors.error}
          busy={pending === 'like' || loadingState}
          icon={<Heart size={18} color={state.hasLike ? colors.error : colors.text} fill={state.hasLike ? colors.error : 'transparent'} />}
          label={`${s.like} · ${formatCount(state.likeCount)}`}
          onPress={() => void toggle('like')}
        />
        <Chip
          active={state.hasCollect}
          activeColor={colors.accent}
          busy={pending === 'collect' || loadingState}
          icon={<Bookmark size={18} color={state.hasCollect ? colors.accent : colors.text} fill={state.hasCollect ? colors.accent : 'transparent'} />}
          label={state.hasCollect ? s.bookmarked : s.bookmark}
          onPress={() => void toggle('collect')}
        />
      </View>
      {!token ? (
        <Pressable onPress={() => setSignInOpen(true)} hitSlop={6}>
          <Text style={[styles.hint, { color: colors.accent }]}>{s.signInToReact}</Text>
        </Pressable>
      ) : null}
      <MakerWorldSignInSheet
        visible={signInOpen}
        onClose={() => setSignInOpen(false)}
        onSignedIn={name => showToast(fill(s.signedInAs, { name }), 'success')}
      />
    </View>
  );
}

function Chip({ active, activeColor, busy, icon, label, onPress }: {
  active: boolean;
  activeColor: string;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      accessibilityState={{ selected: active, busy }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, {
        borderColor: active ? activeColor : colors.border,
        backgroundColor: active ? colors.surfaceElevated : 'transparent',
        opacity: pressed ? 0.7 : 1,
      }]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textSecondary} /> : icon}
      <Text style={[styles.chipText, { color: active ? activeColor : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: 999, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg },
  chipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  hint: { fontSize: fontSize.sm },
});
