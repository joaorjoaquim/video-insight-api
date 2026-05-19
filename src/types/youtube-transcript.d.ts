declare module 'youtube-transcript' {
  export interface TranscriptSegment {
    text: string;
    duration: number;
    offset: number;
  }

  export class YoutubeTranscript {
    static fetchTranscript(videoId: string): Promise<TranscriptSegment[]>;
  }
}
