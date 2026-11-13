import { NativeModules } from 'react-native';
import * as Keychain from 'react-native-keychain';
import {
  defaultCollection,
  makerworldAccountApi,
  makerworldSession,
  MakerworldAuthError,
  socialState,
  toggledState,
} from '@/api/makerworldAccount';

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;
});

function reply(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: () => Promise.resolve(body === undefined ? '' : JSON.stringify(body)) });
}

describe('MakerWorld social state', () => {
  it('reads the flags MakerWorld returns for a signed-in user', () => {
    expect(socialState({ hasLike: true, hasCollect: false, likeCount: 32, collectionCount: 92 }))
      .toEqual({ hasLike: true, hasCollect: false, likeCount: 32, collectionCount: 92 });
    expect(socialState(null)).toEqual({ hasLike: false, hasCollect: false, likeCount: 0, collectionCount: 0 });
  });

  it('toggles like and bookmark with their counters', () => {
    const base = { hasLike: false, hasCollect: true, likeCount: 32, collectionCount: 1 };
    expect(toggledState(base, 'like')).toEqual({ ...base, hasLike: true, likeCount: 33 });
    expect(toggledState(base, 'collect')).toEqual({ ...base, hasCollect: false, collectionCount: 0 });
    expect(toggledState({ ...base, hasLike: true, likeCount: 0 }, 'like').likeCount).toBe(0);
  });

  it('picks the default collection', () => {
    const hits = [{ id: 1, title: 'A' }, { id: 2, title: 'Default Collection', isDefault: true }];
    expect(defaultCollection({ hits, default: { id: 9, title: 'D' } })?.id).toBe(9);
    expect(defaultCollection({ hits })?.id).toBe(2);
    expect(defaultCollection({ hits: [] })).toBeNull();
  });
});

describe('makerworldAccountApi', () => {
  it('likes and unlikes with a Bearer token like makerworld.com does', async () => {
    fetchMock.mockImplementation(() => reply(200, {}));
    await makerworldAccountApi.setLike('tok', 42, true);
    await makerworldAccountApi.setLike('tok', 42, false);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.bambulab.com/v1/design-service/design/42/like');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ id: 42 }) });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('bookmarks into the default collection and removes from all collections', async () => {
    fetchMock
      .mockImplementationOnce(() => reply(200, { hits: [{ id: 26749195, title: 'Default Collection', isDefault: true }], default: { id: 26749195, title: 'Default Collection' } }))
      .mockImplementation(() => reply(200, undefined));
    await makerworldAccountApi.setCollected('tok', 7, true);
    await makerworldAccountApi.setCollected('tok', 7, false);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.bambulab.com/v1/design-service/my/favorites/listlite');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.bambulab.com/v1/design-service/my/design/favoriteslist');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ designId: 7, favoritesIds: [26749195], operateType: 'collection' });
    expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ designId: 7, favoritesIds: [], operateType: 'collection' });
  });

  it('lists bookmarks from the default collection and hides nsfw models', async () => {
    fetchMock
      .mockImplementationOnce(() => reply(200, { default: { id: 5, title: 'Default' } }))
      .mockImplementationOnce(() => reply(200, { total: 2, hits: [{ id: 1, title: 'A' }, { id: 2, title: 'B', nsfw: true }] }));
    const page = await makerworldAccountApi.bookmarks('tok', 20, 20);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.bambulab.com/v1/design-service/favorites/5/designs?offset=20&limit=20');
    expect(page).toEqual({ total: 2, hits: [{ id: 1, title: 'A' }] });
  });

  it('reports an expired sign-in separately', async () => {
    fetchMock.mockImplementation(() => reply(401, { message: 'unauthorized' }));
    await expect(makerworldAccountApi.me('old')).rejects.toBeInstanceOf(MakerworldAuthError);
    fetchMock.mockImplementation(() => reply(500, {}));
    await expect(makerworldAccountApi.me('tok')).rejects.not.toBeInstanceOf(MakerworldAuthError);
  });
});

describe('makerworldSession', () => {
  afterEach(() => { delete (NativeModules as Record<string, unknown>).MakerWorldSession; });

  it('reads the token cookie through the native module', async () => {
    (NativeModules as Record<string, unknown>).MakerWorldSession = {
      readToken: jest.fn().mockResolvedValue({ token: 'abc', domain: '.makerworld.com' }),
      clear: jest.fn().mockResolvedValue(1),
    };
    await expect(makerworldSession.readWebViewToken()).resolves.toBe('abc');
  });

  it('returns null without the native module or cookie', async () => {
    await expect(makerworldSession.readWebViewToken()).resolves.toBeNull();
    (NativeModules as Record<string, unknown>).MakerWorldSession = { readToken: jest.fn().mockResolvedValue(null), clear: jest.fn() };
    await expect(makerworldSession.readWebViewToken()).resolves.toBeNull();
  });

  it('keeps the token in its own Keychain entry', async () => {
    await makerworldSession.saveToken('abc');
    expect(Keychain.setGenericPassword).toHaveBeenCalledWith('makerworld', 'abc', { service: 'bambuddy.makerworld.account' });
    await makerworldSession.saveToken(null);
    expect(Keychain.resetGenericPassword).toHaveBeenCalledWith({ service: 'bambuddy.makerworld.account' });
  });
});
