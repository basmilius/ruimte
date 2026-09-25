/* The page around the takes: the fitting room, the skills index and the contact sheet. */
(() => {
    'use strict';

    const ROLLS = [
        {
            name: 'Roll A',
            title: 'Space and craft',
            note: 'The first twenty: space, rooms and the craft of motion itself.',
            ids: ['room-in-a-room', 'letterspace', 'patch-bay', 'split-flap', 'floating-rooms', 'making-room', 'cursor-flock', 'ball-test', 'transit', 'loupe', 'resonance', 'shuffle', 'napkin', 'monospace', 'mitosis', 'in-step', 'phosphor', 'overnight', 'interference', 'flipside']
        },
        {
            name: 'Roll B',
            title: 'Agents at work',
            note: 'Twenty more, each one a real Ruimte feature or a real moment of agentic work.',
            ids: ['needs-you', 'context-lines', 'delegation', 'question-card', 'stream', 'wake-chain', 'phantom-cursor', 'grid-views', 'plan-tree', 'handshake', 'three-ways', 'agent-loop', 'attention-stack', 'browser-drive', 'limit-clock', 'reading-order', 'device', 'infinite-canvas', 'voice', 'mission-control']
        }
    ];
    const PRINCIPLES = [
        'Squash and stretch',
        'Anticipation',
        'Staging',
        'Straight ahead and pose to pose',
        'Follow through and overlapping action',
        'Slow in and slow out',
        'Arcs',
        'Secondary action',
        'Timing',
        'Exaggeration',
        'Solid drawing',
        'Appeal'
    ];
    const STAR_ICON = document.querySelector('#c-star svg').outerHTML;

    const takes = [];
    for (const roll of ROLLS) {
        roll.takes = roll.ids.map((id) => Reel.get(id)).filter(Boolean);
        for (const take of roll.takes) {
            take.roll = roll;
            takes.push(take);
        }
    }
    const pad = (n) => String(n).padStart(2, '0');
    const $ = (id) => document.getElementById(id);

    const store = {
        read(key, fallback) {
            try {
                const raw = localStorage.getItem('ruimte-reel:' + key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch {
                return fallback;
            }
        },
        write(key, value) {
            try {
                localStorage.setItem('ruimte-reel:' + key, JSON.stringify(value));
            } catch {
                // Storage can be blocked; the page works without it.
            }
        }
    };

    const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const state = {
        current: 0,
        starred: new Set(store.read('starred', []).filter((id) => takes.some((take) => take.id === id))),
        principle: null,
        onlyStarred: false,
        motion: store.read('motion', !reducedQuery.matches)
    };
    const fromHash = /^#take-(\d{1,2})$/.exec(location.hash);
    // Roll B opens on its own first take; what a person picked after that is remembered.
    const remembered = takes.findIndex((take) => take.id === store.read('current-b', null));
    const firstOfB = takes.findIndex((take) => take.roll === ROLLS[1]);
    state.current = fromHash ? Math.min(takes.length - 1, Math.max(0, Number(fromHash[1]) - 1)) : remembered >= 0 ? remembered : Math.max(0, firstOfB);

    $('slate-takes').textContent = String(takes.length);
    $('c-of').textContent = 'of ' + takes.length;

    /* Fitting room */
    const stageHost = $('stage-host');
    let stage = null;
    let stageVisible = true;

    const startRunner = (runner, def) => {
        if (state.motion) {
            ReelClock.play(runner);
        } else {
            runner.seek(def.poster ?? 4);
        }
    };

    const showTake = (index, { focusStage = false } = {}) => {
        state.current = (index + takes.length) % takes.length;
        const def = takes[state.current];
        const previous = stage;
        stage = new ReelRunner(def, stageHost, { quality: 1, maxDpr: 2 });
        stage.canvas.classList.add('entering');
        stageHost.insertBefore(stage.canvas, $('stage-hint'));
        if (stageVisible) {
            startRunner(stage, def);
        } else {
            stage.seek(0);
        }
        requestAnimationFrame(() => requestAnimationFrame(() => stage && stage.canvas.classList.remove('entering')));
        if (previous) {
            previous.canvas.classList.add('leaving');
            const old = previous;
            setTimeout(() => {
                ReelClock.pause(old);
                old.destroy();
            }, reducedQuery.matches ? 0 : 460);
        }
        store.write('current-b', def.id);
        renderCredits();
        for (const tile of tiles) {
            tile.el.classList.toggle('is-current', tile.def === def);
        }
        if (focusStage) {
            $('fitting').scrollIntoView({ behavior: reducedQuery.matches ? 'auto' : 'smooth', block: 'start' });
        }
    };

    const renderCredits = () => {
        const def = takes[state.current];
        const n = state.current + 1;
        $('c-num').textContent = pad(n);
        $('c-roll').textContent = def.roll.name;
        $('c-title').textContent = def.title;
        $('c-line').textContent = def.line || '';
        $('c-tech').textContent = def.tech || '';
        $('c-principles').replaceChildren(
            ...(def.principles || []).map((name) => {
                const li = document.createElement('li');
                li.className = 'chip';
                li.textContent = name;
                return li;
            })
        );
        $('pill-count').textContent = n + '/' + takes.length;
        $('stage-hint').textContent = def.hint || '';
        $('stage-desc').textContent = 'Take ' + n + ', ' + def.title + ': ' + (def.line || '') + ' An animated illustration.';
        const starred = state.starred.has(def.id);
        $('c-star').setAttribute('aria-pressed', String(starred));
        $('c-star-label').textContent = starred ? 'On the shortlist' : 'Shortlist';
    };

    $('prev').addEventListener('click', () => showTake(state.current - 1));
    $('next').addEventListener('click', () => showTake(state.current + 1));
    $('pill').addEventListener('click', () => showTake(state.current + 1));
    $('c-star').addEventListener('click', () => toggleStar(takes[state.current].id));
    window.addEventListener('keydown', (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) {
            return;
        }
        const target = event.target;
        if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) {
            return;
        }
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            showTake(state.current - 1);
        } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            showTake(state.current + 1);
        }
    });

    new IntersectionObserver(([entry]) => {
        stageVisible = entry.isIntersecting;
        if (!stage) {
            return;
        }
        if (stageVisible && state.motion) {
            ReelClock.play(stage);
        } else {
            ReelClock.pause(stage);
        }
    }).observe(stageHost);

    /* Skills */
    const counts = new Map(PRINCIPLES.map((name) => [name, takes.filter((take) => (take.principles || []).includes(name))]));
    const most = Math.max(1, ...[...counts.values()].map((list) => list.length));
    const skillButtons = [];
    $('skills').replaceChildren(
        ...PRINCIPLES.map((name) => {
            const list = counts.get(name);
            const li = document.createElement('li');
            li.className = 'skill-row';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'skill';
            button.setAttribute('aria-pressed', 'false');
            button.dataset.principle = name;
            const meter = Array.from({ length: most }, (_, i) => `<i class="${i < list.length ? 'on' : ''}"></i>`).join('');
            button.innerHTML = `<span class="skill-name"></span><span class="meter" aria-hidden="true">${meter}</span><span class="sr-only">, ${list.length} takes</span>`;
            button.querySelector('.skill-name').textContent = name;
            button.addEventListener('click', () => {
                state.principle = state.principle === name ? null : name;
                applyFilter();
                if (state.principle) {
                    $('reel').scrollIntoView({ behavior: reducedQuery.matches ? 'auto' : 'smooth', block: 'start' });
                }
            });
            skillButtons.push(button);
            const chips = document.createElement('div');
            chips.className = 'skill-takes';
            for (const take of list) {
                const index = takes.indexOf(take);
                const chip = document.createElement('button');
                chip.type = 'button';
                chip.className = 'take-chip';
                chip.textContent = pad(index + 1);
                chip.setAttribute('aria-label', `Show take ${index + 1}, ${take.title}, in the hero`);
                chip.addEventListener('click', () => showTake(index, { focusStage: true }));
                chips.append(chip);
            }
            li.append(button, chips);
            return li;
        })
    );

    /* Reel */
    const tiles = [];
    const grid = $('grid');
    const tileObserver = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                const tile = tiles.find((item) => item.frame === entry.target);
                if (!tile) {
                    continue;
                }
                tile.visible = entry.isIntersecting;
                syncTile(tile);
            }
        },
        { rootMargin: '80px 0px' }
    );

    const syncTile = (tile) => {
        if (tile.visible && !tile.el.hidden) {
            if (!tile.runner) {
                tile.runner = new ReelRunner(tile.def, tile.frame, { quality: 0.55, maxDpr: 1.5 });
                tile.frame.insertBefore(tile.runner.canvas, tile.frame.firstChild);
                if (!state.motion) {
                    tile.runner.seek(tile.def.poster ?? 4);
                }
            }
            if (state.motion) {
                ReelClock.play(tile.runner);
            }
        } else if (tile.runner) {
            ReelClock.pause(tile.runner);
        }
    };

    takes.forEach((def, index) => {
        if (def.roll.takes[0] === def) {
            const head = document.createElement('div');
            head.className = 'roll-head';
            head.innerHTML = '<span class="roll-name"></span><h3 class="roll-title"></h3><p class="roll-note"></p>';
            head.querySelector('.roll-name').textContent = def.roll.name;
            head.querySelector('.roll-title').textContent = def.roll.title;
            head.querySelector('.roll-note').textContent = def.roll.note;
            grid.append(head);
            def.roll.head = head;
        }
        const el = document.createElement('article');
        el.className = 'tile';
        el.id = 'take-' + pad(index + 1);
        const frame = document.createElement('button');
        frame.type = 'button';
        frame.className = 'tile-frame';
        frame.setAttribute('aria-label', `Show take ${index + 1}, ${def.title}, in the hero`);
        frame.innerHTML = '<span class="tile-badge">In the hero</span>';
        frame.addEventListener('click', () => showTake(index, { focusStage: true }));
        const meta = document.createElement('div');
        meta.className = 'tile-meta';
        meta.innerHTML = `
            <span class="tile-num">${pad(index + 1)}</span>
            <h3 class="tile-title"><button type="button"></button></h3>
            <button type="button" class="star" aria-pressed="false">${STAR_ICON}</button>
            <p class="tile-line"></p>
            <p class="tile-principles"></p>
            <p class="tile-tech"></p>`;
        const titleButton = meta.querySelector('.tile-title button');
        titleButton.textContent = def.title;
        titleButton.addEventListener('click', () => showTake(index, { focusStage: true }));
        meta.querySelector('.tile-line').textContent = def.line || '';
        meta.querySelector('.tile-principles').textContent = (def.principles || []).join(', ');
        meta.querySelector('.tile-tech').textContent = def.tech || '';
        const star = meta.querySelector('.star');
        star.addEventListener('click', () => toggleStar(def.id));
        el.append(frame, meta);
        grid.append(el);
        const tile = { def, el, frame, star, runner: null, visible: false };
        tiles.push(tile);
        tileObserver.observe(frame);
    });

    const toggleStar = (id) => {
        if (state.starred.has(id)) {
            state.starred.delete(id);
        } else {
            state.starred.add(id);
        }
        store.write('starred', [...state.starred]);
        renderStars();
        renderCredits();
        applyFilter();
    };

    const renderStars = () => {
        for (const tile of tiles) {
            const on = state.starred.has(tile.def.id);
            tile.star.setAttribute('aria-pressed', String(on));
            tile.star.setAttribute('aria-label', on ? `Remove ${tile.def.title} from the shortlist` : `Add ${tile.def.title} to the shortlist`);
        }
        const count = state.starred.size;
        $('only-starred-label').textContent = count ? `Shortlist only (${count})` : 'Shortlist only';
    };

    const applyFilter = () => {
        let shown = 0;
        for (const tile of tiles) {
            const hidden = state.onlyStarred && !state.starred.has(tile.def.id);
            tile.el.hidden = hidden;
            tile.el.classList.toggle('dim', !!state.principle && !(tile.def.principles || []).includes(state.principle));
            if (!hidden) {
                shown++;
            }
            syncTile(tile);
        }
        $('empty').hidden = shown > 0;
        for (const roll of ROLLS) {
            if (roll.head) {
                roll.head.hidden = tiles.every((tile) => tile.def.roll !== roll || tile.el.hidden);
            }
        }
        for (const button of skillButtons) {
            button.setAttribute('aria-pressed', String(button.dataset.principle === state.principle));
        }
        const filter = $('filter-state');
        if (state.principle) {
            const n = counts.get(state.principle).length;
            filter.innerHTML = '';
            filter.append(`${n} ${n === 1 ? 'take shows' : 'takes show'} ${state.principle.toLowerCase()}. `);
            const clear = document.createElement('button');
            clear.type = 'button';
            clear.textContent = 'Show all';
            clear.addEventListener('click', () => {
                state.principle = null;
                applyFilter();
            });
            filter.append(clear);
        } else {
            filter.textContent = '';
        }
        $('only-starred').setAttribute('aria-pressed', String(state.onlyStarred));
    };

    $('only-starred').addEventListener('click', () => {
        state.onlyStarred = !state.onlyStarred;
        applyFilter();
    });

    const renderMotion = () => {
        const button = $('motion');
        button.setAttribute('aria-pressed', String(state.motion));
        button.textContent = state.motion ? 'Motion on' : 'Motion off';
    };
    $('motion').addEventListener('click', () => {
        state.motion = !state.motion;
        store.write('motion', state.motion);
        renderMotion();
        const all = [stage, ...tiles.map((tile) => tile.runner)].filter(Boolean);
        for (const runner of all) {
            if (state.motion) {
                if (runner === stage ? stageVisible : tiles.some((tile) => tile.runner === runner && tile.visible && !tile.el.hidden)) {
                    ReelClock.play(runner);
                }
            } else {
                ReelClock.pause(runner);
                runner.seek(runner.def.poster ?? 4);
            }
        }
    });

    const boot = () => {
        const gl = takes.filter((take) => /^WebGL/.test(take.tech || '')).length;
        $('tech-count').textContent = `${takes.length - gl} draw with Canvas 2D and ${gl} share one WebGL context.`;
        renderMotion();
        renderStars();
        applyFilter();
        showTake(state.current);
    };

    // Canvas text only uses a web font once it has loaded, so the takes wait for the faces they draw with.
    const faces = ['600 40px Geist', '400 20px Geist', '500 16px "JetBrains Mono"', '700 16px "JetBrains Mono"', '400 20px Kalam', '700 20px Kalam'];
    const ready = Promise.all(faces.map((face) => document.fonts.load(face).catch(() => null)));
    Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 2500))]).then(boot);
})();
