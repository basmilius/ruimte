import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frame, waitInPage, withBrowserFixture } from '../../testing/browser-fixture';

const directory = import.meta.dir;
const settle = 'new Promise(resolve => setTimeout(resolve, 180))';

async function styles(): Promise<string> {
    const css = await readFile(join(directory, '../styles.css'), 'utf8');
    const tokens = css.slice(css.indexOf(":root,\n[data-theme='light']"), css.indexOf("/* Ruimte's own tokens"));
    const eclipse = css.slice(css.indexOf('    .eclipse {'), css.indexOf("    /* The eclipse's orbits at the top edge"));
    return `${tokens}${eclipse}#root{width:100%;background:var(--eclipse-deep)}.fixture{position:relative;height:400px}.fixture .eclipse{height:400px}`;
}

const entry = `
    import { StrictMode } from 'react';
    import { Eclipse } from ${JSON.stringify(join(directory, 'Eclipse.tsx'))};
    import { useTheme } from ${JSON.stringify(join(directory, '../state/theme.ts'))};
    useTheme.getState().setTheme('dark');
    window.theme = theme => useTheme.getState().setTheme(theme);
    window.draws = 0;
    window.sample = true;
    const draw = WebGL2RenderingContext.prototype.drawArrays;
    WebGL2RenderingContext.prototype.drawArrays = function(...args) {
        draw.apply(this, args);
        window.draws++;
        if (window.sample) {
            const pixels = new Uint8Array(this.drawingBufferWidth * this.drawingBufferHeight * 4);
            this.readPixels(0, 0, this.drawingBufferWidth, this.drawingBufferHeight, this.RGBA, this.UNSIGNED_BYTE, pixels);
            window.litPixels = pixels.filter((value, index) => index % 4 === 3 && value > 0).length;
            window.haloPixels = 0;
            for (let index = 0; index < pixels.length; index += 4) {
                if (pixels[index + 3] > 8 && Math.max(pixels[index], pixels[index + 1], pixels[index + 2]) + 1 < pixels[index + 3]) window.haloPixels++;
            }
            window.sample = window.litPixels <= 100;
        }
    };
    const root = createRoot(document.getElementById('root'));
    window.unmount = () => root.unmount();
    root.render(<StrictMode><div className="fixture"><Eclipse center={132} glows={[360,170]} rings={[112,144]} orbits={[]} stars={{density:1,seed:132}} /></div></StrictMode>);
`;

test('Galaxy renders through Strict Mode, stays free of dark halos across themes, follows motion preferences, and falls back after context loss', async () => {
    await withBrowserFixture(entry, await styles(), async (view) => {
        await waitInPage(view, 'window.litPixels>100');
        expect(await view.evaluate<number>('document.querySelectorAll(".galaxy-canvas").length')).toBe(1);
        const mode = `(() => { const gl=document.querySelector('canvas').getContext('webgl2'); return gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM),gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),'uMode')); })()`;
        const focalY = `(() => { const gl=document.querySelector('canvas').getContext('webgl2'); return gl.getUniform(gl.getParameter(gl.CURRENT_PROGRAM),gl.getUniformLocation(gl.getParameter(gl.CURRENT_PROGRAM),'uFocal'))[1]; })()`;
        expect(await view.evaluate<number>(mode)).toBe(1);
        expect(await view.evaluate<number>(focalY)).toBeCloseTo(1 - 132 / 400, 5);

        await view.evaluate('window.theme("light")');
        await view.evaluate(frame);
        expect(await view.evaluate<number>(mode)).toBe(1);
        await view.evaluate('window.sample = true');
        await view.evaluate(frame);
        expect(await view.evaluate<number>('window.haloPixels')).toBe(0);
        await view.resize(360, 600);
        await waitInPage(view, 'document.querySelector("canvas").width===Math.round(360*Math.min(window.devicePixelRatio||1,2))');
        await view.evaluate('document.querySelector(".eclipse").style.height = "500px"');
        await waitInPage(view, `Math.abs(${focalY}-${1 - 132 / 500})<1e-5`);

        await view.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await view.evaluate(settle);
        const stopped = await view.evaluate<number>('window.draws');
        await view.evaluate(settle);
        expect(await view.evaluate<number>('window.draws')).toBe(stopped);
        await view.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 80, y: 80 });
        await view.evaluate(frame);
        expect(await view.evaluate<number>('window.draws')).toBe(stopped);

        await view.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
        await waitInPage(view, `window.draws>${stopped}`);
        await view.evaluate('document.querySelector(".fixture").style.transform="translateY(1000px)"');
        await view.evaluate(settle);
        const offscreen = await view.evaluate<number>('window.draws');
        await view.evaluate(settle);
        expect(await view.evaluate<number>('window.draws')).toBe(offscreen);
        await view.evaluate('document.querySelector(".fixture").style.transform=""');
        await waitInPage(view, `window.draws>${offscreen}`);

        await view.evaluate('document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()');
        await waitInPage(view, 'document.querySelectorAll("canvas").length===0');
        expect(await view.evaluate<number>('document.querySelectorAll(".eclipse-star").length')).toBe(58);
        const fallback = await view.evaluate<number>('window.draws');
        await view.evaluate('window.unmount()');
        await view.evaluate(settle);
        expect(await view.evaluate<number>('window.draws')).toBe(fallback);
        expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
    });
}, 20000);

test('the original stars remain visible when WebGL is unavailable', async () => {
    const withoutWebGL = `
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
            return kind === 'webgl2' ? null : getContext.call(this, kind, ...args);
        };
    `;
    await withBrowserFixture(withoutWebGL + entry, await styles(), async (view) => {
        await waitInPage(view, 'document.querySelectorAll(".eclipse-star").length===58');
        expect(await view.evaluate<number>('document.querySelectorAll("canvas").length')).toBe(0);
        expect(await view.evaluate<string>('getComputedStyle(document.querySelector(".eclipse-star")).backgroundColor')).not.toBe('rgba(0, 0, 0, 0)');
        expect(await view.evaluate<string[]>('window.errors')).toEqual([]);
    });
}, 15000);
