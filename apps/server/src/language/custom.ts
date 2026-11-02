import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute } from 'node:path';
import {
    CUSTOM_SERVER_PREFIX,
    CustomLanguageServerSchema,
    isValidFilePattern,
    LANGUAGE_ERROR_CODES,
    type CustomLanguageServer,
    type CustomLanguageServerInput,
    type LanguageCustomCheckResult,
    type LanguageErrorCode
} from '@ruimte/contracts';
import { CodedError, isNotFound, writeAtomic } from '@adecore/agents';
import { z } from 'zod';
import { sha256 } from '../artifacts/artifact-fs.ts';
import type { KindProfile } from './profiles.ts';

class CustomServerError extends CodedError<LanguageErrorCode> {}

/* A removal of an extension's servers that the file did not take. They left the list all the same, and `ids` names them. */
export class UnsavedRemoval extends Error {
    readonly ids: readonly string[];

    constructor(ids: readonly string[], cause: unknown) {
        super(cause instanceof Error ? cause.message : String(cause), { cause });
        this.ids = ids;
    }
}

const StoredServerSchema = CustomLanguageServerSchema.omit({ held: true }).extend({ approval: z.string().min(1) });
type StoredServer = z.infer<typeof StoredServerSchema>;

/* The path of an executable on this machine: the command itself when it is one, else where PATH has it. */
type ResolveCommand = (command: string) => string | null;

export const resolveCommandOnPath: ResolveCommand = (command) => {
    // A relative path would mean the folder of whichever project starts the server.
    if (!isAbsolute(command) && /[\\/]/.test(command)) {
        return null;
    }
    return Bun.which(command, { PATH: process.env.PATH ?? '' });
};

/* What saving approves: the command, its arguments and its environment, and nothing the person can change without a new save. */
function approvalOf(server: Pick<CustomLanguageServer, 'command' | 'args' | 'env'>): string {
    return sha256(JSON.stringify([server.command, server.args, Object.entries(server.env).sort(([left], [right]) => left.localeCompare(right))]));
}

/*
 * The language servers a person added, in one file under `$RUIMTE_HOME/language-servers`. Never in a
 * project: a project file or an agent with a shell could name any command there. A saved server carries
 * the hash of what the save approved, and one whose command, arguments or environment no longer match
 * it (the file was edited by hand) is held: listed, and never started until a person saves it again.
 */
export class CustomLanguageServers {
    private readonly path: string;
    private readonly resolve: ResolveCommand;
    private servers: StoredServer[] = [];
    /* Entries of this file that this version cannot read, kept as they are when it writes. */
    private unreadable: unknown[] = [];
    /* The file is there and is no JSON, which a write would destroy. */
    private damaged = false;
    /* Extensions whose servers were removed while the file may still hold them. */
    private readonly retired = new Set<string>();
    private writing: Promise<unknown> = Promise.resolve();

    constructor(options: { path: string; resolve?: ResolveCommand }) {
        this.path = options.path;
        this.resolve = options.resolve ?? resolveCommandOnPath;
    }

    async load(): Promise<void> {
        let text: string;
        try {
            text = await readFile(this.path, 'utf8');
        } catch (error) {
            if (isNotFound(error)) {
                return;
            }
            throw error;
        }
        let entries: unknown[] = [];
        try {
            const parsed = JSON.parse(text) as { servers?: unknown };
            entries = Array.isArray(parsed.servers) ? parsed.servers : [];
        } catch {
            this.damaged = true;
            console.error(`${this.path} is not JSON, so no language server of a person's own is loaded and none is saved until it is fixed`);
        }
        for (const entry of entries) {
            const parsed = StoredServerSchema.safeParse(entry);
            if (parsed.success) {
                this.servers.push(parsed.data);
            } else {
                this.unreadable.push(entry);
            }
        }
    }

    list(): CustomLanguageServer[] {
        return listed(this.active());
    }

    get(id: string): CustomLanguageServer | undefined {
        return this.list().find((server) => server.id === id);
    }

    check(command: string): LanguageCustomCheckResult {
        const path = this.resolve(command.trim());
        return path === null ? { found: false } : { found: true, path };
    }

    /* Saves a server a person gave, which approves starting exactly what it names. */
    async save(input: CustomLanguageServerInput): Promise<CustomLanguageServer> {
        this.assertWritable();
        this.assertRunnable(input);

        return this.mutate((servers) => {
            if (input.id !== undefined && !servers.some((server) => server.id === input.id)) {
                throw new CustomServerError(LANGUAGE_ERROR_CODES.invalidServer, `There is no server ${input.id} to change`);
            }

            const server = serverOf(input, input.id ?? newServerId(), undefined);

            return { next: replaced(servers, server), result: server };
        });
    }

    /*
     * An extension's server, by its name, so loading it again changes the one it already added. Who owns the name is
     * decided in the queue, and only a registration that is saved has its command checked: one a person took over keeps
     * their command, whatever the extension names.
     */
    async saveFor(extension: string, input: CustomLanguageServerInput): Promise<CustomLanguageServer> {
        this.assertWritable();

        const name = input.name.trim();

        return this.mutate((servers) => {
            // A person made it theirs, so loading the extension again neither changes it nor adds a second.
            const approved = listed(servers).find((server) => server.extension === undefined && server.name === name);

            if (approved !== undefined) {
                return { next: null, result: approved };
            }

            this.assertRunnable(input);

            const known = servers.find((server) => server.extension === extension && server.name === name);
            const server = serverOf(input, known?.id ?? newServerId(), extension);

            return { next: replaced(servers, server), result: server };
        });
    }

    ownedBy(extension: string): string[] {
        return this.active()
            .filter((server) => server.extension === extension)
            .map((server) => server.id);
    }

    /* Whether there was such a server. */
    async remove(id: string): Promise<boolean> {
        this.assertWritable();

        return this.mutate((servers) =>
            servers.some((server) => server.id === id) ? { next: servers.filter((server) => server.id !== id), result: true } : { next: null, result: false }
        );
    }

    /*
     * Removes every server of the extension in one write, and gives the ids it removed. They leave the list at once, also
     * when the write fails, so none starts again for an extension that no longer runs; that failure is an `UnsavedRemoval`
     * naming them, so their processes stop all the same.
     */
    async removeOwnedBy(extension: string): Promise<string[]> {
        let owned: string[] = [];

        try {
            this.assertWritable();

            return await this.mutate((servers) => {
                owned = servers.filter((server) => server.extension === extension).map((server) => server.id);
                this.retired.add(extension);

                return { next: owned.length === 0 ? null : servers.filter((server) => server.extension !== extension), result: owned };
            });
        } catch (e) {
            throw new UnsavedRemoval(owned, e);
        }
    }

    /* The extensions that own a server on the list. */
    owners(): string[] {
        return [...new Set(this.active().flatMap((server) => server.extension ?? []))];
    }

    private active(): StoredServer[] {
        return this.servers.filter((server) => server.extension === undefined || !this.retired.has(server.extension));
    }

    private assertRunnable(input: CustomLanguageServerInput): void {
        for (const pattern of input.patterns) {
            if (!isValidFilePattern(pattern.trim())) {
                throw new CustomServerError(LANGUAGE_ERROR_CODES.invalidServer, `${pattern} is not a file pattern`);
            }
        }

        if (this.resolve(input.command.trim()) === null) {
            throw new CustomServerError(
                LANGUAGE_ERROR_CODES.invalidServer,
                `${input.command.trim()} is not an executable on this machine. Give an absolute path, or a command that is on the PATH of the daemon.`
            );
        }
    }

    private assertWritable(): void {
        if (this.damaged) {
            throw new CustomServerError(LANGUAGE_ERROR_CODES.invalidServer, `${this.path} is not JSON. Fix or remove it first.`);
        }
    }

    /*
     * One change at a time, computed from the list the previous change left, so two saves or removes
     * never write over each other. The list in memory only changes once the file has it, except that a
     * retired server is gone from it at once; the next write that lands leaves it out of the file too.
     */
    private mutate<T>(change: (servers: StoredServer[]) => { next: StoredServer[] | null; result: T }): Promise<T> {
        const run = this.writing.then(async () => {
            const { next, result } = change(this.active());

            if (next !== null) {
                await mkdir(dirname(this.path), { recursive: true });
                await writeAtomic(this.path, `${JSON.stringify({ servers: [...next, ...this.unreadable] }, null, 2)}\n`, 0o600, { durable: true });
                this.servers = next;
                this.retired.clear();
            }

            return result;
        });
        this.writing = run.catch(() => undefined);

        return run;
    }
}

function newServerId(): string {
    return `${CUSTOM_SERVER_PREFIX}${randomUUID()}`;
}

function serverOf(input: CustomLanguageServerInput, id: string, extension: string | undefined): CustomLanguageServer {
    return {
        id,
        ...(extension === undefined ? {} : { extension }),
        name: input.name.trim(),
        command: input.command.trim(),
        args: [...input.args],
        env: { ...input.env },
        languages: [...new Set(input.languages.map((language) => language.trim().toLowerCase()))],
        patterns: [...new Set(input.patterns.map((pattern) => pattern.trim()))],
        ...(input.initializationOptions === undefined ? {} : { initializationOptions: input.initializationOptions }),
        ...(input.projects === undefined || input.projects.length === 0 ? {} : { projects: [...new Set(input.projects)] })
    };
}

function listed(servers: StoredServer[]): CustomLanguageServer[] {
    return servers.map(({ approval, ...server }) => ({ ...server, ...(approval === approvalOf(server) ? {} : { held: true }) }));
}

function replaced(servers: StoredServer[], server: CustomLanguageServer): StoredServer[] {
    const stored: StoredServer = { ...server, approval: approvalOf(server) };

    return servers.some((candidate) => candidate.id === server.id)
        ? servers.map((candidate) => (candidate.id === server.id ? stored : candidate))
        : [...servers, stored];
}

/* What a server of a person's own runs: one process, named by its id on the wire. */
export function customProfile(server: CustomLanguageServer): KindProfile {
    return {
        kind: server.id as KindProfile['kind'],
        components: [
            {
                name: server.id,
                title: server.name,
                languages: server.languages,
                patterns: server.patterns,
                entry: '',
                command: server.command,
                args: () => server.args,
                initializationOptions: () => server.initializationOptions ?? {},
                env: server.env,
                // A server that offers the pull expects it, since the daemon says it pulls; one that does not is never asked.
                pullDiagnostics: true
            }
        ]
    };
}
