import { VideoRepository } from '../repositories/video.repository';
import { VideoEntity } from '../entities/Video';
import { OpenAI } from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface VideoDownloadResponse {
  success: boolean;
  data: {
    videoId: string;
    title: string;
    duration: number;
    thumbnail: string;
    downloadUrl: string;
  };
}

interface TranscriptionResponse {
  success: boolean;
  data: {
    transcriptionId: string;
    videoId: string;
    status: string;
    statusUrl: string;
    transcriptionUrl: string;
  };
}

interface TranscriptionStatusResponse {
  success: boolean;
  data: {
    transcriptionId: string;
    videoId: string;
    status: string;
    text?: string;
    segments?: any[];
  };
}

export async function createVideo(
  videoData: Partial<VideoEntity>
): Promise<VideoEntity> {
  const video = VideoRepository.create(videoData);
  return await VideoRepository.save(video);
}

export async function getVideoById(id: number): Promise<VideoEntity | null> {
  return await VideoRepository.findOne({
    where: { id },
    relations: ['user'],
  });
}

export async function getVideosByUserId(
  userId: number
): Promise<VideoEntity[]> {
  return await VideoRepository.find({
    where: { userId },
    order: { createdAt: 'DESC' },
  });
}

export async function updateVideo(
  id: number,
  updateData: Partial<VideoEntity>
): Promise<VideoEntity | null> {
  await VideoRepository.update(id, updateData);
  return await getVideoById(id);
}

export async function processVideo(videoId: number): Promise<void> {
  const video = await getVideoById(videoId);
  if (!video) {
    throw new Error('Video not found');
  }

  try {
    // Step 1: Download video from videodowncut
    const downloadResponse = await downloadVideoFromService(video.videoUrl);

    if (!downloadResponse.success) {
      throw new Error('Failed to download video');
    }

    // Update video with download info
    await updateVideo(videoId, {
      videoId: downloadResponse.data.videoId,
      title: downloadResponse.data.title,
      duration: downloadResponse.data.duration,
      thumbnail: downloadResponse.data.thumbnail,
      downloadUrl: downloadResponse.data.downloadUrl,
      status: 'processing',
    });

    // Step 2: Request transcription
    const transcriptionResponse = await requestTranscription(
      downloadResponse.data.videoId
    );

    if (!transcriptionResponse.success) {
      throw new Error('Failed to request transcription');
    }

    await updateVideo(videoId, {
      transcriptionId: transcriptionResponse.data.transcriptionId,
      status: 'processing',
    });

    // Step 3: Poll for transcription completion
    const transcription = await pollTranscriptionStatus(
      transcriptionResponse.data.transcriptionId
    );

    if (!transcription) {
      throw new Error('Transcription failed or timed out');
    }

    // Step 4: Generate AI insights
    const { summary, insights } = await generateAIInsights(transcription);

    // Step 5: Update video with results
    await updateVideo(videoId, {
      transcription,
      summary,
      insights,
      status: 'completed',
    });
  } catch (error) {
    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

async function downloadVideoFromService(
  videoUrl: string
): Promise<VideoDownloadResponse> {
  const response = await fetch(
    'https://api.videodowncut.com/api/videos/download',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: videoUrl }),
    }
  );

  return await response.json();
}

async function requestTranscription(
  videoId: string
): Promise<TranscriptionResponse> {
  const response = await fetch(
    `https://api.videodowncut.com/api/videos/${videoId}/transcribe`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        modelSize: 'large-v3',
        device: 'cuda',
        computeType: 'float16',
        language: 'en',
        saveToFile: true,
      }),
    }
  );

  return await response.json();
}

async function pollTranscriptionStatus(
  transcriptionId: string
): Promise<string | null> {
  const maxAttempts = 30; // 5 minutes with 10-second intervals
  let attempts = 0;

  while (attempts < maxAttempts) {
    const response = await fetch(
      `https://api.videodowncut.com/api/transcriptions/${transcriptionId}/status`
    );
    const statusData: TranscriptionStatusResponse = await response.json();

    if (statusData.success && statusData.data.status === 'completed') {
      return statusData.data.text || null;
    }

    if (statusData.success && statusData.data.status === 'failed') {
      return null;
    }

    // Wait 10 seconds before next attempt
    await new Promise((resolve) => setTimeout(resolve, 10000));
    attempts++;
  }

  return null;
}

async function generateAIInsights(
  transcription: string
): Promise<{ summary: string; insights: any }> {
  const prompt = `
    Analyze the following video transcription and provide:
    1. A concise summary (2-3 sentences)
    2. Key insights including:
       - Main topics discussed
       - Technical examples or code snippets mentioned
       - Notable quotes or important points
       - Action items or recommendations
       - Any tools, technologies, or resources mentioned

    Transcription:
    ${transcription}
    `;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4-turbo-preview',
    messages: [
      {
        role: 'system',
        content:
          'You are an expert at analyzing video content and extracting structured insights. Provide clear, actionable insights in JSON format.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
  });

  const response = completion.choices[0]?.message?.content;

  if (!response) {
    throw new Error('Failed to generate AI insights');
  }

  try {
    // Try to parse as JSON first
    const insights = JSON.parse(response);
    const summary = insights.summary || 'Summary not available';
    return { summary, insights };
  } catch {
    // If not JSON, treat as plain text summary
    return {
      summary: response,
      insights: {
        analysis: response,
        extractedAt: new Date().toISOString(),
      },
    };
  }
}
