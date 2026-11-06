import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ToolRefusal } from '@adecore/agents/context';
import { fileUriToPath, type Diagnostic, type Range } from '@adecore/lsp';
import { storedPathOf, type LanguageMethod, type SqlChoice } from '@ruimte/contracts';
import { languageOf } from '../fs/read.ts';
import type { AgentDocument, LanguageHost } from './host.ts';
import { KIND_PROFILES, lspLanguageId } from './profiles.ts';
import type { SqlFileContext } from './sql-file-context.ts';

/* The project's running language servers as an agent may ask them; absent on a host without them. */
export type LanguageAgentHost = Pick<
    AgentLanguage,
    'diagnostics' | 'hover' | 'definition' | 'references' | 'symbols' | 'sqlFile' | 'problems' | 'supertypes' | 'subtypes'
>;

/* A place in a file as an agent writes it: lines and columns from 1, a column counting characters. */
interface AgentPosition {
    line: number;
    column: number;
}

interface AgentSpan {
    path: string;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
}

interface AgentServer {
    kind: string;
    state: string;
    message?: string;
}

/* What every answer says besides itself: which file, whether its text is an editor's, and the servers that answered. */
interface AgentAnswerHead {
    path: string;
    unsaved: boolean;
    servers: AgentServer[];
}

interface AgentDiagnostic extends AgentSpan {
    severity: 'error' | 'warning' | 'information' | 'hint';
    server: string;
    source: string | null;
    code: string | null;
    message: string;
}

interface AgentType extends AgentSpan {
    name: string;
    kind: string;
    detail: string | null;
}

interface AgentTypes {
    type: AgentType | null;
    types: AgentType[];
}

/* A `TypeHierarchyItem` as a server answers it. */
interface TypeItem {
    name: string;
    kind: number;
    detail?: string;
    uri: string;
    range: Range;
    selectionRange?: Range;
}

interface AgentProblems {
    servers: Array<{ kind: string; process: string }>;
    files: number;
    diagnostics: AgentDiagnostic[];
    truncated: boolean;
    /* Files left out because their SQL is read against a connection turned off for agents. */
    withheld: number;
    /* False while no whole-project pull ran yet, which only a person starts. */
    pulled: boolean;
}

interface AgentSymbol {
    name: string;
    kind: string;
    detail: string | null;
    depth: number;
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
}

interface AgentSqlFile {
    path: string;
    /* Why the file reads this connection: its own choice, the folder of a console, the project's default; none or unbound when it reads none. */
    source: SqlChoice['source'];
    connection: { id: string; name: string; engine: string } | null;
    database: string | null;
    dialect: string | null;
    version: string | null;
    snapshot: string | null;
    takenAt: string | null;
    /* The command that checks the file from a shell, with the dialect and the snapshot it is read against. */
    command: string;
    /* Whether the program of the command is installed on this machine; without it the command names it bare. */
    installed: boolean;
}

/* Where an agent's call stands: the project and its folder. */
interface AgentLanguagePlace {
    projectId: string;
    folder: string;
}

const SEVERITIES = ['error', 'warning', 'information', 'hint'] as const;

/* The most problems a whole-project answer lists; the rest is only counted as truncated. */
const PROBLEMS_LIMIT = 500;

/* `SymbolKind` of LSP, from 1. */
const SYMBOL_KINDS = [
    'file',
    'module',
    'namespace',
    'package',
    'class',
    'method',
    'property',
    'field',
    'constructor',
    'enum',
    'interface',
    'function',
    'variable',
    'constant',
    'string',
    'number',
    'boolean',
    'array',
    'object',
    'key',
    'null',
    'enum-member',
    'struct',
    'event',
    'operator',
    'type-parameter'
];

/* The UTF-16 offset of a column counted in characters, which is what LSP counts in. */
export function utf16Column(line: string, column: number): number {
    let units = 0;
    let characters = 0;
    for (const character of line) {
        if (characters >= column - 1) {
            break;
        }
        units += character.length;
        characters += 1;
    }
    return units + Math.max(0, column - 1 - characters);
}

/* The column in characters, from 1, of a UTF-16 offset in a line. */
export function characterColumn(line: string, offset: number): number {
    let units = 0;
    let characters = 0;
    for (const character of line) {
        if (units >= offset) {
            break;
        }
        units += character.length;
        characters += 1;
    }
    return characters + 1 + Math.max(0, offset - units);
}

function linesOf(text: string): string[] {
    return text.split(/\r\n|\r|\n/);
}

/* A range of LSP as the agent reads it, in a file whose text is known, or by UTF-16 offsets when it is not. */
function spanOf(path: string, range: Range, text: string | null): AgentSpan {
    const lines = text === null ? null : linesOf(text);
    const column = (line: number, character: number): number => (lines === null ? character + 1 : characterColumn(lines[line] ?? '', character));
    return {
        path,
        line: range.start.line + 1,
        column: column(range.start.line, range.start.character),
        endLine: range.end.line + 1,
        endColumn: column(range.end.line, range.end.character)
    };
}

/* The text of a hover, whichever of its shapes the server answered with. */
export function hoverText(contents: unknown): string {
    if (typeof contents === 'string') {
        return contents;
    }
    if (Array.isArray(contents)) {
        return contents
            .map(hoverText)
            .filter((part) => part !== '')
            .join('\n\n');
    }
    if (typeof contents === 'object' && contents !== null && 'value' in contents) {
        const { value, language } = contents as { value: unknown; language?: unknown };
        return typeof language === 'string' && typeof value === 'string' ? `\`\`\`${language}\n${value}\n\`\`\`` : String(value);
    }
    return '';
}

/* Every location an answer of `definition` or `references` holds, as a uri and a range, whichever shape it came in. */
export function locationsOf(result: unknown): Array<{ uri: string; range: Range }> {
    const list = Array.isArray(result) ? result : result === null || result === undefined ? [] : [result];
    return list.flatMap((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null) {
            return [];
        }
        const link = entry as { targetUri?: string; targetSelectionRange?: Range; targetRange?: Range; uri?: string; range?: Range };
        if (typeof link.targetUri === 'string') {
            const range = link.targetSelectionRange ?? link.targetRange;
            return range === undefined ? [] : [{ uri: link.targetUri, range }];
        }
        return typeof link.uri === 'string' && link.range !== undefined ? [{ uri: link.uri, range: link.range }] : [];
    });
}

interface TreeSymbol {
    name: string;
    kind: number;
    detail?: string;
    range?: Range;
    selectionRange?: Range;
    location?: { range: Range };
    containerName?: string;
    children?: TreeSymbol[];
}

/* The symbols of a document, a tree or a flat list, in reading order with how deep each sits. */
export function symbolsOf(result: unknown, text: string, path: string): AgentSymbol[] {
    const symbols: AgentSymbol[] = [];
    const visit = (entries: readonly TreeSymbol[], depth: number): void => {
        for (const entry of entries) {
            const range = entry.selectionRange ?? entry.range ?? entry.location?.range;
            if (range === undefined) {
                continue;
            }
            const span = spanOf(path, range, text);
            symbols.push({
                name: entry.name,
                kind: SYMBOL_KINDS[entry.kind - 1] ?? 'symbol',
                detail: entry.detail ?? entry.containerName ?? null,
                depth,
                line: span.line,
                column: span.column,
                endLine: span.endLine,
                endColumn: span.endColumn
            });
            visit(entry.children ?? [], depth + 1);
        }
    };
    visit(Array.isArray(result) ? (result as TreeSymbol[]) : [], 0);
    return symbols;
}

function severityOf(diagnostic: Diagnostic): AgentDiagnostic['severity'] {
    return SEVERITIES[(diagnostic.severity ?? 1) - 1] ?? 'error';
}

/* The kind a process belongs to; a server of a person's own is its own kind. */
function kindOfProcess(process: string): string {
    const kind = Object.values(KIND_PROFILES).find((profile) => profile.components.some((component) => component.name === process));

    return kind?.kind ?? process;
}

interface AgentLanguageOptions {
    host: Pick<LanguageHost, 'forAgent' | 'programOf' | 'cachedWorkspaceProblems'>;
    sql: { fileContext(projectId: string, path: string): Promise<SqlFileContext> };
    /* The text of a file on disk, or null when it cannot be read. */
    readText?: (path: string) => Promise<string | null>;
}

function isSql(path: string): boolean {
    return path.toLowerCase().endsWith('.sql');
}

/*
 * The project's running language servers as an agent's `language` tool reaches them. Nothing here
 * installs a server: a file opens in the servers that are installed, as it would for a person, and a
 * server that is not answers so. A file whose SQL is read against a connection a person turned off for
 * agents is refused whole, since every answer about it may say what that schema holds.
 */
export class AgentLanguage {
    private readonly options: AgentLanguageOptions;

    constructor(options: AgentLanguageOptions) {
        this.options = options;
    }

    async diagnostics(place: AgentLanguagePlace, caller: string, path: string): Promise<AgentAnswerHead & { diagnostics: AgentDiagnostic[] }> {
        return this.ask(place, caller, path, async (document, head) => {
            const reports = await document.diagnostics();
            const diagnostics = reports.flatMap(({ server, diagnostics: found }) =>
                found.map((diagnostic) => ({
                    ...spanOf(head.path, diagnostic.range, document.text),
                    severity: severityOf(diagnostic),
                    server,
                    source: diagnostic.source ?? null,
                    code: diagnostic.code === undefined ? null : String(diagnostic.code),
                    message: diagnostic.message
                }))
            );
            diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
            return { ...head, diagnostics };
        });
    }

    async hover(place: AgentLanguagePlace, caller: string, path: string, at: AgentPosition): Promise<AgentAnswerHead & { contents: string | null }> {
        return this.ask(place, caller, path, async (document, head) => {
            const answer = await document.request('textDocument/hover', { position: positionIn(document.text, at) });
            const contents = (answer.result as { contents?: unknown } | null)?.contents;
            const text = contents === undefined ? '' : hoverText(contents).trim();
            return { ...head, contents: text === '' ? null : text };
        });
    }

    async definition(place: AgentLanguagePlace, caller: string, path: string, at: AgentPosition): Promise<AgentAnswerHead & { locations: AgentSpan[] }> {
        return this.locate(place, caller, path, 'textDocument/definition', at, {});
    }

    async references(place: AgentLanguagePlace, caller: string, path: string, at: AgentPosition): Promise<AgentAnswerHead & { locations: AgentSpan[] }> {
        return this.locate(place, caller, path, 'textDocument/references', at, { context: { includeDeclaration: true } });
    }

    async symbols(place: AgentLanguagePlace, caller: string, path: string): Promise<AgentAnswerHead & { symbols: AgentSymbol[] }> {
        return this.ask(place, caller, path, async (document, head) => {
            const answer = await document.request('textDocument/documentSymbol', {});
            return { ...head, symbols: symbolsOf(answer.result, document.text, head.path) };
        });
    }

    /*
     * The problems the servers that report for the whole project found in the last pull, in every file, also those
     * nobody has open. It starts no pull, since only a person's press does. With a path that file opens first, so its servers start and the same refusals apply as for `diagnostics`.
     */
    async problems(place: AgentLanguagePlace, caller: string, path: string | null): Promise<AgentProblems> {
        if (path === null) {
            return this.workspaceProblems(place);
        }

        return this.ask(place, caller, path, () => this.workspaceProblems(place));
    }

    async supertypes(place: AgentLanguagePlace, caller: string, path: string, at: AgentPosition): Promise<AgentAnswerHead & AgentTypes> {
        return this.hierarchy(place, caller, path, at, 'typeHierarchy/supertypes');
    }

    async subtypes(place: AgentLanguagePlace, caller: string, path: string, at: AgentPosition): Promise<AgentAnswerHead & AgentTypes> {
        return this.hierarchy(place, caller, path, at, 'typeHierarchy/subtypes');
    }

    /* Which connection, database and snapshot a `.sql` file is read against, and the command that checks it from a shell. */
    async sqlFile(place: AgentLanguagePlace, path: string): Promise<AgentSqlFile> {
        const stored = storedPathOf(place.folder, path);
        if (!isSql(path)) {
            throw new ToolRefusal(
                'not-sql',
                `${stored} is no .sql file; the SQL in other files is read against the project's default, which language sql of a .sql file without a choice of its own shows`
            );
        }
        const context = await this.options.sql.fileContext(place.projectId, path);
        this.gate(context.access, context.choice);
        const { choice, snapshot } = context;
        const connection = choice.source === 'none' || choice.source === 'unbound' ? null : choice.connection;
        const dialect =
            choice.source === 'unbound'
                ? 'generic'
                : (snapshot?.dialect ?? (connection === null ? null : connection.config.engine === 'sqlite' ? 'sqlite' : 'mysql'));
        const program = this.options.host.programOf('sql-native');
        const command = [
            `${program === null ? 'sql-language-server' : shellQuote(program)} check`,
            ...(dialect === null ? [] : [`--dialect ${dialect}`]),
            ...(snapshot?.version === undefined ? [] : [`--version ${shellQuote(snapshot.version)}`]),
            ...(snapshot === null ? [] : [`--schema ${shellQuote(snapshot.path)}`]),
            shellQuote(path)
        ].join(' ');
        return {
            path: stored,
            source: choice.source,
            connection: connection === null ? null : { id: connection.id, name: connection.name, engine: connection.config.engine },
            database: choice.source === 'none' || choice.source === 'unbound' ? null : choice.database,
            dialect,
            version: snapshot?.version ?? null,
            snapshot: snapshot?.path ?? null,
            takenAt: snapshot?.takenAt ?? null,
            command,
            installed: program !== null
        };
    }

    private async workspaceProblems(place: AgentLanguagePlace): Promise<AgentProblems> {
        const { servers, pulled, files, reports } = this.options.host.cachedWorkspaceProblems(place.projectId);

        if (servers.length === 0) {
            throw new ToolRefusal(
                'no-workspace-diagnostics',
                'No running language server of this project reports problems for the whole project; language_file with action diagnostics reads one file'
            );
        }

        const texts = new Map<string, string | null>();
        const withheld = new Set<string>();
        const found: AgentDiagnostic[] = [];

        for (const report of reports) {
            if (withheld.has(report.path)) {
                continue;
            }

            if (readsSql(kindOfProcess(report.server))) {
                const context = await this.options.sql.fileContext(place.projectId, report.absolutePath);

                if (isWithheld(context.access, context.choice)) {
                    withheld.add(report.path);
                    continue;
                }
            }

            if (!texts.has(report.absolutePath)) {
                texts.set(report.absolutePath, await this.readText(report.absolutePath));
            }

            for (const diagnostic of report.diagnostics) {
                found.push({
                    ...spanOf(report.path, diagnostic.range, texts.get(report.absolutePath) ?? null),
                    severity: severityOf(diagnostic),
                    server: report.server,
                    source: diagnostic.source ?? null,
                    code: diagnostic.code === undefined ? null : String(diagnostic.code),
                    message: diagnostic.message
                });
            }
        }

        found.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column);

        return {
            servers: servers.map((process) => ({ kind: kindOfProcess(process), process })),
            files,
            diagnostics: found.slice(0, PROBLEMS_LIMIT),
            truncated: found.length > PROBLEMS_LIMIT,
            withheld: withheld.size,
            pulled
        };
    }

    /* The type at a place, then its supertypes or subtypes; the follow-up reaches the process that made the item. */
    private async hierarchy(
        place: AgentLanguagePlace,
        caller: string,
        path: string,
        at: AgentPosition,
        method: 'typeHierarchy/supertypes' | 'typeHierarchy/subtypes'
    ): Promise<AgentAnswerHead & AgentTypes> {
        return this.ask(place, caller, path, async (document, head) => {
            const prepared = await document.request('textDocument/prepareTypeHierarchy', { position: positionIn(document.text, at) });
            const item = Array.isArray(prepared.result) ? (prepared.result[0] as TypeItem | undefined) : undefined;

            if (item === undefined) {
                return { ...head, type: null, types: [] };
            }

            const answer = await document.request(method, { item });
            const items = Array.isArray(answer.result) ? (answer.result as TypeItem[]) : [];
            const texts = new Map<string, string | null>([[document.absolutePath, document.text]]);
            const typeOf = async (entry: TypeItem): Promise<AgentType | null> => {
                const target = fileUriToPath(entry.uri);

                if (target === null) {
                    return null;
                }

                if (!texts.has(target)) {
                    texts.set(target, await this.readText(target));
                }

                return {
                    ...spanOf(storedPathOf(place.folder, target), entry.selectionRange ?? entry.range, texts.get(target) ?? null),
                    name: entry.name,
                    kind: SYMBOL_KINDS[entry.kind - 1] ?? 'symbol',
                    detail: entry.detail ?? null
                };
            };
            const types: AgentType[] = [];

            for (const entry of items) {
                const type = await typeOf(entry);

                if (type !== null) {
                    types.push(type);
                }
            }

            return { ...head, type: await typeOf(item), types };
        });
    }

    private async locate(
        place: AgentLanguagePlace,
        caller: string,
        path: string,
        method: LanguageMethod,
        at: AgentPosition,
        extra: object
    ): Promise<AgentAnswerHead & { locations: AgentSpan[] }> {
        return this.ask(place, caller, path, async (document, head) => {
            const answer = await document.request(method, { position: positionIn(document.text, at), ...extra });
            const texts = new Map<string, string | null>([[document.absolutePath, document.text]]);
            const locations: AgentSpan[] = [];
            for (const { uri, range } of locationsOf(answer.result)) {
                const target = fileUriToPath(uri);
                if (target === null) {
                    continue;
                }
                if (!texts.has(target)) {
                    texts.set(target, await this.readText(target));
                }
                locations.push(spanOf(storedPathOf(place.folder, target), range, texts.get(target) ?? null));
            }
            return { ...head, locations };
        });
    }

    /* Opens the file for the call, checks that a server can answer and that the agent may see what it says, and runs `work`. */
    private async ask<T>(
        place: AgentLanguagePlace,
        caller: string,
        path: string,
        work: (document: AgentDocument, head: AgentAnswerHead) => Promise<T>
    ): Promise<T> {
        const stored = storedPathOf(place.folder, path);
        const disk = await this.readText(path);
        if (disk === null) {
            throw new ToolRefusal('bad-path', `${stored} cannot be read as text`);
        }
        const languageId = lspLanguageId(languageOf(basename(path)) ?? 'plaintext');
        return this.options.host.forAgent(place.projectId, { path, languageId, disk, owner: `agent:${caller}` }, async (document) => {
            await this.checkServers(document, stored, languageId);
            if (document.servers.some((server) => readsSql(server.kind))) {
                const context = await this.options.sql.fileContext(place.projectId, path);
                this.gate(context.access, context.choice);
            }
            const servers = document.servers.map((server) => ({
                kind: server.kind,
                state: server.state,
                ...(server.message ? { message: server.message } : {})
            }));
            return work(document, { path: stored, unsaved: document.unsaved, servers });
        });
    }

    private async checkServers(document: AgentDocument, stored: string, languageId: string): Promise<void> {
        if (document.servers.length === 0) {
            throw new ToolRefusal('no-language-server', `No language server of this machine serves ${languageId} files such as ${stored}`);
        }
        if (document.servers.some((server) => server.state === 'ready' || server.state === 'indexing')) {
            return;
        }
        const missing = document.servers.filter((server) => server.state === 'not-installed').map((server) => server.kind);
        if (missing.length === document.servers.length) {
            throw new ToolRefusal(
                'language-server-not-installed',
                `The ${missing.join(' and ')} language server is not installed on this machine; a person installs it in the app, in Settings under Language servers, which an agent cannot do`
            );
        }
        const crashed = document.servers.find((server) => server.state === 'crashed');
        if (crashed !== undefined) {
            throw new ToolRefusal(
                'language-server-crashed',
                `The ${crashed.kind} language server is down${crashed.message ? `: ${crashed.message}` : ''}; a person restarts it in the app`
            );
        }
        throw new ToolRefusal('language-server-starting', `The language server of ${stored} did not come up in time; ask again in a moment`);
    }

    private readText(path: string): Promise<string | null> {
        return (this.options.readText ?? readTextOrNull)(path);
    }

    /* The same rule `database` holds agents to: a connection a person turned off for agents says nothing of its schema to them. */
    private gate(access: string, choice: SqlChoice): void {
        if (isWithheld(access, choice) && choice.source !== 'none' && choice.source !== 'unbound') {
            throw new ToolRefusal(
                'database-access-off',
                `The SQL of this file is read against ${choice.connection.name}, which a person turned off for agents; ask them, who can turn it on in the connections dialog of the app`
            );
        }
    }
}

/* Whether the connection a file is read against was turned off for agents. */
function isWithheld(access: string, choice: SqlChoice): boolean {
    return access === 'off' && choice.source !== 'none' && choice.source !== 'unbound';
}

/* Whether a kind reads the project's SQL settings, which is what makes its answers say what a schema holds. */
function readsSql(kind: string): boolean {
    return kind in KIND_PROFILES && KIND_PROFILES[kind as keyof typeof KIND_PROFILES].components.some((component) => component.settings !== undefined);
}

function shellQuote(text: string): string {
    return /^[\w./@%+-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`;
}

function positionIn(text: string, at: AgentPosition): { line: number; character: number } {
    const lines = linesOf(text);
    if (at.line > lines.length) {
        throw new ToolRefusal('bad-position', `The file has ${lines.length} lines, not ${at.line}`);
    }
    return { line: at.line - 1, character: utf16Column(lines[at.line - 1] ?? '', at.column) };
}

async function readTextOrNull(path: string): Promise<string | null> {
    return readFile(path, 'utf8').catch(() => null);
}
