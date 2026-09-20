/*
 * The worklet that pulls samples off the microphone, as a file of its own because a worklet is a
 * module at run time and the policy in `packages/csp` allows a script from this origin and no blob.
 * `capture.ts` is the only thing that loads it, and the names have to match what it posts back.
 */

/* 64 ms at 16 kHz: fifteen messages a second, which is cheap enough for the pipe and fast enough
   that a level meter drawn from these blocks reads as a voice rather than as a slideshow. */
const FRAMES_PER_MESSAGE = 1024;

class SpeechTap extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buffer = new Float32Array(FRAMES_PER_MESSAGE);
        this.filled = 0;
        this.port.onmessage = (event) => {
            if (event.data === 'flush') {
                if (this.filled > 0) {
                    this.port.postMessage(this.buffer.slice(0, this.filled));
                    this.filled = 0;
                }
                this.port.postMessage('flushed');
            }
        };
    }

    process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel) {
            // No input yet is not the end of the graph; returning false would stop it for good.
            return true;
        }
        for (let index = 0; index < channel.length; index += 1) {
            this.buffer[this.filled] = channel[index];
            this.filled += 1;
            if (this.filled === this.buffer.length) {
                this.port.postMessage(this.buffer.slice());
                this.filled = 0;
            }
        }
        return true;
    }
}

registerProcessor('speech-tap', SpeechTap);
