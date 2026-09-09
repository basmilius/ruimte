import type { CanvasNode, Edge, TextElement } from '@/state/canvas';

export const demoNodes: CanvasNode[] = [
    { id: 'term-1', kind: 'terminal', title: 'dev server', x: 80, y: 120, w: 560, h: 340 },
    { id: 'chat-1', kind: 'chat', title: 'Refactor canvas focus model', x: 720, y: 80, w: 500, h: 560, status: 'needs-you' },
    { id: 'term-2', kind: 'terminal', title: 'tests', x: 80, y: 520, w: 560, h: 280 },
    { id: 'browser-1', kind: 'browser', title: 'ruimte.app', x: 1300, y: 160, w: 720, h: 480 }
];

export const demoTexts: TextElement[] = [
    { id: 'text-1', x: 80, y: 40, text: 'Sprint 12 · canvas en focus', size: 28 },
    { id: 'text-2', x: 1300, y: 100, text: 'Landing page, eerste opzet', size: 18 }
];

export const demoEdges: Edge[] = [
    { id: 'edge-1', from: 'term-1', to: 'chat-1', label: 'context' }
];

export interface Project {
    id: string;
    name: string;
    color: string;
    active?: boolean;
}

export const demoProjects: Project[] = [
    { id: 'p-ruimte', name: 'ruimte', color: '#7c74ff', active: true },
    { id: 'p-raxos', name: 'raxos', color: '#f97316' },
    { id: 'p-flux', name: 'flux', color: '#22c55e' }
];
