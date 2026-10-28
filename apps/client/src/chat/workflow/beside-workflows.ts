import { activeWorkflows, type ChatItem, type ChatToolItem, type ChatWorkflow } from '@ruimte/contracts';
import { memoByIdentity } from '@/state/identity-memo';

/* A Workflow call a chat node could show beside it, named by its item, since a call that never launched has no task. */
export interface WorkflowCandidate {
    id: string;
    tool: ChatToolItem;
    workflow: ChatWorkflow;
    /* The call's own state says whether the workflow lives; a stall warning does not end it. */
    running: boolean;
}

const NONE: readonly string[] = [];

const candidatesOf = memoByIdentity((structure: Readonly<Record<string, ChatItem>>, order: readonly string[], before: readonly string[]): WorkflowCandidate[] =>
    // The ones from before the page the client holds come first, since they are older than all of it.
    activeWorkflows([...before, ...order].flatMap((id) => structure[id] ?? [])).map((tool) => ({
        id: tool.id,
        tool,
        workflow: tool.workflow!,
        running: tool.state === 'running'
    }))
);

/*
 * The workflows a chat still speaks of (`activeWorkflows`), in thread order: those of the part of the
 * thread the client holds and those from before it the host sent along. The same array while none of
 * the three changed, so a selector over a store that changes on every pan answers without work.
 */
export function workflowCandidates(row: {
    structure: Readonly<Record<string, ChatItem>>;
    order: readonly string[];
    workflowsBefore?: readonly string[];
}): WorkflowCandidate[] {
    return candidatesOf(row.structure, row.order, row.workflowsBefore ?? NONE);
}

export interface ShownWorkflow {
    candidate: WorkflowCandidate;
    /* Its place among the ones a person can switch between, and how many there are. */
    index: number;
    count: number;
    shown: readonly WorkflowCandidate[];
}

/*
 * The workflow a chat node shows beside it: the one a person picked while it is still there, else the
 * newest that runs, else the newest. One a person dismissed is left out, so a new one shows again.
 */
export function shownWorkflow(candidates: readonly WorkflowCandidate[], picked: string | undefined, dismissed: readonly string[]): ShownWorkflow | null {
    const shown = candidates.filter((candidate) => !dismissed.includes(candidate.id));
    const chosen = shown.find((candidate) => candidate.id === picked) ?? shown.findLast((candidate) => candidate.running) ?? shown.at(-1);
    return chosen === undefined ? null : { candidate: chosen, index: shown.indexOf(chosen), count: shown.length, shown };
}
