/*
 * One listener to the microphone across every window, since Voice Control and dictation never record
 * together. A window says when it takes the microphone; every other window hears it and lets go.
 */
export interface MicrophoneBridge {
    claim(): void;
    onClaimed(listener: () => void): () => void;
}
