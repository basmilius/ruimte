import { BAND_MARGIN, bandOfCode, type Layering } from './graph.ts';

/* Rounds that pull every unit towards the units it is joined to, alternating the direction of the sweep. */
const ROUNDS = 8;

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/*
 * Where every unit sits across the flow, as the top of its box, with the order of `orderLayers` kept.
 * A group's block has one top in every layer it spans and its members sit inside it. It starts from
 * the middle of the tightest packing towards either end, which is always a valid place, and then
 * moves every unit towards the median of its neighbors as far as its own neighbors in the layer let
 * it, so a chain lines up straight. Every step is clamped to whole numbers.
 */
export const placeAcross = (layering: Layering): number[] => {
    const { units, bands, lines, items } = layering;
    const unitCount = units.length;
    const variableCount = unitCount + bands.length;
    // A free unit is its own variable; a band is one variable for all its layers, its members sit at an offset from it.
    const top = new Array<number>(variableCount).fill(0);
    const local = new Array<number>(unitCount).fill(0);

    const variableOf = (code: number): number => (code >= 0 ? code : unitCount + bandOfCode(code));
    const codeOf = (variable: number): number => (variable < unitCount ? variable : -(variable - unitCount + 1));
    const sizeOf = (code: number): number => (code >= 0 ? units[code]!.h : bands[bandOfCode(code)]!.height);
    const marginOf = (code: number): number => (code >= 0 ? units[code]!.margin : BAND_MARGIN);
    const topOf = (code: number): number => top[variableOf(code)]!;
    const absoluteTop = (unit: number): number => {
        const band = units[unit]!.band;
        return band >= 0 ? top[unitCount + band]! + local[unit]! : top[unit]!;
    };

    const successors: number[][] = Array.from({ length: variableCount }, () => []);
    const incoming = new Array<number>(variableCount).fill(0);
    const present = new Array<boolean>(variableCount).fill(false);
    for (const row of items) {
        row.forEach((code, index) => {
            present[variableOf(code)] = true;
            if (index > 0) {
                successors[variableOf(row[index - 1]!)]!.push(code);
                incoming[variableOf(code)]! += 1;
            }
        });
    }

    // The band order is the same in every layer, so these constraints never form a cycle.
    const lowest = new Array<number>(variableCount).fill(0);
    const queue: number[] = [];
    for (let variable = 0; variable < variableCount; variable++) {
        if (present[variable] && incoming[variable] === 0) {
            queue.push(variable);
        }
    }
    for (let i = 0; i < queue.length; i++) {
        const variable = queue[i]!;
        const code = codeOf(variable);
        for (const next of successors[variable]!) {
            const target = variableOf(next);
            lowest[target] = Math.max(lowest[target]!, lowest[variable]! + sizeOf(code) + marginOf(code) + marginOf(next));
            incoming[target]! -= 1;
            if (incoming[target] === 0) {
                queue.push(target);
            }
        }
    }
    const tail = new Array<number>(variableCount).fill(0);
    let total = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
        const variable = queue[i]!;
        const code = codeOf(variable);
        let length = sizeOf(code);
        for (const next of successors[variable]!) {
            length = Math.max(length, sizeOf(code) + marginOf(code) + marginOf(next) + tail[variableOf(next)]!);
        }
        tail[variable] = length;
        total = Math.max(total, lowest[variable]! + length);
    }
    for (const variable of queue) {
        top[variable] = Math.floor((lowest[variable]! + total - tail[variable]!) / 2);
    }

    for (const band of bands) {
        for (const slot of band.members) {
            const low: number[] = [];
            let at = band.before;
            slot.forEach((unit, index) => {
                if (index > 0) {
                    const previous = units[slot[index - 1]!]!;
                    at += previous.h + previous.margin + units[unit]!.margin;
                }
                low.push(at);
            });
            let high = band.height - band.after;
            for (let index = slot.length - 1; index >= 0; index--) {
                const unit = units[slot[index]!]!;
                if (index < slot.length - 1) {
                    high -= unit.margin + units[slot[index + 1]!]!.margin;
                }
                high -= unit.h;
                local[slot[index]!] = Math.floor((low[index]! + high) / 2);
            }
        }
    }

    const medianOf = (values: number[]): number => {
        values.sort((left, right) => left - right);
        const middle = values.length >> 1;
        return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2;
    };
    const desiredTop = (unit: number): number | null => {
        const self = units[unit]!;
        if (self.line >= 0) {
            // The points of one long edge pull towards each other rather than their neighbors, so the edge runs straight
            // instead of stepping a little in every layer it passes.
            const line = lines[self.line]!;
            const ends = [units[line[0]!]!.up[0]!, units[line.at(-1)!]!.down[0]!].map((end) => absoluteTop(end) + units[end]!.h / 2);
            if (line.length === 1) {
                const here = absoluteTop(unit);
                return Math.round(Math.abs(ends[1]! - here) < Math.abs(ends[0]! - here) ? ends[1]! : ends[0]!);
            }
            return Math.round(medianOf([...line.filter((other) => other !== unit).map(absoluteTop), ...ends]));
        }
        const neighbors = [...self.up, ...self.down];
        if (neighbors.length === 0) {
            return null;
        }
        return Math.round(medianOf(neighbors.map((neighbor) => absoluteTop(neighbor) + units[neighbor]!.h / 2)) - self.h / 2);
    };

    for (let round = 0; round < ROUNDS; round++) {
        for (let step = 0; step < items.length; step++) {
            const layer = round % 2 === 0 ? step : items.length - 1 - step;
            const row = items[layer]!;
            row.forEach((code, index) => {
                if (code >= 0) {
                    const want = desiredTop(code);
                    if (want === null) {
                        return;
                    }
                    const previous = row[index - 1];
                    const next = row[index + 1];
                    const low = previous === undefined ? -Infinity : topOf(previous) + sizeOf(previous) + marginOf(previous) + marginOf(code);
                    const high = next === undefined ? Infinity : topOf(next) - marginOf(next) - marginOf(code) - sizeOf(code);
                    top[code] = clamp(want, low, high);
                    return;
                }
                const bandIndex = bandOfCode(code);
                const band = bands[bandIndex]!;
                const slot = band.members[layer - band.first]!;
                slot.forEach((unit, position) => {
                    const want = desiredTop(unit);
                    if (want === null) {
                        return;
                    }
                    const self = units[unit]!;
                    const previous = slot[position - 1];
                    const next = slot[position + 1];
                    const low = previous === undefined ? band.before : local[previous]! + units[previous]!.h + units[previous]!.margin + self.margin;
                    const high = next === undefined ? band.height - band.after - self.h : local[next]! - units[next]!.margin - self.margin - self.h;
                    local[unit] = clamp(want - top[unitCount + bandIndex]!, low, high);
                });
            });
        }

        bands.forEach((band, bandIndex) => {
            const shifts: number[] = [];
            for (const unit of band.members.flat()) {
                const want = desiredTop(unit);
                if (want !== null) {
                    shifts.push(want - absoluteTop(unit));
                }
            }
            if (shifts.length === 0) {
                return;
            }
            const code = -(bandIndex + 1);
            let low = -Infinity;
            let high = Infinity;
            for (let layer = band.first; layer <= band.last; layer++) {
                const row = items[layer]!;
                const index = row.indexOf(code);
                const previous = row[index - 1];
                const next = row[index + 1];
                if (previous !== undefined) {
                    low = Math.max(low, topOf(previous) + sizeOf(previous) + marginOf(previous) + BAND_MARGIN);
                }
                if (next !== undefined) {
                    high = Math.min(high, topOf(next) - marginOf(next) - BAND_MARGIN - band.height);
                }
            }
            const shift = Math.round(shifts.reduce((sum, value) => sum + value, 0) / shifts.length);
            top[unitCount + bandIndex] = clamp(top[unitCount + bandIndex]! + shift, low, high);
        });
    }

    let least = Infinity;
    for (const row of items) {
        for (const code of row) {
            least = Math.min(least, topOf(code));
        }
    }
    if (Number.isFinite(least)) {
        for (let variable = 0; variable < variableCount; variable++) {
            top[variable] = top[variable]! - least || 0;
        }
    }
    bands.forEach((band, index) => {
        band.top = top[unitCount + index]!;
    });
    return units.map((_, unit) => absoluteTop(unit));
};
