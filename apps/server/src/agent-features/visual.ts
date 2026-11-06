import { visualActions } from '../actions/visual-actions.ts';
import { visualToolkit } from '../tools/visual-tools.ts';
import { agentVisuals } from '../visuals/agent-host.ts';
import { defineAgentFeature } from './feature.ts';

export const visualFeature = defineAgentFeature({
    name: 'visual',
    toolkit: visualToolkit,
    actions: visualActions,
    host: ({ identity, agents, devices }) => ({
        visuals: agentVisuals({ enabled: () => identity.visualReplies, visuals: agents.visuals, chats: agents.chats, renderer: devices.visualRenderer })
    })
});
