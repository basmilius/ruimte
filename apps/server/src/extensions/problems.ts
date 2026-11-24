import {
    EXTENSION_PROBLEM_FILES,
    extensionProblemDiagnostic,
    extensionProblemServer,
    extensionProjectPath,
    storedPathOf,
    type ExtensionFileProblems,
    type ExtensionProblem,
    type LanguageDiagnosticsEvent
} from '@ruimte/contracts';
import { ClientSinks } from '../client-sinks.ts';
import type { SessionSink } from '../wire.ts';
import { ExtensionRefusal } from './refusal.ts';

interface SourceProblems {
    extension: string;
    title: string;
    // By the path as a project file stores it.
    files: Map<string, { absolutePath: string; problems: ExtensionProblem[] }>;
}

/* What one source says about one file, as an agent's `language_problems` reads it. */
export interface ReportedProblems {
    // The name its reports go under in `language.diagnostics`.
    server: string;
    title: string;
    path: string;
    absolutePath: string;
    problems: readonly ExtensionProblem[];
}

interface ExtensionProblemsOptions {
    folderOf(projectId: string): string | null;
    holders(projectId: string): readonly string[];
}

/*
 * The problems the sources of extensions report, per project and source. In memory only: a source reports again when
 * its process starts, and what it said goes with its process, its project or its extension. A client draws them as it
 * draws a language server's, since they reach it as `language.diagnostics` under a name of their own.
 */
export class ExtensionProblems {
    private readonly sinks = new ClientSinks();
    // By project, then by the name of the source in `language.diagnostics`.
    private readonly projects = new Map<string, Map<string, SourceProblems>>();
    private readonly options: ExtensionProblemsOptions;

    constructor(options: ExtensionProblemsOptions) {
        this.options = options;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /* Replaces what the source said about these files, and nothing it said about any other. */
    async report(source: { extension: string; id: string; title: string }, projectId: string, files: readonly ExtensionFileProblems[]): Promise<void> {
        const folder = this.options.folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        const placed = files.map((file) => {
            const absolutePath = extensionProjectPath(folder, file.path);

            if (absolutePath === null) {
                throw new ExtensionRefusal('outside-project', `${file.path} is outside the project folder`);
            }

            return { path: storedPathOf(folder, absolutePath), absolutePath, problems: file.problems };
        });
        const server = extensionProblemServer(source.extension, source.id);
        const held = this.projects.get(projectId)?.get(server);
        const kept = new Set(held?.files.keys());

        for (const file of placed) {
            if (file.problems.length === 0) {
                kept.delete(file.path);
            } else {
                kept.add(file.path);
            }
        }

        if (kept.size > EXTENSION_PROBLEM_FILES) {
            throw new ExtensionRefusal('limit', `${source.title} holds problems for at most ${EXTENSION_PROBLEM_FILES} files of one project`);
        }

        const sources = this.projects.get(projectId) ?? new Map<string, SourceProblems>();
        const next: SourceProblems = held ?? { extension: source.extension, title: source.title, files: new Map() };

        next.title = source.title;
        sources.set(server, next);
        this.projects.set(projectId, sources);

        for (const file of placed) {
            if (file.problems.length === 0) {
                // A file the source never spoke for has nothing to take back.
                if (!next.files.delete(file.path)) {
                    continue;
                }
            } else {
                next.files.set(file.path, { absolutePath: file.absolutePath, problems: file.problems });
            }

            this.toHolders(projectId, diagnosticsOf(projectId, server, next.title, file.path, file.problems));
        }
    }

    clear(extension: string, source: string, projectId: string): void {
        this.forget(projectId, extensionProblemServer(extension, source));
    }

    /* Everything an extension said, in every project: its process is gone, so nothing would ever take it back. */
    drop(extension: string): void {
        for (const [projectId, sources] of [...this.projects]) {
            for (const [server, source] of [...sources]) {
                if (source.extension === extension) {
                    this.forget(projectId, server);
                }
            }
        }
    }

    /* The last client closed the project; nobody is left to tell. */
    dropProject(projectId: string): void {
        this.projects.delete(projectId);
    }

    /* What the sources hold for a project now, for a client that opened it after they reported. */
    replay(clientId: string, projectId: string): void {
        for (const [server, source] of this.projects.get(projectId) ?? []) {
            for (const [path, file] of source.files) {
                this.sinks.to(clientId, { event: 'language.diagnostics', payload: diagnosticsOf(projectId, server, source.title, path, file.problems) });
            }
        }
    }

    of(projectId: string): ReportedProblems[] {
        return [...(this.projects.get(projectId) ?? [])].flatMap(([server, source]) =>
            [...source.files].map(([path, file]) => ({ server, title: source.title, path, absolutePath: file.absolutePath, problems: file.problems }))
        );
    }

    /* The sources that reported in a project, also one that found nothing wrong, so an agent reads that it looked. */
    sourcesOf(projectId: string): { server: string; title: string }[] {
        return [...(this.projects.get(projectId) ?? [])].map(([server, source]) => ({ server, title: source.title }));
    }

    private forget(projectId: string, server: string): void {
        const sources = this.projects.get(projectId);
        const source = sources?.get(server);

        if (sources === undefined || source === undefined) {
            return;
        }

        sources.delete(server);

        if (sources.size === 0) {
            this.projects.delete(projectId);
        }

        for (const path of source.files.keys()) {
            this.toHolders(projectId, diagnosticsOf(projectId, server, source.title, path, []));
        }
    }

    private toHolders(projectId: string, payload: LanguageDiagnosticsEvent): void {
        for (const clientId of this.options.holders(projectId)) {
            this.sinks.to(clientId, { event: 'language.diagnostics', payload });
        }
    }
}

function diagnosticsOf(projectId: string, server: string, title: string, path: string, problems: readonly ExtensionProblem[]): LanguageDiagnosticsEvent {
    return { projectId, path, server, diagnostics: problems.map((problem) => extensionProblemDiagnostic(problem, title)) };
}
