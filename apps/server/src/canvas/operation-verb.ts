import { z } from 'zod';
import { OPERATION_FORMS } from '../actions/operation-actions.ts';
import { defineActionVerb, runAction } from './action-verb.ts';
import { defineNoun, field } from './verb.ts';

const NEEDS_ID = 'operation get needs the id of an operation, such as agent.start:<id>';

const getSub = defineActionVerb('operation', {
    name: 'get',
    action: 'operation.get',
    usage: '<id>',
    params: [{ syntax: '<id>', need: 'required', field: 'operationId', more: 'agent.start:<id> after agent, team.start:<id>,<id> after team' }],
    detail: [
        'prints\toperation\tid\taction\tstatus\tthe first line: how the whole stands',
        'prints\tagent\tid\tstatus\ttask\tdetail\tone line per agent it started, with the id of its task or - without one',
        ...OPERATION_FORMS,
        'status\tqueued\trunning\tcompleted\tfailed\tcancelled\tqueued while its start is owed, running while it works or its task is open, and one of the last three once it is over',
        'task\tWith a task the task decides: done is completed, failed is failed, and a child a person removed is cancelled; an open task whose turn was stopped is cancelled too',
        'without\tWithout a task the start is over once the agent runs and its first turn ended, which is completed: the start is done, and whether the work itself is done it does not say',
        'stopped\tA chat whose last turn was stopped before it finished, by operation cancel or by a person, is cancelled',
        'who\tOnly an operation you started; one that is here but no agent that agent or team started is unknown-operation',
        'gone\tA deleted node reads as cancelled while its task is still there; one started without a task is forgotten with its node, so its id is unknown-operation',
        'wake\tA task wakes you with its result anyway, so this is for a look in between and never something to poll'
    ],
    positionals: z.tuple([z.string({ error: NEEDS_ID }).min(1, NEEDS_ID)], {
        error: (issue) => (issue.code === 'too_big' ? 'operation get takes one id and nothing else' : NEEDS_ID)
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const operation = await runAction(call, 'operation.get', { operationId: id });
        return [
            ['operation', operation.operationId, operation.action, operation.status].join('\t'),
            ...operation.agents.map((agent) => ['agent', agent.nodeId, agent.status, agent.taskId ?? '-', field(agent.detail)].join('\t'))
        ];
    }
});

const NEEDS_CANCEL_ID = 'operation cancel needs the id of an operation, such as agent.start:<id>';

const cancelSub = defineActionVerb('operation', {
    name: 'cancel',
    action: 'operation.cancel',
    usage: '<id>',
    params: [{ syntax: '<id>', need: 'required', field: 'operationId', more: 'agent.start:<id> after agent, team.start:<id>,<id> after team' }],
    detail: [
        'prints\toperation\tid\tstatus\tdetail\tone line per agent it started, the detail starting with the id of its node',
        'status\tcancelled\tover\tleft\tcancelled when a chat was told to stop its turn, over when nothing ran, left when it goes on',
        'after\tA stop takes the CLI a moment; operation get reads running until the turn has ended and cancelled from then on',
        'left\tA start still owed runs anyway, and a terminal agent keeps running: nothing sends a signal a person did not press',
        'stays\tThe chats, their threads and their tasks stay; nothing is rolled back',
        'who\tOnly an operation you started'
    ],
    positionals: z.tuple([z.string({ error: NEEDS_CANCEL_ID }).min(1, NEEDS_CANCEL_ID)], {
        error: (issue) => (issue.code === 'too_big' ? 'operation cancel takes one id and nothing else' : NEEDS_CANCEL_ID)
    }),
    flags: z.object({}),
    async run({ positionals: [id] }, call) {
        const cancelled = await runAction(call, 'operation.cancel', { operationId: id });
        return cancelled.operations.map((line) => ['operation', line.operationId, line.status, field(line.detail)].join('\t'));
    }
});

export const operationVerb = defineNoun({
    name: 'operation',
    summary: 'Follows or cancels what agent and team started, since starting is not succeeding',
    detail: ['operations\tagent and team answer at once with what they made, while the agents go on working; an operation is where that stands now'],
    actions: [getSub, cancelSub]
});
