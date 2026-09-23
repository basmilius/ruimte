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
        'task\tWith a task the task decides: done is completed, failed is failed, and a child a person removed is cancelled',
        'without\tWithout a task the start is over once the agent runs and its first turn ended, which is completed',
        'who\tOnly an operation you started; a node that is gone reads as cancelled',
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

export const operationVerb = defineNoun({
    name: 'operation',
    summary: 'Follows what agent and team started, since starting is not succeeding',
    detail: ['operations\tagent and team answer at once with what they made, while the agents go on working; an operation is where that stands now'],
    actions: [getSub]
});
