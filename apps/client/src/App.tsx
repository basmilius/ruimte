import { Canvas } from '@/canvas/Canvas';
import { CommandPalette } from '@/shell/CommandPalette';
import { Dock } from '@/shell/Dock';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { Sidebar } from '@/shell/Sidebar';
import { demoProjects } from '@/data/demo';
import { TooltipProvider } from '@/ui/Tooltip';

export function App() {
    const project = demoProjects.find((p) => p.active) ?? demoProjects[0];
    return (
        <TooltipProvider>
            <div className="flex h-full w-full bg-bg">
                <Sidebar />
                <main className="relative min-w-0 grow">
                    <Canvas />
                    <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 text-[12px] text-text-muted">
                        <span className="float pointer-events-auto flex h-8 items-center gap-2 rounded-lg px-3">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: project.color }} />
                            <span className="font-medium text-text">{project.name}</span>
                            <span className="text-text-faint">/</span>
                            <span>Canvas</span>
                        </span>
                    </div>
                    <Dock />
                </main>
            </div>
            <CommandPalette />
            <SettingsDialog />
        </TooltipProvider>
    );
}
