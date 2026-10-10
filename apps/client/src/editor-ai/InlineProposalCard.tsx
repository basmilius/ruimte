import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Square, X } from 'lucide-react';
import type { AgentKind } from '@ruimte/contracts';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { ProviderLogo } from '@adecore/agents-react/agents/ProviderLogo';
import { useProviders } from '@adecore/agents-react/state/providers';
import { Button, Icon, IconButton, Input, Kbd, Spinner, shortcut } from '@adecore/ui';
import { formatDuration } from '@adecore/ui/format';
import { diffSegments, emphasisOf } from '@adecore/editor-react/models';
import type { EditorLanguage as RuimteEditorLanguage } from '@/language/ruimte-editor-language';
import { isShortcut } from '@/language/shortcut-keys';
import type { ApplyOutcome, InlineEditSession, InlineEditState } from './inline-edit-session';

type EditorLanguage = Pick<RuimteEditorLanguage, 'editor' | 'inlineEdit'>;

const APPLY = shortcut('Mod+Enter');

/* The mark of the agent's CLI, in the color its chats wear. */
function ProviderMark({ kind }: { kind: AgentKind }) {
    return (
        <span className={`flex shrink-0 items-center ${kind === 'claude' ? 'text-(--agent-1)' : 'text-text-muted'}`}>
            {kind === 'claude' || kind === 'codex' ? <ProviderLogo provider={kind} size={14} /> : <AgentIcon kind={kind} size={14} />}
        </span>
    );
}

/* The proposal as lines of code the editor draws in its own face: added lines tinted, and the lines it drops, which the text above does not show gone. */
function Proposal({ language, session }: { language: EditorLanguage; session: InlineEditSession }) {
    const { selectedText, proposal, range } = useStore(session.store, (state) => state);
    const ref = useRef<HTMLDivElement>(null);
    const segments = useMemo(
        () => (proposal === null ? [] : diffSegments(selectedText, proposal, range.start.line + 1)),
        [selectedText, proposal, range.start.line]
    );

    useLayoutEffect(() => {
        const element = ref.current;
        if (element === null) {
            return;
        }
        element.replaceChildren();
        for (const segment of segments) {
            const emphasis = emphasisOf(segment);
            language.editor.renderCode(element, segment.text, {
                ...(segment.firstLine === undefined ? {} : { firstLine: segment.firstLine }),
                ...(segment.kind === 'same'
                    ? {}
                    : { sign: segment.kind === 'added' ? '+' : '-', color: segment.kind === 'added' ? '--status-idle' : '--status-error' }),
                ...(emphasis === undefined ? {} : { emphasis })
            });
        }
    }, [language, segments]);

    return <div ref={ref} className="py-1" />;
}

function Status({ session }: { session: InlineEditSession }) {
    const { t } = useTranslation('inline-edit');
    const { phase, needsYou, startedAt, endedAt } = useStore(session.store, (state) => state);
    if (phase === 'running') {
        return (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
                <Spinner size={12} />
                {needsYou ? t('card.waiting') : t('card.running')}
            </span>
        );
    }
    if (phase === 'failed') {
        return <span className="shrink-0 text-xs text-status-error">{t('card.failed')}</span>;
    }
    if (phase === 'stopped') {
        return <span className="shrink-0 text-xs text-text-muted">{t('card.stopped')}</span>;
    }
    return (
        <span className="shrink-0 text-xs whitespace-nowrap text-text-muted">
            {t('card.done', { duration: formatDuration((endedAt ?? startedAt) - startedAt) })}
        </span>
    );
}

/* What a card without a proposal says once its turn is over. */
function settledText(state: InlineEditState, t: (key: string) => string): string | null {
    if (state.phase === 'failed') {
        return state.error;
    }
    if (state.answer !== '') {
        return state.answer;
    }
    return state.phase === 'stopped' ? t('card.stoppedEmpty') : t('card.noChange');
}

/* The field while there is something to answer, the card itself while the agent works, so Escape and Stop are a key away. */
function moveKeyboard(card: HTMLElement | null, field: HTMLElement | null, running: boolean): void {
    (running ? card : field)?.focus();
}

/* The cards that already took the keyboard for a request, so a row the editor makes again after a scroll never takes it from the text. */
const keyboardTaken = new WeakMap<InlineEditSession, number>();

/*
 * The proposal under the selected lines, in the row the editor makes for it: the agent and what it was
 * asked, the diff against the selection, and one row to ask again, open the chat, discard or apply.
 */
export function InlineProposalCard({ language, session }: { language: EditorLanguage; session: InlineEditSession }) {
    const { t } = useTranslation('inline-edit');
    const state = useStore(session.store, (current) => current);
    const providers = useProviders((row) => row.providers);
    const [followUp, setFollowUp] = useState('');
    const [refused, setRefused] = useState<ApplyOutcome | null>(null);
    const root = useRef<HTMLDivElement>(null);
    const field = useRef<HTMLInputElement>(null);
    const name = providers.find((provider) => provider.kind === state.provider)?.name ?? state.provider;
    const running = state.phase === 'running';
    const canApply = state.phase === 'proposal' && !state.stale && refused !== 'readonly';
    const canAsk = state.phase !== 'running';

    // A request for the card (it was just shown) takes the keyboard once, wherever it was.
    useEffect(() => {
        if (keyboardTaken.get(session) !== state.focusRequest) {
            keyboardTaken.set(session, state.focusRequest);
            moveKeyboard(root.current, field.current, running);
        }
    }, [session, state.focusRequest, running]);

    // A card that just settled takes the keyboard from nothing, so Apply and a follow-up are a key away; only the move between running and settled does.
    useEffect(() => {
        const active = document.activeElement;
        if (active === null || active === document.body || root.current?.contains(active) === true) {
            moveKeyboard(root.current, field.current, running);
        }
    }, [running]);

    async function apply(): Promise<void> {
        setRefused(null);
        const outcome = await session.apply();
        if (outcome !== 'applied') {
            setRefused(outcome);
        }
    }

    function send(): void {
        void session.followUp(followUp);
        setFollowUp('');
    }

    function close(): void {
        language.inlineEdit.returnToEditor();
        session.hide();
    }

    async function discard(): Promise<void> {
        language.inlineEdit.returnToEditor();
        await session.discard();
    }

    function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (isShortcut(APPLY, event.nativeEvent)) {
            event.preventDefault();
            event.stopPropagation();
            void apply();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    }

    return (
        <div ref={root} data-inline-edit-card tabIndex={-1} className="py-1 outline-none" onKeyDown={onKeyDown}>
            <div className="border-y-2 border-accent bg-surface-raised text-sm text-text">
                <div className="flex h-8 items-center gap-2 border-b border-border-soft px-3 text-xs">
                    <ProviderMark kind={state.provider} />
                    <span className="shrink-0 font-semibold">{name}</span>
                    <span className="min-w-0 flex-1 truncate text-text-muted">{state.instruction}</span>
                    <Status session={session} />
                    <IconButton icon={X} label={t('card.close')} size="sm" onClick={close} />
                </div>
                {state.phase === 'proposal' && <Proposal language={language} session={session} />}
                {state.phase !== 'proposal' && state.phase !== 'running' && (
                    <p className={`px-3 py-2 whitespace-pre-wrap ${state.phase === 'failed' ? 'text-status-error' : 'text-text-muted'}`}>
                        {settledText(state, t)}
                    </p>
                )}
                {state.phase === 'proposal' && state.answer !== '' && <p className="px-3 pb-2 whitespace-pre-wrap text-text-muted">{state.answer}</p>}
                {state.stale && <p className="px-3 pb-2 text-status-needs-you">{t('card.stale')}</p>}
                {refused === 'readonly' && <p className="px-3 pb-2 text-status-needs-you">{t('card.readOnly')}</p>}
                {running && state.needsYou && <p className="px-3 pb-2 text-text-muted">{t('card.waiting')}</p>}
                <div className="flex items-center gap-1.5 border-t border-border-soft px-2.5 py-2">
                    {canAsk ? (
                        <Input
                            ref={field}
                            size="sm"
                            aria-label={t('card.followUp')}
                            placeholder={t('card.followUp')}
                            spellCheck={false}
                            value={followUp}
                            onChange={(event) => setFollowUp(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing && !isShortcut(APPLY, event.nativeEvent)) {
                                    event.preventDefault();
                                    send();
                                }
                            }}
                            className="min-w-0 flex-1"
                        />
                    ) : (
                        <span className="grow" />
                    )}
                    {running && (
                        <Button size="sm" variant="secondary" onClick={() => void session.stop()}>
                            <Icon icon={Square} size={12} />
                            {t('card.stop')}
                        </Button>
                    )}
                    {state.phase === 'stopped' && (
                        <Button size="sm" variant="secondary" onClick={() => void session.rerun()}>
                            {t('card.runAgain')}
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => void session.openAsChat()}>
                        {t('card.openAsChat')}
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => void discard()}>
                        {t('card.discard')}
                    </Button>
                    {state.phase === 'proposal' && (
                        <Button size="sm" variant="primary" disabled={!canApply} onClick={() => void apply()}>
                            {t('card.apply')}
                            <Kbd shortcut={APPLY} className="font-sans opacity-80" />
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
