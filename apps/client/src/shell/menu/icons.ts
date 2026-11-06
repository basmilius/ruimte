import type { AgentKind } from '@ruimte/contracts';
import {
    AppWindow,
    Bot,
    CircleHelp,
    CodeXml,
    Compass,
    CornerUpRight,
    Eye,
    File,
    FileText,
    FoldVertical,
    FolderInput,
    Frame,
    GitBranch,
    Globe,
    LayoutDashboard,
    MessageSquare,
    PenTool,
    Pencil,
    Plus,
    Rocket,
    Terminal,
    Trash,
    Workflow,
    type LucideIcon
} from 'lucide-react';
import { generatedOf } from '@/commands/generated';
import { commandSpec, isCommandId } from '@/commands/registry';

/* What the web client draws in front of a row, so every label starts on the same line. The shell's native menu has none. */
type MenuIcon = { icon: LucideIcon } | { agent: AgentKind };

/* The menus and the submenus with a fixed place; a command's own icon is in the command table. */
const MENU_ICONS: Partial<Record<string, LucideIcon>> = {
    file: File,
    edit: Pencil,
    code: CodeXml,
    view: Eye,
    go: Compass,
    run: Rocket,
    window: AppWindow,
    help: CircleHelp,
    'kind-canvas': Frame,
    'kind-drawing': PenTool,
    'kind-diagram': Workflow,
    'kind-chat': MessageSquare,
    'kind-terminal': Terminal,
    'kind-browser': Globe,
    'kind-file': FileText,
    'new-view': Plus,
    'new-agent': Bot,
    'move-to': CornerUpRight,
    layouts: LayoutDashboard,
    'delete-layout': Trash,
    folding: FoldVertical,
    'chat-move': FolderInput,
    'launches-after-settle': GitBranch
};

const AGENT_ROW = /^agent-(?:view-)?(?:chat|terminal)-(.+)$/;

export function menuIconOf(id: string): MenuIcon | null {
    const agent = AGENT_ROW.exec(id)?.[1];
    if (agent !== undefined) {
        return { agent: agent as AgentKind };
    }
    if (isCommandId(id)) {
        return { icon: commandSpec(id).icon };
    }
    const icon = MENU_ICONS[id] ?? generatedOf(id)?.icon;
    return icon === undefined ? null : { icon };
}
