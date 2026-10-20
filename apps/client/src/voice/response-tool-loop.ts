import { VOICE_CONTROL_TOOL, VOICE_TOOL_ACTIONS } from '@ruimte/actions';
import { VoiceToolLoop, type ToolLoopObserver, type VoiceToolExecute, type VoiceToolSend } from '@ruimte/voice';

const toolNames = new Set<string>([...VOICE_TOOL_ACTIONS.keys(), VOICE_CONTROL_TOOL]);

/* The loop over the tools this window offers GPT-Live. */
export class ResponseToolLoop extends VoiceToolLoop {
    constructor(send: VoiceToolSend, execute: VoiceToolExecute, observer: ToolLoopObserver | null = null) {
        super(send, execute, { toolNames, observer });
    }
}
