import i18next from 'i18next';
import type { ApprovalRequest } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import type { SessionsByKey } from '@/state/sessions';

// Permission notifications expire with the daemon's hold, so raising and withdrawal share one model.

/* What a notification needs of a node: who it is on screen. */
export interface ApprovalNode {
    id: string;
    title: string;
}

/*
 * One notification about one request. Keyed on the request and not on the node, so the next
 * permission on the same node raises a notification of its own instead of quietly replacing the one
 * a person has not read yet.
 */
export interface ApprovalNotice {
    key: string;
    nodeId: string;
    title: string;
    body: string;
    /* When the daemon stops holding, which is the last moment this may stand. */
    expiresAt: number;
}

/* A command is a line of shell, not a sentence. The OS truncates too, this keeps the tail readable. */
const SUMMARY_MAX = 96;

const shorten = (text: string): string => (text.length <= SUMMARY_MAX ? text : `${text.slice(0, SUMMARY_MAX - 1)}…`);

/* A terminal standing as a view of its own carries no name until somebody types one. */
const nameOf = (node: ApprovalNode): string =>
    typeof node.title === 'string' && node.title.trim() !== '' ? node.title.trim() : i18next.t('shell:approvals.terminal');

/*
 * How long is left, in the coarsest unit that does not round the clock away. The hold is under two
 * minutes, so this reads in seconds in practice; a longer hold reads in whole minutes rather than in
 * a number nobody counts.
 */
export const expiresIn = (ms: number): string => {
    const seconds = Math.max(Math.round(ms / 1000), 0);
    return seconds < 120
        ? i18next.t('shell:approvals.expiresInSeconds', { seconds })
        : i18next.t('shell:approvals.expiresInMinutes', { minutes: Math.floor(seconds / 60) });
};

/* The machine is named only when it is not the one this window runs on; naming it always is noise. */
export const approvalTitle = (node: ApprovalNode, machine: string | null): string => {
    const where = machine === null ? nameOf(node) : i18next.t('shell:approvals.onMachine', { name: nameOf(node), machine });
    return i18next.t('shell:approvals.title', { where });
};

/*
 * The tool and the one line the strip shows under it, with the clock in brackets: what the agent
 * wants and how long the answer is worth giving. The summary is the daemon's, which already falls
 * back to the tool's name, so an empty one is a tool that carried no readable input at all.
 */
export const approvalBody = (request: ApprovalRequest, now: number): string => {
    const summary = request.summary.trim();
    const what = summary === '' ? request.toolName : `${request.toolName}: ${shorten(summary)}`;
    return i18next.t('shell:approvals.body', { what, expires: expiresIn(request.expiresAt - now) });
};

export interface NoticeOptions {
    /* The machine the workspace runs on, or null for the one this window runs on. */
    machine: string | null;
    /* `agentsApprovals`: with it off nothing is asked here, so there is nothing to announce either. */
    offered: boolean;
    now: number;
}

/*
 * What deserves a notification right now: the front request of every node that has one, which is the
 * request the strip offers. A node waiting on three tools is one question at a time, and three
 * notifications for a strip with one pair of buttons would say otherwise. Answering the front one
 * makes the next the front, which is a new key and a notification of its own.
 */
export const approvalNotices = (nodes: readonly ApprovalNode[], sessions: SessionsByKey, endpointId: string, options: NoticeOptions): ApprovalNotice[] => {
    if (!options.offered) {
        return [];
    }
    return nodes.flatMap((node) => {
        const request = sessions[endpointKey(endpointId, node.id)]?.approvals?.[0];
        if (request === undefined || request.expiresAt <= options.now) {
            return [];
        }
        return [
            {
                key: `${node.id}:${request.requestId}`,
                nodeId: node.id,
                title: approvalTitle(node, options.machine),
                body: approvalBody(request, options.now),
                expiresAt: request.expiresAt
            }
        ];
    });
};

export interface NoticeChanges {
    raise: ApprovalNotice[];
    withdraw: string[];
}

/*
 * What to do with the notifications that stand. Withdrawing never asks whether this one may be
 * raised: an answer from another client, from the CLI's own prompt or the hold running out takes the
 * notification back whatever the window is doing, and the window coming to the front is not an
 * answer to anything, so it leaves what stands alone. Raising is asked per notice, since a person
 * watching one node is not watching the one beside it.
 */
export const noticeChanges = (shown: Iterable<string>, notices: readonly ApprovalNotice[], canRaise: (notice: ApprovalNotice) => boolean): NoticeChanges => {
    const standing = new Set(shown);
    const keys = new Set(notices.map((notice) => notice.key));
    return {
        raise: notices.filter((notice) => !standing.has(notice.key) && canRaise(notice)),
        withdraw: [...standing].filter((key) => !keys.has(key))
    };
};

/*
 * When the watcher has to look again without anything having happened. Nothing on a store changes
 * when a hold runs out, and a daemon that went quiet cannot tell us either, so the clock is the only
 * thing left to withdraw on.
 */
export const nextExpiry = (notices: readonly ApprovalNotice[]): number | null =>
    notices.length === 0 ? null : Math.min(...notices.map((notice) => notice.expiresAt));
