import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import { EditorRenderingProvider, LanguagePopups, type HoverView } from '@adecore/editor-react';
import { Button, ContextMenu, Icon, Kbd, Tooltip } from '@adecore/ui';
import { Bot, Cpu, MessageSquarePlus, Sparkles } from 'lucide-react';
import { InlineEditLayer } from '@/editor-ai/InlineEditLayer';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { highlightCode } from '@/shell/panels/highlight';
import { useCodeTheme } from '@/state/code-theme';
import { useAskAgents } from './ask-agents';
import type { EditorLanguage } from './ruimte-editor-language';
import { AgentIcon } from '@adecore/agents-react/providers';

function HoverActions({ language, view }: { language: EditorLanguage; view: HoverView }) {
    const { t } = useTranslation('panels');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    const explain = useStore(language.explain.store);
    return (
        <>
            {explain.phase !== 'idle' && (
                <div className="flex max-w-[520px] flex-col gap-1.5 px-3 py-2.5 text-xs/[19px]">
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
                <div className="flex flex-wrap gap-1 px-3 py-2">
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
            <ContextMenu.Item onClick={() => language.inlineEdit.start()}>
                <Icon icon={Sparkles} size={14} /> {t('editorMenu.inlineEdit')} <Kbd shortcut={CANVAS_SHORTCUTS.inlineEdit} />
            </ContextMenu.Item>
            <ContextMenu.Item onClick={() => language.selectionChat.choose()}>
                <Icon icon={MessageSquarePlus} size={14} /> {t('editorMenu.selectionToChat')} <Kbd shortcut={CANVAS_SHORTCUTS.selectionToChat} />
            </ContextMenu.Item>
            {agents.length === 1 &&
                agents.map((agent) => (
                    <ContextMenu.Item key={agent.kind} onClick={() => language.selectionChat.askAbout(agent.kind)}>
                        <AgentIcon kind={agent.kind} /> {chat('selection.ask', { provider: agent.name })}
                    </ContextMenu.Item>
                ))}
            {agents.length > 1 && (
                <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger>
                        <Icon icon={Bot} size={14} /> {t('editorMenu.askAgent')}
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Popup>
                        {agents.map((agent) => (
                            <ContextMenu.Item key={agent.kind} onClick={() => language.selectionChat.askAbout(agent.kind)}>
                                <AgentIcon kind={agent.kind} /> {agent.name}
                            </ContextMenu.Item>
                        ))}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
        </>
    );
}

/* The shared cards, with Ruimte's actions in the hover card and the context menu and its inline edit over the editor. */
export function RuimteLanguagePopups({ language }: { language: EditorLanguage }) {
    const theme = useCodeTheme();
    return (
        <EditorRenderingProvider value={{ theme, highlight: highlightCode }}>
            <LanguagePopups
                language={language}
                hoverFooter={(view, shown) => <HoverActions language={shown} view={view} />}
                contextMenuItems={(shown) => <MenuActions language={shown} />}
            >
                <InlineEditLayer language={language} />
            </LanguagePopups>
        </EditorRenderingProvider>
    );
}
