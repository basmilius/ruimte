import { CodedError } from '@adecore/agents';
import { DesignPageError, injectVisualBootstrap, type DesignPageResult } from '@ruimte/contracts';
import type { Area } from '../area.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { assembleDesignPage, designPageById, type DesignProject } from '../fs/design-page.ts';
import type { HeldDesignPages } from '../fs/held-design-pages.ts';

class DesignRequestError extends CodedError<'outside-project' | 'closed'> {}

export interface DesignDeps {
    /* The project as this client has it on screen; null for one it does not, and for the Chats project, which keeps no designs. */
    projectOf(clientId: string, projectId: string): Promise<DesignProject | null>;
    pages: HeldDesignPages;
}

export function designArea(deps: DesignDeps): Area {
    return { name: 'design', holders: [deps.pages], handlers: (dispatcher) => registerRequests(dispatcher, deps) };
}

function registerRequests(dispatcher: Dispatcher, { projectOf, pages }: DesignDeps): void {
    dispatcher.register('design.page', async (payload, client): Promise<DesignPageResult> => {
        const project = await projectOf(client.id, payload.projectId);
        if (project === null) {
            throw new DesignRequestError('outside-project', 'This client does not have that project open');
        }
        const page = designPageById(project, payload.designId, payload.file);
        let html: string;
        try {
            const built = await assembleDesignPage(project.folder, page);
            html = payload.bootstrap === true ? injectVisualBootstrap(built) : built;
        } catch (e) {
            if (e instanceof DesignPageError) {
                return e.failure;
            }
            throw e;
        }
        // A channel that went while the page was built would leave a page nobody reads.
        if (client.closed === true) {
            throw new DesignRequestError('closed', 'The client left before its page was built');
        }
        return { kind: 'page', ...pages.hold(client.id, html) };
    });
}
