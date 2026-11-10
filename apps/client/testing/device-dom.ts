import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { FAKE_SIMULATOR, referenceOf } from './fake-devices';

export function button(label: string): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

export function buttonWithText(text: string): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.trim() === text) ?? null;
}

export function phoneCanvas(machine?: string): ProjectCanvasView {
    const phone: ProjectNode = {
        id: 'phone',
        kind: 'device',
        title: FAKE_SIMULATOR.name,
        x: 0,
        y: 0,
        w: 420,
        h: 860,
        device: referenceOf(FAKE_SIMULATOR),
        ...(machine === undefined ? {} : { machine })
    };
    return { kind: 'canvas', id: 'main', name: 'Main', nodes: [phone], texts: [], edges: [], layouts: [] };
}
