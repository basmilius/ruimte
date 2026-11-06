import { chatOpener } from '@adecore/agents/chat';
import { WatchedSinks } from '@adecore/agents/host';
import type { RoutinePicked, RoutineSkillsPayload, RoutineSkillsResult } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { routineOpener } from '../opener.ts';
import { attachedReferences, type Reference } from '../projects/references.ts';
import { runCommand } from '../routines/command-run.ts';
import { RoutineAuthorStore, RoutineRunStore } from '../routines/routine-runs.ts';
import { RoutineError, RoutineStore } from '../routines/routine-store.ts';
import { Routines } from '../routines/routines.ts';
import type { SessionEvent } from '../wire.ts';
import type { AgentStores, AgentsBundle } from './agents.ts';
import type { ArtifactsBundle } from './artifacts.ts';
import type { LaunchesBundle } from './launches.ts';
import type { ProjectsBundle } from './projects.ts';

/* The clients that asked with `routine.watch`, who hear a project's routines change. */
class RoutineWatchers extends WatchedSinks<SessionEvent> {
    changed(projectId: string): void {
        this.emit({ event: 'routine.changed', payload: { projectId } });
    }
}

export interface RoutinesBundle {
    routines: Routines;
    store: RoutineStore;
    watchers: RoutineWatchers;
    /* What an agent would run as a skill in a project, for a routine's prompt before its chat exists. */
    skills(payload: RoutineSkillsPayload): Promise<RoutineSkillsResult>;
}

/*
 * The brief of a run that continues its chat. A wake carries no message of the person, so the views and chats
 * the prompt points at are named here; the chat may still open them from the run that started it.
 */
export function continuedBrief(brief: string | undefined, picked: RoutinePicked | undefined, lookup: (id: string) => Reference | null): string | undefined {
    if (brief === undefined) {
        return undefined;
    }
    const { note } = attachedReferences({ chats: picked?.chats, references: picked?.references }, lookup);
    return note === null ? brief : `${brief}\n\n${note}`;
}

interface RoutinesInput {
    home: string;
    machineId: string;
    stores: AgentStores;
    agents: AgentsBundle;
    projects: ProjectsBundle;
    launches: LaunchesBundle;
    artifacts: ArtifactsBundle;
}

/* Routines on this machine: their files in each project, what ran and the clock the outbox keeps for them. */
export async function wireRoutines({ home, machineId, stores, agents, projects, launches, artifacts }: RoutinesInput): Promise<RoutinesBundle> {
    const project = projects.store;
    const { chats, chatManager, outboxLink } = agents;
    const runs = new RoutineRunStore(home);
    const authors = new RoutineAuthorStore(home);
    await Promise.all([runs.load(), authors.load()]);
    const store = new RoutineStore({ folderOf: (projectId) => project.index.folderOf(projectId) });
    const watchers = new RoutineWatchers();
    const placed = (nodeId: string): boolean => project.index.locate(nodeId) !== null;
    const openChat = chatOpener({ chats, placed });
    const versionsUnder = (projectId: string, key: string) => {
        const summary = artifacts.store.list({ projectId }).find((candidate) => candidate.key === key);
        return summary === undefined ? null : artifacts.store.get(summary.artifactId);
    };
    const routines = new Routines({
        store,
        runs,
        authors,
        approvals: stores.commandApprovals,
        projects: async () => (await project.known()).filter((known) => project.index.has(known.projectId)),
        outbox: {
            enqueue: (projectId, target, work, notBefore) => outboxLink.enqueue(projectId, target, work, notBefore),
            ofKind: (kind) => stores.outbox.ofKind(kind),
            remove: (id) => stores.outbox.remove(id)
        },
        agents: {
            start: async ({ projectId, folder, chatId, routine, account, prompt, brief }) => {
                // A hidden agent of the routine: in the project without a canvas, and kept when the routine goes.
                await project.hiddenAgents.put({
                    projectId,
                    openedBy: routineOpener(routine.id),
                    node: { id: chatId, kind: 'chat', title: routine.title, x: 0, y: 0, w: 480, h: 560 }
                });
                await stores.prompts.put(projectId, chatId, prompt, { brief, picked: routine.picked });
                await outboxLink.enqueue(projectId, chatId, {
                    kind: 'start-agent',
                    payload: {
                        node: 'chat',
                        provider: routine.provider,
                        ...(routine.selection === undefined ? {} : { selection: routine.selection }),
                        cwd: folder,
                        runtimeMode: routine.mode,
                        // The mode a person approved is the widest anything the run starts may have.
                        ceiling: routine.mode,
                        ...(account === undefined ? {} : { account })
                    }
                });
            },
            info: (chatId) => chats.get(chatId)?.info,
            starting: (chatId) => stores.outbox.owes('start-agent', chatId),
            continueIn: async (chatId, { prompt, brief }, routine) => {
                const chat = await openChat(chatId);
                if (chat === null || chat.relocating?.() === true) {
                    return false;
                }
                const { mentions, skills } = routine.picked ?? {};
                return chatManager.withBrief(
                    chatId,
                    continuedBrief(brief, routine.picked, (id) => project.index.referenceBeside(chatId, id)),
                    () => chat.wake({ text: prompt, label: routine.title, taskIds: [], ...(mentions ? { mentions } : {}), ...(skills ? { skills } : {}) })
                );
            },
            // Opens a stored chat as well, so what it ran before is known before the run's turn opens.
            exists: async (chatId) => placed(chatId) && (await openChat(chatId)) !== null
        },
        commands: { run: runCommand },
        launches: {
            approved: async (projectId, launchId) => (await launches.store.resolve(projectId, launchId)).approved,
            run: async (projectId, launchId) => {
                const result = await launches.runner.start(projectId, launchId, { actor: 'agent' });
                if (result.outcome !== 'started') {
                    return { outcome: result.outcome };
                }
                const ended = launches.runner.ended(projectId, launchId);
                if (ended === null) {
                    return { outcome: 'busy' };
                }
                return {
                    outcome: 'started',
                    ended: ended.then(async (status) => {
                        const sessionId = launches.runner.sessionOf(projectId, launchId);
                        const text = sessionId === null ? null : await agents.sessions.get(sessionId)?.plainText();
                        return { exitCode: status.exitCode ?? 1, output: new TextEncoder().encode(text ?? '') };
                    })
                };
            }
        },
        output: {
            latest: (projectId, key) => {
                const found = versionsUnder(projectId, key);
                const version = found?.versions[0];
                return found && version ? { artifactId: found.artifact.artifactId, versionId: version.versionId, number: version.number } : null;
            },
            byRun: (projectId, key) => {
                const found = versionsUnder(projectId, key);
                const byRun = new Map<string, { artifactId: string; versionId: string; number: number }>();
                if (found === null) {
                    return byRun;
                }
                for (const version of found.versions) {
                    const runId = version.provenance.runId;
                    if (runId !== undefined && !byRun.has(runId)) {
                        byRun.set(runId, { artifactId: found.artifact.artifactId, versionId: version.versionId, number: version.number });
                    }
                }
                return byRun;
            },
            deliver: async ({ projectId, key, title, requestId, provenance, text }) => {
                await artifacts.artifacts.deliver({
                    projectId,
                    key,
                    title,
                    kind: 'report',
                    requestId,
                    provenance,
                    files: [{ name: 'output.txt', bytes: text }]
                });
            }
        },
        machineId,
        now: () => Date.now(),
        timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        onChanged: (projectId) => watchers.changed(projectId)
    });
    outboxLink.worker.handle('routine-run', (entry) => routines.handle(entry));
    store.onOutsideChange = (projectId) => {
        void routines
            .schedule(projectId)
            .then(() => watchers.changed(projectId))
            .catch((e: unknown) => console.error('Scheduling routines after an outside edit failed:', errorText(e)));
    };
    // An observer hears a chat's thread and never `chat.status`, which goes to clients only; its info events carry the same.
    chats.observe((event) => {
        if (event.event !== 'chat.event') {
            return;
        }
        const { chatId, event: chatEvent } = event.payload;
        if (chatEvent.type === 'info' || chatEvent.type === 'reset') {
            void routines.observe(chatId, chatEvent.info).catch((e: unknown) => console.error('Noting a routine run failed:', errorText(e)));
        }
    });
    const skills = async ({ projectId, provider }: RoutineSkillsPayload): Promise<RoutineSkillsResult> => {
        const folder = project.index.folderOf(projectId);
        if (folder === null) {
            throw new RoutineError('project-not-found', `No project ${projectId} on this machine`);
        }
        return { skills: await chats.skillsIn(provider, folder) };
    };
    return { routines, store, watchers, skills };
}
