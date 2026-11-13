// The user's own MakerWorld account: likes and bookmarks (collections).
// Sign-in happens on makerworld.com in a WebView; the site's access token is read from
// the WebView cookie store by the MakerWorldSession native module and kept in the Keychain.
// Authenticated calls go to api.bambulab.com with a Bearer token, like Bambu Handy does.
import { NativeModules } from 'react-native';
import * as Keychain from 'react-native-keychain';
import type { CatalogHit } from './makerworldCatalog';

export const MAKERWORLD_ACCOUNT_SERVICE = 'bambuddy.makerworld.account';
const API = 'https://api.bambulab.com/v1';

export type MakerworldUser = { uid: number; name: string; handle?: string; avatar?: string };
export type DesignSocialState = { hasLike: boolean; hasCollect: boolean; likeCount: number; collectionCount: number };
export type MakerworldCollection = { id: number; title: string; isDefault?: boolean; designCnt?: number };

export class MakerworldAuthError extends Error {
  constructor() {
    super('MakerWorld sign-in expired');
    this.name = 'MakerworldAuthError';
  }
}

type NativeSession = {
  readToken: () => Promise<{ token: string; domain: string; expiresAt?: number } | null>;
  clear: () => Promise<number>;
};

function nativeSession(): NativeSession | null {
  return (NativeModules.MakerWorldSession as NativeSession | undefined) ?? null;
}

export const makerworldSession = {
  /** Token from the sign-in WebView, or null when the user has not signed in there yet. */
  readWebViewToken: async (): Promise<string | null> => {
    const session = nativeSession();
    if (!session) return null;
    const cookie = await session.readToken().catch(() => null);
    return cookie?.token ?? null;
  },
  clearWebView: async () => { await nativeSession()?.clear().catch(() => 0); },
  isAvailable: () => nativeSession() !== null,
  loadToken: async (): Promise<string | null> => {
    try {
      const creds = await Keychain.getGenericPassword({ service: MAKERWORLD_ACCOUNT_SERVICE });
      return creds ? creds.password : null;
    } catch {
      return null;
    }
  },
  saveToken: async (token: string | null) => {
    if (token) await Keychain.setGenericPassword('makerworld', token, { service: MAKERWORLD_ACCOUNT_SERVICE });
    else await Keychain.resetGenericPassword({ service: MAKERWORLD_ACCOUNT_SERVICE });
  },
};

async function call<T>(token: string, path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });
  if (response.status === 401 || response.status === 403) throw new MakerworldAuthError();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export function socialState(raw: Partial<DesignSocialState> | null | undefined): DesignSocialState {
  return {
    hasLike: Boolean(raw?.hasLike),
    hasCollect: Boolean(raw?.hasCollect),
    likeCount: Number(raw?.likeCount) || 0,
    collectionCount: Number(raw?.collectionCount) || 0,
  };
}

/** Optimistic state after a like/bookmark toggle, mirroring what makerworld.com shows. */
export function toggledState(state: DesignSocialState, field: 'like' | 'collect'): DesignSocialState {
  if (field === 'like') {
    return { ...state, hasLike: !state.hasLike, likeCount: Math.max(0, state.likeCount + (state.hasLike ? -1 : 1)) };
  }
  return { ...state, hasCollect: !state.hasCollect, collectionCount: Math.max(0, state.collectionCount + (state.hasCollect ? -1 : 1)) };
}

export function defaultCollection(raw: { hits?: MakerworldCollection[] | null; default?: MakerworldCollection | null } | null | undefined) {
  return raw?.default ?? raw?.hits?.find(item => item.isDefault) ?? raw?.hits?.[0] ?? null;
}

export const makerworldAccountApi = {
  me: async (token: string, signal?: AbortSignal): Promise<MakerworldUser> => {
    const raw = await call<MakerworldUser>(token, '/design-user-service/my/profile', { signal });
    return { uid: raw.uid, name: raw.name, handle: raw.handle, avatar: raw.avatar };
  },
  design: async (token: string, id: number, signal?: AbortSignal) =>
    socialState(await call<Partial<DesignSocialState>>(token, `/design-service/design/${id}`, { signal })),
  setLike: async (token: string, id: number, liked: boolean) => {
    await call(token, `/design-service/design/${id}/like`, { method: liked ? 'POST' : 'DELETE', body: { id } });
  },
  collections: async (token: string) =>
    call<{ hits?: MakerworldCollection[]; default?: MakerworldCollection }>(token, '/design-service/my/favorites/listlite'),
  /** Puts the model into the default collection, or takes it out of every collection. */
  setCollected: async (token: string, id: number, collected: boolean) => {
    let favoritesIds: number[] = [];
    if (collected) {
      const target = defaultCollection(await makerworldAccountApi.collections(token));
      if (!target) throw new Error('No MakerWorld collection');
      favoritesIds = [target.id];
    }
    await call(token, '/design-service/my/design/favoriteslist', {
      method: 'PUT',
      body: { designId: id, favoritesIds, operateType: 'collection' },
    });
  },
  /** Models in the default collection, newest first. */
  bookmarks: async (token: string, offset: number, limit: number, signal?: AbortSignal) => {
    const target = defaultCollection(await makerworldAccountApi.collections(token));
    if (!target) return { total: 0, hits: [] as CatalogHit[] };
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    const raw = await call<{ total?: number; hits?: CatalogHit[] }>(token, `/design-service/favorites/${target.id}/designs?${params}`, { signal });
    const hits = (raw?.hits ?? []).filter(hit => hit && typeof hit.id === 'number' && !hit.nsfw);
    return { total: Number(raw?.total) || hits.length, hits };
  },
};
