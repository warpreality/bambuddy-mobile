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

import { printerIsPrintingFile } from '@/utils/makerworldOneTap';
import { describeOneTapQueueItem, pipelinePlateSliceRequest, pipelineQueueTarget, plateCaption } from '@/utils/makerworldOneTap';

describe('printerIsPrintingFile', () => {
  it('matches the printer task to the imported file (real server names)', () => {
    expect(printerIsPrintingFile({ state: 'RUNNING', subtask_name: 'Reinigung_Gewindespindel_1fach', gcode_file: 'Metadata/plate_1.gcode' },
      'Reinigung Gewindespindel 1fach.3mf')).toBe(true);
    expect(printerIsPrintingFile({ state: 'PREPARE', subtask_name: 'Reinigung_Gewindespindel_1fach' },
      'Reinigung Gewindespindel 1fach.gcode.3mf')).toBe(true);
  });
  it('ignores idle printers and other files', () => {
    expect(printerIsPrintingFile({ state: 'FINISH', subtask_name: 'Reinigung_Gewindespindel_1fach' }, 'Reinigung Gewindespindel 1fach.3mf')).toBe(false);
    expect(printerIsPrintingFile({ state: 'RUNNING', subtask_name: 'Other_model' }, 'Reinigung Gewindespindel 1fach.3mf')).toBe(false);
    expect(printerIsPrintingFile(null, 'x.3mf')).toBe(false);
  });
});

describe('describeOneTapRun with a run stuck in dispatching', () => {
  it('looks at the jobs (real server payload: run 5, queue item 6 "Busy: Home")', () => {
    expect(describeOneTapRun({
      status: 'dispatching',
      jobs: [{ status: 'queued', queue_entry_id: 6, assigned_printer_name: 'Home' }],
    })).toEqual({ kind: 'waiting', queueItemId: 6, printerName: 'Home' });
    expect(describeOneTapRun({ status: 'dispatching', jobs: [{ status: 'pending' }] })).toEqual({ kind: 'dispatching' });
    expect(describeOneTapRun({ status: 'dispatching', error_message: 'boom', jobs: [] })).toEqual({ kind: 'failed', error: 'boom' });
  });
});

describe('single-plate printing', () => {
  const pipeline = {
    printer_preset: { source: 'cloud', id: 'GM030' },
    process_preset: { source: 'cloud', id: 'GP079' },
    filament_presets: [{ source: 'cloud', id: 'GFA00' }],
    bed_type: 'Textured PEI Plate',
    target_kind: 'specific_printer' as const,
    target_printer_id: 1,
    target_model_class: null,
  };

  it('slices only the chosen plate with the pipeline presets', () => {
    expect(pipelinePlateSliceRequest(pipeline as never, 3)).toEqual({
      printer_preset: { source: 'cloud', id: 'GM030' },
      process_preset: { source: 'cloud', id: 'GP079' },
      filament_presets: [{ source: 'cloud', id: 'GFA00' }],
      bed_type: 'Textured PEI Plate',
      plate: 3,
      export_3mf: true,
    });
    expect(pipelinePlateSliceRequest({ ...pipeline, bed_type: null } as never, 2)).not.toHaveProperty('bed_type');
  });

  it('queues on the pipeline printer or its printer class', () => {
    expect(pipelineQueueTarget(pipeline)).toEqual({ printer_id: 1 });
    expect(pipelineQueueTarget({ target_kind: 'printer_class', target_printer_id: null, target_model_class: 'A1' })).toEqual({ target_model: 'A1' });
    expect(pipelineQueueTarget({ target_kind: 'printer_class', target_printer_id: null, target_model_class: null })).toBeNull();
  });

  it('maps queue entry states to stages', () => {
    expect(describeOneTapQueueItem({ id: 7, status: 'pending' }, 'Home')).toEqual({ kind: 'waiting', queueItemId: 7, printerName: 'Home' });
    expect(describeOneTapQueueItem({ id: 7, status: 'printing' }, 'Home')).toEqual({ kind: 'printing', printerName: 'Home' });
    expect(describeOneTapQueueItem({ id: 7, status: 'completed' }, null)).toEqual({ kind: 'completed' });
    expect(describeOneTapQueueItem({ id: 7, status: 'cancelled' }, null)).toEqual({ kind: 'cancelled' });
    expect(describeOneTapQueueItem({ id: 7, status: 'skipped' }, null)).toEqual({ kind: 'cancelled' });
    expect(describeOneTapQueueItem({ id: 7, status: 'failed', error_message: ' Nozzle clog ' }, null)).toEqual({ kind: 'failed', error: 'Nozzle clog' });
  });

  it('describes a plate by name or by its objects', () => {
    expect(plateCaption({ index: 1, name: 'Hat', objects: ['a'] })).toBe('Hat');
    expect(plateCaption({ index: 2, name: null, objects: ['Body', 'Head'] })).toBe('Body, Head');
    expect(plateCaption({ index: 3, name: ' ', objects: ['a', 'b', 'c', 'd', 'e'] })).toBe('a, b, c +2');
    expect(plateCaption({ index: 4, name: null, objects: [] })).toBe('');
  });
});
