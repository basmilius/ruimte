import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowUp, Square } from 'lucide-react';
import type { ChatApprovalItem, ChatInfo, ChatQuestionItem, InteractionMode, ModelInfo, RuntimeMode } from '@ruimte/contracts';
import { chatClient } from '@/chat';
import { readDraft, writeDraft } from '@/chat/drafts';
import { rememberChatPreferences } from '@/chat/preferences';
import { ContextMeter } from '@/chat/ui/ContextMeter';
import { ApprovalDock, QuestionDock } from '@/chat/ui/PendingDock';
import { ModelPicker, ModePicker, OptionsPicker, PlanToggle } from '@/chat/ui/Pickers';
import { useChats } from '@/state/chats';
import { useProviders } from '@/state/providers';
import { Tooltip } from '@/ui/Tooltip';

const MAX_ROWS_PX = 200;

// Commands the composer handles itself; the CLI's own ones are sent through as text.
const LOCAL_COMMANDS = [
    { name: 'plan', hint: 'Switch to plan mode' },
    { name: 'build', hint: 'Switch back to building' },
    { name: 'compact', hint: 'Fold the context' }
];

interface ComposerProps {
    chatId: string;
    info: ChatInfo;
    focused: boolean;
    disabled: boolean;
    onSend(text: string): void;
}

const usePendingRequests = (chatId: string) => {
    const items = useChats((s) => s.byNodeId[chatId]?.items);
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    return useMemo(() => {
        const approvals: ChatApprovalItem[] = [];
        let question: ChatQuestionItem | null = null;
        for (const id of order ?? []) {
            const item = items?.[id];
            if (item?.kind === 'approval' && item.decision === 'pending') {
                approvals.push(item);
            } else if (item?.kind === 'question' && item.state === 'pending' && !question) {
                question = item;
            }
        }
        return { approvals, question };
    }, [items, order]);
};

/*
 * The floating card at the bottom of a chat: what the agent is waiting on docks above it, the
 * prompt sits in the middle, and the footer holds the model, its options, the permission mode,
 * plan or build, the context meter and the send or stop button.
 */
export function Composer({ chatId, info, focused, disabled, onSend }: ComposerProps) {
    const [draft, setDraft] = useState(() => readDraft(chatId));
    const [historyIndex, setHistoryIndex] = useState<number | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const providers = useProviders((s) => s.providers);
    const { approvals, question } = usePendingRequests(chatId);
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    const items = useChats((s) => s.byNodeId[chatId]?.items);

    const provider = providers.find((entry) => entry.kind === info.provider);
    const models: ModelInfo[] = provider?.models ?? [];
    const model = models.find((entry) => entry.slug === info.selection.model);
    const busy = info.activeTurnId !== null;

    useEffect(() => {
        if (focused) {
            inputRef.current?.focus();
        }
    }, [focused]);

    useEffect(() => {
        const el = inputRef.current;
        if (el) {
            el.style.height = 'auto';
            el.style.height = `${Math.min(MAX_ROWS_PX, el.scrollHeight)}px`;
        }
    }, [draft]);

    useEffect(() => {
        writeDraft(chatId, draft);
    }, [chatId, draft]);

    const history = useMemo(() => {
        const texts: string[] = [];
        for (const id of order ?? []) {
            const item = items?.[id];
            if (item?.kind === 'user') {
                texts.push(item.text);
            }
        }
        return texts;
    }, [order, items]);

    const commandQuery = draft.startsWith('/') && !draft.includes('\n') ? draft.slice(1).trim().toLowerCase() : null;
    const commands = useMemo(() => {
        if (commandQuery === null) {
            return [];
        }
        const own = LOCAL_COMMANDS.map((command) => ({ ...command, local: true }));
        const cli = info.slashCommands
            .filter((name) => !LOCAL_COMMANDS.some((command) => command.name === name))
            .map((name) => ({ name, hint: 'Claude Code command', local: false }));
        return [...own, ...cli].filter((command) => command.name.startsWith(commandQuery)).slice(0, 8);
    }, [commandQuery, info.slashCommands]);

    const configure = (patch: { selection?: ChatInfo['selection']; runtimeMode?: RuntimeMode; interactionMode?: InteractionMode }): void => {
        rememberChatPreferences(patch);
        void chatClient.configure({ chatId, ...patch }).catch(() => undefined);
    };

    const runCommand = (name: string): boolean => {
        switch (name) {
            case 'plan':
                configure({ interactionMode: 'plan' });
                return true;
            case 'build':
                configure({ interactionMode: 'default' });
                return true;
            case 'compact':
                void chatClient.compact(chatId).catch(() => undefined);
                return true;
            default:
                return false;
        }
    };

    const submit = (): void => {
        const text = draft.trim();
        if (!text || disabled || busy) {
            return;
        }
        const chosen = commands[menuIndex];
        if (commandQuery !== null && chosen?.local && runCommand(chosen.name)) {
            setDraft('');
            return;
        }
        if (commandQuery !== null && chosen && !chosen.local) {
            onSend(`/${chosen.name}`);
            setDraft('');
            return;
        }
        onSend(text);
        setDraft('');
        setHistoryIndex(null);
    };

    const recall = (direction: -1 | 1): boolean => {
        if (history.length === 0) {
            return false;
        }
        const next = historyIndex === null ? (direction === -1 ? history.length - 1 : null) : historyIndex + direction;
        if (next === null || next >= history.length) {
            setHistoryIndex(null);
            setDraft('');
            return true;
        }
        if (next < 0) {
            return true;
        }
        setHistoryIndex(next);
        setDraft(history[next]!);
        return true;
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (e.key === 'Escape') {
            return;
        }
        e.stopPropagation();
        const el = e.currentTarget;
        if (commandQuery !== null && commands.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuIndex((i) => (i + 1) % commands.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMenuIndex((i) => (i - 1 + commands.length) % commands.length);
                return;
            }
            if (e.key === 'Tab') {
                e.preventDefault();
                setDraft(`/${commands[menuIndex]!.name} `);
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
            return;
        }
        // The arrows recall earlier prompts only from an empty box or an unedited recall, on its first or last line.
        const recalled = historyIndex !== null && draft === history[historyIndex];
        const atStart = el.selectionStart === 0 && !draft.slice(0, el.selectionStart).includes('\n');
        const atEnd = el.selectionEnd === draft.length && !draft.slice(el.selectionEnd).includes('\n');
        if (e.key === 'ArrowUp' && (draft === '' || (recalled && atStart)) && recall(-1)) {
            e.preventDefault();
        } else if (e.key === 'ArrowDown' && recalled && atEnd && recall(1)) {
            e.preventDefault();
        }
    };

    const placeholder = disabled
        ? 'Not connected to the Ruimte server'
        : info.interactionMode === 'plan'
          ? 'Describe what to plan, or / for commands'
          : 'Ask anything, or / for commands';

    return (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
            <div className="chat-composer pointer-events-auto flex flex-col">
                {question && <QuestionDock chatId={chatId} item={question} />}
                {!question && approvals[0] && <ApprovalDock chatId={chatId} item={approvals[0]} index={0} total={approvals.length} />}
                {commandQuery !== null && commands.length > 0 && (
                    <div className="border-b border-border px-1.5 py-1.5">
                        {commands.map((command, index) => (
                            <button
                                key={command.name}
                                className={clsx(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px]',
                                    index === menuIndex ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                )}
                                onMouseEnter={() => setMenuIndex(index)}
                                onClick={() => {
                                    setMenuIndex(index);
                                    setDraft(`/${command.name}`);
                                    inputRef.current?.focus();
                                }}
                            >
                                <span className="font-mono text-text">/{command.name}</span>
                                <span className="text-text-faint">{command.hint}</span>
                            </button>
                        ))}
                    </div>
                )}
                <textarea
                    ref={inputRef}
                    rows={1}
                    placeholder={placeholder}
                    className="w-full resize-none bg-transparent px-3.5 pb-1 pt-3 text-[13px] leading-relaxed text-text outline-none placeholder:text-text-faint"
                    value={draft}
                    disabled={disabled}
                    tabIndex={focused ? 0 : -1}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        setMenuIndex(0);
                        if (historyIndex !== null && e.target.value !== history[historyIndex]) {
                            setHistoryIndex(null);
                        }
                    }}
                    onKeyDown={onKeyDown}
                />
                <div className="flex items-center gap-1 px-2 pb-2">
                    <ModelPicker models={models} selection={info.selection} onChange={(slug) => configure({ selection: { model: slug, options: {} } })} />
                    <OptionsPicker
                        model={model}
                        selection={info.selection}
                        onChange={(id, value) => configure({ selection: { ...info.selection, options: { ...info.selection.options, [id]: value } } })}
                    />
                    <ModePicker runtimeMode={info.runtimeMode} onChange={(runtimeMode) => configure({ runtimeMode })} />
                    <PlanToggle interactionMode={info.interactionMode} onChange={(interactionMode) => configure({ interactionMode })} />
                    <span className="grow" />
                    <ContextMeter usage={info.usage} disabled={busy || disabled} onCompact={() => void chatClient.compact(chatId).catch(() => undefined)} />
                    {busy ? (
                        <Tooltip label="Stop">
                            <button
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-error text-accent-text"
                                onClick={() => void chatClient.cancel(chatId).catch(() => undefined)}
                            >
                                <Square size={11} strokeWidth={3} />
                            </button>
                        </Tooltip>
                    ) : (
                        <Tooltip label="Send" kbd="↵">
                            <button
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-text disabled:opacity-40"
                                disabled={!draft.trim() || disabled}
                                onClick={submit}
                            >
                                <ArrowUp size={15} strokeWidth={2.25} />
                            </button>
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    );
}
