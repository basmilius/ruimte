import { expect, test } from 'bun:test';
import type { BackendLaunch } from '@adecore/agents/chat';
import { ruimteCliMcp, withRuimteMcp } from './ruimte-mcp.ts';

const LAUNCH: BackendLaunch = {
    command: ['codex'],
    cwd: '/',
    env: { RUIMTE_MCP_URL: 'http://127.0.0.1:4210/mcp', RUIMTE_CONTEXT_TOKEN: 'secret-token' },
    selection: { model: 'gpt-5.5', options: {} },
    modelName: 'GPT',
    runtimeMode: 'supervised',
    resume: null,
    generation: 1,
    instructions: null,
    resumeNote: null
};

test("Ruimte's server keeps its tools out of a CLI's scripts and later search, in a chat and a terminal", () => {
    expect(withRuimteMcp(LAUNCH).mcpServers).toEqual([expect.objectContaining({ name: 'ruimte', directTools: true })]);
    expect(ruimteCliMcp('http://127.0.0.1:4210/context', 'RUIMTE_HOOK_TOKEN')).toMatchObject({ name: 'ruimte', directTools: true });
});
