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
  userId: number,
  status?: string,
  limit?: number,
  offset?: number
): Promise<VideoEntity[]> {
  const queryBuilder = VideoRepository.createQueryBuilder('video')
    .where('video.userId = :userId', { userId })
    .orderBy('video.createdAt', 'DESC');

  if (status) {
    queryBuilder.andWhere('video.status = :status', { status });
  }

  if (limit) {
    queryBuilder.limit(limit);
  }

  if (offset) {
    queryBuilder.offset(offset);
  }

  return await queryBuilder.getMany();
}

export async function getVideosCountByUserId(
  userId: number,
  status?: string
): Promise<number> {
  const queryBuilder = VideoRepository.createQueryBuilder('video').where(
    'video.userId = :userId',
    { userId }
  );

  if (status) {
    queryBuilder.andWhere('video.status = :status', { status });
  }

  return await queryBuilder.getCount();
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
): Promise<{ status: string; dashboard?: any }> {
  const video = await getVideoById(videoId);
  if (!video || !video.transcriptionId) {
    throw new Error('Video not found or transcription not started');
  }

  try {
    const transcription = await pollTranscriptionStatus(video.transcriptionId);

    if (transcription) {
      // Generate AI insights
      const dashboard = await generateAIInsights(transcription);

      await updateVideo(videoId, {
        transcription,
        dashboard, // Save the full dashboard object
        status: 'completed',
      });

      return { status: 'completed', dashboard };
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
): Promise<any> {
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

      const prompt = `You are an expert video summarizer and insight extractor. Given a video transcription, return a JSON object with the following structure, designed for a modern, interactive web dashboard. The output should be concise, well-structured, and visually rich for both list and mind map views.

Return ONLY valid JSON, no markdown or code blocks.

### Required JSON Structure:
{
  "summary": {
    "text": "A concise, readable summary of the video (2-4 paragraphs, no bullet points).",
    "metrics": [
      { "label": "Duration", "value": "12:45" },
      { "label": "Main Topics", "value": "5" },
      { "label": "Key Insights", "value": "12" },
      { "label": "Complexity", "value": "Intermediate" }
    ],
    "topics": [
      "Main topic 1",
      "Main topic 2"
    ]
  },
  "transcript": [
    { "time": "00:00", "text": "First sentences..." }
    // ...
  ],
  "insights": {
    "chips": [
      { "label": "15 insights extracted", "variant": "secondary" },
      { "label": "5 main topics", "variant": "secondary" },
      { "label": "3 key takeaways", "variant": "destructive" },
      { "label": "87% confidence", "variant": "secondary" }
    ],
    "sections": [
      {
        "title": "Section Title",
        "icon": "💻",
        "items": [
          { "text": "Insight text", "confidence": 95 },
          { "text": "Another insight", "key": true }
        ]
      }
      // ...
    ]
  },
  "mindMap": {
    "root": "Video Insights",
    "branches": [
      {
        "label": "Branch 1",
        "children": [
          { "label": "Child 1" },
          { "label": "Child 2" }
        ]
      }
      // ...
    ]
  }
}

- summary.text: A readable, human-like summary (not a list).
- summary.metrics: Always include duration, main topics, key insights, and complexity.
- summary.topics: Main topics as strings.
- transcript: Array of {time, text} blocks, 1-3 sentences each, covering the whole video.
- insights.chips: Short badges for quick stats.
- insights.sections: Each with a title, emoji icon, and insight items. Items can have confidence, key, or quote.
- mindMap: Hierarchical structure for mind map view (root, branches, children).

Return only the JSON object, no extra text.

Texto para análise:
${chunk}`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content:
              'Você é um assistente especializado em análise de transcrições de vídeo. Sempre retorne JSON válido e completo.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000, // Increased from 500 to ensure complete response
        // Removed stop parameter to prevent truncation
      });

      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('Failed to generate AI insights for chunk');
      }

      // Check if response is complete JSON
      const trimmedResponse = response.trim();
      if (!trimmedResponse.endsWith('}')) {
        console.error('Incomplete JSON response detected');
        console.error('Response ends with:', trimmedResponse.slice(-50));
        throw new Error('Incomplete JSON response from OpenAI');
      }

      try {
        const result = JSON.parse(response);
        console.log('OpenAI response parsed:', JSON.stringify(result, null, 2));
        
        // Check if this is already a dashboard object
        if (result.summary && typeof result.summary === 'object' && result.summary.text) {
          console.log('Returning dashboard object directly');
          // This is already a dashboard object, return it directly
          return result;
        }
        
        // Check if this has the full dashboard structure
        if (result.summary && result.transcript && result.insights && result.mindMap) {
          console.log('Returning full dashboard structure directly');
          return result;
        }
        
        // If it's the old format, store it for consolidation
        allResults.push(result);
        if (result.warnings) {
          allWarnings.push(...result.warnings);
        }
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        console.error('Raw response:', response);
        console.error('Response length:', response.length);
        
        // Check if the response is truncated
        if (response.includes('"insights"') && response.includes('"mindMap"')) {
          console.log('Response appears to be truncated, attempting to fix...');
          // Try to find the end of the JSON
          const lastBrace = response.lastIndexOf('}');
          if (lastBrace > 0) {
            const truncatedResponse = response.substring(0, lastBrace + 1);
            try {
              const fixedResult = JSON.parse(truncatedResponse);
              console.log('Successfully parsed truncated response');
              if (fixedResult.summary && fixedResult.transcript && fixedResult.insights && fixedResult.mindMap) {
                return fixedResult;
              }
            } catch (fixError) {
              console.error('Failed to fix truncated response:', fixError);
            }
          }
        }
        
        // If JSON parsing fails, create a basic result
        allResults.push({
          topics: ['Análise de transcrição'],
          summary: response,
          warnings: ['Erro no parsing JSON - resultado em texto simples'],
        });
      }
    }

    console.log('Number of chunks:', chunks.length);
    console.log('Number of results:', allResults.length);
    console.log('All results:', JSON.stringify(allResults, null, 2));

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

    // If we have only one chunk, return the parsed result directly
    if (chunks.length === 1 && allResults.length === 1) {
      const result = allResults[0];
      console.log('Single chunk result:', JSON.stringify(result, null, 2));
      
      // If the result is already a dashboard object, return it
      if (result.summary && typeof result.summary === 'object' && result.summary.text) {
        console.log('Returning single chunk dashboard object');
        return result;
      }
      
      // If the result has the full dashboard structure (summary, transcript, insights, mindMap)
      if (result.summary && result.transcript && result.insights && result.mindMap) {
        console.log('Returning full dashboard structure');
        return result;
      }
      
      // If it's the old format, convert to dashboard format
      if (result.summary && typeof result.summary === 'string') {
        console.log('Converting old format to dashboard format');
        return {
          summary: {
            text: result.summary,
            metrics: [
              { label: "Duration", value: "N/A" },
              { label: "Main Topics", value: allTopics.size.toString() },
              { label: "Key Insights", value: "N/A" },
              { label: "Complexity", value: "Intermediate" }
            ],
            topics: Array.from(allTopics)
          },
          transcript: [
            { time: "00:00", text: "Transcript processing completed" }
          ],
          insights: {
            chips: [
              { label: `${allTopics.size} topics extracted`, variant: "secondary" },
              { label: "Processing completed", variant: "secondary" }
            ],
            sections: [
              {
                title: "Key Insights",
                icon: "💡",
                items: [
                  { text: "Video analysis completed", confidence: 90 }
                ]
              }
            ]
          },
          mindMap: {
            root: "Video Insights",
            branches: Array.from(allTopics).map(topic => ({
              label: topic,
              children: []
            }))
          }
        };
      }
    }

    // If we have multiple chunks, create a final consolidation
    if (chunks.length > 1) {
      const consolidationPrompt = `Consolide os seguintes resultados em um único resumo conciso, seguindo o formato JSON abaixo para dashboard e mind map. Retorne apenas o JSON, sem markdown ou texto extra.

### Required JSON Structure:
{
  "summary": { ... },
  "transcript": [ ... ],
  "insights": { ... },
  "mindMap": { ... }
}

Resultados para consolidar:
${allResults.map((r, i) => `Bloco ${i + 1}: ${JSON.stringify(r)}`).join('\n')}
`;

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
          return consolidated; // Return the full dashboard object
        } catch {
          // Fallback to manual consolidation
        }
      }
    }

    // Return consolidated results as dashboard object
    return {
      summary: {
        text: consolidatedSummary.trim(),
        metrics: [
          { label: "Duration", value: "N/A" },
          { label: "Main Topics", value: allTopics.size.toString() },
          { label: "Key Insights", value: "N/A" },
          { label: "Complexity", value: "Intermediate" }
        ],
        topics: Array.from(allTopics)
      },
      transcript: [
        { time: "00:00", text: "Transcript processing completed" }
      ],
      insights: {
        chips: [
          { label: `${allTopics.size} topics extracted`, variant: "secondary" },
          { label: "Processing completed", variant: "secondary" }
        ],
        sections: [
          {
            title: "Key Insights",
            icon: "💡",
            items: [
              { text: "Video analysis completed", confidence: 90 }
            ]
          }
        ]
      },
      mindMap: {
        root: "Video Insights",
        branches: Array.from(allTopics).map(topic => ({
          label: topic,
          children: []
        }))
      }
    };
  } catch (error) {
    // Fallback to simple dashboard structure
    return {
      summary: {
        text: "Análise de transcrição disponível",
        metrics: [
          { label: "Duration", value: "N/A" },
          { label: "Main Topics", value: "1" },
          { label: "Key Insights", value: "1" },
          { label: "Complexity", value: "Basic" }
        ],
        topics: ["Transcrição processada"]
      },
      transcript: [
        { time: "00:00", text: "Transcript processing completed" }
      ],
      insights: {
        chips: [
          { label: "1 topic extracted", variant: "secondary" },
          { label: "Basic analysis", variant: "secondary" }
        ],
        sections: [
          {
            title: "Processing Status",
            icon: "⚠️",
            items: [
              { text: "Erro na análise detalhada - usando resumo básico", confidence: 50 }
            ]
          }
        ]
      },
      mindMap: {
        root: "Video Insights",
        branches: [
          {
            label: "Transcrição processada",
            children: []
          }
        ]
      }
    };
  }
}
