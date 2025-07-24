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
      console.log(
        `[TRANSCRIPTION_STATUS] Transcription received, starting AI processing`,
        {
          videoId,
          transcriptionLength: transcription.length,
          timestamp: new Date().toISOString(),
        }
      );

      // Track tokens used and spend credits
      let totalTokensUsed = 0;
      let dashboard: any;

      try {
        // Generate AI insights (original function)
        const { dashboard: generatedDashboard, tokensUsed } =
          await generateAIInsights(transcription);

        // Use actual tokens from OpenAI API
        totalTokensUsed = tokensUsed;

        console.log(
          `[TRANSCRIPTION_STATUS] AI insights generated successfully`,
          {
            videoId,
            tokensUsed: totalTokensUsed,
            hasDashboard: !!generatedDashboard,
            timestamp: new Date().toISOString(),
          }
        );

        // Calculate final credit cost based on actual tokens used
        const finalCreditsCost = calculateCreditsFromTokens(totalTokensUsed);

        // Update the initial estimated transaction with actual values
        // Find the initial transaction for this video
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
              tokensUsed: totalTokensUsed,
              timestamp: new Date().toISOString(),
            }
          );

          // Update the initial transaction with actual values
          await CreditTransactionRepository.update(initialTransaction.id, {
            amount: -finalCreditsCost, // Update to actual cost
            description: `AI video analysis (${totalTokensUsed} tokens)`,
            referenceType: 'video_ai_processing',
            tokensUsed: totalTokensUsed,
          });
        } else {
          console.warn(
            `[TRANSCRIPTION_STATUS] Initial transaction not found, creating new one`,
            {
              videoId,
              userId: video.userId,
              finalCreditsCost,
              tokensUsed: totalTokensUsed,
              timestamp: new Date().toISOString(),
            }
          );

          // Fallback: create new transaction if initial not found
          const creditSpent = await spendCredits({
            userId: video.userId,
            amount: finalCreditsCost,
            description: `AI video analysis (${totalTokensUsed} tokens)`,
            referenceId: videoId.toString(),
            referenceType: 'video_ai_processing',
            tokensUsed: totalTokensUsed,
          });

          if (!creditSpent) {
            console.error(
              `[TRANSCRIPTION_STATUS] Insufficient credits for AI processing`,
              {
                videoId,
                userId: video.userId,
                requiredCredits: finalCreditsCost,
                tokensUsed: totalTokensUsed,
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

        await updateVideo(videoId, {
          transcription,
          dashboard: generatedDashboard, // Save the full dashboard object
          tokensUsed: totalTokensUsed,
          creditsCost: finalCreditsCost,
          status: 'completed',
        });

        const totalTime = Date.now() - startTime;
        console.log(
          `[TRANSCRIPTION_STATUS] Video processing completed successfully`,
          {
            videoId,
            userId: video.userId,
            totalTime: `${totalTime}ms`,
            tokensUsed: totalTokensUsed,
            creditsCost: finalCreditsCost,
            timestamp: new Date().toISOString(),
          }
        );

        return { status: 'completed', dashboard: generatedDashboard };
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

  console.log(`[AI_INSIGHTS] Starting AI insights generation`, {
    requestId,
    transcriptionLength: transcription.length,
    estimatedTokens: estimateTokenCount(transcription),
    timestamp: new Date().toISOString(),
  });

  try {
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

    // Step 2: Check if text needs to be split into chunks
    const tokenCount = estimateTokenCount(deduplicatedText);
    const chunks =
      tokenCount > 1500
        ? splitTextIntoChunks(deduplicatedText)
        : [deduplicatedText];

    console.log(`[AI_INSIGHTS] Step 2: Text chunking`, {
      requestId,
      totalTokens: tokenCount,
      numberOfChunks: chunks.length,
      needsChunking: tokenCount > 2000,
      timestamp: new Date().toISOString(),
    });

    const allResults: any[] = [];
    const allWarnings: string[] = [];
    let totalTokensUsed = 0;

    // Process each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkStartTime = Date.now();
      const chunk = chunks[i];
      const chunkTokenCount = estimateTokenCount(chunk);

      console.log(`[AI_INSIGHTS] Processing chunk ${i + 1}/${chunks.length}`, {
        requestId,
        chunkIndex: i + 1,
        chunkLength: chunk.length,
        estimatedTokens: chunkTokenCount,
        timestamp: new Date().toISOString(),
      });

      if (chunkTokenCount > 2000) {
        const warning = `Chunk ${i + 1} muito longo (${chunkTokenCount} tokens) - resumido`;
        allWarnings.push(warning);
        console.warn(`[AI_INSIGHTS] Large chunk detected`, {
          requestId,
          chunkIndex: i + 1,
          chunkTokens: chunkTokenCount,
          warning,
          timestamp: new Date().toISOString(),
        });
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

      console.log(
        `[AI_INSIGHTS] Sending request to OpenAI for chunk ${i + 1}`,
        {
          requestId,
          chunkIndex: i + 1,
          promptLength: prompt.length,
          timestamp: new Date().toISOString(),
        }
      );

      try {
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
          max_tokens: 6000, // Increased from 500 to ensure complete response
          // Removed stop parameter to prevent truncation
        });

        const chunkTime = Date.now() - chunkStartTime;
        const tokensUsed = completion.usage?.total_tokens || 0;
        totalTokensUsed += tokensUsed;

        console.log(
          `[AI_INSIGHTS] OpenAI response received for chunk ${i + 1}`,
          {
            requestId,
            chunkIndex: i + 1,
            responseTime: `${chunkTime}ms`,
            tokensUsed,
            totalTokensUsed,
            timestamp: new Date().toISOString(),
          }
        );

        // Track actual tokens used from OpenAI response
        const response = completion.choices[0]?.message?.content;

        if (!response) {
          console.error(
            `[AI_INSIGHTS] Empty response from OpenAI for chunk ${i + 1}`,
            {
              requestId,
              chunkIndex: i + 1,
              timestamp: new Date().toISOString(),
            }
          );
          throw new Error('Failed to generate AI insights for chunk');
        }

        // Check if response is complete JSON
        const trimmedResponse = response.trim();
        if (!trimmedResponse.endsWith('}')) {
          console.error(
            `[AI_INSIGHTS] Incomplete JSON response detected for chunk ${i + 1}`,
            {
              requestId,
              chunkIndex: i + 1,
              responseEndsWith: trimmedResponse.slice(-50),
              responseLength: response.length,
              timestamp: new Date().toISOString(),
            }
          );
          throw new Error('Incomplete JSON response from OpenAI');
        }

        try {
          const result = JSON.parse(response);
          console.log(
            `[AI_INSIGHTS] JSON parsed successfully for chunk ${i + 1}`,
            {
              requestId,
              chunkIndex: i + 1,
              hasSummary: !!result.summary,
              hasTranscript: !!result.transcript,
              hasInsights: !!result.insights,
              hasMindMap: !!result.mindMap,
              timestamp: new Date().toISOString(),
            }
          );

          // Check if this is already a dashboard object
          if (
            result.summary &&
            typeof result.summary === 'object' &&
            result.summary.text
          ) {
            console.log(
              `[AI_INSIGHTS] Returning dashboard object directly for chunk ${i + 1}`,
              {
                requestId,
                chunkIndex: i + 1,
                timestamp: new Date().toISOString(),
              }
            );
            // This is already a dashboard object, return it directly
            return { dashboard: result, tokensUsed: totalTokensUsed };
          }

          // Check if this has the full dashboard structure
          if (
            result.summary &&
            result.transcript &&
            result.insights &&
            result.mindMap
          ) {
            console.log(
              `[AI_INSIGHTS] Returning full dashboard structure for chunk ${i + 1}`,
              {
                requestId,
                chunkIndex: i + 1,
                timestamp: new Date().toISOString(),
              }
            );
            return { dashboard: result, tokensUsed: totalTokensUsed };
          }

          // If it's the old format, store it for consolidation
          allResults.push(result);
          if (result.warnings) {
            allWarnings.push(...result.warnings);
          }
        } catch (parseError) {
          console.error(`[AI_INSIGHTS] JSON parsing error for chunk ${i + 1}`, {
            requestId,
            chunkIndex: i + 1,
            error:
              parseError instanceof Error
                ? parseError.message
                : 'Unknown parsing error',
            responseLength: response.length,
            responseStart: response.substring(0, 100),
            responseEnd: response.substring(response.length - 100),
            timestamp: new Date().toISOString(),
          });

          // Check if the response is truncated
          if (
            response.includes('"insights"') &&
            response.includes('"mindMap"')
          ) {
            console.log(
              `[AI_INSIGHTS] Attempting to fix truncated response for chunk ${i + 1}`,
              {
                requestId,
                chunkIndex: i + 1,
                timestamp: new Date().toISOString(),
              }
            );
            // Try to find the end of the JSON
            const lastBrace = response.lastIndexOf('}');
            if (lastBrace > 0) {
              const truncatedResponse = response.substring(0, lastBrace + 1);
              try {
                const fixedResult = JSON.parse(truncatedResponse);
                console.log(
                  `[AI_INSIGHTS] Successfully parsed truncated response for chunk ${i + 1}`,
                  {
                    requestId,
                    chunkIndex: i + 1,
                    timestamp: new Date().toISOString(),
                  }
                );
                if (
                  fixedResult.summary &&
                  fixedResult.transcript &&
                  fixedResult.insights &&
                  fixedResult.mindMap
                ) {
                  return {
                    dashboard: fixedResult,
                    tokensUsed: totalTokensUsed,
                  };
                }
              } catch (fixError) {
                console.error(
                  `[AI_INSIGHTS] Failed to fix truncated response for chunk ${i + 1}`,
                  {
                    requestId,
                    chunkIndex: i + 1,
                    error:
                      fixError instanceof Error
                        ? fixError.message
                        : 'Unknown fix error',
                    timestamp: new Date().toISOString(),
                  }
                );
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
      } catch (openaiError) {
        console.error(`[AI_INSIGHTS] OpenAI API error for chunk ${i + 1}`, {
          requestId,
          chunkIndex: i + 1,
          error:
            openaiError instanceof Error
              ? openaiError.message
              : 'Unknown OpenAI error',
          stack: openaiError instanceof Error ? openaiError.stack : undefined,
          timestamp: new Date().toISOString(),
        });
        throw openaiError;
      }
    }

    console.log(`[AI_INSIGHTS] All chunks processed, consolidating results`, {
      requestId,
      numberOfChunks: chunks.length,
      numberOfResults: allResults.length,
      totalTokensUsed,
      timestamp: new Date().toISOString(),
    });

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
      console.log(`[AI_INSIGHTS] Single chunk result, processing directly`, {
        requestId,
        hasSummary: !!result.summary,
        hasTranscript: !!result.transcript,
        hasInsights: !!result.insights,
        hasMindMap: !!result.mindMap,
        timestamp: new Date().toISOString(),
      });

      // If the result is already a dashboard object, return it
      if (
        result.summary &&
        typeof result.summary === 'object' &&
        result.summary.text
      ) {
        console.log(`[AI_INSIGHTS] Returning single chunk dashboard object`, {
          requestId,
          timestamp: new Date().toISOString(),
        });
        return { dashboard: result, tokensUsed: totalTokensUsed };
      }

      // If the result has the full dashboard structure (summary, transcript, insights, mindMap)
      if (
        result.summary &&
        result.transcript &&
        result.insights &&
        result.mindMap
      ) {
        console.log(`[AI_INSIGHTS] Returning full dashboard structure`, {
          requestId,
          timestamp: new Date().toISOString(),
        });
        return { dashboard: result, tokensUsed: totalTokensUsed };
      }

      // If it's the old format, convert to dashboard format
      if (result.summary && typeof result.summary === 'string') {
        console.log(`[AI_INSIGHTS] Converting old format to dashboard format`, {
          requestId,
          timestamp: new Date().toISOString(),
        });
        return {
          dashboard: {
            summary: {
              text: result.summary,
              metrics: [
                { label: 'Duration', value: 'N/A' },
                { label: 'Main Topics', value: allTopics.size.toString() },
                { label: 'Key Insights', value: 'N/A' },
                { label: 'Complexity', value: 'Intermediate' },
              ],
              topics: Array.from(allTopics),
            },
            transcript: [
              { time: '00:00', text: 'Transcript processing completed' },
            ],
            insights: {
              chips: [
                {
                  label: `${allTopics.size} topics extracted`,
                  variant: 'secondary',
                },
                { label: 'Processing completed', variant: 'secondary' },
              ],
              sections: [
                {
                  title: 'Key Insights',
                  icon: '💡',
                  items: [{ text: 'Video analysis completed', confidence: 90 }],
                },
              ],
            },
            mindMap: {
              root: 'Video Insights',
              branches: Array.from(allTopics).map((topic) => ({
                label: topic,
                children: [],
              })),
            },
          },
          tokensUsed: totalTokensUsed,
        };
      }
    }

    // If we have multiple chunks, create a final consolidation
    if (chunks.length > 1) {
      console.log(
        `[AI_INSIGHTS] Multiple chunks detected, creating consolidation`,
        {
          requestId,
          numberOfChunks: chunks.length,
          timestamp: new Date().toISOString(),
        }
      );

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

      try {
        console.log(`[AI_INSIGHTS] Sending consolidation request to OpenAI`, {
          requestId,
          consolidationPromptLength: consolidationPrompt.length,
          timestamp: new Date().toISOString(),
        });

        const consolidationCompletion = await openai.chat.completions.create({
          model: 'gpt-4-turbo-preview',
          messages: [
            {
              role: 'system',
              content:
                'Você é um assistente especializado em consolidação de análises de vídeo. Sempre retorne JSON válido e completo.',
            },
            {
              role: 'user',
              content: consolidationPrompt,
            },
          ],
          temperature: 0.2,
          max_tokens: 6000,
        });

        const consolidationTokens =
          consolidationCompletion.usage?.total_tokens || 0;
        totalTokensUsed += consolidationTokens;

        console.log(`[AI_INSIGHTS] Consolidation response received`, {
          requestId,
          consolidationTokens,
          totalTokensUsed,
          timestamp: new Date().toISOString(),
        });

        const consolidationResponse =
          consolidationCompletion.choices[0]?.message?.content;

        if (!consolidationResponse) {
          throw new Error('Failed to generate consolidation');
        }

        try {
          const consolidatedResult = JSON.parse(consolidationResponse);
          console.log(`[AI_INSIGHTS] Consolidation JSON parsed successfully`, {
            requestId,
            hasSummary: !!consolidatedResult.summary,
            hasTranscript: !!consolidatedResult.transcript,
            hasInsights: !!consolidatedResult.insights,
            hasMindMap: !!consolidatedResult.mindMap,
            timestamp: new Date().toISOString(),
          });

          return { dashboard: consolidatedResult, tokensUsed: totalTokensUsed };
        } catch (consolidationParseError) {
          console.error(`[AI_INSIGHTS] Consolidation JSON parsing error`, {
            requestId,
            error:
              consolidationParseError instanceof Error
                ? consolidationParseError.message
                : 'Unknown parsing error',
            responseLength: consolidationResponse.length,
            timestamp: new Date().toISOString(),
          });
          throw new Error('Failed to parse consolidation response');
        }
      } catch (consolidationError) {
        console.error(`[AI_INSIGHTS] Consolidation failed`, {
          requestId,
          error:
            consolidationError instanceof Error
              ? consolidationError.message
              : 'Unknown consolidation error',
          timestamp: new Date().toISOString(),
        });
        throw consolidationError;
      }
    }

    // Fallback: create a basic dashboard
    console.log(`[AI_INSIGHTS] Creating fallback dashboard`, {
      requestId,
      timestamp: new Date().toISOString(),
    });

    const fallbackDashboard = {
      summary: {
        text: consolidatedSummary || 'Video analysis completed',
        metrics: [
          { label: 'Duration', value: 'N/A' },
          { label: 'Main Topics', value: allTopics.size.toString() },
          { label: 'Key Insights', value: 'N/A' },
          { label: 'Complexity', value: 'Intermediate' },
        ],
        topics: Array.from(allTopics),
      },
      transcript: [{ time: '00:00', text: 'Transcript processing completed' }],
      insights: {
        chips: [
          { label: `${allTopics.size} topics extracted`, variant: 'secondary' },
          { label: 'Processing completed', variant: 'secondary' },
        ],
        sections: [
          {
            title: 'Key Insights',
            icon: '💡',
            items: [{ text: 'Video analysis completed', confidence: 90 }],
          },
        ],
      },
      mindMap: {
        root: 'Video Insights',
        branches: Array.from(allTopics).map((topic) => ({
          label: topic,
          children: [],
        })),
      },
    };

    const totalTime = Date.now() - startTime;
    console.log(`[AI_INSIGHTS] AI insights generation completed successfully`, {
      requestId,
      totalTime: `${totalTime}ms`,
      totalTokensUsed,
      numberOfChunks: chunks.length,
      timestamp: new Date().toISOString(),
    });

    return { dashboard: fallbackDashboard, tokensUsed: totalTokensUsed };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const errorMessage =
      error instanceof Error ? error.message : 'AI insights generation failed';

    console.error(`[AI_INSIGHTS] AI insights generation failed`, {
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
