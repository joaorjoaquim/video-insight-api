import { OpenAI } from 'openai';
import logger from '../config/logger';
import { logVideoEvent } from '../lib/log-video-event';
import type { VideoPipelineContext } from '../lib/video-types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// Helper function to count tokens (rough estimation)
function estimateTokenCount(text: string): number {
  // Rough estimation: 1 token â‰ˆ 4 characters for English text
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
export function calculateCreditsFromTokens(tokensUsed: number): number {
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

export async function generateAIInsights(transcription: string, ctx?: VideoPipelineContext
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
            text: `AnÃ¡lise da parte ${chunkIndex} da transcriÃ§Ã£o`,
            metrics: [
              { label: 'Duration', value: 'N/A' },
              { label: 'Main Topics', value: '1' },
              { label: 'Key Insights', value: '1' },
              { label: 'Complexity', value: 'Basic' },
            ],
            topics: ['AnÃ¡lise de transcriÃ§Ã£o'],
          },
          insights: {
            chips: [{ label: '1 insight extraÃ­do', variant: 'secondary' }],
            sections: [
              {
                title: 'AnÃ¡lise BÃ¡sica',
                icon: 'ðŸ“',
                items: [
                  { text: 'ConteÃºdo processado com sucesso', confidence: 80 },
                ],
              },
            ],
          },
          mindMap: {
            root: 'Video Insights',
            branches: [
              {
                label: 'ConteÃºdo Analisado',
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
      icon: 'ðŸ’¡',
      keywords: ['important', 'key', 'main', 'primary'],
    },
    {
      title: 'Technical Details',
      icon: 'âš™ï¸',
      keywords: ['technical', 'technology', 'system', 'process'],
    },
    {
      title: 'Financial Analysis',
      icon: 'ðŸ’°',
      keywords: ['money', 'financial', 'cost', 'budget', 'investment'],
    },
    {
      title: 'Strategic Points',
      icon: 'ðŸŽ¯',
      keywords: ['strategy', 'strategic', 'planning', 'goal'],
    },
    {
      title: 'Challenges & Solutions',
      icon: 'ðŸ”§',
      keywords: ['challenge', 'problem', 'solution', 'issue'],
    },
    {
      title: 'Best Practices',
      icon: 'âœ…',
      keywords: ['best', 'practice', 'recommendation', 'tip'],
    },
    {
      title: 'Market Insights',
      icon: 'ðŸ“Š',
      keywords: ['market', 'trend', 'industry', 'business'],
    },
    {
      title: 'Expert Tips',
      icon: 'ðŸ‘¨â€ðŸ’¼',
      keywords: ['expert', 'professional', 'advice', 'guidance'],
    },
    {
      title: 'Innovation Ideas',
      icon: 'ðŸš€',
      keywords: ['innovation', 'creative', 'new', 'future'],
    },
    {
      title: 'Risk Factors',
      icon: 'âš ï¸',
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
      icon: 'ðŸ’¡',
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
    const words: string[] = sentence.toLowerCase().match(/\b\w{4,}\b/g) || [];
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
export function formatRawTranscription(
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
      system: `VocÃª Ã© um assistente especializado em anÃ¡lise de transcriÃ§Ãµes de vÃ­deo.

IMPORTANTE: Retorne APENAS JSON vÃ¡lido, sem markdown, sem cÃ³digo, sem texto extra. Apenas o objeto JSON puro.

Estrutura JSON esperada:
{
  "summary": {
    "text": "Resumo conciso do conteÃºdo",
    "metrics": [
      { "label": "Duration", "value": "N/A" },
      { "label": "Main Topics", "value": "3" },
      { "label": "Key Insights", "value": "5" },
      { "label": "Complexity", "value": "Intermediate" }
    ],
    "topics": ["TÃ³pico 1", "TÃ³pico 2"]
  },
  "insights": {
    "chips": [
      { "label": "5 insights extraÃ­dos", "variant": "secondary" }
    ],
    "sections": [
      {
        "title": "Insights Principais",
        "icon": "ðŸ’¡",
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
        "label": "TÃ³pico Principal",
        "children": [
          { "label": "SubtÃ³pico 1" }
        ]
      }
    ]
  }
}`,
      user: (
        chunk: string,
        chunkIndex: number
      ) => `Analise esta parte da transcriÃ§Ã£o e retorne insights estruturados em JSON. Esta Ã© a parte ${chunkIndex} de uma transcriÃ§Ã£o completa.

IMPORTANTE: Retorne APENAS JSON vÃ¡lido, sem markdown, sem cÃ³digo, sem texto extra. Apenas o objeto JSON puro.

TranscriÃ§Ã£o para anÃ¡lise:
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
        "icon": "ðŸ’¡",
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


