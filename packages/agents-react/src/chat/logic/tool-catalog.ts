import { Bot, Eye, FolderSearch, Globe, ListTodo, Search, SquarePen, Terminal, Workflow, Zap, type LucideIcon } from 'lucide-react';

/* Everything the thread knows about one tool by name. */
export interface ToolEntry {
    /* The mark in the gutter of the call's row. */
    icon: LucideIcon;
    /* The input keys that hold the one line saying what the call is about, best first. */
    summary: readonly string[];
    /* Whether a run of calls of this name reads as a sentence of its own (`agent-chat:group.tools.<name>`).
       One that changes files without a sentence falls to `agent-chat:group.edited`, which counts files rather than calls. */
    grouped: boolean;
    /* Whether the call writes to a file, which is what a mixed run of calls is named after. */
    changesFiles: boolean;
    /* Whether the call reads a path the thread may draw as an image. */
    readsImage: boolean;
}

const entry = (icon: LucideIcon, summary: readonly string[], rest: Partial<ToolEntry> = {}): ToolEntry => ({
    icon,
    summary,
    grouped: true,
    changesFiles: false,
    readsImage: false,
    ...rest
});

/*
 * The icon, the summary line, the group sentence and the file-changing flag of every tool the thread
 * has a word for, in one table, because they used to sit in four and a name added to one of them was
 * missing from the rest. A name that is not here still draws, reads and groups; it falls back to the
 * wrench and to the first string of its input.
 */
export const TOOL_CATALOG: Record<string, ToolEntry> = {
    Read: entry(Eye, ['file_path'], { readsImage: true }),
    // Only `readImagePath` ever had this one, which is why it has no sentence of its own yet.
    NotebookRead: entry(Eye, ['file_path', 'notebook_path'], { grouped: false, readsImage: true }),
    // These three read as "Edited 3 files" through `changesFiles`, so they carry no copy of that sentence.
    Edit: entry(SquarePen, ['file_path'], { grouped: false, changesFiles: true }),
    Write: entry(SquarePen, ['file_path'], { changesFiles: true }),
    MultiEdit: entry(SquarePen, ['file_path'], { grouped: false, changesFiles: true }),
    NotebookEdit: entry(SquarePen, ['file_path', 'notebook_path']),
    // Codex reports a patch as the paths it touches; its own input carries no path of its own.
    ApplyPatch: entry(SquarePen, ['summary'], { grouped: false, changesFiles: true }),
    Bash: entry(Terminal, ['description', 'command']),
    Grep: entry(Search, ['pattern']),
    Glob: entry(FolderSearch, ['pattern']),
    WebFetch: entry(Globe, ['url', 'query']),
    WebSearch: entry(Globe, ['url', 'query']),
    Task: entry(Bot, ['description']),
    Agent: entry(Bot, ['description']),
    Skill: entry(Zap, ['skill']),
    // A plan is a list of objects, so there is no line to lift out of it.
    TodoWrite: entry(ListTodo, []),
    // Its input is the whole script; the line takes what the CLI says the workflow is about instead.
    Workflow: entry(Workflow, [], { grouped: false })
};

export const toolEntry = (name: string): ToolEntry | undefined => TOOL_CATALOG[name];
