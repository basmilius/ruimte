import type { ComponentProps, ComponentType, ReactNode, RefObject } from 'react';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ThemeRegistration } from 'shiki';
import type { AgentKind, ChatCheckpointDiff, ChatConfigurePayload, ChatItem } from '@ruimte/agent-contracts';
import { isApplePlatform } from '@ruimte/ui/platform';
import type { TimelineRow } from './chat/logic/timeline';
import type { FindReveal } from './chat/ui/find-reveal';
import type { PromptAction } from './prompts/logic/prompts';
import type { HostPrompt, PromptViewProps } from './prompts/logic/subjects';
import { PlainTextarea } from './ui/PlainTextarea';

/* A color an account may wear, by the name the host stores it under. */
export interface AccentChoice {
    id: string;
    color: string;
}

export interface ChatToast {
    /* A toast with the same id replaces the one that is up. */
    id?: string;
    title: string;
    description?: string;
    /* `deleted` says something went that the action can bring back. */
    kind: 'success' | 'error' | 'deleted';
    action?: { label: string; run(): void };
}

/*
 * What a person does to a chat from its own surfaces. Without an app's own set, each one is the request
 * a chat host answers; an app that runs every action through one door (confirmations, voice, an
 * activity log) hands its own. A refusal throws something with a `code`.
 */
export interface ChatActions {
    clear(chatId: string, force: boolean): Promise<void>;
    /* With `subagents`, also ends the agents this chat opened. */
    stopTurn(chatId: string, subagents: boolean): Promise<void>;
    /* Refused with `request-not-found` when the message already went out. */
    unqueue(chatId: string, messageId: string): Promise<void>;
    sendNow(chatId: string, messageId: string): Promise<void>;
    compact(chatId: string): Promise<void>;
    configure(chatId: string, patch: Omit<ChatConfigurePayload, 'chatId'>): Promise<void>;
    continueOn(chatId: string, account: string): Promise<void>;
    /* Null when the turn has no checkpoint to compare against. */
    turnDiff(chatId: string, turnId: string): Promise<ChatCheckpointDiff | null>;
    stopSubagent(chatId: string, toolUseId: string): Promise<void>;
    stopTask(chatId: string, taskId: string): Promise<void>;
    approve(chatId: string, requestId: string, decision: 'allow' | 'allow-always' | 'deny', message?: string): Promise<void>;
    answer(chatId: string, requestId: string, answers: Record<string, string>): Promise<void>;
    dismiss(chatId: string, itemId: string): Promise<void>;
}

/* A path an answer names, as it was written: absolute, or relative to the folder the chat works in. */
export interface FileRef {
    path: string;
    /* One-based, when the reference named a line. */
    line?: number;
    /* A trailing separator is the only thing that says a reference means a directory. */
    directory: boolean;
}

/* Where another chat stands and how to get there; a null title is a chat that is gone. */
export interface ChatPlace {
    title: string | null;
    go(): void;
}

/* The task behind a sub-agent row an app opened with a task of its own (`origin` that is not the CLI's). */
export interface SubagentTask {
    status: 'open' | 'done' | 'failed' | 'cancelled';
    createdAt: number;
    settledAt: number | null;
    /* Set while the child waits out a limit, with when it lifts. */
    paused?: { until?: number };
}

/* What a find in a thread needs of it, and what it hands back to draw. */
export interface TimelineFindOptions {
    chatId: string;
    /* What the find key looks for, and what the bar stands in. */
    frame: RefObject<HTMLDivElement | null>;
    /* Where the rows are drawn, which is what gets marked. */
    thread: RefObject<HTMLDivElement | null>;
    scroller: RefObject<HTMLDivElement | null>;
    enabled: boolean;
    rows: readonly TimelineRow[];
    structure: Readonly<Record<string, ChatItem>> | undefined;
    order: readonly string[] | undefined;
    /* The first row on screen, where a new search starts looking. */
    firstRowInView(): number;
    openTurn(turnId: string): void;
    openGroup(id: string): void;
    openSubagent(id: string): void;
    scrollToRow(index: number): void;
    /* The height of the composer standing over the end of the scroller. */
    coveredHeight(): number;
    stopFollowing(): void;
}

export interface TimelineFind {
    open: boolean;
    /* Drawn over the thread while the find is open. */
    bar: ReactNode;
    reveal: FindReveal | null;
    /* The row each hit is shown at, in the order of the hits. */
    hitRows: readonly number[];
    currentRow: number | null;
}

/* The dictation control beside the composer's editor; it takes its text from the editor itself. */
export interface ComposerDictationProps {
    targetRef: RefObject<HTMLElement | null>;
    /* Where the button goes, in the composer's row of round controls. */
    buttonContainer: HTMLElement | null | undefined;
    disabled: boolean;
    editor(): EditorView | null;
}

export type TextareaProps = ComponentProps<'textarea'> & {
    /* Where a button beside the field sits, such as a negative margin so it does not make a one-line row taller. */
    buttonClassName?: string;
};

/* An attached file's bytes, as a URL an image or a link can use; `failure` says why there is none. */
export interface ResourceUrl {
    url: string | null;
    failure: string | null;
}

/*
 * What the app around the chat decides and the chat cannot. Set once, before the first render, with
 * `setChatHost`; whatever an app leaves out keeps the default here, which is the chat without that
 * part. The same in every scope, so a function that is about one host of chats is told its scope id.
 * The hooks are called as hooks: an app hands the same function for the life of the page.
 */
export interface ChatHost {
    /* The colors an account may wear in the order a picker offers them, the few it shows first, and their names. */
    accents: {
        all: readonly AccentChoice[];
        featured: readonly string[];
        label(id: string): string;
        /* The accent the app is painted in, which an account without a color of its own wears. */
        current(): string;
    };
    isApplePlatform(): boolean;
    /* A key the app keeps for itself even while the composer has the keyboard, such as the ones that move between views. */
    isAppShortcut(event: KeyboardEvent): boolean;
    notify(toast: ChatToast): void;
    /* The app's own actions; null runs every one as a request on the scope's transport. */
    actions: ChatActions | null;
    /* Files under `cwd` for the composer's `@` picker; null offers none. */
    searchFiles: ((scopeId: string, cwd: string, query: string, limit: number) => Promise<string[]>) | null;
    /* The bytes of a file attached to a message, where the host keeps them. */
    attachments: {
        useUrl(scopeId: string, chatId: string, attachmentId: string): ResourceUrl;
        read(scopeId: string, chatId: string, attachmentId: string): Promise<Blob>;
    };
    /* The image a tool read, drawn under its row; null draws none. */
    ReadImage: ComponentType<{ path: string }> | null;
    code: {
        /* Whether the app is light or dark right now. */
        useMode(): 'light' | 'dark';
        /* The Shiki theme ids code is drawn in, one per mode. */
        useThemes(): { light: string; dark: string };
        /* Themes the app ships itself, found by name; the rest Shiki looks up by id. */
        custom: ReadonlyArray<ThemeRegistration & { name: string }>;
    };
    /* How a reply appears while it streams: a word, a block or the whole of it at a time. */
    useStreaming(): 'words' | 'blocks' | 'whole';
    /* Paths in an answer as links; null leaves them text. */
    fileLinks: {
        /* The reference a piece of text names, where the folder it counts from lets it be opened. */
        target(text: string, cwd: string | null): FileRef | null;
        open(cwd: string | null, ref: FileRef): void;
    } | null;
    /* Find in a thread; without one the thread has no find. */
    useTimelineFind(options: TimelineFindOptions): TimelineFind;
    dictation: {
        /* The field a written answer goes in. */
        Textarea: ComponentType<TextareaProps>;
        /* What the composer's editor carries for dictated text, and the control beside it. */
        composer: { extensions: Extension; Control: ComponentType<ComposerDictationProps> } | null;
    };
    prompts: {
        /* Prompts the app raises beside a chat's own requests, answered in the same place. */
        useExtra(scopeId: string, chatId: string): readonly HostPrompt[];
        render(prompt: HostPrompt, props: PromptViewProps): ReactNode;
        answer(prompt: HostPrompt, action: PromptAction): Promise<void>;
    };
    /* Other chats a message may point at with `@`, beside the files. */
    useReferableChats(): ReadonlyArray<{ id: string; title: string }>;
    /* Opens the CLI's own login for an account, somewhere the app can run a command; null offers none. */
    openLogin: ((scopeId: string, kind: AgentKind, accountId: string, name: string) => Promise<void>) | null;
    /* Why a login cannot start from here right now, or null when it can. */
    useLoginBlocked(scopeId: string): string | null;
    /* The name and the mark of a project of the host, for the usage per project; null draws the folder's own. */
    useProjectLook(scopeId: string, projectId: string | null): { name: string; mark: ReactNode } | null;
    /* Where another chat of the app stands, for a fork's way back and a note from a fork. */
    useChatPlace(chatId: string): ChatPlace;
    /* What a chat may read besides its folder, named under an empty thread. */
    useContextSources(chatId: string): ReadonlyArray<{ title: string }>;
    tasks: {
        useTasks(scopeId: string): Readonly<Record<string, SubagentTask>> | undefined;
        /* Null for a row with no task behind it. */
        useTask(scopeId: string, taskId: string | null): SubagentTask | null;
    };
    /* Asked before a stop that ends agents the chat opened; `run` stops. */
    confirm: {
        stopSubagents(scopeId: string, chatId: string, run: () => void): void;
        stopTask(scopeId: string, childId: string, title: string, run: () => void): void;
    };
    /* Offers a fork of the chat after one of its turns; null offers none. */
    fork: ((chatId: string, turnId: string) => void) | null;
    /* Opens the app's settings on a section: `providers`, or `agents`. */
    openSettings(section: 'providers' | 'agents'): void;
    /* Whether the host lets a chat go on by itself once a limit it stopped on lifts. */
    useResumeAtReset(scopeId: string): boolean;
}

const NO_PROMPTS: readonly HostPrompt[] = [];
const NO_CHATS: ReadonlyArray<{ id: string; title: string }> = [];
const NO_ROWS: readonly number[] = [];
const NO_FIND: TimelineFind = { open: false, bar: null, reveal: null, hitRows: NO_ROWS, currentRow: null };
const NO_SOURCES: ReadonlyArray<{ title: string }> = [];
const NO_URL: ResourceUrl = { url: null, failure: null };
const NOWHERE: ChatPlace = { title: null, go: () => undefined };

const DEFAULT_HOST: ChatHost = {
    accents: { all: [], featured: [], label: (id) => id, current: () => '' },
    isApplePlatform,
    isAppShortcut: () => false,
    notify: () => undefined,
    actions: null,
    searchFiles: null,
    attachments: { useUrl: () => NO_URL, read: () => Promise.reject(new Error('This app keeps no attached files')) },
    ReadImage: null,
    code: { useMode: () => 'light', useThemes: () => ({ light: 'github-light', dark: 'github-dark' }), custom: [] },
    useStreaming: () => 'words',
    fileLinks: null,
    useTimelineFind: () => NO_FIND,
    dictation: { Textarea: PlainTextarea, composer: null },
    prompts: { useExtra: () => NO_PROMPTS, render: () => null, answer: () => Promise.reject(new Error('This app raises no prompts of its own')) },
    useReferableChats: () => NO_CHATS,
    openLogin: null,
    useLoginBlocked: () => null,
    useProjectLook: () => null,
    useChatPlace: () => NOWHERE,
    useContextSources: () => NO_SOURCES,
    tasks: { useTasks: () => undefined, useTask: () => null },
    confirm: { stopSubagents: (_scopeId, _chatId, run) => run(), stopTask: (_scopeId, _childId, _title, run) => run() },
    fork: null,
    openSettings: () => undefined,
    useResumeAtReset: () => true
};

let host: ChatHost = DEFAULT_HOST;

export const setChatHost = (patch: Partial<ChatHost>): void => {
    host = { ...host, ...patch };
};

export const chatHost = (): ChatHost => host;
