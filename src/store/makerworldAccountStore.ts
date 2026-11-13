import { create } from 'zustand';
import { makerworldAccountApi, makerworldSession, MakerworldAuthError, type MakerworldUser } from '@/api/makerworldAccount';

interface MakerworldAccountState {
  token: string | null;
  user: MakerworldUser | null;
  loaded: boolean;
  load: () => Promise<void>;
  /** Validates the token from the sign-in WebView and stores it. */
  signIn: (token: string) => Promise<MakerworldUser>;
  signOut: () => Promise<void>;
  /** Call when MakerWorld rejects the token. */
  expire: () => Promise<void>;
}

export const useMakerworldAccount = create<MakerworldAccountState>((set, get) => ({
  token: null,
  user: null,
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const token = await makerworldSession.loadToken();
    set({ token, loaded: true });
    if (!token) return;
    try {
      set({ user: await makerworldAccountApi.me(token) });
    } catch (error) {
      if (error instanceof MakerworldAuthError) await get().expire();
    }
  },
  signIn: async token => {
    const user = await makerworldAccountApi.me(token);
    await makerworldSession.saveToken(token);
    set({ token, user, loaded: true });
    return user;
  },
  signOut: async () => {
    set({ token: null, user: null, loaded: true });
    await makerworldSession.saveToken(null);
    await makerworldSession.clearWebView();
  },
  expire: async () => {
    set({ token: null, user: null, loaded: true });
    await makerworldSession.saveToken(null);
  },
}));
