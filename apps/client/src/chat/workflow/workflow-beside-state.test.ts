import { expect, test } from 'bun:test';
import {
    besideKey,
    closeWorkflowAgent,
    dismissWorkflows,
    forgetWorkflowBeside,
    openWorkflowAgent,
    openWorkflowPhase,
    pickWorkflow,
    pruneWorkflowBeside,
    readWorkflowBeside,
    setWorkflowAgentTrail,
    showWorkflows
} from '@/chat/workflow/workflow-beside-state';

const step = { toolUseId: 'workflow-agent:a1', description: 'Reader' };

test('a phase and an agent are chosen per workflow, so neither carries over to another', () => {
    const key = besideKey('local', 'view', 'chat-1');
    openWorkflowPhase(key, 'wf-1', 'phase-2');
    openWorkflowAgent(key, 'wf-1', 3, step);
    expect(readWorkflowBeside(key).workflows['wf-1']).toEqual({ openPhase: 'phase-2', agent: { index: 3, trail: [step] } });
    expect(readWorkflowBeside(key).workflows['wf-2']).toBeUndefined();

    const child = { toolUseId: 'child', description: 'Child' };
    setWorkflowAgentTrail(key, 'wf-1', [step, child]);
    expect(readWorkflowBeside(key).workflows['wf-1']?.agent?.trail).toEqual([step, child]);
    closeWorkflowAgent(key, 'wf-1');
    expect(readWorkflowBeside(key).workflows['wf-1']).toEqual({ openPhase: 'phase-2' });
    // Without an open agent there is no trail to set.
    setWorkflowAgentTrail(key, 'wf-1', [child]);
    expect(readWorkflowBeside(key).workflows['wf-1']?.agent).toBeUndefined();
    forgetWorkflowBeside((candidate) => candidate === key);
});

test('a pick, a dismissal and the choices go with the workflows the chat stops speaking of, and with the node', () => {
    const key = besideKey('local', 'view', 'chat-2');
    const other = besideKey('local', 'view', 'chat-3');
    pickWorkflow(key, 'wf-1');
    dismissWorkflows(key, ['wf-1', 'wf-2']);
    openWorkflowPhase(key, 'wf-2', null);
    openWorkflowPhase(other, 'wf-9', null);
    pruneWorkflowBeside(key, ['wf-2']);
    expect(readWorkflowBeside(key)).toEqual({ dismissed: ['wf-2'], workflows: { 'wf-2': { openPhase: null } } });
    showWorkflows(key);
    expect(readWorkflowBeside(key).dismissed).toEqual([]);
    forgetWorkflowBeside((candidate) => candidate === key);
    expect(readWorkflowBeside(key)).toEqual({ dismissed: [], workflows: {} });
    expect(readWorkflowBeside(other).workflows['wf-9']).toEqual({ openPhase: null });
    forgetWorkflowBeside(() => true);
});
