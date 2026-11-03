import { describe, expect, test } from 'bun:test';
import { compileUi } from '@adecore/intelligent-ui';
import type { ContextSource } from '@ruimte/contracts';
import { BUILT_IN_KINDS } from '../providers/kinds.ts';
import { NODE_NEW_KINDS } from '../tools/node-kinds.ts';
import { RUIMTE_UI_FENCE } from '../chat/ui-fence.ts';
import { ruimteUiSources, type UiSourceHosts } from '../chat/ui-sources.ts';
import {
    chatPrompt,
    contextChangeNote,
    contextHint,
    contextPrompt,
    hookContext,
    PUBLISHED_INLINE_NOTE,
    toolsNote,
    VISUAL_RESUME_NOTE
} from './context-note.ts';

const TOOLS_NOTE = toolsNote({ depth: 0 });
const TERMINAL_NOTE = toolsNote({ depth: 0, terminal: true });
const VISUAL_NOTE = toolsNote({ depth: 0, standalone: true, visuals: true, databases: true });

// Only the argument schemas are read; a source that ran would be a bug in the test.
const unused = (): never => {
    throw new Error('unused');
};
const SOURCE_HOSTS: UiSourceHosts = {
    place: unused,
    node: unused,
    worktreePaths: unused,
    gitStatus: unused,
    gitLog: unused,
    launches: unused,
    tasks: unused,
    databases: unused
};

const text: ContextSource = { id: 'text-1', kind: 'text', title: 'Sprint goals' };
const terminal: ContextSource = { id: 'term-1', kind: 'terminal', title: 'dev server' };
const chat: ContextSource = { id: 'chat-1', kind: 'chat', title: 'planner' };
const device: ContextSource = { id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' };

const many = Array.from({ length: 8 }, (_, i): ContextSource => ({ id: `t${i}`, kind: 'text', title: `Note ${i}` }));

describe('contextHint', () => {
    test('is silent without links and names each source with its kind', () => {
        expect(contextHint([])).toBeNull();
        expect(contextHint([text, terminal])).toBe('Ruimte: linked context, read with context_read: "Sprint goals" (text), "dev server" (terminal).');
    });

    test('caps the names and counts the rest', () => {
        const hint = contextHint(many);
        expect(hint).toContain('"Note 4" (text) and 3 more.');
        expect(hint).not.toContain('Note 5');
    });
});

describe('toolsNote', () => {
    test('the complete agent note contains a closed and compilable UI example', () => {
        // This checks the example syntax; CPU scheduling must not consume its compiler time budget.
        const blocks = compileUi(VISUAL_NOTE, { id: 'agent-note-example', final: true, fenceLanguage: RUIMTE_UI_FENCE, now: () => 0 });
        expect(blocks).toHaveLength(1);
        expect(blocks[0].diagnostics).toEqual([]);
        expect(blocks[0].nodes.some((node) => node.type === 'Summary')).toBe(true);
    });

    test('every live data source the note advertises compiles against the sources the daemon reads', () => {
        const sources = ruimteUiSources(SOURCE_HOSTS).sources;
        const querySchemas = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, source.args]));
        const advertised = [...VISUAL_NOTE.matchAll(/\b([a-z]+\.[a-z]+) (\{[^}]*\})/g)].filter(([, name]) => Object.hasOwn(sources, name!));
        expect(advertised.map(([, name]) => name).toSorted()).toEqual(Object.keys(sources).toSorted());
        for (const [, name, args] of advertised) {
            const block = `\`\`\`${RUIMTE_UI_FENCE}\n$data = @Query("${name}", ${args})\n<Summary>{@Count($data)}</Summary>\n\`\`\``;
            const [compiled] = compileUi(block, { id: name!, final: true, fenceLanguage: RUIMTE_UI_FENCE, querySchemas, now: () => 0 });
            expect(compiled?.diagnostics).toEqual([]);
            expect(Object.values(compiled?.queries ?? {}).map((query) => query.source)).toEqual([name!]);
        }
    });

    test('teaches the catalog only to a chat a person reads, with databases only where the project has connections', () => {
        expect(VISUAL_NOTE).toContain('Queries only read, never start work or run writes.');
        expect(VISUAL_NOTE).toContain('`ui_catalog` gives props and rules');
        expect(VISUAL_NOTE).toContain('places: Map, Place');
        expect(VISUAL_NOTE).toContain('`chat_attach` and `Image attachment=<id>`');
        expect(VISUAL_NOTE).toContain('a model file (STL, binary glTF, USDZ) with `Model attachment=<id>` only when the person asks to see it');
        expect(VISUAL_NOTE).toContain('Stat in Stats');
        expect(VISUAL_NOTE).toContain('Stat takes numbers; Entry holds text.');
        expect(VISUAL_NOTE).toContain('File and Diff paths, and file links, are relative to your working folder');
        expect(VISUAL_NOTE).toContain('@Query("database.query"');
        expect(VISUAL_NOTE).not.toContain('query show');
        expect(VISUAL_NOTE).not.toContain('  ');
        expect(toolsNote({ depth: 0, standalone: true, visuals: true })).not.toContain('database.query');
        const child = toolsNote({ depth: 1, standalone: true, visuals: true, databases: true });
        expect(child).not.toContain(RUIMTE_UI_FENCE);
        expect(child).not.toContain('@Query');
        expect(child).toContain('`visual_show`');
        expect(VISUAL_RESUME_NOTE).not.toContain(RUIMTE_UI_FENCE);
    });

    test('the UI and visual notes together stay within their size budget, listing names and required props instead of every prop', () => {
        const added = toolsNote({ depth: 0, visuals: true }).length - toolsNote({ depth: 0 }).length;
        expect(added).toBeLessThanOrEqual(4100);
        expect(VISUAL_NOTE).not.toContain('Props:');
    });

    test('the note without UI blocks stays within its budget, since it rides along with every agent Ruimte starts', () => {
        const everything = { computer: true, device: true, databases: true, reach: true };
        expect(toolsNote({ depth: 0, ...everything }).length).toBeLessThanOrEqual(2600);
        expect(toolsNote({ depth: 0, standalone: true, ...everything }).length).toBeLessThanOrEqual(2700);
    });

    test('sends a question the turn waits on to the question tool, never to Choices, and names no tool', () => {
        expect(VISUAL_NOTE).toContain('ask with your own question tool if you have one, otherwise in prose, never with Choices.');
        expect(VISUAL_NOTE).not.toContain('<Choices>');
        expect(VISUAL_NOTE).not.toContain('next steps to pick');
        expect(VISUAL_NOTE).not.toMatch(/AskUserQuestion|request_user_input|ask_user/i);
    });

    test('tells a chat a person reads not to repeat what it published, and nobody else', () => {
        expect(toolsNote({ depth: 0, standalone: true })).toContain(PUBLISHED_INLINE_NOTE);
        expect(toolsNote({ depth: 0 })).toContain(PUBLISHED_INLINE_NOTE);
        expect(toolsNote({ depth: 1, standalone: true })).not.toContain(PUBLISHED_INLINE_NOTE);
        expect(toolsNote({ depth: 0, standalone: true, terminal: true })).not.toContain(PUBLISHED_INLINE_NOTE);
        expect(PUBLISHED_INLINE_NOTE).toContain('does not repeat its content or copy its tables');
    });

    test('names computer use only while it is on for this machine', () => {
        for (const standalone of [false, true]) {
            expect(toolsNote({ depth: 0, standalone })).not.toContain('computer');
            const note = toolsNote({ depth: 0, standalone, computer: true });
            expect(note).toContain('`computer_*`');
            // A person who paused or stopped the agent is waited for, not called around.
            expect(note).toContain('pause, take over or stop you');
            expect(note).toContain('instead of calling again in a loop');
            expect(note).toContain('Stay in the background');
            expect(note).toContain('ask before you set `front`');
        }
        expect(hookContext('SessionStart', [], { computer: true })).toContain('`computer_*`');
        expect(chatPrompt({ sources: [], depth: 0, computer: true })).toContain('`computer_*`');
    });

    test('tells a chat that works on a design where its files go, and every other chat nothing about designs', () => {
        const prompt = chatPrompt({ sources: [], depth: 0, standalone: true, visuals: true, design: { folder: '/repo/designs/onboarding', onCanvas: false } });
        expect(prompt).toContain('in the folder `/repo/designs/onboarding`, also when you run in another checkout');
        // Every convention a tool of the view reads, by the exact name it reads.
        expect(prompt).toContain('`<meta name="ruimte-design" content="canvas">`');
        expect(prompt).toContain('`<section id="t2">`');
        expect(prompt).toContain('(`id="2a"`)');
        expect(prompt).toContain('`<script type="application/json" id="ruimte-tweaks">`');
        expect(prompt).toContain('`<style id="ruimte-edits">`');
        expect(prompt).toContain('`var(--tweak-accent)`');
        // How a design is made, and what the page never does.
        expect(prompt).toContain("put every question you need into one call of your CLI's own question tool");
        expect(prompt).toContain('Start a new page with a short note of your assumptions');
        expect(prompt).toContain('Give three or more options');
        expect(prompt).toContain('is drawn with the theme variables the page receives');
        expect(prompt).toContain('when the person asks for a light or a dark board, give it that instead');
        expect(prompt).toContain('never those theme variables');
        expect(prompt).toContain('Use text the person gives you word for word');
        expect(prompt).toContain('Never show a design with `visual_show`');
        expect(prompt).toContain('`visual_preview` at its width');
        expect(chatPrompt({ sources: [], depth: 0, standalone: true, visuals: true })).not.toContain('design');
    });

    test('tells a chat of a design on a canvas to make every option a page of its own, and never a board', () => {
        const prompt = chatPrompt({ sources: [], depth: 0, visuals: true, design: { folder: '/repo/.ruimte/designs/onboarding', onCanvas: true } });
        expect(prompt).toContain('`/repo/.ruimte/designs/onboarding`');
        expect(prompt).toContain('never use the `ruimte-design` canvas meta');
        expect(prompt).toContain('(`2a Onboarding.html`)');
        expect(prompt).not.toContain('`<meta name="ruimte-design" content="canvas">`');
        expect(prompt).not.toContain('`<section id="t2">`');
        expect(prompt).toContain('`<script type="application/json" id="ruimte-tweaks">`');
    });

    test('tells an AI chat about visuals only while they are on, on a canvas and in a view alike, and never a terminal', () => {
        for (const standalone of [false, true]) {
            expect(chatPrompt({ sources: [], depth: 0, standalone, visuals: true })).toContain('`visual_show`');
            expect(chatPrompt({ sources: [], depth: 0, standalone })).not.toContain('visual');
            expect(chatPrompt({ sources: [], depth: 0, standalone, visuals: false })).not.toContain('visual');
        }
        expect(VISUAL_NOTE).toContain('`visual_show`');
        expect(VISUAL_NOTE).toContain('check it with `visual_preview`');
        expect(VISUAL_NOTE).toContain('`visual_write`');
        expect(VISUAL_NOTE).toContain('never in the project unless the person asks for an export');
        // A terminal agent hears the tools through its hooks, which never carry the sentence.
        expect(hookContext('SessionStart', [], { depth: 0 })).not.toContain('visual');
    });

    test('names the device tools only while a device node is linked in', () => {
        const phone = {
            id: 'phone-1',
            kind: 'device' as const,
            title: 'Phone',
            device: { platform: 'ios' as const, kind: 'simulator' as const, name: 'iPhone', runtime: 'iOS 27.0' }
        };
        expect(chatPrompt({ sources: [], depth: 0 })).not.toContain('device_shot');
        expect(chatPrompt({ sources: [phone], depth: 0 })).toContain('`device_shot`');
        expect(hookContext('SessionStart', [phone])).toContain('`device_shot`');
        expect(toolsNote({ depth: 0, standalone: true, device: true })).toContain('`device_shot`');
    });

    test('offers team and agent at depth 0, only agent at depth 1 and neither below', () => {
        expect(TOOLS_NOTE).toContain('`agent_start` opens an agent and `agent_team` several in parallel');
        expect(TOOLS_NOTE).toContain('answer yourself whatever you can');
        expect(TOOLS_NOTE).toContain('end your turn instead of polling');
        const helper = toolsNote({ depth: 1 });
        expect(helper).toContain('`agent_start` opens a helper agent');
        expect(helper).toContain('answer yourself whatever you can');
        expect(helper).not.toContain('agent_team');
        expect(helper).toContain('With a `task`');
        // Named where the tool is offered, since a prompt asks for a CLI by name and never by flag.
        for (const cli of BUILT_IN_KINDS) {
            expect(TOOLS_NOTE).toContain(cli);
            expect(helper).toContain(cli);
        }
        for (const note of [TOOLS_NOTE, helper]) {
            // A person asking for a second agent wants a node, so the note must not read as a nudge to delegate inside the CLI.
            expect(note).toContain('never a subagent of your own');
            expect(note).toContain('Leave `mode` out unless the person asks for another permission mode');
            expect(note).toContain('a read-only or review assignment does not imply `supervised`');
        }
        const deepest = toolsNote({ depth: 2 });
        expect(deepest).not.toContain('agent_start');
        expect(deepest).not.toContain('`task`');
        expect(deepest).not.toContain('subagent');
        for (const note of [TOOLS_NOTE, helper, deepest]) {
            // Named at every depth, since a model told only about "nodes" writes the note the person asked for as a file.
            for (const kind of NODE_NEW_KINDS) {
                expect(note).toContain(kind);
            }
            expect(note).toContain('Notes or drawings the person asks for in this view are nodes, which `node_new` adds');
            expect(note).toContain("Its MCP tools (`context_read`, `node_new`, `view_list`, ...) work on this project's views and nodes");
            expect(note).not.toContain('ruimte-context');
            expect(note).toEndWith('never by id.');
            expect(note).not.toContain('  ');
        }
    });
});

describe('contextPrompt', () => {
    test('names the sources a chat has and prefers the context the person supplied', () => {
        expect(contextPrompt([])).toBeNull();
        expect(contextPrompt([device])).toBe(
            'Ruimte: linked context, read with context_read: "iPhone 18 Pro Max" (device). This is what the person means, so prefer it over anything your own tools or servers turn up.'
        );
    });

    test('caps the names the way a shell hint does', () => {
        const prompt = contextPrompt(many);
        expect(prompt).toContain('"Note 4" (text) and 3 more.');
        expect(prompt).not.toContain('Note 5');
    });
});

test('a chat view skips linked-context discovery and opens hidden agents with the requested model', () => {
    for (const depth of [0, 1]) {
        const note = chatPrompt({ sources: [device], depth, standalone: true });
        expect(note).toContain('Its MCP tools');
        expect(note).toContain("your CLI's own subagents");
        expect(note).toContain('Keep any model and reasoning effort the person asked for');
        expect(note).toContain('You work in a chat view; skip linked-context discovery');
        expect(note).not.toContain('You work in a node on a canvas');
        expect(note).not.toContain('context linked to this chat');
        expect(note).toContain('These agents stay hidden');
        expect(note).toContain('Leave `mode` out unless the person asks for another permission mode');
        expect(note).toContain('a read-only or review assignment does not imply `supervised`');
        expect(note).toContain('end your turn after delegating instead of polling');
        expect(note).toContain('Set `view` only when the person asks to place the agent on a canvas');
        expect(note).toContain('`view`');
        expect(note).not.toContain('never a subagent of your own');
        expect(note).toContain('"iPhone 18 Pro Max" (device)');
    }
});

test('a chat view arranges the canvas it names and operates its nodes without a line, which a hidden agent is never told', () => {
    const view = toolsNote({ depth: 0, standalone: true });
    expect(view).toContain('To work on a canvas, name it with `view`');
    expect(view).toContain('read and operate any node there');
    const hidden = toolsNote({ depth: 1, standalone: true });
    expect(hidden).not.toContain('To work on a canvas');
    expect(hidden).toContain('Put a note or drawing the person asks for on a canvas you name with `view`');
});

test('a hidden agent at the depth limit is not told to start another agent', () => {
    const note = toolsNote({ depth: 2, standalone: true });
    expect(note).not.toContain('agent_start');
    expect(note).not.toContain('agent_team');
});

describe('chatPrompt', () => {
    test('always names the tools for its depth, and the links by name only when there are some', () => {
        expect(chatPrompt({ sources: [], depth: 0 })).toBe(TOOLS_NOTE);
        expect(chatPrompt({ sources: [], depth: 2 })).toBe(toolsNote({ depth: 2 }));
        expect(chatPrompt({ sources: [device, terminal], depth: 0 })).toBe(`${toolsNote({ depth: 0, device: true })} ${contextPrompt([device, terminal])}`);
        expect(chatPrompt({ sources: [device], depth: 0 })).toContain('"iPhone 18 Pro Max" (device)');
    });
});

describe('hookContext', () => {
    test('a terminal view receives its own placement instructions at startup', () => {
        const note = hookContext('SessionStart', [], { standalone: true });
        expect(note).toContain('You work in a terminal view; skip linked-context discovery');
        expect(note).toContain('go on a canvas you name with `view`');
        expect(note).not.toContain('You work in a node on a canvas');
        expect(note).not.toContain('You work in a chat view');
        expect(note).not.toContain('These agents stay hidden');
        expect(note).not.toContain('`task`');
    });

    test('SessionStart always carries the tools, a prompt only the links', () => {
        expect(hookContext('SessionStart', [])).toBe(TERMINAL_NOTE);
        expect(hookContext('SessionStart', [text])).toBe(`${TERMINAL_NOTE} ${contextHint([text])}`);
        expect(hookContext('UserPromptSubmit', [])).toBeNull();
        expect(hookContext('UserPromptSubmit', [text])).toBe(contextHint([text]));
    });

    test('a CLI whose launch line carried the tools hears only its links and messages at a start', () => {
        const message = 'Ruimte: node term-2 ("builder") sent you a message: the build is green.';
        expect(hookContext('SessionStart', [], { tools: false })).toBeNull();
        expect(hookContext('SessionStart', [text], { tools: false, messages: [message] })).toBe(`${contextHint([text])} ${message}`);
        expect(hookContext('UserPromptSubmit', [text], { tools: false })).toBe(contextHint([text]));
    });

    test('SessionStart names the tools for the depth the agent sits at', () => {
        expect(hookContext('SessionStart', [], { depth: 2 })).toBe(toolsNote({ depth: 2 }));
    });

    test('a line drawn while the agent ran is named at its next prompt and not at a start', () => {
        const changed = contextChangeNote([], [terminal]);
        expect(hookContext('UserPromptSubmit', [terminal], { changed })).toBe(`${contextHint([terminal])} ${changed}`);
        // The start is handed the whole list, so the same note there would only say it twice.
        expect(hookContext('SessionStart', [terminal], { changed })).toBe(`${TERMINAL_NOTE} ${contextHint([terminal])}`);
        expect(hookContext('UserPromptSubmit', [terminal], { changed: null })).toBe(contextHint([terminal]));
    });

    test('a message from another node rides along with a prompt and with a start', () => {
        const message = 'Ruimte: node term-2 ("builder") sent you a message: the build is green.';
        expect(hookContext('UserPromptSubmit', [], { messages: [message] })).toBe(message);
        expect(hookContext('SessionStart', [], { messages: [message] })).toBe(`${TERMINAL_NOTE} ${message}`);
    });
});

describe('contextChangeNote', () => {
    test('nothing to say when the set is the same, also after a rename', () => {
        expect(contextChangeNote([], [])).toBeNull();
        expect(contextChangeNote([text, chat], [chat, text])).toBeNull();
        expect(contextChangeNote([text], [{ ...text, title: 'Renamed' }])).toBeNull();
    });

    test('names what was added and points at the CLI', () => {
        expect(contextChangeNote([text], [text, terminal])).toBe(
            'Ruimte: the linked context changed since your last turn. Added: "dev server" (terminal). `context_list` lists it and `context_read` reads one item.'
        );
    });

    test('names what was removed, and says so when nothing is left', () => {
        expect(contextChangeNote([text, chat], [text])).toBe(
            'Ruimte: the linked context changed since your last turn. Removed: "planner" (chat). `context_list` lists it and `context_read` reads one item.'
        );
        expect(contextChangeNote([text], [])).toBe(
            'Ruimte: the linked context changed since your last turn. Removed: "Sprint goals" (text). Nothing is linked now.'
        );
    });

    test('reports both directions in one note', () => {
        const note = contextChangeNote([text, chat], [chat, terminal]);
        expect(note).toContain('Added: "dev server" (terminal).');
        expect(note).toContain('Removed: "Sprint goals" (text).');
    });
});

test('every agent learns how to send a notification only when requested', () => {
    for (const standalone of [false, true]) {
        const note = toolsNote({ depth: 0, standalone });
        expect(note).toContain('Call `alert` only when the person asked to be notified, at the moment they named');
    }
});
