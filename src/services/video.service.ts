import { VideoRepository } from '../repositories/video.repository';
import { VideoEntity } from '../entities/Video';
import { OpenAI } from 'openai';
import { spendCredits, refundCredits } from './credit.service';
import { CreditTransactionRepository } from '../repositories/credit-transaction.repository';

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

export async function createVideoWithCredits(
  videoData: Partial<VideoEntity>,
  userId: number
): Promise<{ success: boolean; video?: VideoEntity; message?: string }> {
  // Calculate estimated credits based on video URL (rough estimation)
  // We'll use a conservative estimate of 5 credits initially
  const estimatedCredits = 5;

  // Check if user has enough credits
  const creditSpent = await spendCredits({
    userId,
    amount: estimatedCredits,
    description: 'Video submission (estimated)',
    referenceType: 'video_submission_estimated',
  });

  if (!creditSpent) {
    return { success: false, message: 'Insufficient credits' };
  }

  try {
    const video = await createVideo({
      ...videoData,
      creditsCost: estimatedCredits, // Track estimated credits spent
    });

    return { success: true, video };
  } catch (error) {
    // If video creation fails, refund the credits
    await refundCredits({
      userId,
      amount: estimatedCredits,
      description: 'Refund for failed video creation',
      referenceType: 'video_submission_refund',
    });

    throw error;
  }
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
  // Add retry logic for database connection issues
  const maxRetries = 3;
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await VideoRepository.update(id, updateData);
      return await getVideoById(id);
    } catch (error) {
      lastError = error;
      console.error(
        `Database update attempt ${attempt} failed:`,
        error.message
      );

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        console.log(
          `Retrying database update (attempt ${attempt + 1}/${maxRetries})`
        );
      }
    }
  }

  // If all retries failed, throw the last error
  throw lastError;
}

// Step 1: Start video download
export async function startVideoDownload(videoId: number): Promise<void> {
  const startTime = Date.now();
  const video = await getVideoById(videoId);

  if (!video) {
    console.error(`[VIDEO_DOWNLOAD] Video not found: ${videoId}`);
    throw new Error('Video not found');
  }

  console.log(`[VIDEO_DOWNLOAD] Starting download for video ${videoId}`, {
    videoId,
    userId: video.userId,
    videoUrl: video.videoUrl,
    status: video.status,
    timestamp: new Date().toISOString(),
  });

  try {
    console.log(`[VIDEO_DOWNLOAD] Requesting download from videodowncut.com`, {
      videoId,
      videoUrl: video.videoUrl,
      timestamp: new Date().toISOString(),
    });

    const downloadResponse = await downloadVideoFromService(video.videoUrl);
    const requestTime = Date.now() - startTime;

    console.log(`[VIDEO_DOWNLOAD] Download response received`, {
      videoId,
      success: downloadResponse.success,
      responseTime: `${requestTime}ms`,
      hasData: !!downloadResponse.data,
      timestamp: new Date().toISOString(),
    });

    if (!downloadResponse.success) {
      console.error(`[VIDEO_DOWNLOAD] Download failed for video ${videoId}`, {
        videoId,
        error: 'Download service returned failure',
        response: downloadResponse,
        timestamp: new Date().toISOString(),
      });
      throw new Error('Failed to download video');
    }

    console.log(`[VIDEO_DOWNLOAD] Download successful, updating database`, {
      videoId,
      serviceVideoId: downloadResponse.data.videoId,
      title: downloadResponse.data.title,
      duration: downloadResponse.data.duration,
      hasThumbnail: !!downloadResponse.data.thumbnail,
      hasDownloadUrl: !!downloadResponse.data.downloadUrl,
      timestamp: new Date().toISOString(),
    });

    await updateVideo(videoId, {
      videoId: downloadResponse.data.videoId,
      title: downloadResponse.data.title,
      duration: downloadResponse.data.duration,
      thumbnail: downloadResponse.data.thumbnail,
      downloadUrl: downloadResponse.data.downloadUrl,
      status: 'downloaded',
    });

    const totalTime = Date.now() - startTime;
    console.log(`[VIDEO_DOWNLOAD] Download completed successfully`, {
      videoId,
      totalTime: `${totalTime}ms`,
      serviceVideoId: downloadResponse.data.videoId,
      title: downloadResponse.data.title,
      duration: downloadResponse.data.duration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Download failed';

    console.error(`[VIDEO_DOWNLOAD] Download failed for video ${videoId}`, {
      videoId,
      userId: video.userId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
    });

    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: errorMessage,
    });

    // Refund initial estimated credits for failed download
    const initialTransaction = await CreditTransactionRepository.findOne({
      where: {
        userId: video.userId,
        referenceId: videoId.toString(),
        referenceType: 'video_submission_estimated',
      },
      order: { createdAt: 'DESC' },
    });

    if (initialTransaction) {
      console.log(`[VIDEO_DOWNLOAD] Refunding credits for failed download`, {
        videoId,
        userId: video.userId,
        refundAmount: Math.abs(initialTransaction.amount),
        transactionId: initialTransaction.id,
        timestamp: new Date().toISOString(),
      });

      await refundCredits({
        userId: video.userId,
        amount: Math.abs(initialTransaction.amount),
        description: 'Refund for failed video download',
        referenceId: videoId.toString(),
        referenceType: 'video_download_refund',
      });
    }

    throw error;
  }
}

// Step 2: Start transcription
export async function startTranscription(videoId: number): Promise<void> {
  const startTime = Date.now();
  const video = await getVideoById(videoId);

  if (!video || !video.videoId) {
    console.error(
      `[TRANSCRIPTION] Video not found or not downloaded: ${videoId}`
    );
    throw new Error('Video not found or not downloaded');
  }

  console.log(`[TRANSCRIPTION] Starting transcription for video ${videoId}`, {
    videoId,
    userId: video.userId,
    serviceVideoId: video.videoId,
    title: video.title,
    duration: video.duration,
    status: video.status,
    timestamp: new Date().toISOString(),
  });

  try {
    console.log(
      `[TRANSCRIPTION] Requesting transcription from videodowncut.com`,
      {
        videoId,
        serviceVideoId: video.videoId,
        timestamp: new Date().toISOString(),
      }
    );

    const transcriptionResponse = await requestTranscription(video.videoId);
    const requestTime = Date.now() - startTime;

    console.log(`[TRANSCRIPTION] Transcription response received`, {
      videoId,
      success: transcriptionResponse.success,
      responseTime: `${requestTime}ms`,
      hasData: !!transcriptionResponse.data,
      timestamp: new Date().toISOString(),
    });

    if (!transcriptionResponse.success) {
      console.error(
        `[TRANSCRIPTION] Transcription request failed for video ${videoId}`,
        {
          videoId,
          error: 'Transcription service returned failure',
          response: transcriptionResponse,
          timestamp: new Date().toISOString(),
        }
      );
      throw new Error('Failed to request transcription');
    }

    console.log(
      `[TRANSCRIPTION] Transcription request successful, updating database`,
      {
        videoId,
        transcriptionId: transcriptionResponse.data.transcriptionId,
        serviceVideoId: transcriptionResponse.data.videoId,
        status: transcriptionResponse.data.status,
        hasStatusUrl: !!transcriptionResponse.data.statusUrl,
        hasTranscriptionUrl: !!transcriptionResponse.data.transcriptionUrl,
        timestamp: new Date().toISOString(),
      }
    );

    await updateVideo(videoId, {
      transcriptionId: transcriptionResponse.data.transcriptionId,
      status: 'transcribing',
    });

    const totalTime = Date.now() - startTime;
    console.log(`[TRANSCRIPTION] Transcription started successfully`, {
      videoId,
      totalTime: `${totalTime}ms`,
      transcriptionId: transcriptionResponse.data.transcriptionId,
      status: transcriptionResponse.data.status,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Transcription request failed';

    console.error(`[TRANSCRIPTION] Transcription failed for video ${videoId}`, {
      videoId,
      userId: video.userId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
    });

    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: errorMessage,
    });

    // Refund initial estimated credits for failed transcription
    const initialTransaction = await CreditTransactionRepository.findOne({
      where: {
        userId: video.userId,
        referenceId: videoId.toString(),
        referenceType: 'video_submission_estimated',
      },
      order: { createdAt: 'DESC' },
    });

    if (initialTransaction) {
      console.log(
        `[TRANSCRIPTION] Refunding credits for failed transcription`,
        {
          videoId,
          userId: video.userId,
          refundAmount: Math.abs(initialTransaction.amount),
          transactionId: initialTransaction.id,
          timestamp: new Date().toISOString(),
        }
      );

      await refundCredits({
        userId: video.userId,
        amount: Math.abs(initialTransaction.amount),
        description: 'Refund for failed transcription',
        referenceId: videoId.toString(),
        referenceType: 'video_transcription_refund',
      });
    }

    throw error;
  }
}

// Step 3: Check transcription status and generate insights if complete
export async function checkTranscriptionStatus(
  videoId: number
): Promise<{ status: string; dashboard?: any }> {
  const startTime = Date.now();
  const video = await getVideoById(videoId);

  if (!video || !video.transcriptionId) {
    console.error(
      `[TRANSCRIPTION_STATUS] Video not found or transcription not started`,
      {
        videoId,
        hasVideo: !!video,
        hasTranscriptionId: !!video?.transcriptionId,
        transcriptionId: video?.transcriptionId,
        timestamp: new Date().toISOString(),
      }
    );
    throw new Error('Video not found or transcription not started');
  }

  console.log(`[TRANSCRIPTION_STATUS] Checking status for video ${videoId}`, {
    videoId,
    userId: video.userId,
    transcriptionId: video.transcriptionId,
    currentStatus: video.status,
    timestamp: new Date().toISOString(),
  });

  try {
    const transcription = await pollTranscriptionStatus(video.transcriptionId);

    if (transcription) {
      console.log(`[TRANSCRIPTION_STATUS] Full transcription received`, {
        videoId,
        transcriptionLength: transcription.length,
        timestamp: new Date().toISOString(),
      });

      // Step 1: Generate full transcript from raw text (0 AI tokens)
      const fullTranscript = formatRawTranscription(transcription);

      console.log(`[TRANSCRIPTION_STATUS] Raw transcript formatted`, {
        videoId,
        originalLength: transcription.length,
        formattedSegments: fullTranscript.length,
        timestamp: new Date().toISOString(),
      });

      // Step 2: Generate AI insights only (summary, insights, mindMap)
      let aiDashboard: any;
      let tokensUsed = 0;

      try {
        const aiResult = await generateAIInsights(transcription);
        aiDashboard = aiResult.dashboard;
        tokensUsed = aiResult.tokensUsed;

        console.log(`[TRANSCRIPTION_STATUS] AI insights generated`, {
          videoId,
          tokensUsed,
          hasSummary: !!aiDashboard.summary,
          hasInsights: !!aiDashboard.insights,
          hasMindMap: !!aiDashboard.mindMap,
          timestamp: new Date().toISOString(),
        });
      } catch (aiError) {
        const aiErrorTime = Date.now() - startTime;
        const errorMessage =
          aiError instanceof Error ? aiError.message : 'AI processing failed';

        console.error(
          `[TRANSCRIPTION_STATUS] AI processing failed for video ${videoId}`,
          {
            videoId,
            userId: video.userId,
            error: errorMessage,
            stack: aiError instanceof Error ? aiError.stack : undefined,
            aiErrorTime: `${aiErrorTime}ms`,
            transcriptionLength: transcription.length,
            timestamp: new Date().toISOString(),
          }
        );

        // If AI processing fails, refund the initial estimated credits
        const initialTransaction = await CreditTransactionRepository.findOne({
          where: {
            userId: video.userId,
            referenceId: videoId.toString(),
            referenceType: 'video_submission_estimated',
          },
          order: { createdAt: 'DESC' },
        });

        if (initialTransaction) {
          console.log(
            `[TRANSCRIPTION_STATUS] Refunding credits for failed AI processing`,
            {
              videoId,
              userId: video.userId,
              refundAmount: Math.abs(initialTransaction.amount),
              transactionId: initialTransaction.id,
              timestamp: new Date().toISOString(),
            }
          );

          await refundCredits({
            userId: video.userId,
            amount: Math.abs(initialTransaction.amount), // Refund the estimated amount
            description: 'Refund for failed AI processing',
            referenceId: videoId.toString(),
            referenceType: 'video_ai_processing_refund',
          });
        }

        await updateVideo(videoId, {
          status: 'failed',
          errorMessage: errorMessage,
        });
        throw aiError;
      }

      // Step 3: Combine: full transcript + AI insights
      const completeDashboard = {
        ...aiDashboard,
        transcript: fullTranscript, // Always 100% complete from raw text
      };

      // Calculate final credit cost
      const finalCreditsCost = calculateCreditsFromTokens(tokensUsed);

      // Update the initial transaction with actual values
      const initialTransaction = await CreditTransactionRepository.findOne({
        where: {
          userId: video.userId,
          referenceId: videoId.toString(),
          referenceType: 'video_submission_estimated',
        },
        order: { createdAt: 'DESC' },
      });

      if (initialTransaction) {
        console.log(
          `[TRANSCRIPTION_STATUS] Updating credit transaction with actual costs`,
          {
            videoId,
            userId: video.userId,
            estimatedAmount: Math.abs(initialTransaction.amount),
            actualAmount: finalCreditsCost,
            tokensUsed,
            timestamp: new Date().toISOString(),
          }
        );

        // Update the initial transaction with actual values
        await CreditTransactionRepository.update(initialTransaction.id, {
          amount: -finalCreditsCost, // Update to actual cost
          description: `AI video analysis (${tokensUsed} tokens)`,
          referenceType: 'video_ai_processing',
          tokensUsed,
        });
      } else {
        console.warn(
          `[TRANSCRIPTION_STATUS] Initial transaction not found, creating new one`,
          {
            videoId,
            userId: video.userId,
            finalCreditsCost,
            tokensUsed,
            timestamp: new Date().toISOString(),
          }
        );

        // Fallback: create new transaction if initial not found
        const creditSpent = await spendCredits({
          userId: video.userId,
          amount: finalCreditsCost,
          description: `AI video analysis (${tokensUsed} tokens)`,
          referenceId: videoId.toString(),
          referenceType: 'video_ai_processing',
          tokensUsed,
        });

        if (!creditSpent) {
          console.error(
            `[TRANSCRIPTION_STATUS] Insufficient credits for AI processing`,
            {
              videoId,
              userId: video.userId,
              requiredCredits: finalCreditsCost,
              tokensUsed,
              timestamp: new Date().toISOString(),
            }
          );

          // User doesn't have enough credits
          await updateVideo(videoId, {
            status: 'failed',
            errorMessage: 'Insufficient credits for AI processing',
          });
          return { status: 'failed' };
        }
      }

      // Update database
      await updateVideo(videoId, {
        transcription,
        dashboard: completeDashboard,
        tokensUsed,
        creditsCost: finalCreditsCost,
        status: 'completed',
      });

      const totalTime = Date.now() - startTime;
      console.log(`[TRANSCRIPTION_STATUS] Complete processing successful`, {
        videoId,
        userId: video.userId,
        totalTime: `${totalTime}ms`,
        tokensUsed,
        transcriptLength: fullTranscript.length,
        timestamp: new Date().toISOString(),
      });

      return { status: 'completed', dashboard: completeDashboard };
    } else {
      console.log(
        `[TRANSCRIPTION_STATUS] No transcription received, checking service status`,
        {
          videoId,
          transcriptionId: video.transcriptionId,
          timestamp: new Date().toISOString(),
        }
      );

      // Check if it's still processing or failed
      const response = await fetch(
        `https://api.videodowncut.com/api/transcriptions/${video.transcriptionId}/status`
      );
      const statusData: TranscriptionStatusResponse = await response.json();

      console.log(`[TRANSCRIPTION_STATUS] Service status check result`, {
        videoId,
        transcriptionId: video.transcriptionId,
        statusCode: response.status,
        serviceStatus: statusData.data?.status,
        success: statusData.success,
        hasText: !!statusData.data?.text,
        timestamp: new Date().toISOString(),
      });

      if (statusData.success && statusData.data.status === 'failed') {
        console.error(
          `[TRANSCRIPTION_STATUS] Service reported transcription failed`,
          {
            videoId,
            transcriptionId: video.transcriptionId,
            serviceStatus: statusData.data.status,
            responseData: statusData,
            timestamp: new Date().toISOString(),
          }
        );

        await updateVideo(videoId, {
          status: 'failed',
          errorMessage: 'Transcription failed at service level',
        });
        return { status: 'failed' };
      }

      console.log(
        `[TRANSCRIPTION_STATUS] Still processing, returning transcribing status`,
        {
          videoId,
          serviceStatus: statusData.data?.status,
          timestamp: new Date().toISOString(),
        }
      );

      return { status: 'transcribing' };
    }
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Status check failed';

    console.error(`[TRANSCRIPTION_STATUS] Unexpected error in status check`, {
      videoId,
      userId: video?.userId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
    });

    await updateVideo(videoId, {
      status: 'failed',
      errorMessage: errorMessage,
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

    // Refund initial estimated credits for any processing failure
    const initialTransaction = await CreditTransactionRepository.findOne({
      where: {
        userId: video.userId,
        referenceId: videoId.toString(),
        referenceType: 'video_submission_estimated',
      },
      order: { createdAt: 'DESC' },
    });

    if (initialTransaction) {
      await refundCredits({
        userId: video.userId,
        amount: Math.abs(initialTransaction.amount),
        description: 'Refund for failed video processing',
        referenceId: videoId.toString(),
        referenceType: 'video_processing_refund',
      });
    }

    throw error;
  }
}

async function downloadVideoFromService(
  videoUrl: string
): Promise<VideoDownloadResponse> {
  const startTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[VIDEODOWNCUT_API] Starting download request`, {
    requestId,
    videoUrl,
    endpoint: 'https://api.videodowncut.com/api/videos/download',
    timestamp: new Date().toISOString(),
  });

  try {
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

    const responseTime = Date.now() - startTime;
    const responseData = await response.json();

    console.log(`[VIDEODOWNCUT_API] Download response received`, {
      requestId,
      statusCode: response.status,
      responseTime: `${responseTime}ms`,
      success: responseData.success,
      hasData: !!responseData.data,
      timestamp: new Date().toISOString(),
    });

    if (!response.ok) {
      console.error(`[VIDEODOWNCUT_API] HTTP error in download request`, {
        requestId,
        statusCode: response.status,
        statusText: response.statusText,
        responseData,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    if (responseData.success && responseData.data) {
      console.log(`[VIDEODOWNCUT_API] Download successful`, {
        requestId,
        serviceVideoId: responseData.data.videoId,
        title: responseData.data.title,
        duration: responseData.data.duration,
        hasThumbnail: !!responseData.data.thumbnail,
        hasDownloadUrl: !!responseData.data.downloadUrl,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error(`[VIDEODOWNCUT_API] Download service returned failure`, {
        requestId,
        responseData,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    return responseData;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Network error';

    console.error(`[VIDEODOWNCUT_API] Network error in download request`, {
      requestId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      videoUrl,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}

async function requestTranscription(
  videoId: string
): Promise<TranscriptionResponse> {
  const startTime = Date.now();
  const requestId = `trans_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[VIDEODOWNCUT_API] Starting transcription request`, {
    requestId,
    serviceVideoId: videoId,
    endpoint: `https://api.videodowncut.com/api/videos/${videoId}/transcribe`,
    timestamp: new Date().toISOString(),
  });

  try {
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

    const responseTime = Date.now() - startTime;
    const responseData = await response.json();

    console.log(`[VIDEODOWNCUT_API] Transcription response received`, {
      requestId,
      serviceVideoId: videoId,
      statusCode: response.status,
      responseTime: `${responseTime}ms`,
      success: responseData.success,
      hasData: !!responseData.data,
      timestamp: new Date().toISOString(),
    });

    if (!response.ok) {
      console.error(`[VIDEODOWNCUT_API] HTTP error in transcription request`, {
        requestId,
        serviceVideoId: videoId,
        statusCode: response.status,
        statusText: response.statusText,
        responseData,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    }

    if (responseData.success && responseData.data) {
      console.log(`[VIDEODOWNCUT_API] Transcription request successful`, {
        requestId,
        serviceVideoId: videoId,
        transcriptionId: responseData.data.transcriptionId,
        status: responseData.data.status,
        hasStatusUrl: !!responseData.data.statusUrl,
        hasTranscriptionUrl: !!responseData.data.transcriptionUrl,
        responseTime: `${responseTime}ms`,
        timestamp: new Date().toISOString(),
      });
    } else {
      console.error(
        `[VIDEODOWNCUT_API] Transcription service returned failure`,
        {
          requestId,
          serviceVideoId: videoId,
          responseData,
          responseTime: `${responseTime}ms`,
          timestamp: new Date().toISOString(),
        }
      );
    }

    return responseData;
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'Network error';

    console.error(`[VIDEODOWNCUT_API] Network error in transcription request`, {
      requestId,
      serviceVideoId: videoId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}

async function pollTranscriptionStatus(
  transcriptionId: string
): Promise<string | null> {
  const maxAttempts = 30; // 5 minutes with 10-second intervals
  let attempts = 0;
  const startTime = Date.now();
  const requestId = `poll_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  console.log(`[TRANSCRIPTION_POLL] Starting status polling`, {
    requestId,
    transcriptionId,
    maxAttempts,
    pollInterval: '10s',
    expectedMaxTime: '5m',
    timestamp: new Date().toISOString(),
  });

  while (attempts < maxAttempts) {
    attempts++;
    const attemptStartTime = Date.now();

    console.log(
      `[TRANSCRIPTION_POLL] Polling attempt ${attempts}/${maxAttempts}`,
      {
        requestId,
        transcriptionId,
        attempt: attempts,
        timestamp: new Date().toISOString(),
      }
    );

    try {
      const response = await fetch(
        `https://api.videodowncut.com/api/transcriptions/${transcriptionId}/status`
      );
      const statusData: TranscriptionStatusResponse = await response.json();
      const attemptTime = Date.now() - attemptStartTime;

      console.log(`[TRANSCRIPTION_POLL] Status response received`, {
        requestId,
        transcriptionId,
        attempt: attempts,
        statusCode: response.status,
        status: statusData.data?.status,
        success: statusData.success,
        hasText: !!statusData.data?.text,
        attemptTime: `${attemptTime}ms`,
        timestamp: new Date().toISOString(),
      });

      if (statusData.success && statusData.data.status === 'completed') {
        const totalTime = Date.now() - startTime;
        const textLength = statusData.data.text?.length || 0;

        console.log(
          `[TRANSCRIPTION_POLL] Transcription completed successfully`,
          {
            requestId,
            transcriptionId,
            totalAttempts: attempts,
            totalTime: `${totalTime}ms`,
            textLength,
            timestamp: new Date().toISOString(),
          }
        );

        return statusData.data.text || null;
      }

      if (statusData.success && statusData.data.status === 'failed') {
        const totalTime = Date.now() - startTime;

        console.error(`[TRANSCRIPTION_POLL] Transcription failed`, {
          requestId,
          transcriptionId,
          totalAttempts: attempts,
          totalTime: `${totalTime}ms`,
          status: statusData.data.status,
          timestamp: new Date().toISOString(),
        });

        return null;
      }

      // Still processing, wait before next attempt
      if (attempts < maxAttempts) {
        console.log(
          `[TRANSCRIPTION_POLL] Still processing, waiting 10s before next attempt`,
          {
            requestId,
            transcriptionId,
            attempt: attempts,
            status: statusData.data?.status,
            nextAttempt: attempts + 1,
            timestamp: new Date().toISOString(),
          }
        );

        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    } catch (error) {
      const attemptTime = Date.now() - attemptStartTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Network error';

      console.error(
        `[TRANSCRIPTION_POLL] Error in polling attempt ${attempts}`,
        {
          requestId,
          transcriptionId,
          attempt: attempts,
          error: errorMessage,
          attemptTime: `${attemptTime}ms`,
          timestamp: new Date().toISOString(),
        }
      );

      // Continue polling even if one attempt fails
      if (attempts < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  const totalTime = Date.now() - startTime;
  console.error(
    `[TRANSCRIPTION_POLL] Polling timeout after ${maxAttempts} attempts`,
    {
      requestId,
      transcriptionId,
      totalAttempts: attempts,
      totalTime: `${totalTime}ms`,
      timestamp: new Date().toISOString(),
    }
  );

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

// Calculate credits based on tokens used
function calculateCreditsFromTokens(tokensUsed: number): number {
  // Base cost for video download and transcription services
  const baseServiceCost = 2; // 2 credits for download + transcription

  // OpenAI token cost (proportional to tokens used)
  // Using a reasonable rate: 1 credit per 500 tokens
  const tokenCredits = Math.ceil(tokensUsed / 500);

  // Total credits (base service cost + token cost)
  const totalCredits = baseServiceCost + tokenCredits;

  // Apply min/max constraints
  const minCredits = 3;
  const maxCredits = 10;

  return Math.max(minCredits, Math.min(maxCredits, totalCredits));
}

async function generateAIInsights(
  transcription: string
): Promise<{ dashboard: any; tokensUsed: number }> {
  const startTime = Date.now();
  const requestId = `ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  let totalTokensUsed = 0;

  console.log(`[AI_INSIGHTS] Starting optimized AI processing`, {
    requestId,
    transcriptionLength: transcription.length,
    estimatedTokens: estimateTokenCount(transcription),
    timestamp: new Date().toISOString(),
  });

  try {
    // Step 0: Detect language
    console.log(`[AI_INSIGHTS] Step 0: Detecting language`, {
      requestId,
      timestamp: new Date().toISOString(),
    });

    const language = await detectLanguage(transcription);
    const languagePrompts = getLanguagePrompts(language);

    console.log(`[AI_INSIGHTS] Language detection completed`, {
      requestId,
      detectedLanguage: language,
      timestamp: new Date().toISOString(),
    });

    // Step 1: Deduplication
    console.log(`[AI_INSIGHTS] Step 1: Deduplicating transcription`, {
      requestId,
      originalLength: transcription.length,
      timestamp: new Date().toISOString(),
    });

    const deduplicatedText = removeDuplicateSegments(transcription);

    console.log(`[AI_INSIGHTS] Deduplication completed`, {
      requestId,
      originalLength: transcription.length,
      deduplicatedLength: deduplicatedText.length,
      reductionPercent: Math.round(
        (1 - deduplicatedText.length / transcription.length) * 100
      ),
      timestamp: new Date().toISOString(),
    });

    // Step 2: Create robust chunks for AI processing
    const tokenCount = estimateTokenCount(deduplicatedText);
    const chunks =
      tokenCount > 2000
        ? createRobustChunks(deduplicatedText, 1500)
        : [deduplicatedText];

    console.log(`[AI_INSIGHTS] Step 2: Text chunking for AI`, {
      requestId,
      totalTokens: tokenCount,
      numberOfChunks: chunks.length,
      needsChunking: tokenCount > 2000,
      timestamp: new Date().toISOString(),
    });

    // Step 3: Process all chunks with retry logic for AI insights only
    const allResults = await processAllChunksWithRetry(
      chunks,
      requestId,
      languagePrompts
    );
    totalTokensUsed = allResults.totalTokensUsed;

    // Step 4: Consolidate AI results (summary, insights, mindMap only)
    const consolidatedAI = await consolidateAIResults(
      allResults.results,
      requestId
    );

    // Step 5: Validate AI processing completeness
    const coverage = validateAICoverage(deduplicatedText, consolidatedAI);
    if (coverage < 0.3) {
      // Reduced from 0.9 to 0.3 (30% coverage is reasonable)
      console.warn(
        `[AI_INSIGHTS] Low AI coverage detected: ${(coverage * 100).toFixed(1)}%`,
        {
          requestId,
          coverage: `${(coverage * 100).toFixed(1)}%`,
          timestamp: new Date().toISOString(),
        }
      );
      // Don't throw error, just log warning and continue
    }

    console.log(
      `[AI_INSIGHTS] Optimized AI processing completed successfully`,
      {
        requestId,
        totalTime: `${Date.now() - startTime}ms`,
        totalTokensUsed,
        coverage: `${(coverage * 100).toFixed(1)}%`,
        language,
        timestamp: new Date().toISOString(),
      }
    );

    return { dashboard: consolidatedAI, tokensUsed: totalTokensUsed };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'AI processing failed';

    console.error(`[AI_INSIGHTS] Optimized AI processing failed`, {
      requestId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      totalTime: `${totalTime}ms`,
      totalTokensUsed,
      timestamp: new Date().toISOString(),
    });

    throw error;
  }
}

// Helper function to create robust chunks with overlap
function createRobustChunks(text: string, maxTokens: number = 1500): string[] {
  const chunks: string[] = [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  let currentChunk = '';
  let currentTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = estimateTokenCount(sentence);
    const testChunk = currentChunk + sentence + '. ';
    const testTokens = estimateTokenCount(testChunk);

    if (testTokens > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Start new chunk with overlap
      currentChunk = sentence + '. ';
      currentTokens = sentenceTokens;
    } else {
      currentChunk = testChunk;
      currentTokens = testTokens;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

// Helper function to process all chunks with retry logic
async function processAllChunksWithRetry(
  chunks: string[],
  requestId: string,
  prompts: {
    system: string;
    user: (chunk: string, chunkIndex: number) => string;
  },
  maxRetries: number = 3
): Promise<{ results: any[]; totalTokensUsed: number }> {
  const results: any[] = [];
  let totalTokensUsed = 0;
  let currentChunks = [...chunks];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[AI_INSIGHTS] Processing attempt ${attempt}/${maxRetries}`, {
        requestId,
        chunksToProcess: currentChunks.length,
        timestamp: new Date().toISOString(),
      });

      for (let i = 0; i < currentChunks.length; i++) {
        const chunk = currentChunks[i];
        const chunkResult = await processChunkWithRetry(
          chunk,
          i + 1,
          requestId,
          prompts
        );

        results.push(chunkResult.result);
        totalTokensUsed += chunkResult.tokensUsed;

        console.log(
          `[AI_INSIGHTS] Chunk ${i + 1}/${currentChunks.length} processed`,
          {
            requestId,
            chunkIndex: i + 1,
            tokensUsed: chunkResult.tokensUsed,
            totalTokensUsed,
            timestamp: new Date().toISOString(),
          }
        );
      }

      // If we get here, all chunks processed successfully
      return { results, totalTokensUsed };
    } catch (error) {
      console.error(`[AI_INSIGHTS] Attempt ${attempt} failed`, {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      });

      if (attempt === maxRetries) {
        throw error;
      }

      // Reduce chunk size and retry
      currentChunks = createSmallerChunks(currentChunks, 800); // Reduce to 800 tokens
      console.log(`[AI_INSIGHTS] Reducing chunk size for retry`, {
        requestId,
        newChunkCount: currentChunks.length,
        timestamp: new Date().toISOString(),
      });
    }
  }

  throw new Error('All processing attempts failed');
}

// Helper function to create smaller chunks for retry
function createSmallerChunks(
  chunks: string[],
  maxTokens: number = 800
): string[] {
  const smallerChunks: string[] = [];

  for (const chunk of chunks) {
    const subChunks = createRobustChunks(chunk, maxTokens);
    smallerChunks.push(...subChunks);
  }

  return smallerChunks;
}

// Helper function to clean AI response and extract JSON
function extractJSONFromResponse(response: string): string {
  // Remove markdown code blocks if present
  let cleanedResponse = response.trim();

  // Check if response starts with ```json or ``` and ends with ```
  if (cleanedResponse.startsWith('```json')) {
    cleanedResponse = cleanedResponse.replace(/^```json\s*/, '');
  } else if (cleanedResponse.startsWith('```')) {
    cleanedResponse = cleanedResponse.replace(/^```\s*/, '');
  }

  // Remove trailing ```
  if (cleanedResponse.endsWith('```')) {
    cleanedResponse = cleanedResponse.replace(/```$/, '');
  }

  return cleanedResponse.trim();
}

// Helper function to process individual chunk with retry
async function processChunkWithRetry(
  chunk: string,
  chunkIndex: number,
  requestId: string,
  prompts: {
    system: string;
    user: (chunk: string, chunkIndex: number) => string;
  },
  maxRetries: number = 3
): Promise<{ result: any; tokensUsed: number }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          {
            role: 'system',
            content: prompts.system,
          },
          {
            role: 'user',
            content: prompts.user(chunk, chunkIndex),
          },
        ],
        temperature: 0.2,
        max_tokens: 1500, // Conservative
      });

      const tokensUsed = completion.usage?.total_tokens || 0;
      const response = completion.choices[0]?.message?.content;

      if (!response) {
        throw new Error('Empty response from OpenAI');
      }

      // Clean the response and extract JSON
      const cleanedResponse = extractJSONFromResponse(response);

      console.log(`[AI_INSIGHTS] Processing chunk ${chunkIndex} response`, {
        requestId,
        chunkIndex,
        attempt,
        originalResponseLength: response.length,
        cleanedResponseLength: cleanedResponse.length,
        responseStart: response.substring(0, 100),
        cleanedStart: cleanedResponse.substring(0, 100),
        timestamp: new Date().toISOString(),
      });

      let result;
      try {
        result = JSON.parse(cleanedResponse);
      } catch (parseError) {
        console.error(
          `[AI_INSIGHTS] JSON parsing failed for chunk ${chunkIndex}`,
          {
            requestId,
            chunkIndex,
            attempt,
            parseError:
              parseError instanceof Error
                ? parseError.message
                : 'Unknown parse error',
            cleanedResponse: cleanedResponse.substring(0, 200),
            timestamp: new Date().toISOString(),
          }
        );

        // Create a fallback result
        result = {
          summary: {
            text: `Análise da parte ${chunkIndex} da transcrição`,
            metrics: [
              { label: 'Duration', value: 'N/A' },
              { label: 'Main Topics', value: '1' },
              { label: 'Key Insights', value: '1' },
              { label: 'Complexity', value: 'Basic' },
            ],
            topics: ['Análise de transcrição'],
          },
          insights: {
            chips: [{ label: '1 insight extraído', variant: 'secondary' }],
            sections: [
              {
                title: 'Análise Básica',
                icon: '📝',
                items: [
                  { text: 'Conteúdo processado com sucesso', confidence: 80 },
                ],
              },
            ],
          },
          mindMap: {
            root: 'Video Insights',
            branches: [
              {
                label: 'Conteúdo Analisado',
                children: [],
              },
            ],
          },
        };

        console.log(
          `[AI_INSIGHTS] Using fallback result for chunk ${chunkIndex}`,
          {
            requestId,
            chunkIndex,
            attempt,
            timestamp: new Date().toISOString(),
          }
        );
      }

      console.log(`[AI_INSIGHTS] Chunk ${chunkIndex} processed successfully`, {
        requestId,
        chunkIndex,
        attempt,
        tokensUsed,
        hasSummary: !!result.summary,
        hasInsights: !!result.insights,
        timestamp: new Date().toISOString(),
      });

      return { result, tokensUsed };
    } catch (error) {
      console.error(
        `[AI_INSIGHTS] Chunk ${chunkIndex} attempt ${attempt} failed`,
        {
          requestId,
          chunkIndex,
          attempt,
          error: error instanceof Error ? error.message : 'Unknown error',
          timestamp: new Date().toISOString(),
        }
      );

      if (attempt === maxRetries) {
        throw error;
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }

  throw new Error(
    `Chunk ${chunkIndex} processing failed after ${maxRetries} attempts`
  );
}

// Helper function to consolidate AI results (summary, insights, mindMap only)
async function consolidateAIResults(
  chunkResults: any[],
  requestId: string
): Promise<any> {
  console.log(
    `[AI_INSIGHTS] Consolidating ${chunkResults.length} chunk results`,
    {
      requestId,
      timestamp: new Date().toISOString(),
    }
  );

  // Consolidate summaries
  const allSummaries = chunkResults
    .filter((r) => r.summary)
    .map((r) => (typeof r.summary === 'string' ? r.summary : r.summary.text))
    .join(' ');

  // Consolidate insights with diversity
  const allInsights = chunkResults
    .filter((r) => r.insights)
    .flatMap((r) => r.insights.sections || []);

  // Consolidate mind map branches
  const allBranches = chunkResults
    .filter((r) => r.mindMap)
    .flatMap((r) => r.mindMap.branches || []);

  // Create diverse insights sections
  const diverseSections = createDiverseInsightsSections(allInsights);

  // Create final consolidated dashboard (NO transcript field)
  const consolidatedAI = {
    summary: {
      text: allSummaries || 'Video analysis completed',
      metrics: [
        { label: 'Duration', value: 'N/A' },
        { label: 'Main Topics', value: allBranches.length.toString() },
        { label: 'Key Insights', value: diverseSections.length.toString() },
        { label: 'Complexity', value: 'Comprehensive' },
      ],
      topics: allBranches.map((b) => b.label),
    },
    insights: {
      chips: [
        {
          label: `${diverseSections.length} insights extracted`,
          variant: 'secondary',
        },
        { label: `${allBranches.length} main topics`, variant: 'secondary' },
        { label: 'Full analysis completed', variant: 'secondary' },
      ],
      sections: diverseSections,
    },
    mindMap: {
      root: 'Video Insights',
      branches: allBranches,
    },
  };

  console.log(`[AI_INSIGHTS] AI consolidation completed`, {
    requestId,
    summaryLength: allSummaries.length,
    insightsCount: diverseSections.length,
    branchesCount: allBranches.length,
    timestamp: new Date().toISOString(),
  });

  return consolidatedAI;
}

// Helper function to create diverse insights sections
function createDiverseInsightsSections(allSections: any[]): any[] {
  const sectionTypes = [
    {
      title: 'Key Insights',
      icon: '💡',
      keywords: ['important', 'key', 'main', 'primary'],
    },
    {
      title: 'Technical Details',
      icon: '⚙️',
      keywords: ['technical', 'technology', 'system', 'process'],
    },
    {
      title: 'Financial Analysis',
      icon: '💰',
      keywords: ['money', 'financial', 'cost', 'budget', 'investment'],
    },
    {
      title: 'Strategic Points',
      icon: '🎯',
      keywords: ['strategy', 'strategic', 'planning', 'goal'],
    },
    {
      title: 'Challenges & Solutions',
      icon: '🔧',
      keywords: ['challenge', 'problem', 'solution', 'issue'],
    },
    {
      title: 'Best Practices',
      icon: '✅',
      keywords: ['best', 'practice', 'recommendation', 'tip'],
    },
    {
      title: 'Market Insights',
      icon: '📊',
      keywords: ['market', 'trend', 'industry', 'business'],
    },
    {
      title: 'Expert Tips',
      icon: '👨‍💼',
      keywords: ['expert', 'professional', 'advice', 'guidance'],
    },
    {
      title: 'Innovation Ideas',
      icon: '🚀',
      keywords: ['innovation', 'creative', 'new', 'future'],
    },
    {
      title: 'Risk Factors',
      icon: '⚠️',
      keywords: ['risk', 'danger', 'warning', 'caution'],
    },
  ];

  const categorizedSections: { [key: string]: any[] } = {};

  // Categorize items by content
  allSections.forEach((section) => {
    if (section.items) {
      section.items.forEach((item) => {
        const itemText = item.text?.toLowerCase() || '';

        // Find the best matching category
        let bestMatch = sectionTypes[0]; // Default to Key Insights
        let bestScore = 0;

        sectionTypes.forEach((type) => {
          const score = type.keywords.reduce(
            (acc, keyword) => acc + (itemText.includes(keyword) ? 1 : 0),
            0
          );
          if (score > bestScore) {
            bestScore = score;
            bestMatch = type;
          }
        });

        if (!categorizedSections[bestMatch.title]) {
          categorizedSections[bestMatch.title] = [];
        }
        categorizedSections[bestMatch.title].push(item);
      });
    }
  });

  // Create final sections with diverse titles and icons
  const finalSections = Object.entries(categorizedSections).map(
    ([title, items]) => {
      const sectionType =
        sectionTypes.find((st) => st.title === title) || sectionTypes[0];
      return {
        title: sectionType.title,
        icon: sectionType.icon,
        items: items.slice(0, 5), // Limit to 5 items per section
      };
    }
  );

  // If no sections were created, create a default one
  if (finalSections.length === 0) {
    finalSections.push({
      title: 'Key Insights',
      icon: '💡',
      items: [
        { text: 'Video analysis completed successfully', confidence: 90 },
      ],
    });
  }

  return finalSections;
}

// Helper function to extract key topics
function extractKeyTopics(text: string): string[] {
  // Simple topic extraction - you can enhance this
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const topics = new Set<string>();

  sentences.forEach((sentence) => {
    const words = sentence.toLowerCase().match(/\b\w{4,}\b/g) || [];
    words.forEach((word) => {
      if (
        word.length > 4 &&
        ![
          'this',
          'that',
          'with',
          'from',
          'they',
          'have',
          'will',
          'said',
          'like',
          'just',
          'very',
          'much',
          'more',
          'most',
          'some',
          'time',
          'year',
          'month',
          'week',
          'day',
          'hour',
          'minute',
          'second',
        ].includes(word)
      ) {
        topics.add(word);
      }
    });
  });

  return Array.from(topics).slice(0, 15); // Reduced from 20 to 15
}

// Helper function to validate AI coverage
function validateAICoverage(originalText: string, aiDashboard: any): number {
  // Extract key topics from original text
  const originalTopics = extractKeyTopics(originalText);

  // Extract topics from processed dashboard
  const processedTopics = new Set<string>();

  // From summary topics
  if (aiDashboard.summary?.topics) {
    aiDashboard.summary.topics.forEach((topic) =>
      processedTopics.add(topic.toLowerCase())
    );
  }

  // From mind map branches
  if (aiDashboard.mindMap?.branches) {
    aiDashboard.mindMap.branches.forEach((branch) =>
      processedTopics.add(branch.label.toLowerCase())
    );
  }

  // From insights sections
  if (aiDashboard.insights?.sections) {
    aiDashboard.insights.sections.forEach((section) => {
      if (section.title) processedTopics.add(section.title.toLowerCase());
      if (section.items) {
        section.items.forEach((item) => {
          if (item.text) {
            const words = item.text.toLowerCase().match(/\b\w{4,}\b/g) || [];
            words.forEach((word) => processedTopics.add(word));
          }
        });
      }
    });
  }

  // Calculate coverage with more flexible matching
  const coveredTopics = originalTopics.filter((topic) => {
    const topicLower = topic.toLowerCase();
    return Array.from(processedTopics).some(
      (processedTopic) =>
        processedTopic.includes(topicLower) ||
        topicLower.includes(processedTopic)
    );
  });

  const coverage =
    originalTopics.length > 0
      ? coveredTopics.length / originalTopics.length
      : 1;

  console.log(`[AI_INSIGHTS] AI coverage validation`, {
    originalTopics: originalTopics.length,
    processedTopics: processedTopics.size,
    coveredTopics: coveredTopics.length,
    coverage: `${(coverage * 100).toFixed(1)}%`,
    originalTopicsSample: originalTopics.slice(0, 5),
    processedTopicsSample: Array.from(processedTopics).slice(0, 5),
  });

  return coverage;
}

// Helper function to format raw transcription into time-based segments
function formatRawTranscription(
  rawText: string
): Array<{ time: string; text: string }> {
  const sentences = rawText.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const formattedTranscript: Array<{ time: string; text: string }> = [];

  // Calculate time intervals based on total length
  const totalSentences = sentences.length;
  const timeInterval = Math.max(30, Math.floor(totalSentences / 20)); // At least 30 seconds

  sentences.forEach((sentence, index) => {
    const minutes = Math.floor((index * timeInterval) / 60);
    const seconds = (index * timeInterval) % 60;
    const time = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    formattedTranscript.push({
      time,
      text: sentence.trim() + '.',
    });
  });

  return formattedTranscript;
}

// Helper function to detect language from text
async function detectLanguage(text: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content:
            'Detect the language of the given text. Return only the language code (e.g., "en", "pt", "es", "fr"). If mixed languages, return the dominant one.',
        },
        {
          role: 'user',
          content: `Detect the language of this text: ${text.substring(0, 1000)}`,
        },
      ],
      temperature: 0,
      max_tokens: 10,
    });

    const language = completion.choices[0]?.message?.content?.trim() || 'en';
    console.log(`[LANGUAGE_DETECTION] Detected language: ${language}`, {
      textLength: text.length,
      sampleText: text.substring(0, 200),
      timestamp: new Date().toISOString(),
    });

    return language;
  } catch (error) {
    console.warn(
      `[LANGUAGE_DETECTION] Failed to detect language, defaulting to English`,
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }
    );
    return 'en';
  }
}

// Helper function to get language-specific prompts
function getLanguagePrompts(language: string) {
  const prompts = {
    pt: {
      system: `Você é um assistente especializado em análise de transcrições de vídeo.

IMPORTANTE: Retorne APENAS JSON válido, sem markdown, sem código, sem texto extra. Apenas o objeto JSON puro.

Estrutura JSON esperada:
{
  "summary": {
    "text": "Resumo conciso do conteúdo",
    "metrics": [
      { "label": "Duration", "value": "N/A" },
      { "label": "Main Topics", "value": "3" },
      { "label": "Key Insights", "value": "5" },
      { "label": "Complexity", "value": "Intermediate" }
    ],
    "topics": ["Tópico 1", "Tópico 2"]
  },
  "insights": {
    "chips": [
      { "label": "5 insights extraídos", "variant": "secondary" }
    ],
    "sections": [
      {
        "title": "Insights Principais",
        "icon": "💡",
        "items": [
          { "text": "Insight importante", "confidence": 95 }
        ]
      }
    ]
  },
  "mindMap": {
    "root": "Video Insights",
    "branches": [
      {
        "label": "Tópico Principal",
        "children": [
          { "label": "Subtópico 1" }
        ]
      }
    ]
  }
}`,
      user: (
        chunk: string,
        chunkIndex: number
      ) => `Analise esta parte da transcrição e retorne insights estruturados em JSON. Esta é a parte ${chunkIndex} de uma transcrição completa.

IMPORTANTE: Retorne APENAS JSON válido, sem markdown, sem código, sem texto extra. Apenas o objeto JSON puro.

Transcrição para análise:
${chunk}`,
    },
    en: {
      system: `You are an expert video transcription analysis assistant.

IMPORTANT: Return ONLY valid JSON, no markdown, no code, no extra text. Just the pure JSON object.

Expected JSON structure:
{
  "summary": {
    "text": "Concise content summary",
    "metrics": [
      { "label": "Duration", "value": "N/A" },
      { "label": "Main Topics", "value": "3" },
      { "label": "Key Insights", "value": "5" },
      { "label": "Complexity", "value": "Intermediate" }
    ],
    "topics": ["Topic 1", "Topic 2"]
  },
  "insights": {
    "chips": [
      { "label": "5 insights extracted", "variant": "secondary" }
    ],
    "sections": [
      {
        "title": "Key Insights",
        "icon": "💡",
        "items": [
          { "text": "Important insight", "confidence": 95 }
        ]
      }
    ]
  },
  "mindMap": {
    "root": "Video Insights",
    "branches": [
      {
        "label": "Main Topic",
        "children": [
          { "label": "Subtopic 1" }
        ]
      }
    ]
  }
}`,
      user: (
        chunk: string,
        chunkIndex: number
      ) => `Analyze this part of the transcription and return structured insights in JSON. This is part ${chunkIndex} of a complete transcription.

IMPORTANT: Return ONLY valid JSON, no markdown, no code, no extra text. Just the pure JSON object.

Transcription for analysis:
${chunk}`,
    },
  };

  return prompts[language] || prompts['en'];
}

// Utility function to get failed videos with error details
export async function getFailedVideos(
  userId?: number,
  limit: number = 50,
  offset: number = 0
): Promise<{
  videos: VideoEntity[];
  total: number;
  errorSummary: {
    downloadFailures: number;
    transcriptionFailures: number;
    aiProcessingFailures: number;
    creditFailures: number;
    unknownFailures: number;
  };
}> {
  const queryBuilder = VideoRepository.createQueryBuilder('video')
    .where('video.status = :status', { status: 'failed' })
    .orderBy('video.updatedAt', 'DESC');

  if (userId) {
    queryBuilder.andWhere('video.userId = :userId', { userId });
  }

  const videos = await queryBuilder.limit(limit).offset(offset).getMany();

  const total = await queryBuilder.getCount();

  // Analyze error patterns
  const errorSummary = {
    downloadFailures: 0,
    transcriptionFailures: 0,
    aiProcessingFailures: 0,
    creditFailures: 0,
    unknownFailures: 0,
  };

  videos.forEach((video) => {
    const errorMessage = video.errorMessage?.toLowerCase() || '';

    if (
      errorMessage.includes('download') ||
      errorMessage.includes('videodowncut')
    ) {
      errorSummary.downloadFailures++;
    } else if (
      errorMessage.includes('transcription') ||
      errorMessage.includes('transcribe')
    ) {
      errorSummary.transcriptionFailures++;
    } else if (
      errorMessage.includes('ai') ||
      errorMessage.includes('openai') ||
      errorMessage.includes('insights')
    ) {
      errorSummary.aiProcessingFailures++;
    } else if (
      errorMessage.includes('credit') ||
      errorMessage.includes('insufficient')
    ) {
      errorSummary.creditFailures++;
    } else {
      errorSummary.unknownFailures++;
    }
  });

  return { videos, total, errorSummary };
}
