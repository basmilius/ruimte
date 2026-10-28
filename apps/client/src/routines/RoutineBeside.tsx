import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { Archive, History, Package, SquareArrowOutUpRight } from 'lucide-react';
import { nodeColorOf, type RoutineRun } from '@ruimte/contracts';
import { EmptyState, Icon, IconButton, Pill } from '@adecore/ui';
import { formatClock, formatElapsedShort } from '@adecore/ui/format';
import { accentColor, accentHeaderStyle, accentShades } from '@/canvas/accents';
import { OPEN_H } from '@/canvas/beside-metrics';
import { CHROME_H, FRAME, frameStyle, HEADER, HEADER_MIDDLE } from '@/canvas/derived-card-look';
import { CardLine } from '@/canvas/DerivedCardLook';
import { DerivedSet, type DerivedCard } from '@/canvas/DerivedSet';
import { KindIcon } from '@/canvas/KindIcon';
import { ArtifactOnCanvas } from '@/output/ArtifactNode';
import { FileToolbarSlotProvider, fixedSlot } from '@/shell/panels/file-toolbar-slot';
import { lookOfRun, type BlockLook } from '@/routines/agenda';
import { besideLayout, type BesideCard } from '@/routines/beside-layout';
import { LookIcon } from '@/routines/look';
import { OutputShownBesideContext } from '@/output/chat-scope';
import { RoutineRunChat } from '@/routines/RoutineRunChat';
import { useRoutineList } from '@/routines/routine-list';
import { showRoutine } from '@/routines/stage';
import { dayWords, runWords } from '@/routines/words';
import { OUTPUT_MIN, RUNS_MIN_W, storedOutputSize, storedRunsWidth, type CardSize } from '@/routines/output-size';
import { useRunsHidden } from '@/routines/runs-hidden';
import { useCanvas } from '@/state/canvas';
import type { Rect } from '@/canvas/math';
import type { ResizeEdge } from '@/canvas/resize-handles';
import { useEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';

/* The card is placed by its top-left corner beside the node, so only its right and bottom edges move. */
const OUTPUT_EDGES: readonly ResizeEdge[] = ['e', 's', 'se'];
/* A run card sets the width of its whole column, whose cards stack by the layout's heights. */
const RUN_EDGES: readonly ResizeEdge[] = ['e'];

const DOT: Record<BlockLook, string> = {
    done: 'bg-positive',
    waited: 'bg-positive',
    'caught-up': 'bg-positive',
    waiting: 'bg-status-needs-you',
    running: 'bg-accent',
    limit: 'bg-status-error',
    failed: 'bg-status-error',
    skipped: 'border border-border-strong',
    paused: 'border border-border-strong',
    next: 'border border-border-strong'
};

/*
 * A routine node's runs and Output beside it on the canvas, read from the routine list and never
 * stored, so a run writes nothing to the project and a teammate sees the runs of their own machine.
 * A run's chat stays hidden and on no canvas: this only draws it.
 */
export function RoutineBeside({ id, z }: { id: string; z: number }) {
    const { t } = useTranslation('routines');
    const node = useCanvas((s) => s.nodes[id]);
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const endpointId = useEndpointId();
    const list = useRoutineList(endpointId);
    const viewId = useCanvas((s) => s.viewId);
    // Which run is open is this window's alone, like the scroll of a node: undefined opens the newest, null none.
    const [picked, setPicked] = useState<string | null | undefined>(undefined);
    const [outputSize, setOutputSize] = useState<CardSize | null>(() => (viewId === null ? null : storedOutputSize(viewId, id).read()));
    const [runsWidth, setRunsWidth] = useState<number | null>(() => (viewId === null ? null : (storedRunsWidth(viewId, id).read()?.w ?? null)));
    // What each run's header and thread measured while open, in memory, so a run opens again at its own height at once.
    const [openHeights, setOpenHeights] = useState<Readonly<Record<string, number>>>({});
    const runsHidden = useRunsHidden(viewId, id);
    // The version a person picked on the Output with the runs hidden, in memory; undefined follows the latest.
    const [outputPin, setOutputPin] = useState<string | undefined>(undefined);
    if (node === undefined || list === null || list.status !== 'ready') {
        return null;
    }
    const entry = list.result.routines.find((candidate) => candidate.projectId === projectId && candidate.routine.id === node.routine);
    if (entry === undefined) {
        return null;
    }
    const timeZone = list.result.timeZone;
    const target = { projectId: entry.projectId, routineId: entry.routine.id };
    // The color a person gave the node, which every card beside it wears as the node's own frame does.
    const accent = accentColor(nodeColorOf(node));
    const resizeOutput = ({ w, h }: Rect): void => {
        setOutputSize({ w, h });
        if (viewId !== null) {
            storedOutputSize(viewId, id).write({ w, h });
        }
    };
    const resizeRuns = ({ w }: Rect): void => {
        setRunsWidth(w);
        if (viewId !== null) {
            storedRunsWidth(viewId, id).write({ w });
        }
    };
    const cardContent = (card: BesideCard): { label: string; body: ReactNode } => {
        if (card.kind === 'older') {
            const label = t('beside.olderRuns', { count: card.count });
            return {
                label,
                body: (
                    <button
                        type="button"
                        className={clsx(
                            'flex h-full items-center gap-2 rounded-md px-3 text-xs text-text-muted hover:text-text',
                            accent !== undefined && 'hover:bg-(--run-hover)'
                        )}
                        style={accent === undefined ? undefined : ({ '--run-hover': accentShades(accent).hover } as CSSProperties)}
                        onClick={() => showRoutine(target)}
                    >
                        <Icon icon={Archive} size={12} />
                        {label}
                    </button>
                )
            };
        }
        if (card.kind === 'output') {
            const fallback = card.fallback;
            const note =
                fallback === null
                    ? null
                    : fallback.run === null
                      ? t('beside.noVersion')
                      : t('beside.noVersionShowing', { date: dayWords(fallback.run.due, timeZone) });
            return {
                label: t('beside.output'),
                // With the runs shown the open run is the picker; hidden, a person picks any version on the card.
                body: runsHidden ? (
                    <OutputCard
                        artifactId={card.artifactId}
                        version={outputPin}
                        onPin={(versionId) => setOutputPin(versionId ?? undefined)}
                        note={null}
                        accent={accent}
                    />
                ) : (
                    <OutputCard artifactId={card.artifactId} version={card.versionId ?? undefined} onPin={null} note={note} accent={accent} />
                )
            };
        }
        const label = t('beside.runTitle', { title: entry.routine.title, date: dayWords(card.run.due, timeZone) });
        return {
            label,
            body: card.open ? (
                <OpenRun
                    title={label}
                    run={card.run}
                    timeZone={timeZone}
                    artifactId={entry.artifactId}
                    accent={accent}
                    onMeasure={(h) => setOpenHeights((last) => (last[card.run.runId] === h ? last : { ...last, [card.run.runId]: h }))}
                    onShow={() => showRoutine(target, card.run.runId)}
                    onCollapse={() => setPicked(null)}
                />
            ) : (
                <RunLine run={card.run} timeZone={timeZone} accent={accent} onOpen={() => setPicked(card.run.runId)} />
            )
        };
    };
    const sizes = { output: outputSize, runsWidth, openHeights, runsHidden };
    const cards = besideLayout(node, entry.runs, picked, entry.artifactId, sizes).map((card): DerivedCard => {
        const content = cardContent(card);
        const linkedFrom = card.kind === 'older' ? null : card.kind === 'output' ? (card.from ?? 'node') : 'node';
        const resize =
            card.kind === 'output'
                ? { edges: OUTPUT_EDGES, minimum: OUTPUT_MIN, apply: resizeOutput }
                : card.kind === 'run'
                  ? { edges: RUN_EDGES, minimum: { w: RUNS_MIN_W, h: card.rect.h }, apply: resizeRuns }
                  : undefined;
        return { key: card.key, rect: card.rect, linkedFrom, label: content.label, content: content.body, lineDown: HEADER_MIDDLE, resize };
    });

    return <DerivedSet owner={id} z={z} cards={cards} lineDown={HEADER_MIDDLE} {...(accent === undefined ? {} : { stroke: accentShades(accent).line })} />;
}

/* What a run says beside its time: how long it took when it simply ran, and what became of it otherwise. */
function RunMark({ run }: { run: RoutineRun }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    if (look === 'done') {
        return run.endedAt === undefined ? null : (
            <span className="shrink-0 text-xs text-text-muted tabular-nums">{formatElapsedShort(run.endedAt - run.at)}</span>
        );
    }
    const words = look === 'caught-up' ? t('beside.caughtUp') : look === 'waited' ? t('beside.waited') : t(`looks.${look}`);
    return <Pill icon={<LookIcon look={look} />}>{words}</Pill>;
}

function StateDot({ run }: { run: RoutineRun }) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    return <span role="img" aria-label={t(`looks.${look}`)} className={clsx('size-2 shrink-0 rounded-full', DOT[look])} />;
}

function RunLine({ run, timeZone, accent, onOpen }: { run: RoutineRun; timeZone: string; accent: string | undefined; onOpen: () => void }) {
    return (
        <CardLine icon={<Icon icon={History} size={14} />} accent={accent} onOpen={onOpen}>
            <span className="min-w-0 grow truncate">
                {dayWords(run.due, timeZone)} <span className="text-text-muted">· {formatClock(run.at, timeZone)}</span>
            </span>
            <RunMark run={run} />
            <StateDot run={run} />
        </CardLine>
    );
}

function OpenRun({
    title,
    run,
    timeZone,
    artifactId,
    accent,
    onMeasure,
    onShow,
    onCollapse
}: {
    title: string;
    run: RoutineRun;
    timeZone: string;
    // The routine's Output, which its own card beside the run already shows, so the thread keeps only its rows.
    artifactId: string | undefined;
    accent: string | undefined;
    /* The height the card would take to show all of its thread, which the layout keeps under its maximum. */
    onMeasure: (height: number) => void;
    onShow: () => void;
    onCollapse: () => void;
}) {
    const { t } = useTranslation('routines');
    const look = lookOfRun(run);
    const wordsRef = useRef<HTMLDivElement>(null);
    const measured = useRef(onMeasure);
    useLayoutEffect(() => {
        measured.current = onMeasure;
    });
    const report = (content: number): void => measured.current(CHROME_H + content);
    // Before paint, so a run that opens is drawn at its height and what stands under it moves once.
    useLayoutEffect(() => {
        const words = wordsRef.current;
        if (words === null) {
            return;
        }
        const measure = (): void => measured.current(CHROME_H + words.offsetHeight);
        const resizes = new ResizeObserver(measure);
        resizes.observe(words);
        measure();
        return () => resizes.disconnect();
    }, []);
    return (
        <div className={clsx(FRAME, 'bg-surface')} style={frameStyle(accent)}>
            <header className={clsx(HEADER, 'group/header')} style={accent === undefined ? undefined : accentHeaderStyle(accent)}>
                <KindIcon toggle={{ folded: false, label: t('beside.collapse'), onToggle: onCollapse }}>
                    <Icon icon={History} size={14} />
                </KindIcon>
                <span className="min-w-0 grow truncate font-medium">{title}</span>
                {look !== 'done' && <RunMark run={run} />}
                <StateDot run={run} />
                <IconButton icon={SquareArrowOutUpRight} size="sm" label={t('beside.openRun')} onClick={onShow} />
            </header>
            {run.chatId !== undefined ? (
                <OutputShownBesideContext value={artifactId ?? null}>
                    {/*
                     * The thread is laid out at the tallest card's height whatever the card shows, and the frame
                     * clips it, so the rows in view cover all the card can show and its height is never an estimate.
                     * It keeps 16px at its sides and top; without a composer under it the bottom gets the same.
                     */}
                    <div className="flex shrink-0 flex-col [&_.chat-thread]:pb-4" style={{ height: OPEN_H - CHROME_H }}>
                        <RoutineRunChat chatId={run.chatId} revision={`${run.state}:${run.endedAt ?? ''}`} composer={false} onContentHeight={report} />
                    </div>
                </OutputShownBesideContext>
            ) : (
                <div ref={wordsRef} className="grid grow place-items-center p-4">
                    <EmptyState>{runWords(run, timeZone)}</EmptyState>
                </div>
            )}
        </div>
    );
}

/*
 * The routine's Output, drawn by the artifact node's own body with its controls in this card's header.
 * `onPin` is the version picker's, there only with the runs hidden; with them shown the open run picks.
 */
function OutputCard({
    artifactId,
    version,
    onPin,
    note,
    accent
}: {
    artifactId: string;
    version: string | undefined;
    onPin: ((versionId: string | null) => void) | null;
    note: string | null;
    accent: string | undefined;
}) {
    const [controls, setControls] = useState<HTMLElement | null>(null);
    return (
        <div className={clsx(FRAME, 'bg-surface')} style={frameStyle(accent)}>
            <header className={HEADER} style={accent === undefined ? undefined : accentHeaderStyle(accent)}>
                <Icon icon={Package} size={14} className="shrink-0 text-text-muted" />
                <span ref={setControls} className="flex min-w-0 grow items-center gap-1.5" />
            </header>
            <FileToolbarSlotProvider value={fixedSlot(controls)}>
                <ArtifactOnCanvas artifactId={artifactId} version={version} onPin={onPin} titled note={note} />
            </FileToolbarSlotProvider>
        </div>
    );
}
