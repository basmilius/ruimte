import type { DictationChunk } from './engine';

export interface Transcript {
    settled: string;
    pending: string;
}
export const EMPTY_TRANSCRIPT: Transcript = { settled: '', pending: '' };

export const applyChunk = (_previous: Transcript, chunk: DictationChunk): Transcript =>
    chunk.final ? { settled: chunk.text, pending: '' } : { settled: '', pending: chunk.text };

export const joinTranscript = (chunks: readonly DictationChunk[]): Transcript => chunks.reduce(applyChunk, EMPTY_TRANSCRIPT);
export const transcriptText = (transcript: Transcript): string => transcript.settled || transcript.pending;
