import { DESIGN_PAGE_MAX_BYTES } from '@ruimte/contracts';
import { ZOOM_MAX, ZOOM_MIN } from '@/canvas-model/math';
import { DESIGN_METHODS } from '@/design/design-protocol';
import { SPACE_CONTROLS } from '@/surface/canvas/space-pan';

/*
 * What runs inside a design page, in the sandbox: the canvas a page asks for with
 * `<meta name="ruimte-design" content="canvas">` (the whole document pans and zooms, the way a design
 * tool shows a board), the tweaks a page declares in `<script type="application/json" id="ruimte-tweaks">`,
 * and the tools of the stage. The outlines and pins are drawn here, in the page's own coordinates; the
 * stage draws its popovers over the frame from the rectangles this reports. Every message is JSON-RPC
 * with a method of `DESIGN_METHODS`, checked again by the stage.
 */
const RUNTIME = String.raw`(function () {
    if (window.__ruimteDesign) { return; }
    window.__ruimteDesign = true;
    var M = ${JSON.stringify(DESIGN_METHODS)};
    var MIN = ${ZOOM_MIN}, MAX = ${ZOOM_MAX}, PAD = 48;
    var SPACE_WORKS = ${JSON.stringify(`${SPACE_CONTROLS}, textarea`)};
    var staged = window.parent !== window;
    var canvas = false, world = null, layer = null;
    var camera = { x: PAD, y: PAD, zoom: 1 };
    var spaceHere = false, spaceThere = false, dragging = false, swallowClick = false;
    var tool = 'view', hovered = null, selected = null, pins = [], tweaks = null;

    function post(method, params) {
        if (!staged) { return; }
        window.parent.postMessage(params === undefined ? { jsonrpc: '2.0', method: method } : { jsonrpc: '2.0', method: method, params: params }, '*');
    }

    // Canvas.

    function place() {
        world.style.transform = 'translate(' + camera.x + 'px, ' + camera.y + 'px) scale(' + camera.zoom + ')';
    }

    function show() {
        place();
        draw();
    }

    // The stage owns the camera; only a move the page makes itself, a fit or a link to an option, goes back to it.
    function apply() {
        if (!canvas) { return; }
        show();
        post(M.camera, { x: camera.x, y: camera.y, zoom: camera.zoom });
    }

    function fitTo(box) {
        var width = Math.max(box.width, 1), height = Math.max(box.height, 1);
        var zoom = Math.max(MIN, Math.min(1, (innerWidth - 2 * PAD) / width, (innerHeight - 2 * PAD) / height));
        camera = { zoom: zoom, x: (innerWidth - width * zoom) / 2 - box.left * zoom, y: Math.max(PAD, (innerHeight - height * zoom) / 2) - box.top * zoom };
        apply();
    }

    // The board is the document; a wide one fits its width, and a tall one starts at its top, the way a long page reads.
    function fitAll() {
        var width = Math.max(world.scrollWidth, 1);
        var zoom = Math.max(MIN, Math.min(1, (innerWidth - 2 * PAD) / width));
        camera = { zoom: zoom, x: Math.max(PAD, (innerWidth - width * zoom) / 2), y: Math.max(PAD, (innerHeight - world.scrollHeight * zoom) / 2) };
        apply();
    }

    function worldBox(element) {
        var left = 0, top = 0, node = element;
        while (node && node !== world) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent; }
        return { left: left, top: top, width: element.offsetWidth, height: element.offsetHeight };
    }

    function grabCursor() {
        var root = document.documentElement;
        root.classList.toggle('ruimte-design-grab', (spaceHere || spaceThere) && !dragging);
        root.classList.toggle('ruimte-design-grabbing', dragging);
    }

    function holdSpace(down) {
        spaceHere = down;
        grabCursor();
    }

    // A middle drag pans, and so does a left drag with Space held or on the bare board with the select tool, as on a Ruimte canvas.
    function startPan(event) {
        var background = event.target === document.body || event.target === document.documentElement || event.target === world;
        swallowClick = false;
        if (!(event.button === 1 || (event.button === 0 && (spaceHere || spaceThere || (background && tool === 'view'))))) { return; }
        var id = event.pointerId, last = { x: event.clientX, y: event.clientY };
        // Space and a click of its own would also pick an element with Comment or Edit.
        swallowClick = event.button === 0;
        dragging = true;
        grabCursor();
        try { document.documentElement.setPointerCapture(id); } catch (e) {}
        function move(next) {
            if (next.pointerId !== id) { return; }
            post(M.pan, { dx: next.clientX - last.x, dy: next.clientY - last.y });
            last = { x: next.clientX, y: next.clientY };
        }
        function end(next) {
            if (next.pointerId !== id) { return; }
            dragging = false;
            grabCursor();
            removeEventListener('pointermove', move, true);
            removeEventListener('pointerup', end, true);
            removeEventListener('pointercancel', end, true);
        }
        addEventListener('pointermove', move, true);
        addEventListener('pointerup', end, true);
        addEventListener('pointercancel', end, true);
    }

    function startCanvas() {
        var body = document.body;
        world = document.createElement('div');
        world.id = 'ruimte-design-world';
        while (body.firstChild) { world.appendChild(body.firstChild); }
        body.appendChild(world);
        var style = document.createElement('style');
        style.textContent = 'html, body { overflow: hidden !important; height: 100% !important; } #ruimte-design-world { position: absolute; left: 0; top: 0; width: max-content; min-width: 100vw; transform-origin: 0 0; } html.ruimte-design-grab, html.ruimte-design-grab * { cursor: grab !important; } html.ruimte-design-grabbing, html.ruimte-design-grabbing * { cursor: grabbing !important; user-select: none !important; }';
        document.head.appendChild(style);
        // The stage moves the camera with the canvas's own pan and zoom, so the page only hands the wheel on.
        addEventListener('wheel', function (event) {
            event.preventDefault();
            post(M.wheel, { deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode, ctrlKey: event.ctrlKey, metaKey: event.metaKey, timeStamp: event.timeStamp, x: event.clientX, y: event.clientY });
        }, { passive: false });
        addEventListener('pointerdown', startPan, true);
        // Stopped on the mouse event and not the pointer event, which would leave the text selection and the middle button's scroll to the browser.
        addEventListener('mousedown', function (event) { if (dragging) { event.preventDefault(); } }, true);
        addEventListener('auxclick', function (event) { if (event.button === 1) { event.preventDefault(); } }, true);
        addEventListener('click', function (event) {
            if (!swallowClick) { return; }
            swallowClick = false;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
        addEventListener('keydown', function (event) {
            var target = event.target;
            if (event.code !== 'Space' || (target && (target.isContentEditable || (target.closest && target.closest(SPACE_WORKS))))) { return; }
            event.preventDefault();
            if (!spaceHere) { holdSpace(true); }
        }, true);
        addEventListener('keyup', function (event) { if (event.code === 'Space' && spaceHere) { holdSpace(false); } }, true);
        // A Space that goes up while another window has the keyboard never reaches this page.
        addEventListener('blur', function () { if (spaceHere) { holdSpace(false); } });
        // Told to no one: a page that opens again gets its camera from the stage, which this would overwrite.
        place();
    }

    addEventListener('pointerdown', function () { post(M.press, {}); }, true);

    // A link to an option flies to it on the canvas and scrolls to it on a page.
    addEventListener('click', function (event) {
        var link = event.target && event.target.closest && event.target.closest('a[href^="#"]');
        if (!link || tool !== 'view' || swallowClick) { return; }
        var target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
        if (!target) { return; }
        event.preventDefault();
        if (canvas) { fitTo(worldBox(target)); } else { window.scrollTo({ top: target.getBoundingClientRect().top + scrollY - PAD, behavior: 'smooth' }); }
    }, true);

    // What an element is, for a comment, an edit or a person reading which one they picked.

    function selectorOf(element) {
        var parts = [];
        var node = element;
        while (node && node.nodeType === 1 && node !== document.body && node !== world) {
            if (node.id && document.querySelectorAll('#' + CSS.escape(node.id)).length === 1) {
                parts.unshift('#' + CSS.escape(node.id));
                return parts.join(' > ');
            }
            var index = 1, sibling = node;
            while ((sibling = sibling.previousElementSibling)) { if (sibling.tagName === node.tagName) { index++; } }
            parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
            node = node.parentElement;
        }
        return parts.length === 0 ? 'body' : 'body ' + (world ? '> #ruimte-design-world ' : '') + '> ' + parts.join(' > ');
    }

    function optionOf(element) {
        var node = element;
        while (node && node.nodeType === 1) {
            if (node.id && /^\d+[a-z]$/.test(node.id)) { return node.id; }
            node = node.parentElement;
        }
        return null;
    }

    function nameOf(element) {
        var classes = (element.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
        return element.tagName.toLowerCase() + (classes.length > 0 ? '.' + classes.join('.') : '');
    }

    var STYLE_KEYS = ['color', 'backgroundColor', 'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginBottom', 'borderRadius', 'width', 'height', 'gap', 'opacity'];

    function describe(element) {
        var rect = element.getBoundingClientRect();
        var computed = getComputedStyle(element);
        var style = {};
        STYLE_KEYS.forEach(function (key) { style[key] = computed[key]; });
        var html = element.outerHTML;
        return {
            selector: selectorOf(element),
            option: optionOf(element),
            name: nameOf(element),
            html: html.length > 600 ? html.slice(0, 600) + '…' : html,
            text: (element.innerText || '').trim().slice(0, 300),
            rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
            style: style
        };
    }

    function pickable(target) {
        return target && target.nodeType === 1 && target !== document.body && target !== document.documentElement && target !== world && !(layer && layer.contains(target));
    }

    // Outlines and pins, drawn in a layer of the page's own over everything, in screen coordinates.

    function box(rect, kind, label) {
        var element = document.createElement('div');
        element.style.cssText = 'position:fixed;pointer-events:none;box-sizing:border-box;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;border:' + (kind === 'selected' ? 2 : 1.5) + 'px solid var(--ring, var(--primary));border-radius:2px;';
        if (label) {
            var tag = document.createElement('div');
            tag.textContent = label;
            tag.style.cssText = 'position:absolute;left:-1px;bottom:100%;margin-bottom:3px;padding:1px 6px;border-radius:3px;background:var(--primary);color:var(--primary-foreground);font:500 11px/16px ui-monospace,monospace;white-space:nowrap;';
            element.appendChild(tag);
        }
        return element;
    }

    function draw() {
        if (!layer) { return; }
        layer.textContent = '';
        if (hovered && hovered !== selected && (tool === 'comment' || tool === 'edit')) {
            var rect = hovered.getBoundingClientRect();
            layer.appendChild(box(rect, 'hover', nameOf(hovered) + ' · ' + Math.round(hovered.offsetWidth) + '×' + Math.round(hovered.offsetHeight)));
        }
        if (selected) {
            layer.appendChild(box(selected.getBoundingClientRect(), 'selected', null));
        }
        pins.forEach(function (pin) {
            var target = document.querySelector(pin.selector);
            if (!target) { return; }
            var rect = target.getBoundingClientRect();
            var mark = document.createElement('div');
            mark.textContent = String(pin.number);
            mark.style.cssText = 'position:fixed;left:' + (rect.right - 10) + 'px;top:' + (rect.top - 10) + 'px;width:20px;height:20px;border-radius:50% 50% 50% 3px;background:var(--primary);color:var(--primary-foreground);font:600 11px/20px var(--font-sans,system-ui);text-align:center;box-shadow:0 1px 3px color-mix(in srgb, var(--foreground) 30%, transparent);';
            layer.appendChild(mark);
        });
    }

    function startTools() {
        layer = document.createElement('div');
        layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
        document.documentElement.appendChild(layer);
        addEventListener('scroll', draw, true);
        addEventListener('pointermove', function (event) {
            if (tool !== 'comment' && tool !== 'edit') { return; }
            var target = document.elementFromPoint(event.clientX, event.clientY);
            hovered = pickable(target) ? target : null;
            draw();
        });
        addEventListener('click', function (event) {
            if (tool !== 'comment' && tool !== 'edit') { return; }
            event.preventDefault();
            event.stopPropagation();
            if (!pickable(event.target)) { return; }
            selected = event.target;
            draw();
            post(M.pick, { tool: tool, element: describe(selected) });
        }, true);
        addEventListener('dblclick', function (event) {
            if (tool !== 'edit' || !pickable(event.target)) { return; }
            event.preventDefault();
            var element = event.target;
            var before = element.innerText;
            element.contentEditable = 'true';
            element.focus();
            element.addEventListener('blur', function done() {
                element.removeEventListener('blur', done);
                element.contentEditable = 'false';
                if (element.innerText !== before) {
                    post(M.text, { element: describe(element), before: before.slice(0, 2000), after: element.innerText.slice(0, 2000) });
                }
            });
        }, true);
    }

    // The options a drawing crosses, else the element under its middle.
    function under(rect) {
        var found = [];
        document.querySelectorAll('[id]').forEach(function (element) {
            if (found.length >= 4 || !/^\d+[a-z]$/.test(element.id)) { return; }
            var box = element.getBoundingClientRect();
            if (box.right > rect.x && box.left < rect.x + rect.width && box.bottom > rect.y && box.top < rect.y + rect.height) { found.push(describe(element)); }
        });
        if (found.length === 0) {
            var middle = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            if (pickable(middle)) { found.push(describe(middle)); }
        }
        return found;
    }

    // Tweaks.

    function readTweaks() {
        var source = document.getElementById('ruimte-tweaks');
        if (!source) { return null; }
        try { return JSON.parse(source.textContent || '{}'); } catch (e) { return null; }
    }

    function applyTweaks(values) {
        var root = document.documentElement;
        Object.keys(values).forEach(function (name) {
            var value = values[name];
            root.style.setProperty('--tweak-' + name, typeof value === 'number' ? String(value) : String(value));
            root.setAttribute('data-tweak-' + name, String(value));
        });
        window.ruimteTweaks = values;
        window.dispatchEvent(new CustomEvent('ruimte:tweaks', { detail: values }));
    }

    function valuesOf(schema) {
        var values = {};
        Object.keys(schema).forEach(function (name) { values[name] = schema[name] && schema[name].value; });
        return values;
    }

    // From the stage.

    addEventListener('message', function (event) {
        var data = event.data;
        if (!staged || event.source !== window.parent || !data || data.jsonrpc !== '2.0' || !data.params && data.method !== M.clear) { return; }
        var params = data.params || {};
        if (data.method === M.camera && canvas && isFinite(params.x) && isFinite(params.y) && params.zoom > 0) {
            camera = { x: params.x, y: params.y, zoom: Math.min(MAX, Math.max(MIN, params.zoom)) };
            show();
        } else if (data.method === M.zoom && canvas && params.action === 'fit') {
            fitAll();
        } else if (data.method === M.space && canvas) {
            spaceThere = params.down === true;
            grabCursor();
        } else if (data.method === M.tool && typeof params.tool === 'string') {
            tool = params.tool;
            hovered = null;
            selected = null;
            document.documentElement.style.cursor = tool === 'comment' ? 'crosshair' : tool === 'edit' ? 'default' : '';
            draw();
        } else if (data.method === M.style && typeof params.selector === 'string' && params.styles) {
            var target = document.querySelector(params.selector);
            if (target) { Object.keys(params.styles).forEach(function (key) { target.style.setProperty(key, params.styles[key], 'important'); }); draw(); }
        } else if (data.method === M.pins && Array.isArray(params.pins)) {
            pins = params.pins;
            draw();
        } else if (data.method === M.tweaks && params.values) {
            applyTweaks(params.values);
        } else if (data.method === M.clear) {
            selected = null;
            draw();
        } else if (data.method === M.locate && isFinite(params.x) && isFinite(params.y)) {
            post(M.located, { elements: under(params) });
        }
    });

    function start() {
        canvas = !!document.querySelector('meta[name="ruimte-design"][content="canvas"]');
        if (canvas) { startCanvas(); }
        startTools();
        tweaks = readTweaks();
        if (tweaks) { applyTweaks(valuesOf(tweaks)); }
        post(M.ready, canvas ? { canvas: true, tweaks: tweaks, camera: camera } : { canvas: false, tweaks: tweaks });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();`;

export const DESIGN_RUNTIME = RUNTIME;

/* The page with the design runtime at the end of its body, so it runs once the page's own markup is there. */
export function withDesignRuntime(html: string): string {
    const script = `<script data-ruimte-design>${RUNTIME}</script>`;
    const end = html.search(/<\/body\s*>/i);

    return end === -1 ? `${html}${script}` : `${html.slice(0, end)}${script}${html.slice(end)}`;
}

/*
 * What the stage reads for the files a page's script names while it runs: each once however often it is
 * asked, by the page or the pages it frames, and up to the bounds of a visual all together. Null for a
 * file it cannot or may not read, which the page shows as a broken path.
 */
export function runtimeAssets(read: (path: string) => Promise<Blob>): (path: string) => Promise<Blob | null> {
    const asked = new Map<string, Promise<Blob | null>>();
    let total = 0;

    return (path) => {
        let bytes = asked.get(path);

        if (bytes === undefined) {
            bytes = read(path).then(
                (blob) => {
                    if (total + blob.size > DESIGN_PAGE_MAX_BYTES) {
                        return null;
                    }

                    total += blob.size;

                    return blob;
                },
                () => null
            );
            asked.set(path, bytes);
        }

        return bytes;
    };
}
