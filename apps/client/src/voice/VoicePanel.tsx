import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Check, LayoutGrid, MessageSquare, Mic, MicOff, PenTool, Plus, RotateCcw, StickyNote, Terminal, X, type LucideIcon } from 'lucide-react';
import { FadingWords } from '@/chat/ui/FadingWords';
import { hasOverlayControls } from '@/desktop/bridge';
import { clampColumnWidth, useColumnResize } from '@/shell/useColumnResize';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { closeVoicePanel, startVoice, stopVoice, undoVoiceAction } from '@/voice/controller';
import { idleVoiceBands, type IdleVoiceBands } from '@/voice/idle-waveform';
import { useVoice, type VoiceAction, type VoiceActionKind, type VoicePhase, type VoiceUtterance } from '@/voice/state';

const phaseLabel: Record<VoicePhase, string> = {
    idle: 'Ready',
    connecting: 'Connecting…',
    listening: 'Listening',
    closing: 'Ending…',
    error: 'Needs attention'
};

const DEFAULT_WIDTH = 380;
const MIN_WIDTH = 320;
const MIN_WORKSPACE_WIDTH = 480;

const actionIcons: Record<VoiceActionKind, LucideIcon> = {
    focus: LayoutGrid,
    rename: PenTool,
    note: StickyNote,
    terminal: Terminal,
    chat: MessageSquare,
    node: Plus,
    view: LayoutGrid
};

const durationLabel = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

const waveformHeight = (value: number): string => `${Math.max(2, value * 26).toFixed(2)}px`;

function useIdleWaveform(active: boolean, count: number): IdleVoiceBands | null {
    const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const [bands, setBands] = useState<IdleVoiceBands | null>(null);

    useEffect(() => {
        const query = window.matchMedia('(prefers-reduced-motion: reduce)');
        const changed = () => setReducedMotion(query.matches);
        query.addEventListener('change', changed);
        return () => query.removeEventListener('change', changed);
    }, []);

    useEffect(() => {
        if (!active || reducedMotion) {
            return;
        }
        let frame = 0;
        const animate = (now: number) => {
            setBands(idleVoiceBands(now, count));
            frame = window.requestAnimationFrame(animate);
        };
        frame = window.requestAnimationFrame(animate);
        return () => window.cancelAnimationFrame(frame);
    }, [active, count, reducedMotion]);

    return active && !reducedMotion ? bands : null;
}

function VoiceWaveform({ elapsed, phase }: { elapsed: number; phase: VoicePhase }) {
    const inputBands = useVoice((state) => state.inputBands);
    const outputBands = useVoice((state) => state.outputBands);
    const listening = phase === 'listening';
    const idle = phase === 'idle';
    const idleBands = useIdleWaveform(idle, inputBands.length);
    const displayedInput = idleBands?.input ?? inputBands;
    const displayedOutput = idleBands?.output ?? outputBands;
    const inputSpeaking = listening && Math.max(0, ...inputBands) > 0.06;
    const outputSpeaking = listening && Math.max(0, ...outputBands) > 0.04;
    const inputLabel = listening ? (inputSpeaking ? 'speaking' : 'listening') : 'idle';
    const outputLabel = listening ? (outputSpeaking ? 'speaking' : 'listening') : 'idle';

    return (
        <section className="shrink-0 border-b border-border px-4 py-4" aria-label="Conversation audio activity">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted" role="status">
                <span
                    className={clsx(
                        'h-1.5 w-1.5 rounded-full',
                        phase === 'listening' ? 'bg-positive' : phase === 'error' ? 'bg-status-error' : 'bg-text-faint'
                    )}
                />
                <span className="tabular-nums">{phase === 'listening' ? `Live · ${durationLabel(elapsed)}` : phaseLabel[phase]}</span>
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] font-medium tracking-wide uppercase">
                <span className={inputSpeaking ? 'text-text' : 'text-text-muted'}>You · {inputLabel}</span>
                <span className={outputSpeaking ? 'text-accent' : 'text-text-muted'}>Voice · {outputLabel}</span>
            </div>
            <div
                className="relative mt-3 flex h-14 items-center gap-0.5"
                role="img"
                aria-label="Your voice above the line and Voice below it"
            >
                <span className="absolute inset-x-0 top-1/2 z-10 h-px bg-surface" />
                {displayedInput.map((input, index) => {
                    const output = displayedOutput[index] ?? 0;
                    return (
                        <span key={index} className="relative h-full min-w-0 grow" aria-hidden="true">
                            <span
                                className={clsx(
                                    'voice-waveform-input absolute right-0 bottom-1/2 left-0 rounded-t-sm bg-text-muted',
                                    !idle && 'transition-[height,opacity] duration-75 ease-out'
                                )}
                                style={{
                                    height: waveformHeight(input),
                                    opacity: Math.max(0.45, input)
                                }}
                            />
                            <span
                                className={clsx(
                                    'voice-waveform-output absolute top-1/2 right-0 left-0 rounded-b-sm bg-accent',
                                    !idle && 'transition-[height] duration-75 ease-out'
                                )}
                                style={{ height: waveformHeight(output) }}
                            />
                        </span>
                    );
                })}
            </div>
        </section>
    );
}

function useElapsedSeconds(startedAt: number | null): number {
    const [now, setNow] = useState(0);

    useEffect(() => {
        if (startedAt === null) {
            return;
        }
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [startedAt]);

    return startedAt === null ? 0 : Math.max(0, Math.floor((now - startedAt) / 1_000));
}

function ActionEvent({ action }: { action: VoiceAction }) {
    return (
        <div className="flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-2">
            <Icon icon={actionIcons[action.kind]} size={15} className="shrink-0 text-text-muted" />
            <p className="min-w-0 grow truncate text-xs text-text">
                <span className="font-medium">{action.label}</span>
                <span className="text-text-muted"> · {action.detail}</span>
            </p>
            {action.status === 'completed' && action.undoable && (
                <Tooltip label="Undo action" name>
                    <button className="icon-btn shrink-0" onClick={() => undoVoiceAction(action.id)}>
                        <Icon icon={RotateCcw} size={13} />
                    </button>
                </Tooltip>
            )}
            {action.status === 'completed' ? (
                <Icon icon={Check} size={15} className="shrink-0 text-positive" />
            ) : (
                <span className="shrink-0 text-[10px] text-text-faint">{action.status}</span>
            )}
        </div>
    );
}

function TranscriptEntry({ streaming, utterance }: { streaming: boolean; utterance: VoiceUtterance }) {
    return (
        <div>
            <div
                className={clsx(
                    'mb-1.5 text-[10px] font-medium tracking-wide uppercase tabular-nums',
                    utterance.speaker === 'assistant' ? 'text-accent' : 'text-text-muted'
                )}
            >
                {utterance.speaker === 'assistant' ? 'Voice' : 'You'} · {durationLabel(Math.floor(utterance.startMs / 1_000))}
            </div>
            <p className="text-sm leading-6 text-text whitespace-pre-wrap [text-wrap:pretty]">
                {streaming ? <FadingWords text={utterance.text} /> : utterance.text}
            </p>
            {utterance.interrupted && <p className="mt-1 text-[10px] text-text-faint">Interrupted</p>}
        </div>
    );
}

export function VoicePanel() {
    const open = useVoice((state) => state.open);
    const phase = useVoice((state) => state.phase);
    const error = useVoice((state) => state.error);
    const transcript = useVoice((state) => state.transcript);
    const actions = useVoice((state) => state.actions);
    const sessionStartedAt = useVoice((state) => state.sessionStartedAt);
    const storedWidth = useVoice((state) => state.width);
    const elapsed = useElapsedSeconds(sessionStartedAt);
    const bottom = useRef<HTMLDivElement>(null);
    const panel = useRef<HTMLElement>(null);
    const width = clampColumnWidth({ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }, storedWidth ?? DEFAULT_WIDTH);
    const { startResize } = useColumnResize(panel, {
        min: MIN_WIDTH,
        max: () => window.innerWidth - MIN_WORKSPACE_WIDTH,
        width,
        from: 'right',
        onWidth: (next) => useVoice.getState().setWidth(next)
    });
    const active = phase === 'connecting' || phase === 'listening' || phase === 'closing';
    const timeline = [...transcript.map((item) => ({ kind: 'utterance' as const, item })), ...actions.map((item) => ({ kind: 'action' as const, item }))].sort(
        (left, right) => left.item.order - right.item.order
    );
    const streamingOrder = phase === 'listening' && timeline.at(-1)?.kind === 'utterance' ? timeline.at(-1)?.item.order : null;

    useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' });
    }, [transcript, actions]);

    return (
        <aside ref={panel} className="panel-shell flex h-full shrink-0 justify-end overflow-hidden" style={{ width: open ? width : 0 }} inert={!open}>
            {open && (
                <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
                    <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />
                    <header
                        className={clsx(
                            'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3',
                            hasOverlayControls() && 'toolbar-overlay-inset'
                        )}
                    >
                        <span className="flex grow items-center gap-2 text-xs font-semibold text-text">
                            <Icon icon={Mic} size={14} className="text-text-muted" />
                            Voice
                        </span>
                        <Tooltip label="Close voice panel" name>
                            <button className="icon-btn" onClick={closeVoicePanel}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    <VoiceWaveform elapsed={elapsed} phase={phase} />
                    <div className="min-h-0 grow overflow-y-auto px-4 py-5" role="log" aria-live="polite">
                        {timeline.length === 0 && (
                            <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                                {!active && (
                                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                                        <Icon icon={Mic} size={17} />
                                    </div>
                                )}
                                <p className="text-sm font-medium text-text">{active ? 'Listening…' : 'Talk to your workspace'}</p>
                                {!active && (
                                    <p className="max-w-64 text-xs leading-relaxed text-text-muted">
                                        Ask about what is on screen, focus another view, add a note or open a terminal.
                                    </p>
                                )}
                            </div>
                        )}
                        <div className="space-y-6">
                            {timeline.map(({ kind, item }) =>
                                kind === 'utterance' ? (
                                    <TranscriptEntry key={`utterance-${item.id}`} streaming={item.order === streamingOrder} utterance={item} />
                                ) : (
                                    <ActionEvent key={`action-${item.id}`} action={item} />
                                )
                            )}
                        </div>
                        <div ref={bottom} className="h-5" aria-hidden="true" />
                    </div>
                    <footer className="shrink-0 border-t border-border p-3">
                        {error && <p className="mb-2 text-xs text-status-error">{error}</p>}
                        <Button
                            className="w-full"
                            variant={active ? 'secondary' : 'primary'}
                            disabled={phase === 'connecting' || phase === 'closing'}
                            onClick={() => (active ? stopVoice() : void startVoice())}
                        >
                            <Icon icon={active ? MicOff : Mic} size={14} />
                            {active ? 'End conversation' : transcript.length > 0 ? 'Start new conversation' : 'Start Voice conversation'}
                        </Button>
                    </footer>
                </div>
            )}
        </aside>
    );
}
