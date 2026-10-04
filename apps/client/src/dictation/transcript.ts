import type { DictationChunk } from './engine';

export interface Transcript {
    settled: string;
    pending: string;
}
export const EMPTY_TRANSCRIPT: Transcript = { settled: '', pending: '' };

export function applyChunk(_previous: Transcript, chunk: DictationChunk): Transcript {
    return chunk.final ? { settled: chunk.text, pending: '' } : { settled: '', pending: chunk.text };
}

export function transcriptText(transcript: Transcript): string {
    return transcript.settled || transcript.pending;
}
