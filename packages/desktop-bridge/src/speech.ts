export interface SpeechState {
    enabled: boolean;
    phase: 'missing' | 'downloading' | 'verifying' | 'ready' | 'error' | 'unavailable';
    downloadedBytes: number;
    totalBytes: number;
    error: string | null;
}

export type SpeechEvent =
    | { type: 'ready'; sessionId: string }
    | { type: 'transcript'; sessionId: string; text: string; final: boolean }
    | { type: 'ended'; sessionId: string }
    | { type: 'failed'; sessionId: string; message: string };

export interface SpeechBridge {
    state(): Promise<SpeechState>;
    setEnabled(enabled: boolean): Promise<SpeechState>;
    removeModel(): Promise<SpeechState>;
    start(sessionId: string, language: string): Promise<void>;
    samples(sessionId: string, samples: Float32Array): Promise<void>;
    stop(sessionId: string): Promise<void>;
    cancel(sessionId: string): Promise<void>;
    onState(listener: (state: SpeechState) => void): () => void;
    onEvent(listener: (event: SpeechEvent) => void): () => void;
}
