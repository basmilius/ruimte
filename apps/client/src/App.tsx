import { useEffect } from 'react';
import { Canvas } from '@/canvas/Canvas';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { WorktreeDialog } from '@/shell/WorktreeDialog';
import { Dock } from '@/shell/Dock';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { Panel } from '@/shell/Panel';
import { PreviewPanel } from '@/shell/PreviewPanel';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { Sidebar } from '@/shell/Sidebar';
import { Toolbar } from '@/shell/Toolbar';
import { useProject } from '@/state/project';
import { TooltipProvider } from '@/ui/Tooltip';

export function App() {
    const name = useProject((s) => s.current?.name ?? null);

    // The Electron window has no title of its own, so this names it as well.
    useEffect(() => {
        document.title = name ? `${name} - Ruimte` : 'Ruimte';
    }, [name]);

    return (
        <TooltipProvider>
            <div className="flex h-full w-full bg-bg">
                <Sidebar />
                <main className="flex min-w-0 grow">
                    <div className="flex min-w-0 grow flex-col">
                        <Toolbar />
                        <div className="relative min-h-0 grow">
                            <Canvas />
                            <ProjectBanner />
                            <Dock />
                        </div>
                    </div>
                    <PreviewPanel />
                    <Panel />
                </main>
            </div>
            <CommandPalette />
            <SettingsDialog />
            <LayoutDialog />
            <WorktreeDialog />
        </TooltipProvider>
    );
}
