import { VISUAL_HOST_PAGE } from '@adecore/agent-contracts/visual';
import { VISUAL_HOST_HEADERS, VISUAL_HOST_PATH } from './index.ts';

/*
 * The whole answer of the visual host page: where it is, what it is and the headers it carries. The
 * desktop scheme and the client's dev server and build answer with this. The station serves the file the
 * client's build wrote and adds only the headers, so it takes the path and headers from `index.ts` alone;
 * this file stays apart from it because the page needs the contracts of the agents, which a worker should not bundle.
 */
export const VISUAL_HOST = {
    path: VISUAL_HOST_PATH,
    body: VISUAL_HOST_PAGE,
    headers: VISUAL_HOST_HEADERS
} as const;

export function visualHostResponse(): Response {
    return new Response(VISUAL_HOST.body, { headers: VISUAL_HOST.headers });
}
