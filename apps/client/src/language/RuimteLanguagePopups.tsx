import { AgentIcon } from '@adecore/agents-react/providers';
import { EditorRenderingProvider, LanguagePopups, type HoverView } from '@adecore/editor-react';
import { Button, ContextMenu, Icon, Tooltip } from '@adecore/ui';
import { Bot, Cpu, MessageSquarePlus, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { useEditorAssistAvailability } from '@/editor-assist/use-availability';
import { useCodeTheme } from '@/state/code-theme';
import { useSettings } from '@/state/settings';
import { highlightCode } from '@/surface/panels/highlight';
import { RowKbd } from '@/surface/RowKbd';
import { useAskAgents } from './ask-agents';
import type { EditorLanguage } from './ruimte-editor-language';

function HoverActions({ language, view }: { language: EditorLanguage; view: HoverView }) {
    const { t } = useTranslation('panels');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    const explain = useStore(language.app.explain.store);
    return (
        <>
            {explain.phase !== 'idle' && (
                <div className="flex max-w-[520px] flex-col gap-1.5 px-3 py-2.5 text-xs/[19px]">
                    <Tooltip label={t('language.editorAssist.note')}>
                        <span className="flex items-center gap-1.5 text-text-faint">
                            <Icon icon={Cpu} size={12} /> {t('language.editorAssist.explanation')}
                        </span>
                    </Tooltip>
                    <div
                        role={explain.phase === 'error' ? 'alert' : undefined}
                        className={`break-words whitespace-pre-wrap select-text ${explain.phase === 'error' ? 'text-status-error' : 'text-text'}`}
                    >
                        {explain.error ?? (explain.text || t('language.editorAssist.thinking'))}
                    </div>
                </div>
            )}
            {(explain.offered || view.problems.length > 0) && (
                <div className="flex flex-wrap gap-1 px-3 py-2">
                    {explain.offered && (
                        <Button size="xs" variant="secondary" onClick={() => void language.app.explain.explainCard()}>
                            {t('language.editorAssist.explain')}
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
                                    language.app.selectionChat.askAboutProblem(problem, agent.kind);
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

export function MenuActions({ language }: { language: EditorLanguage }) {
    const { t } = useTranslation('shell');
    const { t: chat } = useTranslation('chat');
    const agents = useAskAgents();
    const aiCodeHelp = useSettings((state) => state.aiCodeHelp);
    const available = useEditorAssistAvailability()?.available === true;
    const explains = aiCodeHelp && available;
    return (
        <>
            <ContextMenu.Item onClick={() => language.app.inlineEdit.start()}>
                <Icon icon={Sparkles} size={14} /> {t('editorMenu.inlineEdit')} <RowKbd row="inlineEdit" />
            </ContextMenu.Item>
            {explains && (
                <ContextMenu.Item onClick={() => void language.app.explain.explainHere()}>
                    <Icon icon={Cpu} size={14} /> {t('editorMenu.explain')}
                </ContextMenu.Item>
            )}
            <ContextMenu.Item onClick={() => language.app.selectionChat.choose()}>
                <Icon icon={MessageSquarePlus} size={14} /> {t('editorMenu.selectionToChat')} <RowKbd row="selectionToChat" />
            </ContextMenu.Item>
            {agents.length === 1 &&
                agents.map((agent) => (
                    <ContextMenu.Item key={agent.kind} onClick={() => language.app.selectionChat.askAbout(agent.kind)}>
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
                            <ContextMenu.Item key={agent.kind} onClick={() => language.app.selectionChat.askAbout(agent.kind)}>
                                <AgentIcon kind={agent.kind} /> {agent.name}
                            </ContextMenu.Item>
                        ))}
                    </ContextMenu.Popup>
                </ContextMenu.SubmenuRoot>
            )}
        </>
    );
}

/* The shared cards, with Ruimte's actions in the hover card and the context menu and what `children` draws over the editor. */
export function RuimteLanguagePopups({ language, children }: { language: EditorLanguage; children?: ReactNode }) {
    const theme = useCodeTheme();
    return (
        <EditorRenderingProvider value={{ theme, highlight: highlightCode }}>
            <LanguagePopups
                language={language}
                hoverFooter={(view, shown) => <HoverActions language={shown} view={view} />}
                contextMenuItems={(shown) => <MenuActions language={shown} />}
            >
                {children}
            </LanguagePopups>
        </EditorRenderingProvider>
    );
}
