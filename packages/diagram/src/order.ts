import { bandCode, bandOfCode, type Layering } from './graph.ts';

/* Sweeps of the barycenter heuristic, alternating down and up; the best order any of them reached is kept. */
const SWEEPS = 12;

/*
 * The order inside every layer, in place. A unit moves to the average position of the units it is
 * joined to in the layer it was compared with, a tie keeps the order it had (file order to begin
 * with), and the members of a group stay together as one block. The blocks of groups keep one order
 * in every layer, and a unit that is not in a group stays on the same side of a group from one layer
 * to the next inside it, so no hop has to cross a group it does not belong to.
 */
export const orderLayers = (layering: Layering): void => {
    const { units, hops, bands, items } = layering;
    const position = new Array<number>(units.length).fill(0);
    const bandPosition = bands.map((band) => new Array<number>(band.last - band.first + 1).fill(0));
    const hopsByLayer: number[][] = items.map(() => []);
    hops.forEach((hop, index) => {
        hopsByLayer[units[hop.from]!.layer]!.push(index);
    });

    const flatten = (layer: number): void => {
        let at = 0;
        for (const code of items[layer]!) {
            if (code >= 0) {
                position[code] = at++;
                continue;
            }
            const band = bands[bandOfCode(code)]!;
            const members = band.members[layer - band.first]!;
            bandPosition[bandOfCode(code)]![layer - band.first] = at;
            if (members.length === 0) {
                at++;
            }
            for (const member of members) {
                position[member] = at++;
            }
        }
    };

    const enforceBandOrder = (layer: number): void => {
        const row = items[layer]!;
        const slots: number[] = [];
        const present: number[] = [];
        row.forEach((code, index) => {
            if (code < 0) {
                slots.push(index);
                present.push(bandOfCode(code));
            }
        });
        present.sort((left, right) => bands[left]!.rank - bands[right]!.rank);
        slots.forEach((slot, index) => {
            row[slot] = bandCode(present[index]!);
        });
    };

    const sortLayer = (layer: number, towardsUp: boolean): void => {
        const keyOf = (unit: number): number => {
            const neighbors = towardsUp ? units[unit]!.up : units[unit]!.down;
            if (neighbors.length === 0) {
                return position[unit]!;
            }
            let sum = 0;
            for (const neighbor of neighbors) {
                sum += position[neighbor]!;
            }
            return sum / neighbors.length;
        };
        const keyed = items[layer]!.map((code, index) => {
            if (code >= 0) {
                return { code, index, key: keyOf(code) };
            }
            const band = bands[bandOfCode(code)]!;
            const slot = layer - band.first;
            const members = band.members[slot]!.map((unit) => ({ unit, key: keyOf(unit), at: position[unit]! }));
            members.sort((left, right) => left.key - right.key || left.at - right.at);
            band.members[slot] = members.map((member) => member.unit);
            const key = members.length > 0 ? members.reduce((sum, member) => sum + member.key, 0) / members.length : bandPosition[bandOfCode(code)]![slot]!;
            return { code, index, key };
        });
        keyed.sort((left, right) => left.key - right.key || left.index - right.index);
        items[layer] = keyed.map((entry) => entry.code);
        enforceBandOrder(layer);
        flatten(layer);
    };

    const updateRanks = (): void => {
        const scores = bands.map((band, index) => {
            let sum = 0;
            for (let layer = band.first; layer <= band.last; layer++) {
                const row = items[layer]!;
                sum += row.indexOf(bandCode(index)) / row.length;
            }
            return sum / (band.last - band.first + 1);
        });
        const order = bands.map((_, index) => index).sort((left, right) => scores[left]! - scores[right]! || bands[left]!.rank - bands[right]!.rank);
        order.forEach((band, rank) => {
            bands[band]!.rank = rank;
        });
    };

    // A free unit takes the side of every group its neighbors are on, as far as they agree.
    const keepSides = (): void => {
        for (let layer = 0; layer < items.length; layer++) {
            if (!items[layer]!.some((code) => code < 0)) {
                continue;
            }
            const previousIndex = new Map<number, number>();
            (items[layer - 1] ?? []).forEach((code, index) => previousIndex.set(code, index));
            const free = items[layer]!.filter((code) => code >= 0);
            for (const unit of free) {
                const row = items[layer]!;
                const present = row.filter((code) => code < 0).map(bandOfCode);
                let lower = 0;
                let upper = present.length;
                const narrow = (source: number, sourceLayer: number): void => {
                    let low = 0;
                    let high = present.length;
                    present.forEach((band, slot) => {
                        const target = bands[band]!;
                        const sourceBand = units[source]!.band;
                        if (sourceLayer < target.first || sourceLayer > target.last || sourceBand === band) {
                            return;
                        }
                        const before =
                            sourceBand >= 0 ? bands[sourceBand]!.rank < target.rank : previousIndex.get(source)! < previousIndex.get(bandCode(band))!;
                        if (before) {
                            high = Math.min(high, slot);
                        } else {
                            low = Math.max(low, slot + 1);
                        }
                    });
                    if (Math.max(lower, low) <= Math.min(upper, high)) {
                        lower = Math.max(lower, low);
                        upper = Math.min(upper, high);
                    }
                };
                for (const source of units[unit]!.up) {
                    narrow(source, layer - 1);
                }
                // A member of a group in the next layer cannot move, so the free unit follows it instead.
                for (const target of units[unit]!.down) {
                    if (units[target]!.band >= 0) {
                        narrow(target, layer + 1);
                    }
                }
                const at = row.indexOf(unit);
                const slot = row.slice(0, at).filter((code) => code < 0).length;
                if (slot < lower) {
                    row.splice(at, 1);
                    row.splice(row.indexOf(bandCode(present[lower - 1]!)) + 1, 0, unit);
                } else if (slot > upper) {
                    row.splice(at, 1);
                    row.splice(row.indexOf(bandCode(present[upper]!)), 0, unit);
                }
            }
        }
    };

    const crossings = (): number => {
        let total = 0;
        for (let layer = 0; layer + 1 < items.length; layer++) {
            const pairs = hopsByLayer[layer]!.map((index) => [position[hops[index]!.from]!, position[hops[index]!.to]!] as const);
            if (pairs.length < 2) {
                continue;
            }
            pairs.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
            // A Fenwick tree over the positions of the next layer counts the pairs that come in out of order.
            const size = pairs.reduce((largest, pair) => Math.max(largest, pair[1]), 0) + 2;
            const tree = new Array<number>(size + 1).fill(0);
            pairs.forEach(([, to], seen) => {
                let atMost = 0;
                for (let i = to + 1; i > 0; i -= i & -i) {
                    atMost += tree[i]!;
                }
                total += seen - atMost;
                for (let i = to + 1; i <= size; i += i & -i) {
                    tree[i]! += 1;
                }
            });
        }
        return total;
    };

    const settle = (): number => {
        items.forEach((_, layer) => enforceBandOrder(layer));
        keepSides();
        items.forEach((_, layer) => flatten(layer));
        return crossings();
    };

    const snapshot = () => ({
        items: items.map((row) => row.slice()),
        members: bands.map((band) => band.members.map((slot) => slot.slice())),
        ranks: bands.map((band) => band.rank)
    });

    items.forEach((_, layer) => flatten(layer));
    // A band's first layer always holds a member, which is what made it the first.
    const firstSeen = bands.map((band, index) => [band.first, position[band.members[0]![0]!]!, index] as const);
    firstSeen
        .slice()
        .sort((left, right) => left[0] - right[0] || left[1] - right[1] || left[2] - right[2])
        .forEach(([, , band], rank) => {
            bands[band]!.rank = rank;
        });

    let bestCount = settle();
    let best = snapshot();
    for (let sweep = 0; sweep < SWEEPS && bestCount > 0; sweep++) {
        if (sweep % 2 === 0) {
            for (let layer = 1; layer < items.length; layer++) {
                sortLayer(layer, true);
            }
        } else {
            for (let layer = items.length - 2; layer >= 0; layer--) {
                sortLayer(layer, false);
            }
        }
        updateRanks();
        const count = settle();
        if (count < bestCount) {
            bestCount = count;
            best = snapshot();
        }
    }

    best.items.forEach((row, layer) => {
        items[layer] = row;
    });
    bands.forEach((band, index) => {
        band.members = best.members[index]!;
        band.rank = best.ranks[index]!;
    });
};
