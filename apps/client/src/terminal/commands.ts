import { clearTerminalAction } from '@/action-port/person-actions';
import { defineBehaviors } from '@/commands/behavior';
import { withActiveView } from '@/views/active-view';

export const TERMINAL_BEHAVIORS = defineBehaviors({
    'terminal-clear': { run: withActiveView(({ view }) => clearTerminalAction(view.id)) }
});
