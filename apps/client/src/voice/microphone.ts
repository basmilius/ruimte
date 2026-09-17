import { desktop } from '@/desktop/bridge';

export interface MicrophoneSnapshot {
    deviceName: string;
    bands: number[];
    trackStatus: 'live' | 'muted' | 'disabled' | 'ended';
}

export const WAVEFORM_BAND_COUNT = 40;
export const DEFAULT_MICROPHONE_ID = 'default';

export interface MicrophoneDevice {
    id: string;
    label: string;
}

export const microphoneConstraints = (deviceId: string): MediaStreamConstraints => ({
    audio: {
        echoCancellation: true,
        noiseSuppression: true,
        ...(deviceId === DEFAULT_MICROPHONE_ID ? {} : { deviceId: { exact: deviceId } })
    }
});

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export const openMicrophoneStream = async (
    deviceId: string,
    getUserMedia: GetUserMedia = (constraints) => navigator.mediaDevices.getUserMedia(constraints)
): Promise<MediaStream> => {
    try {
        return await getUserMedia(microphoneConstraints(deviceId));
    } catch (error) {
        const unavailable = error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'OverconstrainedError');
        if (deviceId === DEFAULT_MICROPHONE_ID || !unavailable) {
            throw error;
        }
        return getUserMedia(microphoneConstraints(DEFAULT_MICROPHONE_ID));
    }
};

export const listMicrophones = async (): Promise<MicrophoneDevice[]> => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    let unnamed = 0;
    return devices
        .filter((device) => device.kind === 'audioinput' && device.deviceId !== DEFAULT_MICROPHONE_ID)
        .map((device) => ({
            id: device.deviceId,
            label: device.label || `Microphone ${++unnamed}`
        }));
};

export class WaveformMonitor {
    readonly #onBands: (bands: number[]) => void;
    #context: AudioContext | null = null;
    #source: MediaStreamAudioSourceNode | null = null;
    #analyser: AnalyserNode | null = null;
    #frame: number | null = null;
    #lastFrame = 0;
    #stopped = false;
    #levels = Array(WAVEFORM_BAND_COUNT).fill(0);

    constructor(onBands: (bands: number[]) => void) {
        this.#onBands = onBands;
    }

    async start(stream: MediaStream): Promise<void> {
        this.#stopped = false;
        this.#levels.fill(0);
        const context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.minDecibels = -80;
        analyser.maxDecibels = -20;
        analyser.smoothingTimeConstant = 0.72;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        this.#context = context;
        this.#source = source;
        this.#analyser = analyser;
        await context.resume();
        if (this.#stopped || this.#context !== context) {
            return;
        }
        this.#frame = requestAnimationFrame((time) => this.#measure(time));
    }

    stop(): void {
        this.#stopped = true;
        if (this.#frame !== null) {
            cancelAnimationFrame(this.#frame);
            this.#frame = null;
        }
        this.#source?.disconnect();
        void this.#context?.close();
        this.#context = null;
        this.#source = null;
        this.#analyser = null;
    }

    #measure(time: number): void {
        const analyser = this.#analyser;
        if (!analyser) {
            return;
        }
        if (time - this.#lastFrame >= 32) {
            this.#lastFrame = time;
            const waveform = new Uint8Array(analyser.fftSize);
            analyser.getByteTimeDomainData(waveform);
            const measured = Array.from({ length: WAVEFORM_BAND_COUNT }, (_, index) => {
                const start = Math.floor((index / WAVEFORM_BAND_COUNT) * waveform.length);
                const end = Math.max(start + 1, Math.floor(((index + 1) / WAVEFORM_BAND_COUNT) * waveform.length));
                let squares = 0;
                for (let sample = start; sample < end; sample += 1) {
                    const amplitude = ((waveform[sample] ?? 128) - 128) / 128;
                    squares += amplitude * amplitude;
                }
                return Math.min(1, Math.sqrt(squares / (end - start)) * 4);
            });
            this.#levels = measured.map((level, index) => {
                const previous = this.#levels[index] ?? 0;
                const response = level > previous ? 0.38 : 0.16;
                return previous + (level - previous) * response;
            });
            this.#onBands([...this.#levels]);
        }
        this.#frame = requestAnimationFrame((next) => this.#measure(next));
    }
}

export class MicrophoneMonitor {
    readonly #onSnapshot: (snapshot: MicrophoneSnapshot) => void;
    readonly #deviceId: string;
    #stream: MediaStream | null = null;
    #waveform: WaveformMonitor | null = null;
    #stopped = false;
    #starting: Promise<MediaStream> | null = null;

    constructor(onSnapshot: (snapshot: MicrophoneSnapshot) => void, deviceId = DEFAULT_MICROPHONE_ID) {
        this.#onSnapshot = onSnapshot;
        this.#deviceId = deviceId;
    }

    start(): Promise<MediaStream> {
        if (this.#stream) {
            return Promise.resolve(this.#stream);
        }
        this.#starting ??= this.#open().finally(() => {
            this.#starting = null;
        });
        return this.#starting;
    }

    async #open(): Promise<MediaStream> {
        if ((await desktop()?.requestMicrophoneAccess?.()) === false) {
            throw new DOMException('Microphone access is disabled in System Settings', 'NotAllowedError');
        }
        const stream = await openMicrophoneStream(this.#deviceId);
        if (this.#stopped) {
            stream.getTracks().forEach((track) => track.stop());
            throw new DOMException('The microphone test was stopped', 'AbortError');
        }
        const track = stream.getAudioTracks()[0];
        if (!track) {
            stream.getTracks().forEach((candidate) => candidate.stop());
            throw new Error('No microphone audio track was available');
        }
        this.#stream = stream;
        this.#waveform = new WaveformMonitor((bands) => {
            this.#onSnapshot({ deviceName: track.label || 'Default microphone', bands, trackStatus: this.#trackStatus(track) });
        });
        this.#onSnapshot({
            deviceName: track.label || 'Default microphone',
            bands: Array(WAVEFORM_BAND_COUNT).fill(0),
            trackStatus: this.#trackStatus(track)
        });
        await this.#waveform.start(stream);
        return stream;
    }

    stop(): void {
        this.#stopped = true;
        this.#waveform?.stop();
        this.#stream?.getTracks().forEach((track) => track.stop());
        this.#stream = null;
        this.#waveform = null;
    }

    #trackStatus(track: MediaStreamTrack): MicrophoneSnapshot['trackStatus'] {
        if (track.readyState === 'ended') {
            return 'ended';
        }
        if (!track.enabled) {
            return 'disabled';
        }
        return track.muted ? 'muted' : 'live';
    }
}
