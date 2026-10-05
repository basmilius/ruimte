import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { CircleX, Info, Sparkles, TriangleAlert, X } from 'lucide-react';
import { AgentIcon } from '@ruimte/agents-react/agents/AgentIcon';
import { ModelPicker } from '@ruimte/agents-react/chat/ui/Pickers';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { Button, FileIcon, Icon, IconButton, Input, Kbd, Pill, Spinner, shortcut } from '@basmilius/desktop-ui';
import { formatDuration } from '@basmilius/desktop-ui/format';
import { availableAgents } from '@/agents/creation';
import { lineRangeLabel } from '@/chat/selection-to-chat';
import { AnchoredPopup } from '@/language/AnchoredPopup';
import type { EditorLanguage } from '@/language/editor-language';
import { isShortcut } from '@/language/shortcut-keys';
import { basenameOf } from '@/shell/panels/files-tree';
import { diffSegments, lineSpanOf, type InlineProblem } from './inline-edit-model';
import type { InlineEditFeature, InlinePrompt } from './inline-edit';
import type { ApplyOutcome, InlineEditSession } from './inline-edit-session';

const APPLY = shortcut('Mod+Enter');
const SEVERITY_ICONS = { error: CircleX, warning: TriangleAlert, info: Info, hint: Info } as const;
const SEVERITY_TONES = { error: 'error', warning: 'needsYou', info: 'muted', hint: 'muted' } as const;
/* The chips that fit beside the file label before the rest are counted. */
const VISIBLE_PROBLEMS = 3;

function ProblemChips({ problems }: { problems: readonly InlineProblem[] }) {
    const { t } = useTranslation('inline-edit');
    const shown = problems.slice(0, VISIBLE_PROBLEMS);
    return (
        <>
            {shown.map((problem, index) => (
                <span key={`${problem.line}:${index}`} className="min-w-0 shrink" aria-label={t('prompt.problems')}>
                    <Pill tone={SEVERITY_TONES[problem.severity]} icon={<Icon icon={SEVERITY_ICONS[problem.severity]} size={12} />}>
                        <span className="block max-w-[180px] truncate">{`${problem.line}: ${problem.message}`}</span>
                    </Pill>
                </span>
            ))}
            {problems.length > shown.length && <span className="text-xs text-text-faint">+{problems.length - shown.length}</span>}
        </>
    );
}

/* The question under the selected lines: what to change, which agent answers, and what goes along. */
function Prompt({ feature, language, prompt }: { feature: InlineEditFeature; language: EditorLanguage; prompt: InlinePrompt }) {
    const { t } = useTranslation('inline-edit');
    const providers = useProviders((row) => row.providers);
    const offered = availableAgents(providers, 'chat');
    const owner = providers.find((provider) => provider.kind === prompt.provider);
    const [picking, setPicking] = useState(false);
    const path = basenameOf(language.inlineEdit.path);

    function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
        if (event.nativeEvent.isComposing) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            feature.run();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            feature.cancel();
        }
    }

    return (
        <div className="flex w-[560px] max-w-full flex-col gap-2 p-2.5">
            <Input
                autoFocus
                icon={Sparkles}
                aria-label={t('prompt.input')}
                placeholder={t('prompt.input')}
                spellCheck={false}
                value={prompt.instruction}
                onChange={(event) => feature.setInstruction(event.target.value)}
                onKeyDown={onKeyDown}
            />
            <div className="flex items-center gap-1.5">
                {offered.length === 0 ? (
                    <span className="text-xs text-text-muted">{t('prompt.noAgent')}</span>
                ) : (
                    <ModelPicker
                        providers={offered}
                        provider={prompt.provider}
                        selection={{ model: prompt.model ?? owner?.defaultModel ?? '', options: {} }}
                        open={picking}
                        onOpenChange={setPicking}
                        onChange={(provider, model) => feature.setAgent(provider, model)}
                        kbd={null}
                        side="bottom"
                    />
                )}
                <Pill tone="muted" icon={<FileIcon path={language.inlineEdit.path} size={12} />} mono>
                    <span aria-label={t('prompt.lines')}>{lineRangeLabel(path, prompt.span.startLine, prompt.span.endLine)}</span>
                </Pill>
                <ProblemChips problems={prompt.problems} />
                <span className="grow" />
                <span className="shrink-0 text-xs whitespace-nowrap text-text-faint">
                    ↵ {t('prompt.run')} · Esc {t('prompt.cancel')}
                </span>
            </div>
            <p className="text-xs text-text-faint">{t('prompt.note')}</p>
        </div>
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
            language.editor.renderCode(element, segment.text, {
                ...(segment.firstLine === undefined ? {} : { firstLine: segment.firstLine }),
                ...(segment.kind === 'same'
                    ? {}
                    : { sign: segment.kind === 'added' ? '+' : '-', color: segment.kind === 'added' ? '--status-idle' : '--status-error' })
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
            <span className="flex items-center gap-1.5 text-xs text-text-muted">
                <Spinner size={12} />
                {needsYou ? t('card.waiting') : t('card.running')}
            </span>
        );
    }
    if (phase === 'failed') {
        return <span className="text-xs text-status-error">{t('card.failed')}</span>;
    }
    return <span className="text-xs text-text-muted">{t('card.done', { duration: formatDuration((endedAt ?? startedAt) - startedAt) })}</span>;
}

/* What the proposal is drawn in, under the selected lines. */
function Card({ language, session }: { language: EditorLanguage; session: InlineEditSession }) {
    const { t } = useTranslation('inline-edit');
    const state = useStore(session.store, (current) => current);
    const providers = useProviders((row) => row.providers);
    const [followUp, setFollowUp] = useState('');
    const [refused, setRefused] = useState<ApplyOutcome | null>(null);
    const field = useRef<HTMLInputElement>(null);
    const name = providers.find((provider) => provider.kind === state.provider)?.name ?? state.provider;
    const running = state.phase === 'running';
    const canApply = state.phase === 'proposal' && !state.stale && refused !== 'readonly';

    // A card that just settled takes the keyboard from nothing, so Apply and a follow-up are a key away.
    useEffect(() => {
        const active = document.activeElement;
        if (!running && (active === null || active === document.body || active.closest('[data-inline-edit-card]') !== null)) {
            field.current?.focus();
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
            session.hide();
            language.editor.focus();
        }
    }

    return (
        <div data-inline-edit-card className="border-y border-accent bg-surface text-sm text-text" onKeyDown={onKeyDown}>
            <div className="flex h-9 items-center gap-2 px-3">
                <AgentIcon kind={state.provider} size={14} />
                <span className="shrink-0 font-medium">{name}</span>
                <span className="min-w-0 flex-1 truncate text-text-muted">{state.instruction}</span>
                <Status session={session} />
                <IconButton icon={X} label={t('card.close')} size="sm" onClick={() => session.hide()} />
            </div>
            {state.phase === 'proposal' && <Proposal language={language} session={session} />}
            {state.phase !== 'proposal' && state.phase !== 'running' && (
                <p className={`px-3 py-2 whitespace-pre-wrap ${state.phase === 'failed' ? 'text-status-error' : 'text-text-muted'}`}>
                    {state.phase === 'failed' ? state.error : state.answer === '' ? t('card.noChange') : state.answer}
                </p>
            )}
            {state.phase === 'proposal' && state.answer !== '' && <p className="px-3 pb-2 whitespace-pre-wrap text-text-muted">{state.answer}</p>}
            {state.stale && <p className="px-3 pb-2 text-status-needs-you">{t('card.stale')}</p>}
            {refused === 'readonly' && <p className="px-3 pb-2 text-status-needs-you">{t('card.readOnly')}</p>}
            {running && state.needsYou && <p className="px-3 pb-2 text-text-muted">{t('card.waiting')}</p>}
            <div className="flex items-center gap-2 px-2 pt-1 pb-2">
                {running ? (
                    <span className="grow" />
                ) : (
                    <Input
                        ref={field}
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
                )}
                <Button size="sm" variant="ghost" onClick={() => void session.openAsChat()}>
                    {t('card.openAsChat')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void session.discard()}>
                    {t('card.discard')}
                </Button>
                {state.phase === 'proposal' && (
                    <Button size="sm" variant="primary" disabled={!canApply} onClick={() => void apply()}>
                        {t('card.apply')}
                        <Kbd shortcut={APPLY} variant="inline" className="ml-1.5 bg-transparent text-inherit" />
                    </Button>
                )}
            </div>
        </div>
    );
}

/*
 * What an inline edit draws over an editor: the question in a card under the selected lines, and
 * once there is a session, its card in the row the editor makes for it. The row is the editor's, so
 * the card scrolls with the text; this only fills it.
 */
export function InlineEditLayer({ language }: { language: EditorLanguage }) {
    const feature = language.inlineEdit;
    const { prompt, session, container } = useStore(feature.store, (view) => view);
    const [, redraw] = useState(0);

    useEffect(() => language.editor.onViewChange(() => redraw((count) => count + 1)), [language]);

    const rect = prompt === null ? null : language.editor.rectAt({ line: lineSpanOf(prompt.range).endLine - 1, character: 0 });
    return (
        <>
            {prompt !== null && rect !== null && (
                <AnchoredPopup rect={rect} className="overflow-visible" placement={{ prefer: 'below' }}>
                    <div data-inline-edit-card>
                        <Prompt feature={feature} language={language} prompt={prompt} />
                    </div>
                </AnchoredPopup>
            )}
            {session !== null && container !== null && createPortal(<Card language={language} session={session} />, container)}
        </>
    );
}
