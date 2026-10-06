import { useEffect, useReducer } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import {
    AnchoredPopup,
    CodeAuthorsCard,
    CompletionPopup,
    EditorContextMenu,
    EditorRenderingProvider,
    HoverCard,
    PeekPanel,
    PickPopup,
    RenameCard,
    SignatureCard,
    SymbolPicker,
    type HoverView
} from '@adecore/editor-react';
import { AgentIcon } from '@adecore/agents-react/agents/AgentIcon';
import { Button, ContextMenu, Icon, Kbd, Tooltip } from '@adecore/ui';
import { Cpu, MapPin, MessageSquarePlus, Sparkles } from 'lucide-react';
import { InlineEditLayer } from '@/editor-ai/InlineEditLayer';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { highlightCode } from '@/shell/panels/highlight';
import { useCodeTheme } from '@/state/code-theme';
import { useAskAgents } from './ask-agents';
import type { EditorLanguage } from './ruimte-editor-language';

function HoverActions({ language, view }: { language: EditorLanguage; view: HoverView }) {
    const { t } = useTranslation('panels');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    const explain = useStore(language.explain.store);
    return (
        <>
            {explain.phase !== 'idle' && (
                <div className="flex max-w-[520px] flex-col gap-1.5 border-t border-border px-3 py-2.5 text-xs/[19px]">
                    <Tooltip label={t('language.onDevice.note')}>
                        <span className="flex items-center gap-1.5 text-text-faint">
                            <Icon icon={Cpu} size={12} /> {t('language.onDevice.explanation')}
                        </span>
                    </Tooltip>
                    <div
                        role={explain.phase === 'error' ? 'alert' : undefined}
                        className={`break-words whitespace-pre-wrap select-text ${explain.phase === 'error' ? 'text-status-error' : 'text-text'}`}
                    >
                        {explain.error ?? (explain.text || t('language.onDevice.thinking'))}
                    </div>
                </div>
            )}
            {(explain.offered || view.problems.length > 0) && (
                <div className="flex flex-wrap gap-1 border-t border-border px-3 py-2">
                    {explain.offered && (
                        <Button size="xs" variant="secondary" onClick={() => void language.explain.explainCard()}>
                            {t('language.onDevice.explain')}
                        </Button>
                    )}
                    {view.problems.map((problem, index) =>
                        agents.map((agent) => (
                            <Button
                                key={`${index}:${agent.kind}`}
                                size="xs"
                                variant="secondary"
                                onClick={() => {
                                    language.hover.hide();
                                    language.selectionChat.askAboutProblem(problem, agent.kind);
                                }}
                            >
                                <AgentIcon kind={agent.kind} size={12} /> {chat('selection.ask', { provider: agent.name })}
                            </Button>
                        ))
                    )}
                </div>
            )}
        </>
    );
}

function MenuActions({ language }: { language: EditorLanguage }) {
    const { t } = useTranslation('shell');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    return (
        <>
            {language.project.service.supports('textDocument/declaration', language.uri) && (
                <ContextMenu.Item onClick={() => void language.navigation.go('declaration')}>
                    <Icon icon={MapPin} size={14} /> {t('menu.goToDeclaration')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Separator />
            <ContextMenu.Item onClick={() => language.inlineEdit.start()}>
                <Icon icon={Sparkles} size={14} /> {t('menu.inlineEdit')} <Kbd shortcut={CANVAS_SHORTCUTS.inlineEdit} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => language.selectionChat.choose()}>
                <Icon icon={MessageSquarePlus} size={14} /> {t('menu.selectionToChat')} <Kbd shortcut={CANVAS_SHORTCUTS.selectionToChat} />
            </ContextMenu.Item>
            {agents.map((agent) => (
                <ContextMenu.Item key={agent.kind} onClick={() => language.selectionChat.askAbout(agent.kind)}>
                    <AgentIcon kind={agent.kind} /> {chat('selection.ask', { provider: agent.name })}
                </ContextMenu.Item>
            ))}
        </>
    );
}

export function LanguagePopups({ language }: { language: EditorLanguage }) {
    const theme = useCodeTheme();
    const [, redraw] = useReducer((count: number) => count + 1, 0);
    const state = useStore(language.popups);
    useEffect(() => language.editor.onViewChange(redraw), [language]);
    const { hover, completion, signature, pick, rename, peek, symbols, menu, authors } = state;
    const hoverRect = hover === null ? null : language.editor.rectAt(hover.anchor);
    const completionRect = completion === null ? null : language.editor.rectAt(completion.anchor);
    const signatureRect = signature === null ? null : language.editor.rectAt(signature.anchor);
    const pickRect = pick === null ? null : language.editor.rectAt(pick.anchor);
    const renameRect = rename === null ? null : language.editor.rectAt(rename.range.start);
    const renameEnd = rename === null ? null : language.editor.rectAt(rename.range.end);
    return (
        <EditorRenderingProvider value={{ theme, highlight: highlightCode }}>
            {hover !== null && hoverRect !== null && (
                <AnchoredPopup rect={hoverRect} onPointerEnter={() => language.hover.holdCard(true)} onPointerLeave={() => language.hover.holdCard(false)}>
                    <HoverCard language={language} problems={hover.problems} info={hover.info} anchor={hover.anchor} position={hover.position} />
                    <HoverActions language={language} view={hover} />
                </AnchoredPopup>
            )}
            {signature !== null && signatureRect !== null && (
                <AnchoredPopup rect={signatureRect} placement={{ prefer: 'above' }}>
                    <SignatureCard model={signature.model} />
                </AnchoredPopup>
            )}
            {completion !== null && completionRect !== null && <CompletionPopup language={language} view={completion} rect={completionRect} />}
            {pick !== null && pickRect !== null && <PickPopup language={language} view={pick} rect={pickRect} />}
            {menu !== null && (
                <EditorContextMenu language={language} view={menu}>
                    <MenuActions language={language} />
                </EditorContextMenu>
            )}
            {symbols !== null && <SymbolPicker language={language} view={symbols} />}
            {peek !== null && <PeekPanel language={language} view={peek} />}
            {authors !== null && <CodeAuthorsCard language={language} view={authors} />}
            <InlineEditLayer language={language} />
            {rename !== null && renameRect !== null && <RenameCard language={language} view={rename} rect={renameRect} endRect={renameEnd} />}
        </EditorRenderingProvider>
    );
}
