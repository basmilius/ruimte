import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import { writeAtomic } from '@adecore/utils/fs';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { ProjectError } from './project-error.ts';
import { readJsonDocument, type JsonDocumentParse } from './project-files.ts';

const RegistryEntrySchema = z.object({
    projectId: z.string().min(1),
    name: z.string(),
    color: z.string(),
    folder: z.string().min(1),
    lastOpenedAt: z.number(),
    /* When a person last closed this project, which keeps it under Recent until it is opened again:
       neither age nor whether it is open right now moves a project. Absent in an older registry. */
    closedAt: z.number().nullish(),
    // A cache of what the canvas file holds, so `project.list` needs no document read.
    icon: ProjectIconChoiceSchema.nullish()
});
export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;

const RegistrySchema = z.object({
    projects: z.array(z.unknown())
});

interface RegistryRead {
    entries: RegistryEntry[];
    // Entries this Ruimte cannot read, written back untouched so a newer or hand-edited one is never lost.
    kept: unknown[];
}

function parseRegistry(text: string): JsonDocumentParse<RegistryRead> {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return { kind: 'unreadable' };
    }
    const parsed = RegistrySchema.safeParse(json);
    if (!parsed.success) {
        return { kind: 'unreadable' };
    }
    const entries: RegistryEntry[] = [];
    const kept: unknown[] = [];
    for (const raw of parsed.data.projects) {
        const entry = RegistryEntrySchema.safeParse(raw);
        if (entry.success) {
            entries.push(entry.data);
        } else {
            kept.push(raw);
        }
    }
    return { kind: 'ok', document: { entries, kept } };
}

function entryIn(entries: readonly RegistryEntry[], projectId: string): RegistryEntry {
    const entry = entries.find((candidate) => candidate.projectId === projectId);
    if (!entry) {
        throw new ProjectError('project-not-found', `No project ${projectId}`);
    }
    return entry;
}

/* The projects this machine knows, in `$RUIMTE_HOME/projects.json`: which folder each is, and what it looked like when last read. */
export class ProjectRegistry {
    private readonly path: string;
    private readonly home: string;
    private entries: RegistryEntry[] | null = null;
    private loading: Promise<RegistryEntry[]> | null = null;
    private kept: unknown[] = [];
    // Registry changes run one after the other; two clients opening at once must not lose an entry.
    private readonly writes = new Serializer();
    private readonly updated = new Set<() => void>();
    private readonly write: typeof writeAtomic;

    constructor(home: string, write: typeof writeAtomic = writeAtomic) {
        this.home = home;
        this.path = join(home, 'projects.json');
        this.write = write;
    }

    async load(): Promise<RegistryEntry[]> {
        if (this.entries) {
            return this.entries;
        }
        // One read for everyone who asks first, so a read that ends late never undoes a change made meanwhile.
        this.loading ??= this.read().then(
            (entries) => {
                this.entries ??= entries;
                return this.entries;
            },
            (e: unknown) => {
                // The next caller reads again rather than inheriting a failure that may have passed.
                this.loading = null;
                throw e;
            }
        );
        return this.loading;
    }

    /* The entry of a project, refused with `project-not-found` when the registry has none. */
    async entry(projectId: string): Promise<RegistryEntry> {
        return entryIn(await this.load(), projectId);
    }

    /* Calls back after every change that was written, for what keeps a view of the whole list. */
    onUpdate(listener: () => void): void {
        this.updated.add(listener);
    }

    /* Applies a change to the registry as it stands once the changes before it are written, never to a copy read earlier. */
    update(change: (entries: RegistryEntry[]) => RegistryEntry[]): Promise<void> {
        return this.writes.run(async () => {
            const entries = change(await this.load());
            this.entries = entries;
            await mkdir(this.home, { recursive: true, mode: 0o700 });
            // Durable like the project files: after a power loss the machine's list is the old one or the new one, never empty.
            await this.write(this.path, `${JSON.stringify({ projects: [...entries, ...this.kept] }, null, 2)}\n`, undefined, { durable: true });
            this.updated.forEach((listener) => listener());
        });
    }

    /* A file that will not parse is moved aside before the next write; one that fails to read at all is an error, never an empty list. */
    private async read(): Promise<RegistryEntry[]> {
        const read = await readJsonDocument(this.path, parseRegistry);
        if (read.kind === 'ok') {
            this.kept = read.document.kept;
            return read.document.entries;
        }
        if (read.kind === 'corrupt') {
            console.warn(`The project registry would not parse; it was moved to ${read.setAside} and a new one starts empty.`);
        }
        return [];
    }
}
