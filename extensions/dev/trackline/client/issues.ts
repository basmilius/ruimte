import { agents, canvas, getServer, type NodeInfo, type NodeRef, type Result } from '@ruimte/extension/client';
import type { IssueRow, TracklineServer } from '../server/index';

export const ISSUE_NODE = 'issue';

const OPENING = 'Fix this issue. Read the issue on the line to this chat first.';

/* An issue's node carries its key as its title, so a slot knows the issue without reading the node's data. */
export function keyOf(node: NodeInfo): string {
    return /^[A-Z]+-\d+$/.test(node.title) ? node.title : '';
}

export interface Shown {
    mine: boolean;
    closed: boolean;
    order: string;
}

export function shownIssues(issues: readonly IssueRow[], account: string | null, show: Shown): IssueRow[] {
    const shown = issues.filter((issue) => (show.closed || issue.state === 'open') && (!show.mine || issue.assignee === account));

    return show.order === 'key' ? shown.toSorted((one, other) => one.key.localeCompare(other.key, undefined, { numeric: true })) : shown;
}

/* A chat beside the issue's node, on a line to it, so the chat reads the issue as an agent reads any node. */
export async function startChat(node: NodeRef, key: string): Promise<Result<NodeRef>> {
    const chat = await agents.start({ title: key, prompt: OPENING, near: [node] });

    if (!chat.ok) {
        return chat;
    }

    const linked = canvas.link(node, chat.value);

    if (!linked.ok) {
        return linked;
    }

    await getServer<TracklineServer>().assign(key, chat.value.id);
    canvas.reveal(chat.value);

    return chat;
}
