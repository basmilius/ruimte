import { ACTION_DOMAINS, type ActionDomain } from '@ruimte/actions';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { windowWorkspace } from '@/state/window';

/* What a project holds, as far as the tools Voice gets are concerned. */
export interface VoiceProjectFacts {
    sessions: boolean;
    content: boolean;
    pages: boolean;
    folder: boolean;
    repository: boolean;
}

/*
 * Always sent: what finds and makes things, and what prompts a chat, since "make a chat and ask it"
 * is one request and the chat does not exist yet when the session starts.
 */
const ALWAYS: readonly ActionDomain[] = ['workspace', 'views', 'canvas', 'layout', 'communicate', 'projects', 'machine'];

export const voiceDomainsFor = (facts: VoiceProjectFacts): ActionDomain[] => {
    const wanted = new Set<ActionDomain>(ALWAYS);
    if (facts.sessions) {
        wanted.add('sessions');
        wanted.add('plans');
        wanted.add('agents');
    }
    if (facts.content) {
        wanted.add('content');
    }
    if (facts.pages) {
        wanted.add('pages');
    }
    if (facts.folder) {
        wanted.add('files');
    }
    if (facts.folder && facts.repository) {
        wanted.add('developer');
    }
    return ACTION_DOMAINS.filter((domain) => wanted.has(domain));
};

/* The kinds a project holds, as views and as nodes on its canvases. */
export const kindsIn = (views: readonly ProjectView[]): Set<string> =>
    new Set(views.flatMap((view) => [view.kind, ...(isCanvasView(view) ? view.nodes.map((node) => node.kind) : [])]));

/* A machine from before `git.repos` still has the folder, which the git panel then shows as its one repository. */
const hasRepository = async (folder: string): Promise<boolean> => {
    const transport = windowWorkspace()?.connection.transport ?? null;
    if (transport === null) {
        return false;
    }
    return transport
        .request('git.repos', { folder })
        .then((answer) => answer.repos.length > 0)
        .catch(() => true);
};

/* The domains for a session that starts now; the list stays as it is for the whole session. */
export const currentVoiceDomains = async (): Promise<ActionDomain[]> => {
    const kinds = kindsIn(useDocument.getState().exportViews());
    const folder = useProject.getState().current?.folder ?? null;
    return voiceDomainsFor({
        sessions: kinds.has('chat') || kinds.has('terminal'),
        content: kinds.has('note') || kinds.has('drawing') || kinds.has('diagram'),
        pages: kinds.has('browser'),
        folder: folder !== null,
        repository: folder !== null && (await hasRepository(folder))
    });
};
