import { pickNumber, type ApiRecord } from '@/utils/data';
import type { SliceRequest, SlicerPipeline } from '@/types/api';

export type MakerworldModelRef = { modelId: number; profileId: number | null; url: string };

const MODEL_RE = /^https?:\/\/(?:www\.)?makerworld\.com(?:\/[a-z]{2}(?:-[a-z]{2,4})?)?\/models\/(\d+)/i;
const PROFILE_RE = /profileId[-=](\d+)/i;

/** Extracts the MakerWorld model (and optional print profile) from a page URL. */
export function parseMakerworldModelUrl(url: string | null | undefined): MakerworldModelRef | null {
  if (!url) return null;
  const match = MODEL_RE.exec(url.trim());
  if (!match) return null;
  const modelId = Number(match[1]);
  if (!Number.isSafeInteger(modelId) || modelId <= 0) return null;
  const profile = PROFILE_RE.exec(url);
  const profileId = profile ? Number(profile[1]) : null;
  return {
    modelId,
    profileId: profileId !== null && Number.isSafeInteger(profileId) && profileId > 0 ? profileId : null,
    url: url.trim(),
  };
}

/**
 * Picks the print profile to use for a one-tap print: the profile selected on
 * the MakerWorld page when there is one, otherwise the first (default) profile.
 */
export function pickOneTapInstance(instances: ApiRecord[], profileId: number | null): ApiRecord | null {
  if (!instances.length) return null;
  if (profileId !== null) {
    // MakerWorld's `#profileId-N` hash carries the instance id; accept either field.
    const selected = instances.find(item => pickNumber(item, ['id'], NaN) === profileId)
      ?? instances.find(item => pickNumber(item, ['profileId'], NaN) === profileId);
    if (selected) return selected;
  }
  return instances.find(item => item.isDefault === true) ?? instances[0];
}

export const PIPELINE_TERMINAL_STATUSES = ['completed', 'failed', 'partial_failure', 'cancelled'] as const;
export const PIPELINE_BLOCKING_ISSUES = ['printer_not_set', 'printer_not_found', 'class_not_set', 'no_class_matches'];

export function oneTapPipelineStorageKey(serverUrl: string | null | undefined) {
  return `bambuddy.makerworldOneTap.pipeline:${serverUrl ?? ''}`;
}

// ---------------------------------------------------------------------------
// Pipeline run progress
//
// A pipeline run reports `in_progress` as soon as its dispatch jobs exist —
// even when slicing failed (the server then keeps `error_message` and leaves
// the jobs `pending` without a queue entry). The real outcome lives in the
// run's error message and its per-copy jobs, so derive the stage from those.

export type OneTapRunLike = {
  status: string;
  error_message?: string | null;
  jobs?: Array<{
    status: string;
    queue_entry_id?: number | null;
    assigned_printer_name?: string | null;
    error_message?: string | null;
  }> | null;
};

export type OneTapStage =
  | { kind: 'queued' }
  | { kind: 'slicing' }
  | { kind: 'dispatching' }
  | { kind: 'waiting'; queueItemId: number | null; printerName: string | null }
  | { kind: 'printing'; printerName: string | null }
  | { kind: 'completed' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string | null };

export function describeOneTapRun(run: OneTapRunLike): OneTapStage {
  const jobs = run.jobs ?? [];
  const error = run.error_message?.trim() || jobs.find(job => job.error_message)?.error_message?.trim() || null;
  switch (run.status) {
    case 'failed':
    case 'partial_failure':
      return { kind: 'failed', error };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'queued':
      return { kind: 'queued' };
    case 'slicing':
      return { kind: 'slicing' };
    default:
      // 'dispatching' / 'in_progress' / 'completed': the jobs tell the real state.
      // The server can keep a run in 'dispatching' while its job already sits in the
      // print queue or prints, so never stop at the run status here.
      break;
  }
  const printing = jobs.find(job => job.status === 'printing');
  if (printing) return { kind: 'printing', printerName: printing.assigned_printer_name ?? null };
  if (jobs.length && jobs.every(job => job.status === 'completed')) return { kind: 'completed' };
  const waiting = jobs.find(job => (job.status === 'queued' || job.status === 'awaiting_printer') && job.queue_entry_id);
  if (waiting) {
    return { kind: 'waiting', queueItemId: waiting.queue_entry_id ?? null, printerName: waiting.assigned_printer_name ?? null };
  }
  // Nothing reached the queue: an error message means slicing/dispatch failed.
  if (error) return { kind: 'failed', error };
  if (jobs.length && jobs.every(job => job.status === 'failed' || job.status === 'cancelled')) {
    return jobs.some(job => job.status === 'failed') ? { kind: 'failed', error } : { kind: 'cancelled' };
  }
  if (run.status === 'completed') return { kind: 'completed' };
  return { kind: 'dispatching' };
}

export function isOneTapStageFinal(stage: OneTapStage) {
  return stage.kind === 'printing' || stage.kind === 'completed' || stage.kind === 'cancelled' || stage.kind === 'failed';
}

/** True for the slicer error raised by 3MF settings the server's slicer does not accept. */
export function isIncompatible3mfError(error: string | null | undefined) {
  return Boolean(error && /invalid parameter value\(s\) included in the 3mf/i.test(error));
}

// ---------------------------------------------------------------------------
// Printer-side confirmation
//
// The server can lose track of a run's jobs (e.g. stale jobs re-attached to a
// reused run id) while the printer is already printing the file. As a
// fallback, confirm the print on the pipeline's target printer by comparing
// the printer's current task with the imported file name.

const PRINTING_STATES = new Set(['RUNNING', 'PREPARE', 'SLICING', 'PAUSE', 'PRINTING']);

function normalizeTaskName(value: string) {
  return value
    .toLowerCase()
    .replace(/^.*[\\/]/, '')
    .replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/g, '')
    .replace(/[\s_\-.]+/g, ' ')
    .trim();
}

export function printerIsPrintingFile(
  status: { state?: string | null; subtask_name?: string | null; current_print?: string | null; gcode_file?: string | null } | null | undefined,
  fileName: string | null | undefined,
) {
  if (!status || !fileName) return false;
  if (!PRINTING_STATES.has(String(status.state ?? '').toUpperCase())) return false;
  const wanted = normalizeTaskName(fileName);
  if (!wanted) return false;
  return [status.subtask_name, status.current_print, status.gcode_file]
    .filter((value): value is string => Boolean(value))
    .some(value => normalizeTaskName(value) === wanted);
}

// ---------------------------------------------------------------------------
// Single-plate printing
//
// A pipeline run always slices plate 1 of the source. To print another plate
// of a multi-plate model, slice that plate with the pipeline's presets and
// queue the result on the pipeline's target ourselves.

/** Slice request equivalent to the pipeline's own, limited to one plate. */
export function pipelinePlateSliceRequest(
  pipeline: Pick<SlicerPipeline, 'printer_preset' | 'process_preset' | 'filament_presets' | 'bed_type'>,
  plate: number,
): SliceRequest {
  return {
    printer_preset: pipeline.printer_preset,
    process_preset: pipeline.process_preset,
    filament_presets: pipeline.filament_presets,
    ...(pipeline.bed_type ? { bed_type: pipeline.bed_type } : {}),
    plate,
    export_3mf: true,
  };
}

/** Queue target of a pipeline: its printer, or any printer of its class. */
export function pipelineQueueTarget(
  pipeline: Pick<SlicerPipeline, 'target_kind' | 'target_printer_id' | 'target_model_class'>,
): { printer_id: number } | { target_model: string } | null {
  if (pipeline.target_kind === 'specific_printer' && pipeline.target_printer_id != null) {
    return { printer_id: pipeline.target_printer_id };
  }
  if (pipeline.target_model_class) return { target_model: pipeline.target_model_class };
  if (pipeline.target_printer_id != null) return { printer_id: pipeline.target_printer_id };
  return null;
}

/** Stage of a print-queue entry created for a single plate. */
export function describeOneTapQueueItem(
  item: { id: number; status: string; error_message?: string | null },
  printerName: string | null,
): OneTapStage {
  switch (item.status) {
    case 'printing':
      return { kind: 'printing', printerName };
    case 'completed':
      return { kind: 'completed' };
    case 'cancelled':
    case 'skipped':
      return { kind: 'cancelled' };
    case 'failed':
      return { kind: 'failed', error: item.error_message?.trim() || null };
    default:
      return { kind: 'waiting', queueItemId: item.id, printerName };
  }
}

/** Short caption of a plate for the plate picker. */
export function plateCaption(plate: { index: number; name: string | null; objects: string[] }) {
  const name = plate.name?.trim();
  if (name) return name;
  const objects = plate.objects.filter(Boolean);
  if (!objects.length) return '';
  return objects.length > 3 ? `${objects.slice(0, 3).join(', ')} +${objects.length - 3}` : objects.join(', ');
}
