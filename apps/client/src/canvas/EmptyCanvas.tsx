import { startingSelection, useChatPreferences } from '@adecore/agents-react/chat';
import { AgentIcon, modelName } from '@adecore/agents-react/providers';
import { useProviders } from '@adecore/agents-react/state';
import { Icon, IconButton } from '@adecore/ui';
import type { AgentKind, ProviderInfo } from '@ruimte/contracts';
import clsx from 'clsx';
import { useEffect, useState, type ReactNode } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { createNodeAction } from '@/action-port/person-actions';
import { GHOST_AREA, GHOST_FADE_MS, GHOST_FRAMES, ghostScale, type GhostKind } from '@/canvas/empty-canvas';
import { SlotRow } from '@/extensions/SlotSurfaces';
import { availableAgents } from '@/state/agent-availability';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useUi } from '@/state/ui';
import { NODE_KIND_ICONS } from '@/surface/canvas/node-icons';
import { ADD_NODE_ROWS } from '@/surface/canvas/shortcuts';
import { RowKbd } from '@/surface/RowKbd';
import { useDetectProviders } from '@/transport/provider-detection';

type AddNode = (kind: GhostKind, provider?: AgentKind) => void;

/*
 * Ghosts of the four nodes a canvas most often starts with. Everything else is a right-click or ⌘K
 * away. Once the first node lands the ghosts stay a moment longer, so the others fade and the new
 * node can grow out of its own (`ghost-landing.ts`).
 */
export function EmptyCanvas({ empty }: { empty: boolean }) {
    const { t } = useTranslation('canvas');
    const canvasStore = useCanvasStore();
    const viewport = useCanvas((s) => s.viewport);
    const landed = useCanvas((s) => (s.order.length === 1 ? (s.nodes[s.order[0]!]?.kind ?? null) : null));
    const [wasEmpty, setWasEmpty] = useState(empty);
    const [leaving, setLeaving] = useState(false);

    if (wasEmpty !== empty) {
        setWasEmpty(empty);
        setLeaving(!empty);
    }

    useEffect(() => {
        if (!leaving) {
            return;
        }

        const timer = setTimeout(() => setLeaving(false), GHOST_FADE_MS);
        return () => clearTimeout(timer);
    }, [leaving]);

    if (!empty && !leaving) {
        return null;
    }

    const scale = ghostScale(viewport);

    const add: AddNode = (kind, provider) => {
        void createNodeAction(kind, provider === undefined ? {} : { provider }).then((nodeId) => {
            // A chat is started to be typed in.
            if (nodeId !== null && kind === 'chat') {
                canvasStore.getState().setBodyFocus(nodeId);
            }
        });
    };

    const ghostOf = (kind: GhostKind, body: ReactNode) => (
        <Ghost key={kind} kind={kind} title={t(`kinds.${kind}`)} landed={leaving && landed === kind} onAdd={() => add(kind)}>
            {body}
        </Ghost>
    );

    return (
        /* The bottom padding keeps the ghosts clear of the dock, which floats over the same cell. */
        <div
            className={clsx(
                'pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6 overflow-hidden px-6 pt-4 pb-20 transition-opacity duration-220',
                leaving && 'opacity-0'
            )}
            inert={leaving}
        >
            <div className="relative shrink-0" style={{ width: Math.round(GHOST_AREA.w * scale), height: Math.round(GHOST_AREA.h * scale) }}>
                <div className="absolute top-0 left-0 origin-top-left" style={{ width: GHOST_AREA.w, height: GHOST_AREA.h, transform: `scale(${scale})` }}>
                    {ghostOf('chat', <ChatGhostBody onAdd={add} />)}
                    {ghostOf('terminal', <TerminalGhostBody onAdd={add} />)}
                    {ghostOf(
                        'browser',
                        <>
                            <span className="h-7 shrink-0 rounded-md bg-text/5" />
                            <FaintLine className="w-3/4" />
                            <FaintLine className="w-1/2" />
                        </>
                    )}
                    {ghostOf(
                        'note',
                        <>
                            <FaintLine className="w-4/5" />
                            <FaintLine className="w-3/5" />
                            <FaintLine className="w-2/3" />
                        </>
                    )}
                </div>
            </div>
            <SlotRow
                place="emptyCanvas"
                context={{}}
                words
                wrap={(row) => <div className="pointer-events-auto flex shrink-0 flex-wrap justify-center gap-2">{row}</div>}
            />
            <p className="pointer-events-auto shrink-0 text-center text-xs text-text-muted">
                <Trans t={t} i18nKey="empty.hint" components={{ palette: <RowKbd row="palette" variant="inline" /> }} />
            </p>
        </div>
    );
}

/*
 * A dashed outline where a node would stand, with the header a node has. The whole ghost adds its node
 * through one button laid over it, so the buttons inside stay buttons of their own.
 */
function Ghost({ kind, title, landed, onAdd, children }: { kind: GhostKind; title: string; landed: boolean; onAdd(): void; children: ReactNode }) {
    const frame = GHOST_FRAMES[kind];

    return (
        <div
            data-ghost={kind}
            className={clsx(
                'pointer-events-auto absolute flex flex-col rounded-xl border-2 border-dashed border-text/15 text-xs text-text-muted transition-[border-color] duration-150 focus-within:border-text/30 hover:border-text/30',
                // The node that landed stands where its ghost was, so that ghost goes at once.
                landed && 'invisible'
            )}
            style={{ left: frame.x, top: frame.y, width: frame.w, height: frame.h }}
        >
            <button type="button" aria-label={title} className="absolute -inset-0.5 rounded-xl" onClick={onAdd} />
            <div className="pointer-events-none flex h-10 shrink-0 items-center gap-2 px-2.5">
                <Icon icon={NODE_KIND_ICONS[kind]} size={16} />
                <span className="truncate font-medium text-text">{title}</span>
                <RowKbd row={ADD_NODE_ROWS[kind]} className="ml-auto text-text-faint" />
            </div>
            <div className="pointer-events-none flex min-h-0 flex-1 flex-col gap-2.5 p-3">{children}</div>
        </div>
    );
}

function FaintLine({ className }: { className: string }) {
    return <span className={clsx('h-2 shrink-0 rounded-sm bg-text/6', className)} />;
}

/* Drawn as a secondary button, so it answers the pointer the way every other button does. */
const AGENT_BUTTON = 'border border-field-border bg-field text-text hover:bg-surface-hover';

/* A conversation that has not started: a question, an answer, and the agents, each named with its model while a person points at it. */
function ChatGhostBody({ onAdd }: { onAdd: AddNode }) {
    const { t } = useTranslation('canvas');
    const { t: tAgents } = useTranslation('agents');
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const preferences = useChatPreferences();
    const [pointed, setPointed] = useState<ProviderInfo | null>(null);
    const chats = availableAgents(providers, 'chat');
    useDetectProviders();

    const modelOf = (provider: ProviderInfo): string => {
        const model = startingSelection(preferences, provider)?.model ?? null;
        return model === null ? tAgents('menu.defaultModel') : modelName(model, provider.models);
    };

    return (
        <>
            <span className="self-end rounded-xl border-2 border-dashed border-text/15 px-3 py-2.5">
                <FaintLine className="block w-30" />
            </span>
            <span className="flex flex-col gap-2">
                <FaintLine className="w-7/8" />
                <FaintLine className="w-3/4" />
                <FaintLine className="w-1/2" />
            </span>
            <p className="mt-auto truncate" aria-live="polite">
                {pointed !== null ? (
                    <>
                        <span className="font-medium text-text">{pointed.name}</span> {modelOf(pointed)}
                    </>
                ) : chats.length > 0 ? (
                    t('empty.pick')
                ) : loaded ? (
                    <button
                        type="button"
                        className="pointer-events-auto relative text-text underline-offset-2 hover:underline"
                        onClick={() => useUi.getState().setSettings({ open: true, section: 'agents' })}
                    >
                        {tAgents('menu.setup')}
                    </button>
                ) : (
                    tAgents('menu.connecting')
                )}
            </p>
            {chats.length > 0 && (
                <span className="pointer-events-auto relative flex flex-wrap gap-1.5">
                    {chats.map((provider) => (
                        <IconButton
                            key={provider.kind}
                            label={provider.name}
                            tooltip={false}
                            className={clsx('size-9 rounded-lg', AGENT_BUTTON)}
                            onPointerEnter={() => setPointed(provider)}
                            onPointerLeave={() => setPointed(null)}
                            onFocus={() => setPointed(provider)}
                            onBlur={() => setPointed(null)}
                            onClick={() => onAdd('chat', provider.kind)}
                        >
                            <AgentIcon kind={provider.kind} size={18} className={provider.kind === 'claude' ? 'text-chart-claude' : undefined} />
                        </IconButton>
                    ))}
                </span>
            )}
        </>
    );
}

/* A shell waiting at its prompt, and the agent CLIs that run in a terminal. */
function TerminalGhostBody({ onAdd }: { onAdd: AddNode }) {
    const { t } = useTranslation('canvas');
    const providers = useProviders((s) => s.providers);
    const agents = availableAgents(providers, 'terminal');

    return (
        <>
            <span className="font-mono text-text-faint">
                $ <span className="ghost-caret inline-block h-4 w-2 bg-current align-middle opacity-60" />
            </span>
            {agents.length > 0 && (
                <span className="pointer-events-auto relative mt-auto flex flex-wrap items-center gap-1.5">
                    <span className="mr-1">{t('empty.orRun')}</span>
                    {agents.map((provider) => (
                        <IconButton
                            key={provider.kind}
                            size="sm"
                            label={t('empty.runIn', { name: provider.name })}
                            className={clsx('rounded-md', AGENT_BUTTON)}
                            onClick={() => onAdd('terminal', provider.kind)}
                        >
                            <AgentIcon kind={provider.kind} size={14} className={provider.kind === 'claude' ? 'text-chart-claude' : undefined} />
                        </IconButton>
                    ))}
                </span>
            )}
        </>
    );
}
