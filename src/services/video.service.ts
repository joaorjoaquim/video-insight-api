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

// Step 1: Start video download
export async function startVideoDownload(videoId: number): Promise<void> {
  const video = await getVideoById(videoId);
  if (!video) {
    throw new Error('Video not found');
  }

  try {
    const downloadResponse = await downloadVideoFromService(video.videoUrl);

    if (!downloadResponse.success) {
      throw new Error('Failed to download video');
    }

    await updateVideo(videoId, {
      videoId: downloadResponse.data.videoId,
      title: downloadResponse.data.title,
      duration: downloadResponse.data.duration,
      thumbnail: downloadResponse.data.thumbnail,
      downloadUrl: downloadResponse.data.downloadUrl,
      status: 'downloaded',
    });
  } catch (error) {
    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: error instanceof Error ? error.message : 'Download failed',
    });
    throw error;
  }
}

// Step 2: Start transcription
export async function startTranscription(videoId: number): Promise<void> {
  const video = await getVideoById(videoId);
  if (!video || !video.videoId) {
    throw new Error('Video not found or not downloaded');
  }

  try {
    const transcriptionResponse = await requestTranscription(video.videoId);

    if (!transcriptionResponse.success) {
      throw new Error('Failed to request transcription');
    }

    await updateVideo(videoId, {
      transcriptionId: transcriptionResponse.data.transcriptionId,
      status: 'transcribing',
    });
  } catch (error) {
    await updateVideo(videoId, {
      status: 'failed',
      errorMessage:
        error instanceof Error ? error.message : 'Transcription request failed',
    });
    throw error;
  }
}

// Step 3: Check transcription status and generate insights if complete
export async function checkTranscriptionStatus(
  videoId: number
): Promise<{ status: string; transcription?: string }> {
  const video = await getVideoById(videoId);
  if (!video || !video.transcriptionId) {
    throw new Error('Video not found or transcription not started');
  }

  try {
    const transcription = await pollTranscriptionStatus(video.transcriptionId);

    if (transcription) {
      // Generate AI insights
      const { summary, insights } = await generateAIInsights(transcription);

      await updateVideo(videoId, {
        transcription,
        summary,
        insights,
        status: 'completed',
      });

      return { status: 'completed', transcription };
    } else {
      // Check if it's still processing or failed
      const response = await fetch(
        `https://api.videodowncut.com/api/transcriptions/${video.transcriptionId}/status`
      );
      const statusData: TranscriptionStatusResponse = await response.json();

      if (statusData.success && statusData.data.status === 'failed') {
        await updateVideo(videoId, {
          status: 'failed',
          errorMessage: 'Transcription failed',
        });
        return { status: 'failed' };
      }

      return { status: 'transcribing' };
    }
  } catch (error) {
    await updateVideo(videoId, {
      status: 'failed',
      errorMessage:
        error instanceof Error ? error.message : 'Status check failed',
    });
    throw error;
  }
}

// Main processing function (for backward compatibility)
export async function processVideo(videoId: number): Promise<void> {
  const video = await getVideoById(videoId);
  if (!video) {
    throw new Error('Video not found');
  }

  try {
    // Step 1: Download video
    await startVideoDownload(videoId);

    // Step 2: Start transcription
    await startTranscription(videoId);

    // Step 3: Poll for completion
    const maxAttempts = 30; // 5 minutes with 10-second intervals
    let attempts = 0;

    while (attempts < maxAttempts) {
      const result = await checkTranscriptionStatus(videoId);

      if (result.status === 'completed') {
        return;
      }

      if (result.status === 'failed') {
        throw new Error('Processing failed');
      }

      // Wait 10 seconds before next attempt
      await new Promise((resolve) => setTimeout(resolve, 10000));
      attempts++;
    }

    throw new Error('Processing timed out');
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

// Helper function to count tokens (rough estimation)
function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

// Helper function to remove duplicate text segments
function removeDuplicateSegments(text: string, minLength: number = 8): string {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length >= minLength && !seen.has(trimmed)) {
      seen.add(trimmed);
      deduplicated.push(trimmed);
    }
  }

  return deduplicated.join('. ') + '.';
}

// Helper function to split text into chunks
function splitTextIntoChunks(text: string, maxTokens: number = 500): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  for (const sentence of sentences) {
    const testChunk = currentChunk + sentence + '. ';
    if (estimateTokenCount(testChunk) > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      currentChunk = sentence + '. ';
    } else {
      currentChunk = testChunk;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

async function generateAIInsights(
  transcription: string
): Promise<{ summary: string; insights: any }> {
  try {
    // Step 1: Deduplication
    const deduplicatedText = removeDuplicateSegments(transcription);

    // Step 2: Check if text needs to be split into chunks
    const tokenCount = estimateTokenCount(deduplicatedText);
    const chunks =
      tokenCount > 2000
        ? splitTextIntoChunks(deduplicatedText)
        : [deduplicatedText];

    const allResults: any[] = [];
    const allWarnings: string[] = [];

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkTokenCount = estimateTokenCount(chunk);

      if (chunkTokenCount > 2000) {
        allWarnings.push(
          `Chunk ${i + 1} muito longo (${chunkTokenCount} tokens) - resumido`
        );
      }

      const prompt = `Você é um Assistente de Resumo de Transcrição de Vídeo.

1. **(Deduplicação)** Analise o texto e remova trechos repetidos (>8 tokens) mantendo apenas a primeira ocorrência.
2. **(Fidelidade)** Extraia somente informações explícitas no texto. Não adicione contexto externo.
3. **(Verificação)** Liste em "topics" até 5 tópicos principais. Depois, para cada tópico, confirme sua correspondência exata com o original.
4. **(Formato)** Retorne um JSON com:
   {
     "topics": [string],
     "summary": string,
     "warnings": [string]  // ex.: ["texto muito longo – resumido em blocos"]
   }
5. **(Limites)** Defina "max_tokens": 500 e pare ao encontrar "\\n\\n".

Texto para análise:
${chunk}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente especializado em análise de transcrições de vídeo. Sempre retorne JSON válido.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 500,
        stop: ['\n\n'],
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('Failed to generate AI insights for chunk');
      }

      try {
        const result = JSON.parse(response);
        allResults.push(result);
        if (result.warnings) {
          allWarnings.push(...result.warnings);
        }
      } catch (parseError) {
        // If JSON parsing fails, create a basic result
        allResults.push({
          topics: ['Análise de transcrição'],
          summary: response,
          warnings: ['Erro no parsing JSON - resultado em texto simples'],
        });
      }
    }

    // Step 3: Consolidate results
    let consolidatedSummary = '';
    const allTopics = new Set<string>();
    const consolidatedWarnings = [...allWarnings];

    for (const result of allResults) {
      if (result.summary) {
        consolidatedSummary += result.summary + ' ';
      }
      if (result.topics) {
        result.topics.forEach((topic: string) => allTopics.add(topic));
      }
    }

    // If we have multiple chunks, create a final consolidation
    if (chunks.length > 1) {
      const consolidationPrompt = `Consolide os seguintes resultados em um único resumo conciso:

${allResults.map((r, i) => `Bloco ${i + 1}: ${r.summary}`).join('\n')}

Retorne apenas um JSON:
{
  "topics": [string],
  "summary": string,
  "warnings": [string]
}`;

      const consolidationCompletion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente especializado em consolidação de resumos. Sempre retorne JSON válido.',
          },
          {
            role: 'user',
            content: consolidationPrompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 300,
      });

      const consolidationResponse =
        consolidationCompletion.choices[0]?.message?.content;

      if (consolidationResponse) {
        try {
          const consolidated = JSON.parse(consolidationResponse);
          return {
            summary: consolidated.summary || consolidatedSummary.trim(),
            insights: {
              topics: consolidated.topics || Array.from(allTopics),
              summary: consolidated.summary || consolidatedSummary.trim(),
              warnings: consolidated.warnings || consolidatedWarnings,
              originalTokenCount: tokenCount,
              processedChunks: chunks.length,
              extractedAt: new Date().toISOString(),
            },
          };
        } catch {
          // Fallback to manual consolidation
        }
      }
    }

    // Return consolidated results
    return {
      summary: consolidatedSummary.trim(),
      insights: {
        topics: Array.from(allTopics),
        summary: consolidatedSummary.trim(),
        warnings: consolidatedWarnings,
        originalTokenCount: tokenCount,
        processedChunks: chunks.length,
        extractedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    // Fallback to simple summary
    return {
      summary: 'Análise de transcrição disponível',
      insights: {
        topics: ['Transcrição processada'],
        summary: 'Análise de transcrição disponível',
        warnings: ['Erro na análise detalhada - usando resumo básico'],
        error: error instanceof Error ? error.message : 'Unknown error',
        extractedAt: new Date().toISOString(),
      },
    };
  }
}
