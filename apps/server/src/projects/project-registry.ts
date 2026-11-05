import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Serializer } from '@adecore/utils/async';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import { ProjectIconChoiceSchema } from '@ruimte/contracts';
import { z } from 'zod';
import { errorText } from '../error-text.ts';
import { ProjectError } from './project-error.ts';

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
    projects: z.array(z.unknown()).transform((entries) =>
        entries.flatMap((entry) => {
            const parsed = RegistryEntrySchema.safeParse(entry);
            return parsed.success ? [parsed.data] : [];
        })
    )
});

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
    // Registry changes run one after the other; two clients opening at once must not lose an entry.
    private readonly writes = new Serializer();
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
        this.loading ??= this.read().then((entries) => {
            this.entries ??= entries;
            return this.entries;
        });
        return this.loading;
    }

    /* The entry of a project, refused with `project-not-found` when the registry has none. */
    async entry(projectId: string): Promise<RegistryEntry> {
        return entryIn(await this.load(), projectId);
    }

    /* Applies a change to the registry as it stands once the changes before it are written, never to a copy read earlier. */
    update(change: (entries: RegistryEntry[]) => RegistryEntry[]): Promise<void> {
        return this.writes.run(async () => {
            const entries = change(await this.load());
            this.entries = entries;
            await mkdir(this.home, { recursive: true, mode: 0o700 });
            // Durable like the project files: after a power loss the machine's list is the old one or the new one, never empty.
            await this.write(this.path, `${JSON.stringify({ projects: entries }, null, 2)}\n`, undefined, { durable: true });
        });
    }

    private async read(): Promise<RegistryEntry[]> {
        try {
            const parsed = RegistrySchema.safeParse(JSON.parse(await readFile(this.path, 'utf8')));
            return parsed.success ? parsed.data.projects : [];
        } catch (e) {
            if (!isNotFound(e)) {
                console.warn('The project registry would not parse; starting with an empty one:', errorText(e));
            }
            return [];
        }
    }
}
