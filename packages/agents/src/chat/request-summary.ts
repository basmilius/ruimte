import { CHAT_REQUEST_LIMITS, type ChatApprovalItem, type ChatQuestionItem, type ChatRequestApproval, type ChatRequestSummary } from '@ruimte/agent-contracts';

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);

// The keys a tool's input names its subject under, in the order a person would look for one.
const SUBJECT_KEYS = ['file_path', 'notebook_path', 'path', 'url', 'query', 'pattern', 'skill', 'description'];

/* Cuts text at `max` code units, never between the halves of a surrogate pair. */
const cut = (text: string, max: number): string => {
    if (text.length <= max) {
        return text;
    }
    const end = /[\uD800-\uDBFF]/.test(text[max - 1] ?? '') ? max - 1 : max;
    return text.slice(0, end);
};

const clip = (text: string, max: number): string => (text.length <= max ? text : `${cut(text, max - 1)}…`);

/* Keeps the end of a path, where its file name is. */
const clipPath = (path: string, max: number): string => {
    if (path.length <= max) {
        return path;
    }
    const start = path.length - (max - 1);
    return `…${path.slice(/[\uDC00-\uDFFF]/.test(path[start] ?? '') ? start + 1 : start)}`;
};

const firstLine = (text: string): string => text.trim().split('\n', 1)[0] ?? '';

/* At most `maxLines` lines and `maxLength` code units, cut at a line; a first line longer than that is cut in itself. */
const clipLines = (lines: readonly string[], maxLines: number, maxLength: number): { text: string; truncated: boolean } => {
    const kept: string[] = [];
    let length = 0;
    for (const line of lines) {
        if (kept.length === maxLines || length + line.length + (kept.length > 0 ? 1 : 0) > maxLength) {
            if (kept.length === 0) {
                return { text: cut(line, maxLength), truncated: true };
            }
            return { text: kept.join('\n'), truncated: true };
        }
        length += line.length + (kept.length > 0 ? 1 : 0);
        kept.push(line);
    }
    return { text: kept.join('\n'), truncated: false };
};

const splitLines = (text: string): string[] => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

/* The lines a replacement takes out and puts in; a provider's edit is a fragment, so there is no context to show. */
const replacementLines = (before: string, after: string): string[] => [
    ...splitLines(before).map((line) => `-${line}`),
    ...splitLines(after).map((line) => `+${line}`)
];

/* Only what a unified diff changes: its headers and context lines stay in the thread. */
const changedLines = (diff: string): string[] =>
    splitLines(diff).filter((line) => (line.startsWith('-') && !line.startsWith('---')) || (line.startsWith('+') && !line.startsWith('+++')));

interface FileChange {
    path: string;
    files: number;
    lines: string[];
}

/* The first file a call changes, as Codex's patch or Claude's edit and write tools carry it; null for any other call. */
const fileChange = (toolName: string, input: Record<string, unknown>): FileChange | null => {
    const patches = Array.isArray(input.changes)
        ? input.changes.filter(
              (change): change is { path: string; diff: string } => isRecord(change) && typeof change.path === 'string' && typeof change.diff === 'string'
          )
        : [];
    if (patches.length > 0) {
        return { path: patches[0]!.path, files: patches.length, lines: changedLines(patches[0]!.diff) };
    }
    const path = str(input.file_path);
    if (path === null) {
        return null;
    }
    if (toolName === 'Edit') {
        return { path, files: 1, lines: replacementLines(str(input.old_string) ?? '', str(input.new_string) ?? '') };
    }
    if (toolName === 'Write') {
        return { path, files: 1, lines: replacementLines('', str(input.content) ?? '') };
    }
    if (toolName === 'MultiEdit' && Array.isArray(input.edits)) {
        return {
            path,
            files: 1,
            lines: input.edits.filter(isRecord).flatMap((edit) => replacementLines(str(edit.old_string) ?? '', str(edit.new_string) ?? ''))
        };
    }
    return null;
};

const subjectOf = (input: Record<string, unknown>): string => {
    const named = SUBJECT_KEYS.map((key) => str(input[key])).find((value) => value !== null && value.trim() !== '');
    const first = named ?? Object.values(input).find((value): value is string => typeof value === 'string' && value.trim() !== '') ?? '';
    return clip(firstLine(first), CHAT_REQUEST_LIMITS.subject);
};

export const approvalSummary = (item: ChatApprovalItem): ChatRequestApproval => {
    const input = isRecord(item.input) ? item.input : {};
    const change = fileChange(item.toolName, input);
    const command = change === null ? str(input.command) : null;
    const diff = change === null ? null : clipLines(change.lines, CHAT_REQUEST_LIMITS.diffLines, CHAT_REQUEST_LIMITS.diff);
    const shell = command === null ? null : clipLines(splitLines(command), CHAT_REQUEST_LIMITS.commandLines, CHAT_REQUEST_LIMITS.command);
    const truncated = diff?.truncated === true || shell?.truncated === true;
    return {
        toolName: clip(item.toolName, CHAT_REQUEST_LIMITS.subject),
        subject:
            change !== null
                ? clipPath(change.path, CHAT_REQUEST_LIMITS.subject)
                : command !== null
                  ? clip(firstLine(command), CHAT_REQUEST_LIMITS.subject)
                  : subjectOf(input),
        description: item.description === null ? null : clip(item.description, CHAT_REQUEST_LIMITS.description),
        ...(change === null ? {} : { path: clipPath(change.path, CHAT_REQUEST_LIMITS.subject) }),
        ...(change !== null && change.files > 1 ? { files: change.files } : {}),
        ...(diff === null || diff.text === '' ? {} : { diff: diff.text }),
        ...(shell === null ? {} : { command: shell.text }),
        ...(truncated ? { truncated: true } : {}),
        canAllowAlways: item.canAllowAlways,
        ...(item.allowAlways
            ? {
                  allowAlways: {
                      label: clip(item.allowAlways.label, CHAT_REQUEST_LIMITS.header),
                      description: clip(item.allowAlways.description, CHAT_REQUEST_LIMITS.description)
                  }
              }
            : {})
    };
};

const questionSummary = (item: ChatQuestionItem): NonNullable<ChatRequestSummary['question']> => ({
    questions: item.questions.map((question) => ({
        id: question.id,
        header: clip(question.header, CHAT_REQUEST_LIMITS.header),
        question: clip(question.question, CHAT_REQUEST_LIMITS.question),
        choices: question.choices.map((choice) => ({ label: choice.label, description: clip(choice.description, CHAT_REQUEST_LIMITS.choiceDescription) })),
        multiSelect: question.multiSelect
    })),
    ...(item.async === undefined ? {} : { async: item.async })
});

/* What a chat waits on, oldest first, as `ChatInfo.requests` carries it. */
export const requestSummaries = (pending: ReadonlyArray<ChatApprovalItem | ChatQuestionItem>): ChatRequestSummary[] =>
    pending.slice(0, CHAT_REQUEST_LIMITS.perChat).map((item) => ({
        requestId: item.requestId,
        itemId: item.id,
        kind: item.kind,
        createdAt: item.createdAt,
        ...(item.kind === 'approval' ? { approval: approvalSummary(item) } : { question: questionSummary(item) })
    }));
