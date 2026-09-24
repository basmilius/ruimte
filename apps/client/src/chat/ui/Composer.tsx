import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { indentLess, indentMore, insertNewline } from '@codemirror/commands';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import clsx from 'clsx';
import { ArrowUp, ChevronDown, Clock, Copy, FastForward, Paperclip, Pencil, Plus, Square, SquareSlash, X, Zap } from 'lucide-react';
import { ActionRefusal } from '@ruimte/actions';
import type {
    AgentKind,
    ChatApprovalItem,
    ChatAttachmentUpload,
    ChatInfo,
    ChatItem,
    ChatQueuedMessage,
    ChatQuestionItem,
    ChatSkill,
    ModelInfo,
    ModelSelection,
    RuntimeMode
} from '@ruimte/contracts';
import { performAsPerson } from '@/actions/client-actions';
import { askBeforeStoppingSubagents } from '@/agents/end-children';
import { chatClient, type ChatSendExtras } from '@/chat';
import { checkAttachmentLimits, filesOf, formatBytes, isImageAttachment, readAttachments, readStoredAttachments, uploadBytes } from '@/chat/attachments';
import { EMPTY_DRAFT, isEmptyDraft, joinDraftText, readDraft, takeBackIntoDraft, takeDraftOffers, writeDraft, type ChatDraft } from '@/chat/drafts';
import {
    MENTION_DRAG_TYPE,
    findMentionQuery,
    findSkillQuery,
    insertMention,
    insertSkill,
    presentMentions,
    presentSkills,
    type MentionQuery,
    type TextRange
} from '@/chat/mentions';
import { RESUME_COMPACTION_TOKENS, resumeCompactionOffer } from '@/chat/logic/resume-compaction';
import { dismissResumeCompaction, useResumeCompactionDismissal } from '@/chat/resume-compaction-dismissals';
import { composerStopLabel, composerStopOf } from '@/chat/subagent-list';
import { PROMPT_MAX_CHARS, pasteBecomesAttachment, pastedTextName, promptGuard, usableSlashCommands } from '@/chat/guards';
import { withQuote } from '@/chat/quote';
import { rememberChatPreferences, rememberChatSelection } from '@/chat/preferences';
import { STASH_SHORTCUT, stashDraft, type StashedPrompt, useStash } from '@/chat/stash';
import { pageTimeline, scrollTimelineToEnd, subscribeTimelineEnd, timelineAtEnd } from '@/chat/timeline-scroll';
import { ChatActivity } from '@/chat/ui/ChatActivity';
import { chipDecorations } from '@/chat/ui/composer/chips';
import { enterAction, inCode, inFenceBody, inOpenFence, listItemAt, recallDirection, tabSpaces } from '@/chat/ui/composer/keys';
import { ComposerInput, type ComposerInputHandle } from '@/chat/ui/ComposerInput';
import { PromptComposer } from '@/chat/ui/PromptComposer';
import { QuoteTakerContext } from '@/chat/ui/quote-selection';
import { ResumeCompactionDock } from '@/chat/ui/ResumeCompactionDock';
import { PROMPTS_IN_NODES } from '@/prompts/placement';
import { StashPicker } from '@/chat/ui/Pickers';
import { RunSettings } from '@/chat/ui/RunSettings';
import { UploadThumb } from '@/chat/ui/UploadThumb';
import { isApplePlatform } from '@/desktop/bridge';
import { formatNumber } from '@/format/number';
import { useChatRow } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useProviders } from '@/state/providers';
import { useToasts } from '@/state/toasts';
import { isShellShortcut } from '@/terminal/keymap';
import { transportFor } from '@/transport';
import { BTN_GROUP, FLOAT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { copyText } from '@/ui/clipboard';
import { Tooltip } from '@/ui/Tooltip';
import { FileIcon } from '@/ui/FileIcon';
import { Icon } from '@/ui/Icon';
import { PromptDialog } from '@/ui/PromptDialog';
import { KEY_SHORTCUTS, isModHeld, matchesShortcut } from '@/ui/shortcut';
import { useNow } from '@/ui/useNow';

const SEARCH_DEBOUNCE_MS = 80;
// What fits above the composer without turning the picker into a file tree.
const MENTION_RESULTS = 8;
const NOTICE_MS = 4000;
// How many sent prompts the arrow keys walk back through, per chat.
const PROMPT_HISTORY = 50;

// Commands the composer handles itself; the CLI's own ones are sent through as text.
const LOCAL_COMMANDS = ['model', 'compact', 'clear'];

/* Files and paths dropped on the card become attachments and chips there. CodeMirror would paste a
   file's text, or the drag's own text, at the drop point on top of that. */
const LEAVE_DROPS_TO_THE_CARD = EditorView.domEventHandlers({
    drop: (event) => event.dataTransfer !== null && (event.dataTransfer.types.includes('Files') || event.dataTransfer.types.includes(MENTION_DRAG_TYPE))
});

interface ComposerProps {
    chatId: string;
    info: ChatInfo;
    focused: boolean;
    /* On a canvas, whose prompt stack may be where this chat's prompts are answered. */
    onCanvas: boolean;
    disabled: boolean;
    /* Opened for one CLI from a menu. The model is the remembered one and there is nothing to pick. */
    providerFixed: boolean;
    onSend(text: string, extras: ChatSendExtras): void;
    /* Another provider's model was picked before the first message; the node has to follow. */
    onRetarget(provider: AgentKind, selection: ModelSelection): void;
}

const usePendingRequests = (chatId: string) => {
    // The structure, which a delta leaves alone. The prompts and the requests are items of their own.
    const items = useChatRow(chatId, (row) => row?.structure);
    const order = useChatRow(chatId, (row) => row?.order);
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

/* The empty box names its sigils as key caps, so they read as keys to press rather than as punctuation. */
const hintedPlaceholder = (lead: string, joiner: string, hints: ReadonlyArray<{ key: string; label: string }>): HTMLElement => {
    const root = document.createElement('span');
    root.className = 'composer-hints';
    const extra = document.createElement('span');
    extra.className = 'composer-hints-extra';
    extra.append(joiner);
    for (const hint of hints) {
        const cap = document.createElement('kbd');
        cap.textContent = hint.key;
        extra.append(cap, hint.label);
    }
    root.append(lead, extra);
    return root;
};

const splitPath = (path: string): { name: string; dir: string } => {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? { name: path, dir: '' } : { name: path.slice(slash + 1), dir: path.slice(0, slash) };
};

// Keep the editor mounted while a pending request takes over, so its selection and draft survive.
export function Composer({ chatId, info, focused, onCanvas, disabled, providerFixed, onSend, onRetarget }: ComposerProps) {
    const { t } = useTranslation('chat');
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
    const [confirmClear, setConfirmClear] = useState(false);
    const [takingBack, setTakingBack] = useState<string | null>(null);
    const endpointId = useEndpointId();
    const registerQuoteTaker = useContext(QuoteTakerContext);
    const inputRef = useRef<ComposerInputHandle>(null);
    // Taking a queued message back waits on the machine, and what was typed meanwhile is what it merges with.
    const draftRef = useRef(draft);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [dictationToolbar, setDictationToolbar] = useState<HTMLDivElement | null>(null);
    // A paste event says nothing about the keys behind it, so the key that asked for text inline is remembered here.
    const pasteInlineRef = useRef(false);
    const providers = useProviders((s) => s.providers);
    const { approvals, questions } = usePendingRequests(chatId);
    const order = useChatRow(chatId, (row) => row?.order);
    // The structure, which a delta leaves alone. The prompts and the requests are items of their own.
    const items = useChatRow(chatId, (row) => row?.structure);

    const pending = useMemo(() => [...approvals, ...questions], [approvals, questions]);
    const provider = providers.find((entry) => entry.kind === info.provider);
    // Absent until the daemon answered `provider.list`, so only an explicit false hides anything.
    const capabilities = provider?.capabilities;
    const compaction = capabilities?.compaction;
    const dismissedTurnId = useResumeCompactionDismissal(chatId);
    /* The cheap half of the offer, so a chat that can never make one keeps no timer. */
    const couldOfferCompaction = compaction !== undefined && compaction !== 'none' && info.usage.contextTokens >= RESUME_COMPACTION_TOKENS;
    const now = useNow(60_000, couldOfferCompaction);
    const compactionOffer = !couldOfferCompaction
        ? null
        : resumeCompactionOffer({
              info,
              compaction,
              items: (order ?? []).map((id) => items?.[id]).filter((item): item is ChatItem => item !== undefined),
              dismissedTurnId,
              now
          });
    const models: ModelInfo[] = provider?.models ?? [];
    const model = models.find((entry) => entry.slug === info.selection.model);
    const busy = info.activeTurnId !== null;
    const queue = info.queue ?? [];
    const text = draft.text;
    const quote = draft.quote;
    // The CLI announces its session on the first message, so anything before that is still a blank chat.
    const started = info.agentSessionId !== null || info.usage.turns > 0;
    /*
     * A chat that has started keeps its provider (the CLI holds the thread), and one opened for a
     * named CLI was never going to change it. Either way the models stay switchable. The CLI takes
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
        draftRef.current = draft;
        writeDraft(chatId, draft);
    }, [chatId, draft]);

    useEffect(
        () =>
            takeDraftOffers(chatId, (offered) => {
                setDraft((current) => ({ ...current, text: joinDraftText(current.text, offered) }));
                inputRef.current?.focus();
            }),
        [chatId]
    );

    useEffect(
        () =>
            registerQuoteTaker?.((selected) => {
                setDraft((current) => ({ ...current, quote: selected }));
                inputRef.current?.focus();
            }),
        [registerQuoteTaker]
    );

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
        // A bare `@` is not a keystroke in a query. It opens the list of what is there, at once.
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
        // Walking back further than this is faster with the timeline than with the arrow key.
        return prompts.slice(-PROMPT_HISTORY);
    }, [order, items]);

    const commandQuery = text.startsWith('/') && !text.includes('\n') ? text.slice(1).trim().toLowerCase() : null;
    const commands = useMemo(() => {
        if (commandQuery === null) {
            return [];
        }
        const known = new Set(skills.map((skill) => skill.name));
        const own = LOCAL_COMMANDS.map((name) => ({ name, hint: t(`composer.commands.${name}`), local: true, skill: false }));
        const cli = usableSlashCommands(info.slashCommands)
            .filter((name) => !LOCAL_COMMANDS.includes(name))
            .map((name) => ({
                name,
                hint: known.has(name) ? t('composer.commands.skill') : t('composer.commands.cli', { cli: provider?.name ?? t('composer.commands.anyCli') }),
                local: false,
                skill: known.has(name)
            }));
        return [...own, ...cli].filter((command) => command.name.startsWith(commandQuery)).slice(0, 8);
    }, [commandQuery, info.slashCommands, provider?.name, skills, t]);

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
    const editorExtensions = useMemo(
        () => [chipDecorations({ mentions: draft.mentions, skills: draft.skills }), LEAVE_DROPS_TO_THE_CARD],
        [draft.mentions, draft.skills]
    );
    const guard = promptGuard(withQuote(quote, text));

    const setText = (next: string, mentions = draft.mentions, chosen = draft.skills): void => {
        setDraft((current) => ({ ...current, text: next, mentions, skills: chosen }));
    };

    const clearDraft = (): void => {
        setDraft(EMPTY_DRAFT);
    };

    const removeQuote = (): void => {
        setDraft((current) => ({ ...current, quote: '' }));
        inputRef.current?.focus();
    };

    const configure = (patch: { selection?: ModelSelection; runtimeMode?: RuntimeMode }): void => {
        if (patch.selection) {
            rememberChatSelection(info.provider, patch.selection);
        }
        if (patch.runtimeMode) {
            rememberChatPreferences({ runtimeMode: patch.runtimeMode });
        }
        void performAsPerson('chat.configure', {
            chatId,
            model: null,
            option: null,
            selection: patch.selection ?? null,
            runtimeMode: patch.runtimeMode ?? null
        }).catch(() => undefined);
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

    const stop = (shiftKey: boolean): void => {
        if (composerStopOf(shiftKey) === 'turn') {
            void performAsPerson('chat.stopTurn', { chatId, subagents: false }).catch(() => undefined);
            return;
        }
        void askBeforeStoppingSubagents(
            transportFor(endpointId),
            chatId,
            () => void performAsPerson('chat.stopTurn', { chatId, subagents: true }).catch(() => undefined)
        );
    };

    /* The daemon decides whether a turn is in the way; only its refusal asks the person first. */
    const clearThread = async (): Promise<void> => {
        try {
            await performAsPerson('chat.clear', { chatId, force: false });
        } catch (e) {
            if (e instanceof ActionRefusal && e.code === 'chat-busy') {
                setConfirmClear(true);
                return;
            }
            setNotice(t('composer.notice.clearFailed'));
        }
    };

    const forceClearThread = async (): Promise<void> => {
        await performAsPerson('chat.clear', { chatId, force: true });
        setConfirmClear(false);
    };

    const compact = (): void => {
        void performAsPerson('chat.compact', { chatId }).catch(() => setNotice(t('composer.notice.compactFailed')));
    };

    const runCommand = (name: string): boolean => {
        switch (name) {
            case 'model':
                setModelPickerOpen(true);
                return true;
            case 'compact':
                void performAsPerson('chat.compact', { chatId }).catch(() => undefined);
                return true;
            case 'clear':
                void clearThread();
                return true;
            default:
                return false;
        }
    };

    const same = (a: MentionQuery | null, b: MentionQuery | null): boolean => a?.start === b?.start && a?.query === b?.query;

    /* Which picker the caret opens: `@` for a file, `$` for a skill, or neither. In code a sigil is just text. */
    const trackTriggers = (value: string, selection: TextRange, state: EditorState): void => {
        const empty = selection.from === selection.to;
        const tree = empty ? (ensureSyntaxTree(state, selection.from, 50) ?? syntaxTree(state)) : null;
        const caret = tree !== null && !inCode(tree, value, selection.from) ? selection.from : null;
        const skill = caret === null ? null : findSkillQuery(value, caret);
        setSkillQuery((current) => (same(current, skill) ? current : skill));
        // A CLI that does not expand `@path` gets the text as it is, so the picker stays out of the way.
        const next = caret === null || capabilities?.mentions === false ? null : findMentionQuery(value, caret);
        setMention((current) => (same(current, next) ? current : next));
    };

    // The inserted text reaches the editor with the render it causes, so the caret waits a frame for it.
    const moveCaret = (caret: number): void => {
        requestAnimationFrame(() => inputRef.current?.setCaret(caret));
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
            setNotice(t('composer.notice.noAttachments', { agent: provider?.name ?? t('composer.notice.thisAgent') }));
            return;
        }
        const checked = checkAttachmentLimits(
            draft.attachments.length,
            incoming.map((file) => ({ name: file.name, mime: file.type, bytes: file.size, file })),
            draft.attachments.reduce((bytes, attachment) => bytes + uploadBytes(attachment), 0)
        );
        if (checked.rejected[0]) {
            setNotice(t('composer.notice.rejected', { name: checked.rejected[0].name || t('composer.notice.thatFile'), reason: checked.rejected[0].reason }));
        }
        if (checked.accepted.length === 0) {
            return;
        }
        readAttachments(checked.accepted.map((entry) => entry.file))
            .then((attachments) => setDraft((current) => ({ ...current, attachments: [...current.attachments, ...attachments] })))
            .catch(() => setNotice(t('composer.notice.unreadable')));
    };

    const removeAttachment = (index: number): void => {
        setDraft((current) => ({ ...current, attachments: current.attachments.filter((_, i) => i !== index) }));
    };

    const submit = (): void => {
        const trimmed = text.trim();
        if (isEmptyDraft(draft) || disabled || guard.tooLong) {
            return;
        }
        // Recheck restored drafts and files that finished reading concurrently.
        const rejected = checkAttachmentLimits(
            0,
            draft.attachments.map((attachment) => ({ ...attachment, bytes: uploadBytes(attachment) }))
        ).rejected[0];
        if (rejected) {
            setNotice(`${rejected.name}: ${rejected.reason}`);
            return;
        }
        const chosen = commands[menuIndex];
        if (commandQuery !== null && chosen?.local && runCommand(chosen.name)) {
            clearDraft();
            return;
        }
        if (commandQuery !== null && chosen?.skill) {
            chooseSkill(chosen.name);
            return;
        }
        if (commandQuery !== null && chosen && !chosen.local) {
            onSend(`/${chosen.name}`, {});
            clearDraft();
            return;
        }
        onSend(withQuote(quote, trimmed), {
            mentions: presentMentions(trimmed, draft.mentions),
            skills: presentSkills(trimmed, draft.skills),
            attachments: draft.attachments
        });
        clearDraft();
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

    /*
     * The files come back from the machine before the message leaves the queue, since the machine only
     * serves a file some message still holds. The machine's refusal is what says it already went out.
     */
    const takeBack = async (message: ChatQueuedMessage): Promise<void> => {
        if (takingBack !== null) {
            return;
        }
        const failed = (e: unknown): void => {
            useToasts.getState().show({ kind: 'error', title: t('composer.queue.editFailed'), description: e instanceof Error ? e.message : String(e) });
        };
        const readFiles = async (): Promise<ChatAttachmentUpload[]> => {
            const stored = message.attachments ?? [];
            const transport = transportFor(endpointId);
            if (stored.length === 0) {
                return [];
            }
            if (transport === null) {
                throw new Error(t('composer.placeholder.disconnected'));
            }
            return readStoredAttachments((piece) => transport.request('bytes.read', piece), chatId, stored);
        };
        setTakingBack(message.id);
        try {
            let uploads: ChatAttachmentUpload[];
            try {
                uploads = await readFiles();
            } catch (e) {
                failed(e);
                return;
            }
            const taken: Omit<ChatDraft, 'quote'> = {
                text: message.text,
                mentions: message.mentions ?? [],
                skills: message.skills ?? [],
                attachments: uploads
            };
            // A file that would not fit is refused here, while the message still holds it on the machine.
            const wouldReject = takeBackIntoDraft(draftRef.current, taken).rejected[0];
            if (wouldReject) {
                setNotice(t('composer.notice.queuedDoesNotFit', { name: wouldReject.name || t('composer.notice.thatFile'), reason: wouldReject.reason }));
                return;
            }
            try {
                await performAsPerson('chat.unqueue', { chatId, messageId: message.id });
            } catch (e) {
                if (e instanceof ActionRefusal && e.code === 'request-not-found') {
                    useToasts.getState().show({ kind: 'error', title: t('composer.queue.alreadySent') });
                } else {
                    failed(e);
                }
                return;
            }
            const merged = takeBackIntoDraft(draftRef.current, taken);
            setDraft(merged.draft);
            if (merged.rejected[0]) {
                setNotice(t('composer.notice.rejected', { name: merged.rejected[0].name, reason: merged.rejected[0].reason }));
            }
            setHistoryIndex(null);
            inputRef.current?.focus();
        } finally {
            setTakingBack(null);
        }
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
            clearDraft();
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
            setText('', [], []);
            return true;
        }
        if (next < 0) {
            return true;
        }
        setHistoryIndex(next);
        setText(history[next]!.text, history[next]!.mentions);
        return true;
    };

    /* Runs before the editor's own keymap; true means the key is handled and its default prevented. */
    const onKeyDown = (e: KeyboardEvent, view: EditorView): boolean => {
        // Shift with the paste shortcut pastes a large text inline after all; any other key forgets it.
        pasteInlineRef.current = e.shiftKey && e.key.toLowerCase() === 'v' && (isApplePlatform() ? e.metaKey : e.ctrlKey);
        // Escape leaves the node, unless it first has a recalled prompt to put back.
        if (e.key === 'Escape' && !e.isComposing) {
            if (historyIndex === null) {
                return false;
            }
            e.stopPropagation();
            setHistoryIndex(null);
            setText('', [], []);
            return true;
        }
        // The composer keeps the keyboard while you type, but the shortcuts that move between views,
        // panels and the palette stay the app's, untouched: Mod+Shift+Enter would otherwise send as well.
        if (isShellShortcut(e, isApplePlatform())) {
            return false;
        }
        e.stopPropagation();
        // A key inside an IME composition belongs to the composition, Enter and the arrows included.
        if (e.isComposing) {
            return false;
        }
        // Reading back through a long answer should not mean leaving the box you are typing in.
        if (e.key === 'PageUp' || e.key === 'PageDown') {
            return pageTimeline(chatId, e.key === 'PageUp' ? -1 : 1);
        }
        if (matchesShortcut(STASH_SHORTCUT, e, isApplePlatform())) {
            toggleStash();
            return true;
        }
        if (commandMenuOpen) {
            if (e.key === 'ArrowDown') {
                setMenuIndex((i) => (i + 1) % commands.length);
                return true;
            }
            if (e.key === 'ArrowUp') {
                setMenuIndex((i) => (i - 1 + commands.length) % commands.length);
                return true;
            }
            if (e.key === 'Tab') {
                const chosen = commands[menuIndex]!;
                if (chosen.skill) {
                    chooseSkill(chosen.name);
                } else {
                    setText(`/${chosen.name} `);
                }
                return true;
            }
        }
        if (skillMenuOpen) {
            if (e.key === 'ArrowDown') {
                setMenuIndex((i) => (i + 1) % skillMatches.length);
                return true;
            }
            if (e.key === 'ArrowUp') {
                setMenuIndex((i) => (i - 1 + skillMatches.length) % skillMatches.length);
                return true;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                chooseSkill((skillMatches[menuIndex] ?? skillMatches[0]!).name);
                return true;
            }
        }
        if (mentionMenuOpen && files.length > 0) {
            if (e.key === 'ArrowDown') {
                setMenuIndex((i) => (i + 1) % files.length);
                return true;
            }
            if (e.key === 'ArrowUp') {
                setMenuIndex((i) => (i - 1 + files.length) % files.length);
                return true;
            }
            if (e.key === 'Tab' || e.key === 'Enter') {
                chooseMention(files[menuIndex] ?? files[0]!);
                return true;
            }
        }
        // In a fence Tab indents like a code editor; anywhere else it keeps moving the focus.
        if (e.key === 'Tab' && !e.altKey && !e.metaKey && !e.ctrlKey) {
            const { state } = view;
            const { from, to, head } = state.selection.main;
            const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
            if (inFenceBody(tree, state.doc.toString(), head)) {
                // Handled even when there is nothing to outdent, so Shift+Tab never throws the focus out of a block.
                if (e.shiftKey) {
                    indentLess(view);
                } else if (from !== to) {
                    indentMore(view);
                } else {
                    view.dispatch(state.replaceSelection(tabSpaces(head - state.doc.lineAt(head).from)), { scrollIntoView: true, userEvent: 'input' });
                }
                return true;
            }
        }
        if (e.key === 'Enter') {
            const { state } = view;
            const { from, to, head } = state.selection.main;
            // Parsed to the end, since the fence that closes the block can sit after the caret.
            const tree = ensureSyntaxTree(state, state.doc.length, 50) ?? syntaxTree(state);
            const line = state.doc.lineAt(head);
            const list = from === to && !inCode(tree, state.doc.toString(), head) ? listItemAt(line.text) : null;
            const action = enterAction(
                { shift: e.shiftKey, mod: isModHeld(e, isApplePlatform()) },
                { inOpenFence: inOpenFence(tree, head), list, column: head - line.from }
            );
            if (action === 'newline') {
                return insertNewline(view);
            }
            if (action === 'continue-list' && list) {
                view.dispatch({
                    changes: { from: head, insert: `\n${list.next}` },
                    selection: { anchor: head + 1 + list.next.length },
                    scrollIntoView: true,
                    userEvent: 'input'
                });
                return true;
            }
            if (action === 'leave-list') {
                view.dispatch({ changes: { from: line.from, to: line.to }, selection: { anchor: line.from }, userEvent: 'delete' });
                return true;
            }
            submit();
            return true;
        }
        const { from, to } = view.state.selection.main;
        const recalled = historyIndex !== null && text === history[historyIndex]?.text;
        const direction = recallDirection({ key: e.key, text, from, to, recalled });
        return direction !== null && recall(direction);
    };

    /* Files become attachments and a long text a file of its own; anything else the editor pastes as plain text. */
    const onPaste = (e: ClipboardEvent, view: EditorView): boolean => {
        const data = e.clipboardData;
        if (!data) {
            return false;
        }
        const pasted = filesOf(data);
        if (pasted.length > 0) {
            addFiles(pasted);
            return true;
        }
        const inline = pasteInlineRef.current;
        pasteInlineRef.current = false;
        const clip = data.getData('text/plain');
        // Without attachments there is nowhere else for the text to go, so it pastes as it always did.
        if (inline || capabilities?.attachments === false || !pasteBecomesAttachment(clip)) {
            return false;
        }
        // The paste still replaces what was selected; it just puts nothing in its place.
        const { from, to } = view.state.selection.main;
        if (from !== to) {
            view.dispatch({ changes: { from, to }, userEvent: 'delete' });
        }
        const name = pastedTextName(draft.attachments.map((attachment) => attachment.name));
        addFiles([new File([clip], name, { type: 'text/plain' })]);
        return true;
    };

    /* The timeline owns the scroller; this is the one bit of it the composer needs to know. */
    const atEnd = useSyncExternalStore(
        subscribeTimelineEnd,
        () => timelineAtEnd(chatId),
        () => true
    );

    const mentionable = capabilities?.mentions !== false;
    const hasSkills = skills.length > 0;
    const placeholder = useMemo(() => {
        if (disabled) {
            return t('composer.placeholder.disconnected');
        }
        return hintedPlaceholder(t('composer.placeholder.lead'), t('composer.placeholder.joiner'), [
            { key: '/', label: t('composer.placeholder.commands') },
            ...(mentionable ? [{ key: '@', label: t('composer.placeholder.files') }] : []),
            ...(hasSkills ? [{ key: '$', label: t('composer.placeholder.skills') }] : [])
        ]);
    }, [disabled, mentionable, hasSkills, t]);
    const attachable = capabilities?.attachments !== false;

    return (
        <div className="chat-composer-content pointer-events-none relative z-10 w-full">
            {/* Only while there is something below the fold. It sits over the composer rather than
                in the thread, because the composer is the one thing whose height it always clears. */}
            {!atEnd && (
                <div className="absolute inset-x-0 bottom-full mb-2 flex justify-center">
                    <Tooltip label={t('composer.jumpToEnd')} name>
                        <button
                            className={`${FLOAT} pointer-events-auto grid h-8 w-8 place-items-center rounded-full text-text-muted hover:text-text`}
                            onClick={() => scrollTimelineToEnd(chatId)}
                        >
                            <Icon icon={ChevronDown} size={16} />
                        </button>
                    </Tooltip>
                </div>
            )}
            <ChatActivity chatId={chatId} />
            <div
                className={clsx(
                    '@container/composer pointer-events-auto flex flex-col overflow-hidden rounded-2xl border shadow-float backdrop-blur-[14px] focus-ring-within',
                    dragging
                        ? 'border-accent bg-[color-mix(in_srgb,var(--accent-soft)_60%,var(--surface-raised))]'
                        : 'border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)]'
                )}
                /* The whole card takes a dropped file as a mention, so the grid leaves it alone
                   instead of offering a split over it (`shell/SplitGrid.tsx`). */
                data-takes-drop="all"
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
                <PromptComposer
                    chatId={chatId}
                    pending={pending}
                    focused={focused}
                    elsewhere={onCanvas && !PROMPTS_IN_NODES}
                    disabled={disabled}
                    hasDraft={!isEmptyDraft(draft)}
                    denyReason={capabilities?.denyReason === true}
                    onAllAnswered={() => inputRef.current?.focus()}
                >
                    {compactionOffer && (
                        <ResumeCompactionDock
                            tokens={compactionOffer.tokens}
                            onCompact={compact}
                            onDismiss={() => dismissResumeCompaction(endpointId, chatId, compactionOffer.turnId)}
                        />
                    )}
                    {commandMenuOpen && (
                        <div className="border-b border-border px-1.5 py-1.5">
                            {commands.map((command, index) => (
                                <button
                                    key={command.name}
                                    data-active={index === menuIndex}
                                    className="cursor-row flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-text-muted"
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
                                    <Icon
                                        icon={command.skill ? Zap : SquareSlash}
                                        size={12}
                                        className={clsx('shrink-0', command.skill ? 'text-skill' : 'text-text-faint')}
                                    />
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
                                    data-active={index === menuIndex}
                                    className="cursor-row flex w-full items-start gap-2 rounded-md px-2 py-1 text-left text-xs text-text-muted"
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
                            {mention.query === '' && files.length > 0 && <div className={MENU_LABEL}>{t('composer.mentions.here')}</div>}
                            {files.length === 0 && (
                                <div className="px-2 py-1 text-xs text-text-faint">
                                    {mention.query ? t('composer.mentions.noMatch') : t('composer.mentions.empty')}
                                </div>
                            )}
                            {files.map((path, index) => {
                                const { name, dir } = splitPath(path);
                                return (
                                    <button
                                        key={path}
                                        data-active={index === menuIndex}
                                        className="cursor-row flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-text-muted"
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
                            {queue.map((message) => {
                                const sendNow = (): void => void performAsPerson('chat.sendNow', { chatId, messageId: message.id }).catch(() => undefined);
                                const unqueue = (): void => void performAsPerson('chat.unqueue', { chatId, messageId: message.id }).catch(() => undefined);
                                const edit = (): void => void takeBack(message);
                                return (
                                    <ContextMenu.Root key={message.id}>
                                        <ContextMenu.Trigger className="group/queued flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-text-muted">
                                            <Icon icon={Clock} size={12} className="shrink-0 text-text-faint" />
                                            <span className="min-w-0 grow truncate">
                                                {message.text || t('composer.queue.attachments', { count: message.attachments?.length ?? 0 })}
                                            </span>
                                            <span
                                                className={`${BTN_GROUP} opacity-0 transition-opacity group-hover/queued:opacity-100 focus-within:opacity-100`}
                                            >
                                                <Tooltip label={t('composer.queue.sendNow')} name>
                                                    <button className="icon-btn icon-btn-2xs" onClick={sendNow}>
                                                        <Icon icon={FastForward} size={12} />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip label={t('common:action.edit')} name>
                                                    <button className="icon-btn icon-btn-2xs" disabled={takingBack !== null} onClick={edit}>
                                                        <Icon icon={Pencil} size={12} />
                                                    </button>
                                                </Tooltip>
                                                <Tooltip label={t('common:action.remove')} name>
                                                    <button className="icon-btn icon-btn-2xs" onClick={unqueue}>
                                                        <Icon icon={X} size={12} />
                                                    </button>
                                                </Tooltip>
                                            </span>
                                        </ContextMenu.Trigger>
                                        <ContextMenu.Portal>
                                            <ContextMenu.Positioner className="z-(--z-popup)">
                                                <ContextMenu.Popup className="menu-popup">
                                                    <ContextMenu.Item className="menu-item" onClick={sendNow}>
                                                        <Icon icon={FastForward} size={14} /> {t('composer.queue.sendNow')}
                                                    </ContextMenu.Item>
                                                    <ContextMenu.Item className="menu-item" disabled={takingBack !== null} onClick={edit}>
                                                        <Icon icon={Pencil} size={14} /> {t('common:action.edit')}
                                                    </ContextMenu.Item>
                                                    <ContextMenu.Item
                                                        className="menu-item"
                                                        disabled={message.text === ''}
                                                        onClick={() => copyText(message.text)}
                                                    >
                                                        <Icon icon={Copy} size={14} /> {t('common:action.copy')}
                                                    </ContextMenu.Item>
                                                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                                                    <ContextMenu.Item className="menu-item text-status-error" onClick={unqueue}>
                                                        <Icon icon={X} size={14} /> {t('common:action.remove')}
                                                    </ContextMenu.Item>
                                                </ContextMenu.Popup>
                                            </ContextMenu.Positioner>
                                        </ContextMenu.Portal>
                                    </ContextMenu.Root>
                                );
                            })}
                        </div>
                    )}
                    {quote !== '' && (
                        <div className="flex items-center gap-2 px-5 pt-4 @max-md/composer:px-3.5 @max-md/composer:pt-3">
                            <span className="min-w-0 grow truncate border-l-2 border-border-strong pl-2.5 text-xs text-text-muted">{quote}</span>
                            <Tooltip label={t('composer.quote.remove')} name>
                                <button className="icon-btn icon-btn-2xs" onClick={removeQuote}>
                                    <Icon icon={X} size={12} />
                                </button>
                            </Tooltip>
                        </div>
                    )}
                    {draft.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2 px-5 pt-4 @max-md/composer:px-3.5 @max-md/composer:pt-3">
                            {draft.attachments.map((attachment, index) => (
                                <div key={`${attachment.name}-${index}`} className="group/thumb relative">
                                    {isImageAttachment(attachment.mime) ? (
                                        <UploadThumb upload={attachment} />
                                    ) : (
                                        <span className="flex h-14 w-36 flex-col justify-center gap-0.5 rounded-lg border border-border bg-surface-sunken px-2.5">
                                            <span className="flex items-center gap-1.5 text-xs text-text">
                                                <Icon icon={Paperclip} size={12} className="shrink-0 text-text-faint" />
                                                <span className="truncate">{attachment.name}</span>
                                            </span>
                                            <span className="pl-5 text-xs text-text-faint">{formatBytes(uploadBytes(attachment))}</span>
                                        </span>
                                    )}
                                    <Tooltip label={t('composer.removeAttachment', { name: attachment.name })}>
                                        <button
                                            className="icon-btn icon-btn-2xs absolute -top-1.5 -right-1.5 border border-border bg-surface-raised opacity-0 transition-opacity group-hover/thumb:opacity-100 focus-visible:opacity-100"
                                            onClick={() => removeAttachment(index)}
                                        >
                                            <Icon icon={X} size={12} />
                                        </button>
                                    </Tooltip>
                                </div>
                            ))}
                        </div>
                    )}
                    <ComposerInput
                        ref={inputRef}
                        dictationToolbar={dictationToolbar}
                        className="composer-input select-text text-sm leading-normal text-text"
                        value={text}
                        placeholder={placeholder}
                        disabled={disabled}
                        tabbable={focused}
                        extensions={editorExtensions}
                        onChange={(value, selection, state) => {
                            setText(value);
                            setMenuIndex(0);
                            trackTriggers(value, selection, state);
                            if (historyIndex !== null && value !== history[historyIndex]?.text) {
                                setHistoryIndex(null);
                            }
                        }}
                        onSelectionChange={trackTriggers}
                        onBlur={() => {
                            setMention(null);
                            setSkillQuery(null);
                        }}
                        onKeyDown={onKeyDown}
                        onPaste={onPaste}
                    />
                    {notice && <div className="px-5 pb-1 text-xs text-status-error @max-md/composer:px-3.5">{notice}</div>}
                    {guard.visible && (
                        <div
                            className={clsx(
                                'px-5 pb-1 text-right text-xs tabular-nums @max-md/composer:px-3.5',
                                guard.tooLong ? 'text-status-error' : 'text-text-faint'
                            )}
                        >
                            {formatNumber(guard.count)} / {formatNumber(PROMPT_MAX_CHARS)}
                            {guard.tooLong && ` ${t('composer.tooLong')}`}
                        </div>
                    )}
                    {/* The composer's controls are round, from attach to send, so they keep their own shape instead of `.icon-btn`'s. */}
                    <div className="flex items-center gap-2 pt-3 pr-3.5 pb-3.5 pl-5 @max-md/composer:gap-1.5 @max-md/composer:p-3 @max-md/composer:pt-2.5">
                        {attachable && (
                            <Tooltip label={t('composer.attach')} name>
                                <button
                                    type="button"
                                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border text-text-muted hover:bg-surface-hover hover:text-text disabled:opacity-50"
                                    disabled={disabled}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <Icon icon={Plus} size={16} />
                                </button>
                            </Tooltip>
                        )}
                        <input
                            ref={fileInputRef}
                            type="file"
                            multiple
                            hidden
                            onChange={(e) => {
                                addFiles(Array.from(e.target.files ?? []));
                                e.target.value = '';
                                inputRef.current?.focus();
                            }}
                        />
                        <RunSettings
                            providers={pickable}
                            provider={info.provider}
                            selection={info.selection}
                            model={model}
                            runtimeMode={info.runtimeMode}
                            open={modelPickerOpen}
                            onOpenChange={setModelPickerOpen}
                            onModel={chooseModel}
                            onOption={(id, value) => configure({ selection: { ...info.selection, options: { ...info.selection.options, [id]: value } } })}
                            onMode={(runtimeMode) => configure({ runtimeMode })}
                            usage={info.usage}
                            compactDisabled={busy || disabled}
                            onCompact={compact}
                        />
                        <StashPicker onRestore={restoreStashed} />
                        <span className="grow" />
                        <div className="flex h-9 shrink-0 items-center gap-0.5 rounded-full bg-surface-hover">
                            <div ref={setDictationToolbar} className="flex items-center pl-1 empty:hidden [&_.icon-btn]:rounded-full" />
                            {busy && (
                                <Tooltip label={composerStopLabel()} name>
                                    <button
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-status-error text-accent-text"
                                        onClick={(event) => stop(event.shiftKey)}
                                    >
                                        <Icon icon={Square} size={16} />
                                    </button>
                                </Tooltip>
                            )}
                            {/* While a turn runs the same button queues the message instead of sending it. */}
                            {(!busy || !isEmptyDraft(draft)) && (
                                <Tooltip label={busy ? t('composer.queueButton') : t('composer.send')} kbd={KEY_SHORTCUTS.modEnter} name>
                                    <button
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-text hover:brightness-90 disabled:opacity-50 disabled:hover:brightness-100"
                                        disabled={isEmptyDraft(draft) || disabled || guard.tooLong}
                                        onClick={submit}
                                    >
                                        <Icon icon={ArrowUp} size={16} />
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                    </div>
                </PromptComposer>
            </div>
            <PromptDialog
                open={confirmClear}
                title={t('composer.clear.title')}
                description={t('composer.clear.description')}
                confirmLabel={t('composer.clear.confirm')}
                danger
                fallbackMessage={t('composer.notice.clearFailed')}
                onConfirm={forceClearThread}
                onClose={() => setConfirmClear(false)}
            />
        </div>
    );
}
