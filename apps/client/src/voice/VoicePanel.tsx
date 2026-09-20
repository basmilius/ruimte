import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import {
    Check,
    ChevronRight,
    LayoutGrid,
    MessageSquare,
    Mic,
    MicOff,
    PenTool,
    Plus,
    RotateCcw,
    StickyNote,
    Terminal,
    Trash2,
    X,
    type LucideIcon
} from 'lucide-react';
import { FadingWords } from '@/chat/ui/FadingWords';
import { hasOverlayControls } from '@/desktop/bridge';
import { formatClockDuration } from '@/format/duration';
import { SlidingColumn } from '@/shell/SlidingColumn';
import { clampColumnSize } from '@/shell/useColumnResize';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { useNow } from '@/ui/useNow';
import { closeVoicePanel, startVoice, stopVoice, undoVoiceAction, undoVoiceActions } from '@/voice/controller';
import { VoiceWaveform } from '@/voice/VoiceWaveform';
import { useVoice, type VoiceAction, type VoiceActionKind, type VoicePhase, type VoiceUtterance } from '@/voice/state';
import { voiceTimeline, type VoiceTimelineEntry } from '@/voice/timeline';

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
    view: LayoutGrid,
    delete: Trash2
};

function VoiceStatus({ elapsedMs, phase }: { elapsedMs: number; phase: VoicePhase }) {
    const { t } = useTranslation('voice');
    return (
        <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-text-muted" role="status">
            <span
                className={clsx('h-1.5 w-1.5 rounded-full', phase === 'listening' ? 'bg-positive' : phase === 'error' ? 'bg-status-error' : 'bg-text-faint')}
            />
            <span className="tabular-nums">{phase === 'listening' ? t('phase.live', { elapsed: formatClockDuration(elapsedMs) }) : t(`phase.${phase}`)}</span>
        </div>
    );
}

function ActionEvent({ action }: { action: VoiceAction }) {
    const { t } = useTranslation('voice');
    const completed = action.status === 'completed';

    return (
        <div className="group/action flex min-h-11 items-center gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-1.5">
            <Icon icon={actionIcons[action.kind]} size={15} className="shrink-0 text-text-muted" />
            <p className="min-w-0 grow truncate text-xs text-text">
                <span className="font-medium">{action.label}</span>
                <span className="text-text-muted"> · {action.detail}</span>
            </p>
            <div className="grid h-8 w-8 shrink-0 place-items-center">
                {completed && action.undoable ? (
                    <>
                        <Icon
                            icon={Check}
                            size={15}
                            className="col-start-1 row-start-1 text-positive transition-opacity group-hover/action:opacity-0 group-focus-within/action:opacity-0"
                        />
                        <Tooltip label={t('actions.undo')} name>
                            <button
                                className="icon-btn col-start-1 row-start-1 pointer-events-none opacity-0 transition-opacity group-hover/action:pointer-events-auto group-hover/action:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                                onClick={() => undoVoiceAction(action.id)}
                            >
                                <Icon icon={RotateCcw} size={13} />
                            </button>
                        </Tooltip>
                    </>
                ) : completed ? (
                    <Icon icon={Check} size={15} className="text-positive" />
                ) : (
                    <span className="text-[10px] text-text-faint">{action.status}</span>
                )}
            </div>
        </div>
    );
}

const actionDetail = (detail: string): { item: string; context: string | null } => {
    const separator = detail.lastIndexOf(' · ');
    return separator === -1 ? { item: detail, context: null } : { item: detail.slice(0, separator), context: detail.slice(separator + 3) };
};

function ActionGroup({ actions }: { actions: VoiceAction[] }) {
    const { t } = useTranslation('voice');
    const [open, setOpen] = useState(true);
    const details = actions.map((action) => actionDetail(action.detail));
    const context = details[0]?.context && details.every((detail) => detail.context === details[0]?.context) ? details[0].context : null;
    const completed = actions.every((action) => action.status === 'completed');
    const undoable = actions.some((action) => action.status === 'completed' && action.undoable);
    const undoableIds = actions.filter((action) => action.status === 'completed' && action.undoable).map((action) => action.id);

    return (
        <div className="group/action-group rounded-lg border border-border bg-surface-raised px-3 py-1.5">
            <div className="flex min-h-8 items-center gap-2.5">
                <button
                    className="-m-1 grid h-6 w-6 shrink-0 place-items-center rounded-md p-1 hover:bg-surface-hover"
                    type="button"
                    aria-label={open ? t('actions.collapse') : t('actions.expand')}
                    aria-expanded={open}
                    onClick={() => setOpen(!open)}
                >
                    <Icon
                        icon={StickyNote}
                        size={15}
                        className="col-start-1 row-start-1 text-text-muted group-hover/action-group:hidden group-focus-within/action-group:hidden"
                    />
                    <Icon
                        icon={ChevronRight}
                        size={14}
                        className={clsx(
                            'col-start-1 row-start-1 hidden text-text-muted transition-transform group-hover/action-group:block group-focus-within/action-group:block',
                            open && 'rotate-90'
                        )}
                    />
                </button>
                <button className="min-w-0 grow text-left" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                    <span className="min-w-0 grow truncate text-xs text-text">
                        <span className="font-medium">{t('actions.notesAdded', { count: actions.length })}</span>
                        {context && <span className="text-text-muted"> · {context}</span>}
                    </span>
                </button>
                <div className="grid h-8 w-8 shrink-0 place-items-center">
                    {completed && undoable ? (
                        <>
                            <Icon
                                icon={Check}
                                size={15}
                                className="col-start-1 row-start-1 text-positive transition-opacity group-hover/action-group:opacity-0 group-focus-within/action-group:opacity-0"
                            />
                            <Tooltip label={t('actions.undoGroup', { count: actions.length })} name>
                                <button
                                    className="icon-btn col-start-1 row-start-1 pointer-events-none opacity-0 transition-opacity group-hover/action-group:pointer-events-auto group-hover/action-group:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
                                    onClick={() => undoVoiceActions(undoableIds)}
                                >
                                    <Icon icon={RotateCcw} size={13} />
                                </button>
                            </Tooltip>
                        </>
                    ) : completed ? (
                        <Icon icon={Check} size={15} className="text-positive" />
                    ) : (
                        <span className="text-[10px] text-text-faint">undone</span>
                    )}
                </div>
            </div>
            {open && (
                <div className="space-y-1.5 pt-1 pb-2 pl-6 text-xs text-text-muted">
                    {details.map((detail, index) => (
                        <p key={actions[index]!.id} className="truncate">
                            {detail.item}
                            {!context && detail.context && <span className="text-text-faint"> · {detail.context}</span>}
                        </p>
                    ))}
                </div>
            )}
        </div>
    );
}

const isActionEntry = (entry: VoiceTimelineEntry): boolean => entry.kind === 'action' || entry.kind === 'action-group';

function TranscriptEntry({ streaming, utterance }: { streaming: boolean; utterance: VoiceUtterance }) {
    const { t } = useTranslation('voice');
    return (
        <div>
            <div
                className={clsx(
                    'mb-1.5 text-[10px] font-medium tracking-wide uppercase tabular-nums',
                    utterance.speaker === 'assistant' ? 'text-accent' : 'text-text-muted'
                )}
            >
                {utterance.speaker === 'assistant' ? t('speaker.assistant') : t('speaker.person')} · {formatClockDuration(utterance.startMs)}
            </div>
            <p className="text-sm leading-6 text-text whitespace-pre-wrap [text-wrap:pretty]">
                {streaming ? <FadingWords text={utterance.text} /> : utterance.text}
            </p>
            {utterance.interrupted && <p className="mt-1 text-[10px] text-text-faint">{t('speaker.interrupted')}</p>}
        </div>
    );
}

export function VoicePanel() {
    const { t } = useTranslation('voice');
    const open = useVoice((state) => state.open);
    const phase = useVoice((state) => state.phase);
    const error = useVoice((state) => state.error);
    const transcript = useVoice((state) => state.transcript);
    const actions = useVoice((state) => state.actions);
    const sessionStartedAt = useVoice((state) => state.sessionStartedAt);
    const storedWidth = useVoice((state) => state.width);
    const now = useNow(1_000, sessionStartedAt !== null);
    const elapsedMs = sessionStartedAt === null ? 0 : Math.max(0, now - sessionStartedAt);
    const bottom = useRef<HTMLDivElement>(null);
    const width = clampColumnSize({ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }, storedWidth ?? DEFAULT_WIDTH);
    const active = phase === 'connecting' || phase === 'listening' || phase === 'closing';
    const timeline = voiceTimeline(transcript, actions);
    const last = timeline.at(-1);
    const streamingOrder = phase === 'listening' && last?.kind === 'utterance' ? last.item.order : null;

    useEffect(() => {
        bottom.current?.scrollIntoView({ block: 'end' });
    }, [transcript, actions]);

    return (
        <SlidingColumn
            open={open}
            restoreWithProject={false}
            width={width}
            bounds={{ min: MIN_WIDTH, max: () => window.innerWidth - MIN_WORKSPACE_WIDTH }}
            onWidth={(next) => useVoice.getState().setWidth(next)}
        >
            <header
                className={clsx(
                    'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3',
                    hasOverlayControls() && 'toolbar-overlay-inset'
                )}
            >
                <span className="flex grow items-center gap-2 text-xs font-semibold text-text">
                    <Icon icon={Mic} size={14} className="text-text-muted" />
                    {t('title')}
                </span>
                <VoiceStatus elapsedMs={elapsedMs} phase={phase} />
                <Tooltip label={t('close')} name>
                    <button className="icon-btn" onClick={closeVoicePanel}>
                        <Icon icon={X} size={16} />
                    </button>
                </Tooltip>
            </header>
            <VoiceWaveform phase={phase} />
            <div className="min-h-0 grow overflow-y-auto px-4 py-5" role="log" aria-live="polite">
                {timeline.length === 0 && (
                    <div className="flex min-h-48 flex-col items-center justify-center gap-2 text-center">
                        {!active && (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-raised text-text-muted">
                                <Icon icon={Mic} size={17} />
                            </div>
                        )}
                        <p className="text-sm font-medium text-text">{active ? t('empty.listening') : t('empty.title')}</p>
                        {!active && <p className="max-w-64 text-xs leading-relaxed text-text-muted">{t('empty.description')}</p>}
                    </div>
                )}
                <div>
                    {timeline.map((entry, index) => (
                        <div
                            key={entry.kind === 'action-group' ? `action-group-${entry.order}` : `${entry.kind}-${entry.item.id}`}
                            className={index === 0 ? undefined : isActionEntry(entry) && isActionEntry(timeline[index - 1]!) ? 'mt-3' : 'mt-6'}
                        >
                            {entry.kind === 'utterance' ? (
                                <TranscriptEntry streaming={entry.item.order === streamingOrder} utterance={entry.item} />
                            ) : entry.kind === 'action-group' ? (
                                <ActionGroup actions={entry.items} />
                            ) : (
                                <ActionEvent action={entry.item} />
                            )}
                        </div>
                    ))}
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
                    {active ? t('conversation.end') : transcript.length > 0 ? t('conversation.restart') : t('conversation.start')}
                </Button>
            </footer>
        </SlidingColumn>
    );
}
