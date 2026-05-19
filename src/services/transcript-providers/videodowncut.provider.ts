import type { VideoPipelineContext } from '../../lib/video-types';
import { logVideoEvent } from '../../lib/log-video-event';
import type { TranscriptResult } from './types';

const VDC_BASE = 'https://api.videodowncut.com/api';

export interface VideoDownloadResponse {
  success: boolean;
  data?: {
    videoId: string;
    title: string;
    duration: number;
    thumbnail: string;
    downloadUrl: string;
  };
}

export interface TranscriptionResponse {
  success: boolean;
  data?: {
    transcriptionId: string;
    videoId: string;
    status: string;
    statusUrl: string;
    transcriptionUrl: string;
  };
}

export interface TranscriptionStatusResponse {
  success: boolean;
  data?: {
    transcriptionId: string;
    videoId: string;
    status: string;
    text?: string;
    segments?: unknown[];
  };
}

export async function vdcDownloadVideo(
  ctx: VideoPipelineContext,
  videoUrl: string
): Promise<VideoDownloadResponse> {
  const start = Date.now();
  const externalRequestId = `req_${Date.now()}`;

  await logVideoEvent({
    ctx,
    stage: 'download',
    event: 'started',
    msg: 'vdc_download_request',
    provider: 'videodowncut',
    externalRequestId,
    inputSummary: { videoUrl },
  });

  try {
    const response = await fetch(`${VDC_BASE}/videos/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: videoUrl }),
    });
    const data = (await response.json()) as VideoDownloadResponse;
    const durationMs = Date.now() - start;

    if (!response.ok || !data.success) {
      await logVideoEvent({
        ctx,
        stage: 'download',
        event: 'failed',
        msg: 'vdc_download_failed',
        provider: 'videodowncut',
        externalRequestId,
        durationMs,
        httpStatus: response.status,
        outputSummary: { success: data.success },
        errorCode: 'VDC_DOWNLOAD_FAILED',
      });
      return { success: false };
    }

    await logVideoEvent({
      ctx,
      stage: 'download',
      event: 'completed',
      msg: 'vdc_download_ok',
      provider: 'videodowncut',
      externalRequestId,
      durationMs,
      httpStatus: response.status,
      outputSummary: {
        externalVideoId: data.data?.videoId,
        title: data.data?.title,
        duration: data.data?.duration,
      },
    });

    return data;
  } catch (error) {
    await logVideoEvent({
      ctx,
      stage: 'download',
      event: 'failed',
      msg: 'vdc_download_network_error',
      provider: 'videodowncut',
      externalRequestId,
      durationMs: Date.now() - start,
      errorCode: 'VDC_DOWNLOAD_FAILED',
      errorMessage: error instanceof Error ? error.message : 'Network error',
    });
    throw error;
  }
}

export async function vdcRequestTranscription(
  ctx: VideoPipelineContext,
  serviceVideoId: string,
  language?: string | null
): Promise<TranscriptionResponse> {
  const start = Date.now();
  const externalRequestId = `trans_${Date.now()}`;

  const body: Record<string, unknown> = {
    modelSize: 'large-v3',
    device: 'cuda',
    computeType: 'float16',
    saveToFile: true,
  };
  if (language) {
    body.language = language;
  }

  await logVideoEvent({
    ctx,
    stage: 'transcribe',
    event: 'started',
    msg: 'vdc_transcribe_request',
    provider: 'videodowncut',
    externalRequestId,
    inputSummary: { serviceVideoId, language: language ?? 'auto' },
  });

  const response = await fetch(`${VDC_BASE}/videos/${serviceVideoId}/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as TranscriptionResponse;
  const durationMs = Date.now() - start;

  if (!response.ok || !data.success) {
    await logVideoEvent({
      ctx,
      stage: 'transcribe',
      event: 'failed',
      msg: 'vdc_transcribe_failed',
      provider: 'videodowncut',
      externalRequestId,
      durationMs,
      httpStatus: response.status,
      errorCode: 'VDC_TRANSCRIBE_FAILED',
    });
    return { success: false };
  }

  await logVideoEvent({
    ctx,
    stage: 'transcribe',
    event: 'completed',
    msg: 'vdc_transcribe_started',
    provider: 'videodowncut',
    externalRequestId,
    durationMs,
    outputSummary: {
      transcriptionId: data.data?.transcriptionId,
      status: data.data?.status,
    },
  });

  return data;
}

/** Single status check — one HTTP poll per frontend poll */
export async function vdcCheckTranscriptionStatusOnce(
  ctx: VideoPipelineContext,
  transcriptionId: string
): Promise<TranscriptionStatusResponse> {
  const start = Date.now();

  const response = await fetch(
    `${VDC_BASE}/transcriptions/${transcriptionId}/status`
  );
  const data = (await response.json()) as TranscriptionStatusResponse;

  await logVideoEvent({
    ctx,
    stage: 'poll',
    event: 'completed',
    msg: 'vdc_poll_status',
    provider: 'videodowncut',
    durationMs: Date.now() - start,
    httpStatus: response.status,
    outputSummary: {
      status: data.data?.status,
      hasText: !!data.data?.text,
      textLength: data.data?.text?.length ?? 0,
    },
  });

  return data;
}

export function mapVdcStatusToTranscript(
  data: TranscriptionStatusResponse
): TranscriptResult | null {
  if (data.success && data.data?.status === 'completed' && data.data.text) {
    return {
      text: data.data.text,
      provider: 'videodowncut',
      transcriptionId: data.data.transcriptionId,
      externalVideoId: data.data.videoId,
    };
  }
  return null;
}
