import { basename, join } from 'node:path';
import { CustomLanguageServerInputSchema, extensionChatOf, type ExtensionTerminalProfile } from '@ruimte/contracts';
import { extensionActionCall } from '../actions/context.ts';
import { errorText } from '../error-text.ts';
import { extensionChatStarter } from '../extensions/extension-chat.ts';
import { ExtensionHost, type ExtensionAsks, type ExtensionFilesPort, type ExtensionProject, type ExtensionTerminalPort } from '../extensions/extension-host.ts';
import { runMachineAction, outputOf } from '../extensions/machine-actions.ts';
import { terminalWriteRefusal } from '../extensions/policy.ts';
import { ExtensionProblems } from '../extensions/problems.ts';
import { extensionProjectFiles } from '../extensions/project-files.ts';
import { ExtensionRefusal } from '../extensions/refusal.ts';
import { ExtensionStore } from '../extensions/store.ts';
import { ExtensionTerminals, extensionTerminalOpener, insideProject } from '../extensions/terminals.ts';
import { runExtensionPrompt, type ExtensionHandlerDeps } from '../handlers/extensions.ts';
import { LaunchSources } from '../launches/sources.ts';
import { HEADLESS_TERMINAL } from '../outbox/start-agent.ts';
import { markDrawnChat } from '../projects/drawn-chat.ts';
import { quote } from '../providers/launch.ts';
import type { ProfileStart } from '../sessions/manager.ts';
import type { DaemonBundles } from './bundles.ts';
import type { Later } from './later.ts';

const EXTENSION_QUERY_ROWS = 500;

export interface ExtensionsBundle {
    host: ExtensionHost;
    /* The terminals an extension opened or a profile starts, which a project's `placed` event prunes. */
    terminals: ExtensionTerminals;
    /* What the problem sources of extensions report, which a client and an agent read beside the language servers'. */
    problems: ExtensionProblems;
    /* What the launch sources of extensions list, which the launch store resolves beside a project's own. */
    launchSources: LaunchSources;
    /* A client put a project on screen, or the last one closed it: what an extension with `projects.read` follows. */
    projectOpened(projectId: string): void;
    projectClosed(projectId: string): void;
    /* The terminal profiles a person may pick in this project. */
    terminalProfiles(projectId: string): Promise<ExtensionTerminalProfile[]>;
    /* What the profile of this node starts its session with; null for a node without one. */
    profileStart(sessionId: string, cwd: string): Promise<ProfileStart | null>;
    /* What the requests of `extension.*` read from the machine. */
    handlerDeps(): ExtensionHandlerDeps;
    /* The text of one chat, as `chats.read` and `extension.chatRead` give it. */
    readChat(chatId: string): Promise<string>;
    /* What an extension's own node says to the agent that reads it as context. */
    nodeText(extension: string, type: string, data: unknown): Promise<string | null>;
}

type ExtensionsLater = Later<
    Pick<
        DaemonBundles,
        'agents' | 'providers' | 'projects' | 'databases' | 'artifacts' | 'language' | 'canvasHost' | 'actions' | 'git' | 'machine' | 'launches' | 'hosts'
    >
>;

/*
 * The extension host with everything it asks of the machine, built before the machine is up: each
 * ask reaches the bundle that answers it through `later`, so none is patched in after the start.
 */
export function wireExtensions(home: string, developmentRoots: readonly string[], later: ExtensionsLater): ExtensionsBundle {
    const index = () => later.projects().store.index;
    const readChat = async (chatId: string): Promise<string> =>
        (await later.agents().context.answerSource('extension', { id: chatId, kind: 'chat', title: chatId }, null, null)).text ?? '';
    const folderOfProject = (projectId: string): string => {
        const folder = index().folderOf(projectId);

        if (folder === null) {
            throw new ExtensionRefusal('not-found', `No project ${projectId} on this machine`);
        }

        return folder;
    };
    const asks: ExtensionAsks = {
        'agents.run': (options: { prompt: string; context?: string[]; provider?: string }) => runExtensionPrompt(later.providers().providers, options),
        'chats.send': async (chatId: string, text: string) => {
            await later.agents().chats.send(chatId, text);
        },
        'chats.list': async () => (await later.agents().chats.list()).map(extensionChatOf),
        'chats.read': readChat
    };
    const startChat = (...args: Parameters<ReturnType<typeof extensionChatStarter>>) =>
        extensionChatStarter({
            host: later.canvasHost(),
            actions: later.actions(),
            folderOf: (projectId) => index().folderOf(projectId),
            projectOfFolder: (folder) => index().projectOfFolder(folder),
            markDrawn: (projectId, viewId, extensionId) => markDrawnChat(later.projects().store, projectId, viewId, extensionId)
        })(...args);
    const terminals = new ExtensionTerminals(join(home, 'extension-terminals.json'));
    const worktreePaths = (folder: string): Promise<string[]> => later.git().checkouts.paths(folder);
    const readTerminal = async (nodeId: string): Promise<string> => {
        const text = await later.agents().sessions.get(nodeId)?.plainText();

        if (text === undefined) {
            throw new ExtensionRefusal('not-found', `No terminal ${nodeId} runs on this machine`);
        }

        return text;
    };
    const openTerminal = (...args: Parameters<ReturnType<typeof extensionTerminalOpener>>) =>
        extensionTerminalOpener({
            projects: later.canvasHost().projects,
            terminals,
            folderOf: (projectId) => index().folderOf(projectId),
            worktreePaths,
            nodeSize: (kind) => later.canvasHost().machine.nodeSize(kind),
            // Its client attaches to this session once it draws the node, and fits it to that node then.
            start: async (nodeId, cwd) => {
                await later.agents().sessions.create({ sessionId: nodeId, cwd, ...HEADLESS_TERMINAL });
            }
        })(...args);
    const terminalPort: ExtensionTerminalPort = {
        open: async (...args) => openTerminal(...args),
        read: readTerminal,
        write: async (id, nodeId, text) => {
            const sessions = later.agents().sessions;
            const refused = terminalWriteRefusal(id, nodeId, terminals.get(nodeId), sessions.awaitsPerson(nodeId));

            if (refused !== null) {
                throw new ExtensionRefusal(refused.code, refused.message);
            }

            if (sessions.live(nodeId) === undefined) {
                throw new ExtensionRefusal('unavailable', `The terminal ${nodeId} does not run`);
            }

            // Without a client, so the text sizes the terminal to nobody's window.
            sessions.write(nodeId, text);
        }
    };
    const projectOf = async (projectId: string): Promise<ExtensionProject> => {
        const folder = folderOfProject(projectId);
        const known = (await later.projects().store.known()).find((entry) => entry.projectId === projectId);

        return { id: projectId, name: known?.name ?? basename(folder), folder };
    };
    const problems = new ExtensionProblems({
        folderOf: (projectId) => index().folderOf(projectId),
        holders: (projectId) => later.projects().store.holdersOf(projectId)
    });
    // Made on the first ask, since the watcher it stands on is wired after the extensions.
    let files: ExtensionFilesPort | null = null;
    const projectFiles = (): ExtensionFilesPort => {
        files ??= extensionProjectFiles({
            folderOf: (projectId) => index().folderOf(projectId),
            machineHome: later.machine().machineHome,
            watcher: later.git().folders
        });

        return files;
    };
    const host = new ExtensionHost({
        store: new ExtensionStore(home),
        developmentRoots,
        asks: () => asks,
        terminals: () => terminalPort,
        projectFiles,
        problems: () => problems,
        launchesChanged: (_id, _source, projectId) => void launchSources.refresh(projectId),
        providersChanged: (id) => {
            launchSources.extensionChanged(id);
            later.hosts().hosts.extensionChanged();
        },
        startChat: async (...args) => startChat(...args),
        runAction: async (id, projectId, action, input) => {
            const folder = folderOfProject(projectId);
            const call = extensionActionCall(later.canvasHost(), { projectId, folder, canvasId: null }, id);

            return runMachineAction(
                action,
                input,
                async (name, translated) => outputOf(await later.actions().execute(name, translated, call)),
                (files) => later.artifacts().artifacts.publishFor(projectId, files)
            );
        },
        // Saved like one a person added, so it is listed in Settings and held when its file changes.
        addLanguageServer: async (id, server) => {
            const input = CustomLanguageServerInputSchema.safeParse({ args: [], ...server, id: undefined });

            if (!input.success) {
                throw new ExtensionRefusal('invalid-input', `defineLanguageServer takes another shape: ${input.error.issues[0]?.message ?? 'invalid'}`);
            }

            await later.language().host.customSaveFor(id, input.data);
        },
        removeLanguageServers: async (id) => later.language().host.customRemoveOwned(id),
        languageServerOwners: () => later.language().host.customOwners()
    });
    const launchSources: LaunchSources = new LaunchSources({
        host: {
            list: (project) => host.launchSources(project),
            watch: (extension, source, project, watch) => host.watchLaunchSource(extension, source, project, watch)
        },
        projectOf: async (projectId) => (index().folderOf(projectId) === null ? null : projectOf(projectId)),
        changed: (projectId) => later.launches().store.sourcesChanged(projectId)
    });
    // The projects a client has open, so each opening and each close is told once.
    const open = new Set<string>();

    return {
        host,
        terminals,
        problems,
        launchSources,
        projectOpened: (projectId) => {
            if (open.has(projectId)) {
                return;
            }

            open.add(projectId);
            void projectOf(projectId).then(
                (project) => host.forwardEvent('project.opened', { project }),
                (e: unknown) => console.warn(`No extension heard that ${projectId} opened: ${errorText(e)}`)
            );
        },
        projectClosed: (projectId) => {
            if (open.delete(projectId)) {
                host.forwardEvent('project.closed', { projectId });
            }

            problems.dropProject(projectId);
        },
        terminalProfiles: async (projectId) => host.terminalProfiles(await projectOf(projectId)),
        profileStart: async (sessionId, cwd) => {
            const profile = terminals.get(sessionId)?.profile;
            const projectId = terminals.get(sessionId)?.projectId;

            if (profile === undefined || projectId === undefined) {
                return null;
            }

            try {
                const project = await projectOf(projectId);
                const described = await host.profileSpawn(profile.extension, profile.id, { project, cwd });

                return {
                    exec: [described.command, ...(described.args ?? [])].map(quote).join(' '),
                    ...(described.env === undefined ? {} : { env: described.env }),
                    ...(described.cwd === undefined ? {} : { cwd: await insideProject(project.folder, described.cwd, worktreePaths) })
                };
            } catch (e) {
                return { notice: `Ruimte: ${profile.extension} did not start this terminal, so it is a plain shell. ${errorText(e)}` };
            }
        },
        readChat,
        nodeText: async (extension, type, data) => {
            const parts = await host.nodeContext(extension, type, data);

            return Array.isArray(parts) ? parts.map((part: { text?: string }) => part.text ?? '').join('\n') : typeof parts === 'string' ? parts : null;
        },
        handlerDeps: () => ({
            viewsOf: (projectId) => index().viewsOf(projectId),
            folderOf: (projectId) => index().folderOf(projectId),
            readSource: async (source, projectId) => (await later.agents().context.answerSource('extension', source, null, null, projectId)).text ?? '',
            providers: later.providers().providers,
            terminalProfiles: async (projectId) => host.terminalProfiles(await projectOf(projectId)),
            databaseQuery: async (projectId, connection, sql) => {
                const folder = folderOfProject(projectId);
                const { result } = await later
                    .databases()
                    .agents.query({ projectId, folder }, 'extension', connection, sql, { schema: null, limit: EXTENSION_QUERY_ROWS });

                return {
                    columns: result.columns.map((column) => (typeof column === 'string' ? column : column.name)),
                    rows: result.rows.map((row) => [...row]),
                    hasMore: result.hasMore
                };
            }
        })
    };
}
