import { Canvas } from '@/canvas/Canvas';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { Dock } from '@/shell/Dock';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { Panel } from '@/shell/Panel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { Sidebar } from '@/shell/Sidebar';
import { Toolbar } from '@/shell/Toolbar';
import { TooltipProvider } from '@/ui/Tooltip';

export function App() {
    return (
        <TooltipProvider>
            <div className="flex h-full w-full bg-bg">
                <Sidebar />
                <main className="flex min-w-0 grow flex-col">
                    <Toolbar />
                    <div className="flex min-h-0 grow">
                        <div className="relative min-w-0 grow">
                            <Canvas />
                            <ProjectBanner />
                            <Dock />
                        </div>
                        <Panel />
                    </div>
                </main>
            </div>
            <CommandPalette />
            <SettingsDialog />
            <LayoutDialog />
            <WorktreeDialog />
        </TooltipProvider>
    );
}
