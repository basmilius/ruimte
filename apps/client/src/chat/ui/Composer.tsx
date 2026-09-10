import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { ArrowUp, Clock, FastForward, Paperclip, Square, X, Zap } from 'lucide-react';
import type { AgentKind, ChatApprovalItem, ChatInfo, ChatQuestionItem, ChatSkill, ModelInfo, ModelSelection, RuntimeMode } from '@ruimte/contracts';
import { chatClient, type ChatSendExtras } from '@/chat';
import { checkAttachmentLimits, filesOf, formatBytes, isImageAttachment, readAttachments, uploadBytes, uploadPreviewUrl } from '@/chat/attachments';
import { EMPTY_DRAFT, isEmptyDraft, readDraft, writeDraft, type ChatDraft } from '@/chat/drafts';
import {
    MENTION_DRAG_TYPE,
    findMentionQuery,
    findSkillQuery,
    insertMention,
    insertSkill,
    presentMentions,
    presentSkills,
    tokenizeChips,
    type MentionQuery
} from '@/chat/mentions';
import { rememberChatPreferences, rememberChatSelection } from '@/chat/preferences';
import { stashDraft, useStash, type StashedPrompt } from '@/chat/stash';
import { ContextMeter } from '@/chat/ui/ContextMeter';
import { ApprovalDock, QuestionDock } from '@/chat/ui/PendingDock';
import { ModelPicker, ModePicker, OptionsPicker, StashPicker } from '@/chat/ui/Pickers';
import { useChats } from '@/state/chats';
import { useProviders } from '@/state/providers';
import { Tooltip } from '@/ui/Tooltip';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';

const MAX_ROWS_PX = 200;
const SEARCH_DEBOUNCE_MS = 80;
// What fits above the composer without turning the picker into a file tree.
const MENTION_RESULTS = 8;
const NOTICE_MS = 4000;

// Commands the composer handles itself; the CLI's own ones are sent through as text.
const LOCAL_COMMANDS = [
    { name: 'model', hint: 'Switch the model' },
    { name: 'compact', hint: 'Fold the context' }
];

// The textarea and the chip layer behind it must wrap identically, so they share every metric.
const INPUT_CLASS = 'w-full whitespace-pre-wrap break-words px-3.5 pb-1 pt-3 text-sm leading-normal';

interface ComposerProps {
    chatId: string;
    info: ChatInfo;
    focused: boolean;
    disabled: boolean;
    /* Opened for one CLI from a menu: the model is the remembered one and there is nothing to pick. */
    providerFixed: boolean;
    onSend(text: string, extras: ChatSendExtras): void;
    /* Another provider's model was picked before the first message; the node has to follow. */
    onRetarget(provider: AgentKind, selection: ModelSelection): void;
}

const usePendingRequests = (chatId: string) => {
    const items = useChats((s) => s.byNodeId[chatId]?.items);
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    return useMemo(() => {
        const approvals: ChatApprovalItem[] = [];
        const questions: ChatQuestionItem[] = [];
        for (const id of order ?? []) {
            const item = items?.[id];
            if (item?.kind === 'approval' && item.decision === 'pending') {
                approvals.push(item);
            } else if (item?.kind === 'question' && item.state === 'pending') {
                questions.push(item);
            }
        }
        return { approvals, questions };
    }, [items, order]);
};

const splitPath = (path: string): { name: string; dir: string } => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
};

/*
 * The floating card at the bottom of a chat: what the agent is waiting on docks above it, the
 * prompt sits in the middle, and the footer holds the model, its options, the permission mode,
 * the context meter and the send or stop button. `/` opens the command menu, `@` a file picker
 * over the chat's folder; images arrive by paste or drop.
 */
export function Composer({ chatId, info, focused, disabled, providerFixed, onSend, onRetarget }: ComposerProps) {
    const [draft, setDraft] = useState<ChatDraft>(() => readDraft(chatId));
    const [historyIndex, setHistoryIndex] = useState<number | null>(null);
    const [menuIndex, setMenuIndex] = useState(0);
    const [mention, setMention] = useState<MentionQuery | null>(null);
    const [skillQuery, setSkillQuery] = useState<MentionQuery | null>(null);
    const [skills, setSkills] = useState<ChatSkill[]>([]);
    const [searched, setSearched] = useState<string[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [modelPickerOpen, setModelPickerOpen] = useState(false);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const providers = useProviders((s) => s.providers);
    const { approvals, questions } = usePendingRequests(chatId);
    const order = useChats((s) => s.byNodeId[chatId]?.order);
    const items = useChats((s) => s.byNodeId[chatId]?.items);

    // The dock shows one request at a time and says how many others are behind it.
    const question = questions[0] ?? null;
    const waiting = approvals.length + questions.length;
    const provider = providers.find((entry) => entry.kind === info.provider);
    // Absent until the daemon answered `provider.list`, so only an explicit false hides anything.
    const capabilities = provider?.capabilities;
    const models: ModelInfo[] = provider?.models ?? [];
    const model = models.find((entry) => entry.slug === info.selection.model);
    const busy = info.activeTurnId !== null;
    const queue = info.queue ?? [];
    const text = draft.text;
    // The CLI announces its session on the first message, so anything before that is still a blank chat.
    const started = info.agentSessionId !== null || info.usage.turns > 0;
    /*
     * A chat that has started keeps its provider (the CLI holds the thread), and one opened for a
     * named CLI was never going to change it. Either way the models stay switchable: the CLI takes
     * the new one on the restart the next send does anyway. With one provider in the list the
     * picker drops its group headers on its own, so it reads as that CLI's own catalog.
     */
    const pickable =
        started || providerFixed
            ? providers.filter((entry) => entry.kind === info.provider)
            : providers.filter((entry) => entry.installed && entry.capabilities.chat);

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
    }, [text, draft.attachments.length]);

    useEffect(() => {
        writeDraft(chatId, draft);
    }, [chatId, draft]);

    useEffect(() => {
        if (!notice) {
            return;
        }
        const timer = setTimeout(() => setNotice(null), NOTICE_MS);
        return () => clearTimeout(timer);
    }, [notice]);

    // Every keystroke inside an `@word` searches again; a slow answer must not overwrite a newer one.
    useEffect(() => {
        if (mention === null) {
            return;
        }
        let stale = false;
        const search = (): void => {
            chatClient
                .searchFiles(info.cwd, mention.query, MENTION_RESULTS)
                .then((result) => {
                    if (!stale) {
                        setSearched(result.files);
                        setMenuIndex(0);
                    }
                })
                .catch(() => undefined);
        };
        // A bare `@` is not a keystroke in a query: it opens the list of what is there, at once.
        if (mention.query === '') {
            search();
            return () => {
                stale = true;
            };
        }
        const timer = setTimeout(search, SEARCH_DEBOUNCE_MS);
        return () => {
            stale = true;
            clearTimeout(timer);
        };
    }, [info.cwd, mention]);

    /* The daemon's skill list, once per chat and again once the CLI announced its own after the first message. */
    useEffect(() => {
        let stale = false;
        chatClient
            .listSkills(chatId)
            .then((found) => {
                if (!stale) {
                    setSkills(found);
                }
            })
            .catch(() => undefined);
        return () => {
            stale = true;
        };
    }, [chatId, info.skills]);

    const history = useMemo(() => {
        const prompts: Array<{ text: string; mentions: string[] }> = [];
        for (const id of order ?? []) {
            const item = items?.[id];
            if (item?.kind === 'user') {
                prompts.push({ text: item.text, mentions: item.mentions ?? [] });
            }
        }
        return prompts;
    }, [order, items]);

    const commandQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).trim().toLowerCase() : null;
    const commands = useMemo(() => {
        if (commandQuery === null) {
            return [];
        }
        const known = new Set(skills.map((skill) => skill.name));
        const own = LOCAL_COMMANDS.map((command) => ({ ...command, local: true, skill: false }));
        const cli = info.slashCommands
            .filter((name) => !LOCAL_COMMANDS.some((command) => command.name === name))
            .map((name) => ({ name, hint: known.has(name) ? 'Skill' : `${provider?.name ?? 'CLI'} command`, local: false, skill: known.has(name) }));
        return [...own, ...cli].filter((command) => command.name.startsWith(commandQuery)).slice(0, 8);
    }, [commandQuery, info.slashCommands, provider?.name, skills]);

    const skillMatches = useMemo(() => {
        if (skillQuery === null) {
            return [];
        }
        const query = skillQuery.query.toLowerCase();
        return skills.filter((skill) => skill.name.toLowerCase().includes(query)).slice(0, 8);
    }, [skillQuery, skills]);

    const commandMenuOpen = commandQuery !== null && commands.length > 0;
    const skillMenuOpen = !commandMenuOpen && skillQuery !== null && skillMatches.length > 0;
    const mentionMenuOpen = !commandMenuOpen && !skillMenuOpen && mention !== null;
    // Results belong to the query that asked for them; a closed picker shows none while the next answer is on its way.
    const files = mention === null ? [] : searched;
    const segments = useMemo(() => tokenizeChips(text, draft.mentions, draft.skills), [text, draft.mentions, draft.skills]);

    const setText = (next: string, mentions = draft.mentions, chosen = draft.skills): void => {
        setDraft((current) => ({ ...current, text: next, mentions, skills: chosen }));
    };

    const configure = (patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode }): void => {
        if (patch.selection) {
            rememberChatSelection(info.provider, patch.selection);
        }
        if (patch.runtimeMode) {
            rememberChatPreferences({ runtimeMode: patch.runtimeMode });
        }
        void chatClient.configure({ chatId, ...patch }).catch(() => undefined);
    };

    /* A model of another CLI re-points the whole chat; one of this CLI's own is a configure. */
    const chooseModel = (provider: AgentKind, slug: string): void => {
        const selection: ModelSelection = { model: slug, options: {} };
        if (provider !== info.provider) {
            rememberChatSelection(provider, selection);
            onRetarget(provider, selection);
            return;
        }
        configure({ selection });
    };

    const runCommand = (name: string): boolean => {
        switch (name) {
            case 'model':
                setModelPickerOpen(true);
                return true;
            case 'compact':
                void chatClient.compact(chatId).catch(() => undefined);
                return true;
            default:
                return false;
        }
    };

    const same = (a: MentionQuery | null, b: MentionQuery | null): boolean => a?.start === b?.start && a?.query === b?.query;

    /* Which picker the caret opens: `@` for a file, `$` for a skill, or neither. */
    const trackTriggers = (el: HTMLTextAreaElement): void => {
        const caret = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
        const skill = caret === null ? null : findSkillQuery(el.value, caret);
        setSkillQuery((current) => (same(current, skill) ? current : skill));
        // A CLI that does not expand `@path` gets the text as it is, so the picker stays out of the way.
        const next = caret === null || capabilities?.mentions === false ? null : findMentionQuery(el.value, caret);
        setMention((current) => (same(current, next) ? current : next));
    };

    const moveCaret = (caret: number): void => {
        const el = inputRef.current;
        if (el) {
            requestAnimationFrame(() => {
                el.focus();
                el.setSelectionRange(caret, caret);
            });
        }
    };

    const chooseMention = (path: string): void => {
        if (!mention) {
            return;
        }
        const result = insertMention(text, mention, path);
        setText(result.text, draft.mentions.includes(path) ? draft.mentions : [...draft.mentions, path]);
        setMention(null);
        moveCaret(result.caret);
    };

    /*
     * A picked skill becomes a `$name` chip in the text and a name on the send, which is what
     * dispatches it. The `/` menu lands here too, so both spellings end up on the same path.
     */
    const chooseSkill = (name: string): void => {
        const result = skillQuery ? insertSkill(text, skillQuery, name) : { text: `$${name} `, caret: name.length + 2 };
        setText(result.text, draft.mentions, draft.skills.includes(name) ? draft.skills : [...draft.skills, name]);
        setSkillQuery(null);
        moveCaret(result.caret);
    };

    /* Paths dragged in from the Files panel. There is no mention query to insert into, so they land
       at the end of the prompt and join the draft's mentions, which is what `chat.send` carries. */
    const addMentions = (paths: string[]): void => {
        const fresh = paths.filter((path) => path !== '');
        if (fresh.length === 0 || capabilities?.mentions === false) {
            return;
        }
        const appended = fresh.map((path) => `@${path}`).join(' ');
        const before = text.replace(/\s+$/, '');
        setText(before === '' ? `${appended} ` : `${before} ${appended} `, [...draft.mentions, ...fresh.filter((path) => !draft.mentions.includes(path))]);
    };

    const addFiles = (incoming: File[]): void => {
        if (incoming.length === 0) {
            return;
        }
        if (capabilities?.attachments === false) {
            setNotice(`${provider?.name ?? 'This agent'} takes no attachments`);
            return;
        }
        const checked = checkAttachmentLimits(
            draft.attachments.length,
            incoming.map((file) => ({ name: file.name, mime: file.type, bytes: file.size, file }))
        );
        if (checked.rejected[0]) {
            setNotice(`${checked.rejected[0].name || 'That file'}: ${checked.rejected[0].reason}`);
        }
        if (checked.accepted.length === 0) {
            return;
        }
        readAttachments(checked.accepted.map((entry) => entry.file))
            .then((attachments) => setDraft((current) => ({ ...current, attachments: [...current.attachments, ...attachments] })))
            .catch(() => setNotice('That file could not be read'));
    };

    const removeAttachment = (index: number): void => {
        setDraft((current) => ({ ...current, attachments: current.attachments.filter((_, i) => i !== index) }));
    };

    const submit = (): void => {
        const trimmed = text.trim();
        if (isEmptyDraft(draft) || disabled) {
            return;
        }
        const chosen = commands[menuIndex];
        if (commandQuery !== null && chosen?.local && runCommand(chosen.name)) {
            setDraft(EMPTY_DRAFT);
            return;
        }
        if (commandQuery !== null && chosen?.skill) {
            chooseSkill(chosen.name);
            return;
        }
        if (commandQuery !== null && chosen && !chosen.local) {
            onSend(`/${chosen.name}`, {});
            setDraft(EMPTY_DRAFT);
            return;
        }
        onSend(trimmed, {
            mentions: presentMentions(trimmed, draft.mentions),
            skills: presentSkills(trimmed, draft.skills),
            attachments: draft.attachments
        });
        setDraft(EMPTY_DRAFT);
        setMention(null);
        setSkillQuery(null);
        setHistoryIndex(null);
    };

    /* A stashed prompt comes back as text, mentions and skills; its files were never kept. */
    const restoreStashed = (prompt: StashedPrompt): void => {
        setDraft((current) => ({ ...current, text: prompt.text, mentions: [...prompt.mentions], skills: [...prompt.skills] }));
        setHistoryIndex(null);
        inputRef.current?.focus();
    };

    /* Cmd+S puts the draft away and clears the box; on an empty box the same key takes the last one back. */
    const toggleStash = (): void => {
        if (isEmptyDraft(draft)) {
            const newest = useStash.getState().prompts[0];
            if (newest) {
                restoreStashed(newest);
            }
            return;
        }
        if (stashDraft(draft)) {
            setDraft(EMPTY_DRAFT);
            setMention(null);
            setSkillQuery(null);
        }
    };

    const recall = (direction: -1 | 1): boolean => {
        if (history.length === 0) {
            return false;
        }
        const next = historyIndex === null ? (direction === -1 ? history.length - 1 : null) : historyIndex + direction;
        if (next === null || next >= history.length) {
            setHistoryIndex(null);
            setText('');
            return true;
        }
        if (next < 0) {
            return true;
        }
        setHistoryIndex(next);
        setText(history[next]!.text, history[next]!.mentions);
        return true;
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
        if (e.key === 'Escape') {
            return;
        }
        e.stopPropagation();
        const el = e.currentTarget;
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
            e.preventDefault();
            toggleStash();
            return;
        }
        if (commandMenuOpen) {
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
                const chosen = commands[menuIndex]!;
                if (chosen.skill) {
                    chooseSkill(chosen.name);
                } else {
                    setText(`/${chosen.name} `);
                }
                return;
            }
        }
        if (skillMenuOpen) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuIndex((i) => (i + 1) % skillMatches.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMenuIndex((i) => (i - 1 + skillMatches.length) % skillMatches.length);
                return;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                chooseSkill((skillMatches[menuIndex] ?? skillMatches[0]!).name);
                return;
            }
        }
        if (mentionMenuOpen && files.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMenuIndex((i) => (i + 1) % files.length);
                return;
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMenuIndex((i) => (i - 1 + files.length) % files.length);
                return;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                e.preventDefault();
                chooseMention(files[menuIndex] ?? files[0]!);
                return;
            }
        }
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
            return;
        }
        // The arrows recall earlier prompts only from an empty box or an unedited recall, on its first or last line.
        const recalled = historyIndex !== null && text === history[historyIndex]?.text;
        const atStart = el.selectionStart === 0 && !text.slice(0, el.selectionStart).includes('\n');
        const atEnd = el.selectionEnd === text.length && !text.slice(el.selectionEnd).includes('\n');
        if (e.key === 'ArrowUp' && (text === '' || (recalled && atStart)) && recall(-1)) {
            e.preventDefault();
        } else if (e.key === 'ArrowDown' && recalled && atEnd && recall(1)) {
            e.preventDefault();
        }
    };

    const placeholder = disabled ? 'Not connected to the Ruimte server' : 'Ask anything, / for commands, @ for files, $ for skills';

    return (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10">
            <div
                className={clsx('chat-composer pointer-events-auto flex flex-col', dragging && 'chat-composer-drop')}
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes(MENTION_DRAG_TYPE)) {
                        e.preventDefault();
                        e.stopPropagation();
                        setDragging(true);
                    }
                }}
                onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                        setDragging(false);
                    }
                }}
                onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragging(false);
                    addMentions(e.dataTransfer.getData(MENTION_DRAG_TYPE).split(' '));
                    addFiles(filesOf(e.dataTransfer));
                    inputRef.current?.focus();
                }}
            >
                {question && <QuestionDock chatId={chatId} item={question} more={waiting - 1} focused={focused} />}
                {!question && approvals[0] && (
                    <ApprovalDock chatId={chatId} item={approvals[0]} more={waiting - 1} denyReason={capabilities?.denyReason === true} focused={focused} />
                )}
                {commandMenuOpen && (
                    <div className="border-b border-border px-1.5 py-1.5">
                        {commands.map((command, index) => (
                            <button
                                key={command.name}
                                className={clsx(
                                    'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
                                    index === menuIndex ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                )}
                                onMouseEnter={() => setMenuIndex(index)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                    setMenuIndex(index);
                                    if (command.skill) {
                                        chooseSkill(command.name);
                                        return;
                                    }
                                    setText(`/${command.name}`);
                                    inputRef.current?.focus();
                                }}
                            >
                                {command.skill && <Icon icon={Zap} size={12} className="shrink-0 text-skill" />}
                                <span className="font-mono text-text">/{command.name}</span>
                                <span className="text-text-faint">{command.hint}</span>
                            </button>
                        ))}
                    </div>
                )}
                {skillMenuOpen && (
                    <div className="border-b border-border px-1.5 py-1.5">
                        {skillMatches.map((skill, index) => (
                            <button
                                key={skill.name}
                                className={clsx(
                                    'flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs',
                                    index === menuIndex ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                )}
                                onMouseEnter={() => setMenuIndex(index)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => chooseSkill(skill.name)}
                            >
                                <Icon icon={Zap} size={12} className="mt-0.5 shrink-0 text-skill" />
                                <span className="flex min-w-0 flex-col">
                                    <span className="truncate font-mono text-text">${skill.name}</span>
                                    {skill.description !== '' && <span className="line-clamp-1 text-text-faint">{skill.description}</span>}
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {mentionMenuOpen && (
                    <div className="border-b border-border px-1.5 py-1.5">
                        {mention.query === '' && files.length > 0 && <div className="menu-label">Files in this folder</div>}
                        {files.length === 0 && <div className="px-2 py-1 text-xs text-text-faint">{mention.query ? 'No files match' : 'No files here'}</div>}
                        {files.map((path, index) => {
                            const { name, dir } = splitPath(path);
                            return (
                                <button
                                    key={path}
                                    className={clsx(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs',
                                        index === menuIndex ? 'bg-surface-sunken text-text' : 'text-text-muted'
                                    )}
                                    onMouseEnter={() => setMenuIndex(index)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => chooseMention(path)}
                                >
                                    <FileIcon path={path} size={14} />
                                    <span className="truncate font-mono text-text">{name}</span>
                                    {dir && <span className="min-w-0 truncate text-text-faint">{dir}</span>}
                                </button>
                            );
                        })}
                    </div>
                )}
                {queue.length > 0 && (
                    <div className="flex flex-col gap-1 border-b border-border px-2 py-1.5">
                        {queue.map((message) => (
                            <div key={message.id} className="group/queued flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-text-muted">
                                <Icon icon={Clock} size={12} className="shrink-0 text-text-faint" />
                                <span className="min-w-0 grow truncate">{message.text || `${message.attachments?.length ?? 0} attachments`}</span>
                                <span className="btn-group opacity-0 transition-opacity group-hover/queued:opacity-100 focus-within:opacity-100">
                                    <Tooltip label="Send now" name>
                                        <button
                                            className="icon-btn h-5 w-5 rounded"
                                            onClick={() => void chatClient.sendNow(chatId, message.id).catch(() => undefined)}
                                        >
                                            <Icon icon={FastForward} size={12} />
                                        </button>
                                    </Tooltip>
                                    <Tooltip label="Remove" name>
                                        <button
                                            className="icon-btn h-5 w-5 rounded"
                                            onClick={() => void chatClient.unqueue(chatId, message.id).catch(() => undefined)}
                                        >
                                            <Icon icon={X} size={12} />
                                        </button>
                                    </Tooltip>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
                {draft.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pt-3">
                        {draft.attachments.map((attachment, index) => (
                            <div key={`${attachment.name}-${index}`} className="group/thumb relative">
                                {isImageAttachment(attachment.mime) ? (
                                    <img
                                        src={uploadPreviewUrl(attachment)}
                                        alt={attachment.name}
                                        className="h-14 w-14 rounded-lg border border-border object-cover"
                                    />
                                ) : (
                                    <span className="flex h-14 w-36 flex-col justify-center gap-0.5 rounded-lg border border-border bg-surface-sunken px-2.5">
                                        <span className="flex items-center gap-1.5 text-xs text-text">
                                            <Icon icon={Paperclip} size={12} className="shrink-0 text-text-faint" />
                                            <span className="truncate">{attachment.name}</span>
                                        </span>
                                        <span className="pl-5 text-xs text-text-faint">{formatBytes(uploadBytes(attachment))}</span>
                                    </span>
                                )}
                                <Tooltip label={`Remove ${attachment.name}`}>
                                    <button
                                        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-surface-raised text-text-muted opacity-0 transition-opacity hover:text-text group-hover/thumb:opacity-100 focus-visible:opacity-100"
                                        onClick={() => removeAttachment(index)}
                                    >
                                        <Icon icon={X} size={12} />
                                    </button>
                                </Tooltip>
                            </div>
                        ))}
                    </div>
                )}
                <div className="relative">
                    <div ref={backdropRef} aria-hidden className={clsx(INPUT_CLASS, 'pointer-events-none absolute inset-0 overflow-hidden text-text')}>
                        {segments.map((segment, index) => {
                            if (segment.kind === 'mention') {
                                return (
                                    <span key={index} className="mention-chip">
                                        @{segment.path}
                                    </span>
                                );
                            }
                            if (segment.kind === 'skill') {
                                return (
                                    <span key={index} className="skill-chip">
                                        ${segment.name}
                                    </span>
                                );
                            }
                            return <span key={index}>{segment.text}</span>;
                        })}
                        {text.endsWith('\n') && <br />}
                    </div>
                    <textarea
                        ref={inputRef}
                        rows={1}
                        placeholder={placeholder}
                        className={clsx(
                            INPUT_CLASS,
                            'relative resize-none bg-transparent text-transparent caret-text outline-none placeholder:text-text-faint'
                        )}
                        value={text}
                        disabled={disabled}
                        tabIndex={focused ? 0 : -1}
                        onChange={(e) => {
                            setText(e.target.value);
                            setMenuIndex(0);
                            trackTriggers(e.target);
                            if (historyIndex !== null && e.target.value !== history[historyIndex]?.text) {
                                setHistoryIndex(null);
                            }
                        }}
                        onSelect={(e) => trackTriggers(e.currentTarget)}
                        onBlur={() => {
                            setMention(null);
                            setSkillQuery(null);
                        }}
                        onScroll={(e) => {
                            if (backdropRef.current) {
                                backdropRef.current.scrollTop = e.currentTarget.scrollTop;
                            }
                        }}
                        onPaste={(e) => {
                            const pasted = filesOf(e.clipboardData);
                            if (pasted.length > 0) {
                                e.preventDefault();
                                addFiles(pasted);
                            }
                        }}
                        onKeyDown={onKeyDown}
                    />
                </div>
                {notice && <div className="px-3.5 pb-1 text-xs text-status-error">{notice}</div>}
                <div className="flex items-center gap-1 px-2 pb-2">
                    <ModelPicker
                        providers={pickable}
                        provider={info.provider}
                        selection={info.selection}
                        open={modelPickerOpen}
                        onOpenChange={setModelPickerOpen}
                        onChange={chooseModel}
                    />
                    <OptionsPicker
                        model={model}
                        selection={info.selection}
                        onChange={(id, value) => configure({ selection: { ...info.selection, options: { ...info.selection.options, [id]: value } } })}
                    />
                    <ModePicker runtimeMode={info.runtimeMode} onChange={(runtimeMode) => configure({ runtimeMode })} />
                    <StashPicker onRestore={restoreStashed} />
                    <span className="grow" />
                    <ContextMeter usage={info.usage} disabled={busy || disabled} onCompact={() => void chatClient.compact(chatId).catch(() => undefined)} />
                    {busy && (
                        <Tooltip label="Stop" name>
                            <button
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-status-error text-accent-text"
                                onClick={() => void chatClient.cancel(chatId).catch(() => undefined)}
                            >
                                <Icon icon={Square} size={16} />
                            </button>
                        </Tooltip>
                    )}
                    {/* While a turn runs the same button queues the message instead of sending it. */}
                    {(!busy || !isEmptyDraft(draft)) && (
                        <Tooltip label={busy ? 'Queue' : 'Send'} kbd="↵" name>
                            <button
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-text disabled:opacity-40"
                                disabled={isEmptyDraft(draft) || disabled}
                                onClick={submit}
                            >
                                <Icon icon={ArrowUp} size={16} />
                            </button>
                        </Tooltip>
                    )}
                </div>
            </div>
        </div>
    );
}
