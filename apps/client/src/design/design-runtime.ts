import { DESIGN_METHODS } from '@/design/design-protocol';

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
    var MIN = 0.05, MAX = 8, PAD = 48;
    var staged = window.parent !== window;
    var canvas = false, world = null, layer = null, fitted = false, told = 0;
    var camera = { x: 0, y: 0, zoom: 1 };
    var tool = 'view', hovered = null, selected = null, pins = [], tweaks = null;

    function post(method, params) {
        if (!staged) { return; }
        window.parent.postMessage(params === undefined ? { jsonrpc: '2.0', method: method } : { jsonrpc: '2.0', method: method, params: params }, '*');
    }

    // Canvas.

    function apply() {
        if (!canvas) { return; }
        world.style.transform = 'translate(' + camera.x + 'px, ' + camera.y + 'px) scale(' + camera.zoom + ')';
        draw();
        var now = Date.now();
        clearTimeout(apply.timer);
        if (now - told > 120) {
            told = now;
            post(M.camera, { x: camera.x, y: camera.y, zoom: camera.zoom });
        } else {
            apply.timer = setTimeout(function () { told = Date.now(); post(M.camera, { x: camera.x, y: camera.y, zoom: camera.zoom }); }, 140);
        }
    }

    function fitTo(box) {
        var width = Math.max(box.width, 1), height = Math.max(box.height, 1);
        var zoom = Math.max(MIN, Math.min(1, (innerWidth - 2 * PAD) / width, (innerHeight - 2 * PAD) / height));
        camera = { zoom: zoom, x: (innerWidth - width * zoom) / 2 - box.left * zoom, y: Math.max(PAD, (innerHeight - height * zoom) / 2) - box.top * zoom };
        apply();
    }

    // The board is the document; a wide one fits its width and starts at its top, the way a long page reads.
    function fitAll() {
        var width = Math.max(world.scrollWidth, 1);
        var zoom = Math.max(MIN, Math.min(1, (innerWidth - 2 * PAD) / width));
        camera = { zoom: zoom, x: Math.max(PAD, (innerWidth - width * zoom) / 2), y: PAD };
        apply();
    }

    function worldBox(element) {
        var left = 0, top = 0, node = element;
        while (node && node !== world) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent; }
        return { left: left, top: top, width: element.offsetWidth, height: element.offsetHeight };
    }

    function zoomAt(clientX, clientY, factor) {
        var zoom = Math.min(MAX, Math.max(MIN, camera.zoom * factor));
        camera = { zoom: zoom, x: clientX - (clientX - camera.x) * (zoom / camera.zoom), y: clientY - (clientY - camera.y) * (zoom / camera.zoom) };
        apply();
    }

    function startCanvas() {
        var body = document.body;
        world = document.createElement('div');
        world.id = 'ruimte-design-world';
        while (body.firstChild) { world.appendChild(body.firstChild); }
        body.appendChild(world);
        var style = document.createElement('style');
        style.textContent = 'html, body { overflow: hidden !important; height: 100% !important; } #ruimte-design-world { position: absolute; left: 0; top: 0; width: max-content; min-width: 100vw; transform-origin: 0 0; }';
        document.head.appendChild(style);
        addEventListener('wheel', function (event) {
            event.preventDefault();
            fitted = true;
            if (event.ctrlKey || event.metaKey) {
                zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.01)));
            } else {
                camera = { zoom: camera.zoom, x: camera.x - event.deltaX, y: camera.y - event.deltaY };
                apply();
            }
        }, { passive: false });
        addEventListener('pointerdown', function (event) {
            var background = event.target === document.body || event.target === document.documentElement || event.target === world;
            if (tool === 'draw' || !(event.button === 1 || (event.button === 0 && background && tool === 'view'))) { return; }
            event.preventDefault();
            fitted = true;
            var from = { x: event.clientX - camera.x, y: event.clientY - camera.y };
            document.body.style.cursor = 'grabbing';
            function move(next) { camera = { zoom: camera.zoom, x: next.clientX - from.x, y: next.clientY - from.y }; apply(); }
            function end() { document.body.style.cursor = ''; removeEventListener('pointermove', move); removeEventListener('pointerup', end); removeEventListener('pointercancel', end); }
            addEventListener('pointermove', move);
            addEventListener('pointerup', end);
            addEventListener('pointercancel', end);
        });
        addEventListener('resize', function () { if (!fitted) { fitAll(); } });
        addEventListener('load', function () { if (!fitted) { fitAll(); } });
        fitAll();
    }

    // A link to an option flies to it on the canvas and scrolls to it on a page.
    addEventListener('click', function (event) {
        var link = event.target && event.target.closest && event.target.closest('a[href^="#"]');
        if (!link || tool !== 'view') { return; }
        var target = document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1)));
        if (!target) { return; }
        event.preventDefault();
        if (canvas) { fitted = true; fitTo(worldBox(target)); } else { window.scrollTo({ top: target.getBoundingClientRect().top + scrollY - PAD, behavior: 'smooth' }); }
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
            fitted = true;
            camera = { x: params.x, y: params.y, zoom: Math.min(MAX, Math.max(MIN, params.zoom)) };
            apply();
        } else if (data.method === M.zoom && canvas) {
            fitted = true;
            if (params.action === 'fit') { fitAll(); } else if (params.action === 'set' && params.zoom > 0) { zoomAt(innerWidth / 2, innerHeight / 2, params.zoom / camera.zoom); }
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
        post(M.ready, { canvas: canvas, tweaks: tweaks });
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
