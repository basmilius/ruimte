import { z } from 'zod';
import { defineActionTool, runAction } from './action-tool.ts';
import { field, requiredField } from './host.ts';
import { defineToolkit } from './tool.ts';

const ID_TEXT = 'As agent_start or agent_team answered it';

const operationGet = defineActionTool('operation', {
    name: 'operation_get',
    action: 'operation.get',
    description: 'Reads where an agent_start or agent_team operation stands.',
    annotations: { readOnly: true },
    input: z.object({ id: requiredField('operation_get needs id, an operation such as agent.start:<id>').describe(ID_TEXT) }),
    async run(input, call) {
        const operation = await runAction(call, 'operation.get', { operationId: input.id });

        return [
            ['operation', operation.operationId, operation.action, operation.status].join('\t'),
            ...operation.agents.map((agent) => ['agent', agent.nodeId, agent.status, agent.taskId ?? '-', field(agent.detail)].join('\t'))
        ];
    }
});

const operationCancel = defineActionTool('operation', {
    name: 'operation_cancel',
    action: 'operation.cancel',
    description: 'Stops the turns of an agent or team you started; nothing rolls back.',
    annotations: { destructive: true },
    input: z.object({ id: requiredField('operation_cancel needs id, an operation such as agent.start:<id>').describe(ID_TEXT) }),
    async run(input, call) {
        const cancelled = await runAction(call, 'operation.cancel', { operationId: input.id });

        return cancelled.operations.map((line) => ['operation', line.operationId, line.status, field(line.detail)].join('\t'));
    }
});

export const operationToolkit = defineToolkit('operation', [operationGet, operationCancel]);
