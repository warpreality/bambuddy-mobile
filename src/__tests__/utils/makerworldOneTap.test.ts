import { parseMakerworldModelUrl, pickOneTapInstance } from '@/utils/makerworldOneTap';

describe('parseMakerworldModelUrl', () => {
  it('reads model id from localized model pages', () => {
    expect(parseMakerworldModelUrl('https://makerworld.com/en/models/1234567-cool-vase?from=search')).toMatchObject({ modelId: 1234567, profileId: null });
    expect(parseMakerworldModelUrl('https://makerworld.com/models/42')).toMatchObject({ modelId: 42, profileId: null });
    expect(parseMakerworldModelUrl('https://www.makerworld.com/zh-hans/models/7-x')).toMatchObject({ modelId: 7 });
  });

  it('reads the selected print profile from the hash', () => {
    expect(parseMakerworldModelUrl('https://makerworld.com/en/models/1234567-vase#profileId-987654')).toMatchObject({ modelId: 1234567, profileId: 987654 });
  });

  it('ignores non-model pages and other hosts', () => {
    expect(parseMakerworldModelUrl('https://makerworld.com/en')).toBeNull();
    expect(parseMakerworldModelUrl('https://makerworld.com/en/search/models?keyword=vase')).toBeNull();
    expect(parseMakerworldModelUrl('https://evil.example/makerworld.com/models/1')).toBeNull();
    expect(parseMakerworldModelUrl(undefined)).toBeNull();
  });
});

describe('pickOneTapInstance', () => {
  const instances = [{ id: 1, profileId: 10 }, { id: 2, profileId: 20 }];
  it('prefers the selected profile and falls back to the first', () => {
    expect(pickOneTapInstance(instances, 20)).toBe(instances[1]);
    expect(pickOneTapInstance(instances, 99)).toBe(instances[0]);
    expect(pickOneTapInstance(instances, null)).toBe(instances[0]);
    expect(pickOneTapInstance([], 10)).toBeNull();
  });
});

describe('pickOneTapInstance with MakerWorld hash ids', () => {
  it('matches the instance id carried by #profileId-N', () => {
    const instances = [{ id: 3387944, profileId: 858421954 }, { id: 3388324, profileId: 1 }];
    expect(pickOneTapInstance(instances, 3388324)).toBe(instances[1]);
  });
  it('falls back to the default instance', () => {
    const instances = [{ id: 1, profileId: 1 }, { id: 2, profileId: 2, isDefault: true }];
    expect(pickOneTapInstance(instances, null)).toBe(instances[1]);
  });
});

import { describeOneTapRun, isIncompatible3mfError, isOneTapStageFinal } from '@/utils/makerworldOneTap';

describe('describeOneTapRun', () => {
  it('treats an in_progress run whose slice failed as a failure (real server payload)', () => {
    const stage = describeOneTapRun({
      status: 'in_progress',
      error_message: 'Slice failed: Invalid parameter value(s) included in the 3mf file.',
      jobs: [
        { status: 'pending', queue_entry_id: null, error_message: null },
        { status: 'pending', queue_entry_id: null, error_message: null },
        { status: 'pending', queue_entry_id: null, error_message: null },
      ],
    });
    expect(stage).toEqual({ kind: 'failed', error: 'Slice failed: Invalid parameter value(s) included in the 3mf file.' });
    expect(isOneTapStageFinal(stage)).toBe(true);
    expect(isIncompatible3mfError(stage.kind === 'failed' ? stage.error : null)).toBe(true);
  });

  it('reports the queue entry while the job waits for the printer', () => {
    expect(describeOneTapRun({
      status: 'in_progress',
      jobs: [{ status: 'queued', queue_entry_id: 42, assigned_printer_name: 'Home' }],
    })).toEqual({ kind: 'waiting', queueItemId: 42, printerName: 'Home' });
  });

  it('only reports success once the printer is printing', () => {
    expect(describeOneTapRun({ status: 'in_progress', jobs: [{ status: 'pending' }] })).toEqual({ kind: 'dispatching' });
    const printing = describeOneTapRun({ status: 'in_progress', jobs: [{ status: 'printing', assigned_printer_name: 'Home' }] });
    expect(printing).toEqual({ kind: 'printing', printerName: 'Home' });
    expect(isOneTapStageFinal(printing)).toBe(true);
    expect(describeOneTapRun({ status: 'completed', jobs: [{ status: 'completed' }] })).toEqual({ kind: 'completed' });
  });

  it('maps early and terminal run statuses', () => {
    expect(describeOneTapRun({ status: 'queued' })).toEqual({ kind: 'queued' });
    expect(describeOneTapRun({ status: 'slicing' })).toEqual({ kind: 'slicing' });
    expect(describeOneTapRun({ status: 'failed', error_message: 'boom' })).toEqual({ kind: 'failed', error: 'boom' });
    expect(describeOneTapRun({ status: 'cancelled' })).toEqual({ kind: 'cancelled' });
    expect(describeOneTapRun({ status: 'in_progress', jobs: [{ status: 'failed', error_message: 'offline' }] }))
      .toEqual({ kind: 'failed', error: 'offline' });
  });
});
