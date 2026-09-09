import { Canvas } from '@/canvas/Canvas';
import { CommandPalette } from '@/shell/CommandPalette';
import { LayoutDialog } from '@/shell/LayoutDialog';
import { Dock } from '@/shell/Dock';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { ProjectBanner } from '@/shell/ProjectBanner';
import { Sidebar } from '@/shell/Sidebar';
import { useProject } from '@/state/project';
import { TooltipProvider } from '@/ui/Tooltip';

export function App() {
    const project = useProject((s) => s.current);
    const dirty = useProject((s) => s.dirty);
    return (
        <TooltipProvider>
            <div className="flex h-full w-full bg-bg">
                <Sidebar />
                <main className="relative min-w-0 grow">
                    <Canvas />
                    <div className="pointer-events-none absolute left-4 top-3 flex items-center gap-2 text-[12px] text-text-muted">
                        <span className="float pointer-events-auto flex h-8 items-center gap-2 rounded-lg px-3">
                            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: project?.color ?? 'var(--text-faint)' }} />
                            <span className="font-medium text-text">{project?.name ?? 'No project'}</span>
                            <span className="text-text-faint">/</span>
                            <span>Canvas</span>
                            {dirty && <span className="h-1.5 w-1.5 rounded-full bg-text-faint" aria-label="Unsaved changes" />}
                        </span>
                    </div>
                    <ProjectBanner />
                    <Dock />
                </main>
            </div>
            <CommandPalette />
            <SettingsDialog />
            <LayoutDialog />
        </TooltipProvider>
    );
}
