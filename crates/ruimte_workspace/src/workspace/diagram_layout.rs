#![allow(
    clippy::collapsible_if,
    clippy::manual_is_multiple_of,
    clippy::needless_range_loop
)]

use std::collections::{HashMap, HashSet};

use serde_json::Value;

use super::graphics::{
    Point, Rect, diagram_edge_label_size, diagram_node_size, estimate_diagram_text,
};

const NODE_MARGIN: f64 = 16.0;
const DUMMY_MARGIN: f64 = 8.0;
const BAND_MARGIN: f64 = 16.0;
const GROUP_PADDING: f64 = 20.0;
const GROUP_LABEL_BAND: f64 = 24.0;
const GROUP_LABEL_INSET: f64 = 12.0;
const EDGE_CLEAR: f64 = 20.0;
const LOOP: f64 = 16.0;
const PORT_GAP: f64 = 12.0;
const PORT_INSET: f64 = 10.0;
const SNAP: f64 = 6.0;

#[derive(Clone)]
struct Unit {
    layer: usize,
    node: Option<usize>,
    band: Option<usize>,
    w: f64,
    h: f64,
    margin: f64,
    line: Option<usize>,
    up: Vec<usize>,
    down: Vec<usize>,
}

#[derive(Clone, Copy)]
struct Hop {
    edge: usize,
    from: usize,
    to: usize,
}

#[derive(Clone)]
struct Band {
    first: usize,
    last: usize,
    members: Vec<Vec<usize>>,
    top: f64,
    height: f64,
    before: f64,
    after: f64,
    rank: usize,
    label_width: f64,
}

struct Layering {
    units: Vec<Unit>,
    hops: Vec<Hop>,
    bands: Vec<Band>,
    lines: Vec<Vec<usize>>,
    items: Vec<Vec<i32>>,
}

#[derive(Clone)]
struct Chain {
    edge: usize,
    hops: Vec<usize>,
    reversed: bool,
}

#[derive(Clone, Copy)]
struct Loop {
    edge: usize,
    unit: usize,
}

#[derive(Clone)]
pub(super) struct NodeBox {
    pub id: String,
    pub shape: String,
    pub tone: String,
    pub rect: Rect,
    pinned: bool,
    pub label: Vec<String>,
    pub sub: Vec<String>,
}

#[derive(Clone)]
pub(super) struct GroupBox {
    pub index: usize,
    pub rect: Rect,
    pub label: Rect,
}

#[derive(Clone)]
pub(super) struct EdgeBox {
    pub index: usize,
    pub points: Vec<Point>,
    pub label: Option<LabelBox>,
}

#[derive(Clone)]
pub(super) struct LabelBox {
    pub rect: Rect,
    pub lines: Vec<String>,
}

pub(super) struct DiagramLayout {
    pub nodes: Vec<NodeBox>,
    pub groups: Vec<GroupBox>,
    pub edges: Vec<EdgeBox>,
    pub bounds: Rect,
}

fn band_code(band: usize) -> i32 {
    -(band as i32 + 1)
}

fn band_of(code: i32) -> usize {
    (-code - 1) as usize
}

fn js_round(value: f64) -> f64 {
    (value + 0.5).floor()
}

fn flip(rect: Rect) -> Rect {
    Rect {
        x: rect.y,
        y: rect.x,
        w: rect.h,
        h: rect.w,
    }
}

fn flip_point(point: Point) -> Point {
    Point {
        x: point.y,
        y: point.x,
    }
}

fn center(rect: Rect) -> Point {
    Point {
        x: js_round(rect.x + rect.w / 2.0),
        y: js_round(rect.y + rect.h / 2.0),
    }
}

fn overlaps(left: Rect, right: Rect) -> bool {
    left.x < right.x + right.w
        && right.x < left.x + left.w
        && left.y < right.y + right.h
        && right.y < left.y + left.h
}

fn union(rects: impl IntoIterator<Item = Rect>) -> Rect {
    let rects = rects.into_iter().collect::<Vec<_>>();
    if rects.is_empty() {
        return Rect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        };
    }
    let left = rects
        .iter()
        .map(|rect| rect.x)
        .fold(f64::INFINITY, f64::min);
    let top = rects
        .iter()
        .map(|rect| rect.y)
        .fold(f64::INFINITY, f64::min);
    let right = rects
        .iter()
        .map(|rect| rect.x + rect.w)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = rects
        .iter()
        .map(|rect| rect.y + rect.h)
        .fold(f64::NEG_INFINITY, f64::max);
    Rect {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
    }
}

fn simplify(points: Vec<Point>) -> Vec<Point> {
    let mut unique = Vec::new();
    for point in points {
        if unique
            .last()
            .is_none_or(|last: &Point| last.x != point.x || last.y != point.y)
        {
            unique.push(point);
        }
    }
    unique
        .iter()
        .enumerate()
        .filter_map(|(index, point)| {
            let before = index.checked_sub(1).and_then(|at| unique.get(at));
            let after = unique.get(index + 1);
            if before.is_some_and(|before| {
                after.is_some_and(|after| {
                    (before.x == point.x && point.x == after.x)
                        || (before.y == point.y && point.y == after.y)
                })
            }) {
                None
            } else {
                Some(*point)
            }
        })
        .collect()
}

fn layers_of(nodes: &[Value], edges: &[Value]) -> Vec<usize> {
    let ids = nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node["id"].as_str().unwrap(), index))
        .collect::<HashMap<_, _>>();
    let mut outgoing = vec![Vec::new(); nodes.len()];
    let mut incoming = vec![0_usize; nodes.len()];
    for edge in edges {
        let Some(&from) = edge["from"].as_str().and_then(|id| ids.get(id)) else {
            continue;
        };
        let Some(&to) = edge["to"].as_str().and_then(|id| ids.get(id)) else {
            continue;
        };
        if from != to {
            outgoing[from].push(to);
            incoming[to] += 1;
        }
    }
    let mut state = vec![0_u8; nodes.len()];
    let mut forward = vec![Vec::new(); nodes.len()];
    let roots = (0..nodes.len())
        .filter(|index| incoming[*index] == 0)
        .chain(0..nodes.len())
        .collect::<Vec<_>>();
    for root in roots {
        if state[root] != 0 {
            continue;
        }
        state[root] = 1;
        let mut stack = vec![(root, 0_usize)];
        while let Some((node, next)) = stack.last_mut() {
            if *next == outgoing[*node].len() {
                state[*node] = 2;
                stack.pop();
                continue;
            }
            let target = outgoing[*node][*next];
            *next += 1;
            if state[target] == 1 {
                continue;
            }
            forward[*node].push(target);
            if state[target] == 0 {
                state[target] = 1;
                stack.push((target, 0));
            }
        }
    }
    let mut remaining = vec![0_usize; nodes.len()];
    for targets in &forward {
        for &target in targets {
            remaining[target] += 1;
        }
    }
    let mut layers = vec![0_usize; nodes.len()];
    let mut ready = (0..nodes.len())
        .filter(|index| remaining[*index] == 0)
        .collect::<Vec<_>>();
    let mut at = 0;
    while at < ready.len() {
        let node = ready[at];
        at += 1;
        for &target in &forward[node] {
            layers[target] = layers[target].max(layers[node] + 1);
            remaining[target] -= 1;
            if remaining[target] == 0 {
                ready.push(target);
            }
        }
    }
    layers
}

fn order_layers(layering: &mut Layering) {
    let mut position = vec![0_usize; layering.units.len()];
    let mut band_position = layering
        .bands
        .iter()
        .map(|band| vec![0_usize; band.last - band.first + 1])
        .collect::<Vec<_>>();
    let mut hops_by_layer = vec![Vec::new(); layering.items.len()];
    for (index, hop) in layering.hops.iter().enumerate() {
        hops_by_layer[layering.units[hop.from].layer].push(index);
    }

    fn flatten(
        layer: usize,
        items: &[Vec<i32>],
        bands: &[Band],
        position: &mut [usize],
        band_position: &mut [Vec<usize>],
    ) {
        let mut at = 0;
        for &code in &items[layer] {
            if code >= 0 {
                position[code as usize] = at;
                at += 1;
            } else {
                let index = band_of(code);
                let band = &bands[index];
                let members = &band.members[layer - band.first];
                band_position[index][layer - band.first] = at;
                if members.is_empty() {
                    at += 1;
                }
                for &member in members {
                    position[member] = at;
                    at += 1;
                }
            }
        }
    }

    fn enforce_band_order(layer: usize, items: &mut [Vec<i32>], bands: &[Band]) {
        let slots = items[layer]
            .iter()
            .enumerate()
            .filter_map(|(index, code)| (*code < 0).then_some(index))
            .collect::<Vec<_>>();
        let mut present = slots
            .iter()
            .map(|index| band_of(items[layer][*index]))
            .collect::<Vec<_>>();
        present.sort_by_key(|index| bands[*index].rank);
        for (slot, band) in slots.into_iter().zip(present) {
            items[layer][slot] = band_code(band);
        }
    }

    for layer in 0..layering.items.len() {
        flatten(
            layer,
            &layering.items,
            &layering.bands,
            &mut position,
            &mut band_position,
        );
    }
    let mut first_seen = layering
        .bands
        .iter()
        .enumerate()
        .map(|(index, band)| (band.first, position[band.members[0][0]], index))
        .collect::<Vec<_>>();
    first_seen.sort();
    for (rank, (_, _, band)) in first_seen.into_iter().enumerate() {
        layering.bands[band].rank = rank;
    }

    let settle =
        |layering: &mut Layering, position: &mut [usize], band_position: &mut [Vec<usize>]| {
            for layer in 0..layering.items.len() {
                enforce_band_order(layer, &mut layering.items, &layering.bands);
            }
            keep_sides(layering);
            for layer in 0..layering.items.len() {
                flatten(
                    layer,
                    &layering.items,
                    &layering.bands,
                    position,
                    band_position,
                );
            }
            crossings(layering, position, &hops_by_layer)
        };

    let mut best_count = settle(layering, &mut position, &mut band_position);
    let mut best_items = layering.items.clone();
    let mut best_members = layering
        .bands
        .iter()
        .map(|band| band.members.clone())
        .collect::<Vec<_>>();
    let mut best_ranks = layering
        .bands
        .iter()
        .map(|band| band.rank)
        .collect::<Vec<_>>();
    for sweep in 0..12 {
        if best_count == 0 {
            break;
        }
        if sweep % 2 == 0 {
            for layer in 1..layering.items.len() {
                sort_layer(layering, layer, true, &mut position, &mut band_position);
            }
        } else {
            for layer in (0..layering.items.len().saturating_sub(1)).rev() {
                sort_layer(layering, layer, false, &mut position, &mut band_position);
            }
        }
        update_ranks(layering);
        let count = settle(layering, &mut position, &mut band_position);
        if count < best_count {
            best_count = count;
            best_items = layering.items.clone();
            best_members = layering
                .bands
                .iter()
                .map(|band| band.members.clone())
                .collect();
            best_ranks = layering.bands.iter().map(|band| band.rank).collect();
        }
    }
    layering.items = best_items;
    for (index, band) in layering.bands.iter_mut().enumerate() {
        band.members = best_members[index].clone();
        band.rank = best_ranks[index];
    }
}

fn sort_layer(
    layering: &mut Layering,
    layer: usize,
    towards_up: bool,
    position: &mut [usize],
    band_position: &mut [Vec<usize>],
) {
    let key = |unit: usize| {
        let neighbors = if towards_up {
            &layering.units[unit].up
        } else {
            &layering.units[unit].down
        };
        if neighbors.is_empty() {
            position[unit] as f64
        } else {
            neighbors
                .iter()
                .map(|neighbor| position[*neighbor] as f64)
                .sum::<f64>()
                / neighbors.len() as f64
        }
    };
    let source = layering.items[layer].clone();
    let mut keyed = Vec::new();
    for (index, code) in source.into_iter().enumerate() {
        if code >= 0 {
            keyed.push((code, index, key(code as usize)));
            continue;
        }
        let band_index = band_of(code);
        let slot = layer - layering.bands[band_index].first;
        let mut members = layering.bands[band_index].members[slot]
            .iter()
            .map(|unit| (*unit, key(*unit), position[*unit]))
            .collect::<Vec<_>>();
        members.sort_by(|left, right| {
            left.1
                .total_cmp(&right.1)
                .then_with(|| left.2.cmp(&right.2))
        });
        layering.bands[band_index].members[slot] = members.iter().map(|entry| entry.0).collect();
        let value = if members.is_empty() {
            band_position[band_index][slot] as f64
        } else {
            members.iter().map(|entry| entry.1).sum::<f64>() / members.len() as f64
        };
        keyed.push((code, index, value));
    }
    keyed.sort_by(|left, right| {
        left.2
            .total_cmp(&right.2)
            .then_with(|| left.1.cmp(&right.1))
    });
    layering.items[layer] = keyed.into_iter().map(|entry| entry.0).collect();
    {
        let slots = layering.items[layer]
            .iter()
            .enumerate()
            .filter_map(|(index, code)| (*code < 0).then_some(index))
            .collect::<Vec<_>>();
        let mut present = slots
            .iter()
            .map(|index| band_of(layering.items[layer][*index]))
            .collect::<Vec<_>>();
        present.sort_by_key(|index| layering.bands[*index].rank);
        for (slot, band) in slots.into_iter().zip(present) {
            layering.items[layer][slot] = band_code(band);
        }
    }
    let mut at = 0;
    for &code in &layering.items[layer] {
        if code >= 0 {
            position[code as usize] = at;
            at += 1;
        } else {
            let index = band_of(code);
            let band = &layering.bands[index];
            let members = &band.members[layer - band.first];
            band_position[index][layer - band.first] = at;
            if members.is_empty() {
                at += 1;
            }
            for &member in members {
                position[member] = at;
                at += 1;
            }
        }
    }
}

fn update_ranks(layering: &mut Layering) {
    let scores = layering
        .bands
        .iter()
        .enumerate()
        .map(|(index, band)| {
            let sum = (band.first..=band.last)
                .map(|layer| {
                    layering.items[layer]
                        .iter()
                        .position(|code| *code == band_code(index))
                        .unwrap() as f64
                        / layering.items[layer].len() as f64
                })
                .sum::<f64>();
            sum / (band.last - band.first + 1) as f64
        })
        .collect::<Vec<_>>();
    let mut order = (0..layering.bands.len()).collect::<Vec<_>>();
    order.sort_by(|left, right| {
        scores[*left]
            .total_cmp(&scores[*right])
            .then_with(|| layering.bands[*left].rank.cmp(&layering.bands[*right].rank))
    });
    for (rank, band) in order.into_iter().enumerate() {
        layering.bands[band].rank = rank;
    }
}

fn keep_sides(layering: &mut Layering) {
    for layer in 0..layering.items.len() {
        if !layering.items[layer].iter().any(|code| *code < 0) {
            continue;
        }
        let previous = layering
            .items
            .get(layer.wrapping_sub(1))
            .into_iter()
            .flatten()
            .enumerate()
            .map(|(index, code)| (*code, index))
            .collect::<HashMap<_, _>>();
        let free = layering.items[layer]
            .iter()
            .filter(|code| **code >= 0)
            .copied()
            .collect::<Vec<_>>();
        for code in free {
            let unit = code as usize;
            let present = layering.items[layer]
                .iter()
                .filter(|code| **code < 0)
                .map(|code| band_of(*code))
                .collect::<Vec<_>>();
            let mut lower = 0;
            let mut upper = present.len();
            let mut narrow = |source: usize, source_layer: usize| {
                let mut low = 0;
                let mut high = present.len();
                for (slot, &target_band) in present.iter().enumerate() {
                    let target = &layering.bands[target_band];
                    let source_band = layering.units[source].band;
                    if source_layer < target.first
                        || source_layer > target.last
                        || source_band == Some(target_band)
                    {
                        continue;
                    }
                    let before = source_band
                        .is_some_and(|band| layering.bands[band].rank < target.rank)
                        || source_band.is_none()
                            && previous[&(source as i32)] < previous[&band_code(target_band)];
                    if before {
                        high = high.min(slot);
                    } else {
                        low = low.max(slot + 1);
                    }
                }
                if lower.max(low) <= upper.min(high) {
                    lower = lower.max(low);
                    upper = upper.min(high);
                }
            };
            for source in layering.units[unit].up.clone() {
                narrow(source, layer - 1);
            }
            for target in layering.units[unit].down.clone() {
                if layering.units[target].band.is_some() {
                    narrow(target, layer + 1);
                }
            }
            let row = &mut layering.items[layer];
            let at = row.iter().position(|entry| *entry == code).unwrap();
            let slot = row[..at].iter().filter(|entry| **entry < 0).count();
            if slot < lower {
                row.remove(at);
                let after = row
                    .iter()
                    .position(|entry| *entry == band_code(present[lower - 1]))
                    .unwrap()
                    + 1;
                row.insert(after, code);
            } else if slot > upper {
                row.remove(at);
                let before = row
                    .iter()
                    .position(|entry| *entry == band_code(present[upper]))
                    .unwrap();
                row.insert(before, code);
            }
        }
    }
}

fn crossings(layering: &Layering, position: &[usize], hops_by_layer: &[Vec<usize>]) -> usize {
    let mut total = 0;
    for layer in 0..layering.items.len().saturating_sub(1) {
        let mut pairs = hops_by_layer[layer]
            .iter()
            .map(|index| {
                let hop = layering.hops[*index];
                (position[hop.from], position[hop.to])
            })
            .collect::<Vec<_>>();
        if pairs.len() < 2 {
            continue;
        }
        pairs.sort();
        let size = pairs.iter().map(|pair| pair.1).max().unwrap_or(0) + 2;
        let mut tree = vec![0_usize; size + 1];
        for (seen, (_, to)) in pairs.into_iter().enumerate() {
            let mut at_most = 0;
            let mut index = to + 1;
            while index > 0 {
                at_most += tree[index];
                index -= index.isolate_lowest_one();
            }
            total += seen - at_most;
            let mut index = to + 1;
            while index <= size {
                tree[index] += 1;
                index += index.isolate_lowest_one();
            }
        }
    }
    total
}

fn place_across(layering: &mut Layering) -> Vec<f64> {
    let unit_count = layering.units.len();
    let variable_count = unit_count + layering.bands.len();
    let mut top = vec![0.0; variable_count];
    let mut local = vec![0.0; unit_count];
    let variable_of = |code: i32| {
        if code >= 0 {
            code as usize
        } else {
            unit_count + band_of(code)
        }
    };
    let code_of = |variable: usize| {
        if variable < unit_count {
            variable as i32
        } else {
            band_code(variable - unit_count)
        }
    };
    let size_of = |code: i32| {
        if code >= 0 {
            layering.units[code as usize].h
        } else {
            layering.bands[band_of(code)].height
        }
    };
    let margin_of = |code: i32| {
        if code >= 0 {
            layering.units[code as usize].margin
        } else {
            BAND_MARGIN
        }
    };

    let mut successors = vec![Vec::<i32>::new(); variable_count];
    let mut incoming = vec![0_usize; variable_count];
    let mut present = vec![false; variable_count];
    for row in &layering.items {
        for (index, &code) in row.iter().enumerate() {
            present[variable_of(code)] = true;
            if index > 0 {
                successors[variable_of(row[index - 1])].push(code);
                incoming[variable_of(code)] += 1;
            }
        }
    }
    let mut lowest = vec![0.0_f64; variable_count];
    let mut queue = (0..variable_count)
        .filter(|variable| present[*variable] && incoming[*variable] == 0)
        .collect::<Vec<_>>();
    let mut cursor = 0;
    while cursor < queue.len() {
        let variable = queue[cursor];
        cursor += 1;
        let code = code_of(variable);
        for &next in &successors[variable] {
            let target = variable_of(next);
            lowest[target] = lowest[target]
                .max(lowest[variable] + size_of(code) + margin_of(code) + margin_of(next));
            incoming[target] -= 1;
            if incoming[target] == 0 {
                queue.push(target);
            }
        }
    }
    let mut tail = vec![0.0_f64; variable_count];
    let mut total = 0.0_f64;
    for &variable in queue.iter().rev() {
        let code = code_of(variable);
        let mut length = size_of(code);
        for &next in &successors[variable] {
            length = length
                .max(size_of(code) + margin_of(code) + margin_of(next) + tail[variable_of(next)]);
        }
        tail[variable] = length;
        total = total.max(lowest[variable] + length);
    }
    for &variable in &queue {
        top[variable] = ((lowest[variable] + total - tail[variable]) / 2.0).floor();
    }

    for band in &layering.bands {
        for slot in &band.members {
            let mut low = Vec::new();
            let mut at = band.before;
            for (index, &unit) in slot.iter().enumerate() {
                if index > 0 {
                    let previous = &layering.units[slot[index - 1]];
                    at += previous.h + previous.margin + layering.units[unit].margin;
                }
                low.push(at);
            }
            let mut high = band.height - band.after;
            for index in (0..slot.len()).rev() {
                let unit = &layering.units[slot[index]];
                if index + 1 < slot.len() {
                    high -= unit.margin + layering.units[slot[index + 1]].margin;
                }
                high -= unit.h;
                local[slot[index]] = ((low[index] + high) / 2.0).floor();
            }
        }
    }

    for round in 0..8 {
        for step in 0..layering.items.len() {
            let layer = if round % 2 == 0 {
                step
            } else {
                layering.items.len() - 1 - step
            };
            let row = layering.items[layer].clone();
            for (index, code) in row.iter().copied().enumerate() {
                if code >= 0 {
                    let unit = code as usize;
                    let Some(want) = desired_top(unit, layering, &top, &local) else {
                        continue;
                    };
                    let low = row
                        .get(index.wrapping_sub(1))
                        .map_or(f64::NEG_INFINITY, |entry| {
                            top_of(*entry, unit_count, &top)
                                + size_of(*entry)
                                + margin_of(*entry)
                                + margin_of(code)
                        });
                    let high = row.get(index + 1).map_or(f64::INFINITY, |entry| {
                        top_of(*entry, unit_count, &top)
                            - margin_of(*entry)
                            - margin_of(code)
                            - size_of(code)
                    });
                    top[unit] = want.clamp(low, high);
                    continue;
                }
                let band_index = band_of(code);
                let band = &layering.bands[band_index];
                let slot = band.members[layer - band.first].clone();
                for (position, unit) in slot.iter().copied().enumerate() {
                    let Some(want) = desired_top(unit, layering, &top, &local) else {
                        continue;
                    };
                    let self_unit = &layering.units[unit];
                    let low = slot
                        .get(position.wrapping_sub(1))
                        .map_or(band.before, |previous| {
                            local[*previous]
                                + layering.units[*previous].h
                                + layering.units[*previous].margin
                                + self_unit.margin
                        });
                    let high = slot.get(position + 1).map_or(
                        band.height - band.after - self_unit.h,
                        |next| {
                            local[*next]
                                - layering.units[*next].margin
                                - self_unit.margin
                                - self_unit.h
                        },
                    );
                    local[unit] = (want - top[unit_count + band_index]).clamp(low, high);
                }
            }
        }

        for band_index in 0..layering.bands.len() {
            let band = &layering.bands[band_index];
            let shifts = band
                .members
                .iter()
                .flatten()
                .filter_map(|unit| {
                    desired_top(*unit, layering, &top, &local)
                        .map(|want| want - absolute_top(*unit, layering, &top, &local))
                })
                .collect::<Vec<_>>();
            if shifts.is_empty() {
                continue;
            }
            let code = band_code(band_index);
            let mut low = f64::NEG_INFINITY;
            let mut high = f64::INFINITY;
            for layer in band.first..=band.last {
                let row = &layering.items[layer];
                let index = row.iter().position(|entry| *entry == code).unwrap();
                if let Some(previous) = index.checked_sub(1).and_then(|at| row.get(at)) {
                    low = low.max(
                        top_of(*previous, unit_count, &top)
                            + size_of(*previous)
                            + margin_of(*previous)
                            + BAND_MARGIN,
                    );
                }
                if let Some(next) = row.get(index + 1) {
                    high = high.min(
                        top_of(*next, unit_count, &top)
                            - margin_of(*next)
                            - BAND_MARGIN
                            - band.height,
                    );
                }
            }
            let shift = js_round(shifts.iter().sum::<f64>() / shifts.len() as f64);
            top[unit_count + band_index] = (top[unit_count + band_index] + shift).clamp(low, high);
        }
    }

    let least = layering
        .items
        .iter()
        .flatten()
        .map(|code| top_of(*code, unit_count, &top))
        .fold(f64::INFINITY, f64::min);
    if least.is_finite() {
        for value in &mut top {
            *value -= least;
            if *value == 0.0 {
                *value = 0.0;
            }
        }
    }
    for (index, band) in layering.bands.iter_mut().enumerate() {
        band.top = top[unit_count + index];
    }
    (0..unit_count)
        .map(|unit| absolute_top(unit, layering, &top, &local))
        .collect()
}

fn top_of(code: i32, unit_count: usize, top: &[f64]) -> f64 {
    if code >= 0 {
        top[code as usize]
    } else {
        top[unit_count + band_of(code)]
    }
}

fn absolute_top(unit: usize, layering: &Layering, top: &[f64], local: &[f64]) -> f64 {
    layering.units[unit].band.map_or(top[unit], |band| {
        top[layering.units.len() + band] + local[unit]
    })
}

fn desired_top(unit: usize, layering: &Layering, top: &[f64], local: &[f64]) -> Option<f64> {
    let self_unit = &layering.units[unit];
    if let Some(line_index) = self_unit.line {
        let line = &layering.lines[line_index];
        let ends = [
            layering.units[line[0]].up[0],
            layering.units[*line.last().unwrap()].down[0],
        ]
        .map(|end| absolute_top(end, layering, top, local) + layering.units[end].h / 2.0);
        if line.len() == 1 {
            let here = absolute_top(unit, layering, top, local);
            return Some(js_round(
                if (ends[1] - here).abs() < (ends[0] - here).abs() {
                    ends[1]
                } else {
                    ends[0]
                },
            ));
        }
        let mut values = line
            .iter()
            .filter(|other| **other != unit)
            .map(|other| absolute_top(*other, layering, top, local))
            .chain(ends)
            .collect::<Vec<_>>();
        return Some(js_round(median(&mut values)));
    }
    let mut neighbors = self_unit
        .up
        .iter()
        .chain(&self_unit.down)
        .map(|neighbor| {
            absolute_top(*neighbor, layering, top, local) + layering.units[*neighbor].h / 2.0
        })
        .collect::<Vec<_>>();
    if neighbors.is_empty() {
        None
    } else {
        Some(js_round(median(&mut neighbors)) - self_unit.h / 2.0)
    }
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len() % 2 == 1 {
        values[middle]
    } else {
        (values[middle - 1] + values[middle]) / 2.0
    }
}

#[derive(Clone, Copy)]
struct ChannelHop {
    hop: usize,
    ya: f64,
    yb: f64,
}

#[derive(Clone)]
struct ChannelLabel {
    edge: usize,
    hop: Option<usize>,
    y: f64,
    along: f64,
    across: f64,
}

struct ChannelResult {
    width: f64,
    tracks: HashMap<usize, f64>,
    labels: HashMap<usize, Rect>,
}

fn route_channel(
    start: f64,
    clear_before: f64,
    clear_after: f64,
    hops: &[ChannelHop],
    labels: &[ChannelLabel],
    obstacles: &[Rect],
) -> ChannelResult {
    const TRACK_GAP: f64 = 12.0;
    const LANE_GAP: f64 = 12.0;
    const LABEL_GAP: f64 = 8.0;
    const LABEL_OFFSET: f64 = 4.0;
    const RANGE_CLEARANCE: f64 = 8.0;
    let vertical = hops
        .iter()
        .filter(|hop| hop.ya != hop.yb)
        .copied()
        .collect::<Vec<_>>();
    let count = vertical.len();
    let near = |left: ChannelHop, right: ChannelHop| {
        left.ya.max(left.yb).min(right.ya.max(right.yb)) + RANGE_CLEARANCE
            > left.ya.min(left.yb).max(right.ya.min(right.yb))
    };
    let mut cost = vec![0_usize; count * count];
    for left in 0..count {
        for right in 0..count {
            if left != right && near(vertical[left], vertical[right]) {
                cost[left * count + right] =
                    conflicts(&sketch(vertical[left], 1.0), &sketch(vertical[right], 2.0));
            }
        }
    }
    let score = (0..count)
        .map(|left| {
            (0..count)
                .map(|right| {
                    cost[left * count + right] as isize - cost[right * count + left] as isize
                })
                .sum::<isize>()
        })
        .collect::<Vec<_>>();
    let mut order = (0..count).collect::<Vec<_>>();
    order.sort_by_key(|index| (score[*index], *index));
    for _ in 0..count {
        let mut swapped = false;
        for at in 0..count.saturating_sub(1) {
            let left = order[at];
            let right = order[at + 1];
            if cost[right * count + left] < cost[left * count + right] {
                order.swap(at, at + 1);
                swapped = true;
            }
        }
        if !swapped {
            break;
        }
    }
    let mut track = vec![0_usize; count];
    let mut tracks = 0;
    for (position, &index) in order.iter().enumerate() {
        let mut at = 0;
        for &other in &order[..position] {
            if near(vertical[other], vertical[index]) {
                at = at.max(track[other] + 1);
            }
        }
        track[index] = at;
        tracks = tracks.max(at + 1);
    }

    let slot_along = labels.iter().map(|label| label.along).fold(0.0, f64::max);
    let slot_step = slot_along + LABEL_GAP;
    let tracks_span = tracks.saturating_sub(1) as f64 * TRACK_GAP;
    let after_start = if tracks > 0 {
        tracks_span + LANE_GAP
    } else {
        0.0
    };
    let track_of = vertical
        .iter()
        .enumerate()
        .map(|(index, hop)| (hop.hop, track[index] as f64 * TRACK_GAP))
        .collect::<HashMap<_, _>>();
    let mut placed = Vec::<(bool, Rect)>::new();
    let mut chosen = HashMap::<usize, (bool, Rect)>::new();
    let mut slots_before = usize::from(!labels.is_empty());
    let mut slots_after = 0_usize;
    for label in labels {
        let hop = label
            .hop
            .and_then(|index| hops.iter().find(|candidate| candidate.hop == index));
        let lane = |_before: bool, slot: usize, y: f64, above: bool| Rect {
            x: slot as f64 * slot_step + ((slot_along - label.along) / 2.0).floor(),
            y: if above {
                y - LABEL_OFFSET - label.across
            } else {
                y + LABEL_OFFSET
            },
            w: label.along,
            h: label.across,
        };
        let candidates = |before_slots: usize, after_slots: usize| {
            let mut values = Vec::new();
            for slot in 0..before_slots {
                values.push((true, lane(true, slot, label.y, true)));
                values.push((true, lane(true, slot, label.y, false)));
            }
            if let Some(hop) = hop {
                if let Some(at) = label.hop.and_then(|index| track_of.get(&index)).copied() {
                    values.push((
                        false,
                        Rect {
                            x: at + LABEL_OFFSET,
                            y: js_round((hop.ya + hop.yb) / 2.0 - label.across / 2.0),
                            w: label.along,
                            h: label.across,
                        },
                    ));
                }
                for slot in 0..after_slots {
                    let mut rect = lane(false, slot, hop.yb, true);
                    rect.x += after_start;
                    values.push((false, rect));
                    let mut rect = lane(false, slot, hop.yb, false);
                    rect.x += after_start;
                    values.push((false, rect));
                }
            }
            values
        };
        let blocked = |zone_before: bool, rect: Rect, placed: &[(bool, Rect)]| {
            placed.iter().any(|(other_zone, other)| {
                *other_zone == zone_before
                    && overlaps(
                        Rect {
                            x: other.x - 4.0,
                            y: other.y - 4.0,
                            w: other.w + 8.0,
                            h: other.h + 8.0,
                        },
                        rect,
                    )
            }) || obstacles
                .iter()
                .any(|obstacle| obstacle.y < rect.y + rect.h && rect.y < obstacle.y + obstacle.h)
        };
        let on_line = |zone_before: bool, rect: Rect| {
            hops.iter().any(|candidate| {
                if zone_before {
                    return label.hop != Some(candidate.hop)
                        && candidate.ya > rect.y - 3.0
                        && candidate.ya < rect.y + rect.h + 3.0;
                }
                let own = label.hop == Some(candidate.hop);
                let touch = |x0: f64, x1: f64, y0: f64, y1: f64| {
                    x1 >= rect.x - 3.0
                        && x0 <= rect.x + rect.w + 3.0
                        && y1 >= rect.y - 3.0
                        && y0 <= rect.y + rect.h + 3.0
                };
                match track_of.get(&candidate.hop).copied() {
                    None => {
                        !own && touch(f64::NEG_INFINITY, f64::INFINITY, candidate.ya, candidate.ya)
                    }
                    Some(at) => {
                        (!own && touch(f64::NEG_INFINITY, at, candidate.ya, candidate.ya))
                            || (!own
                                && touch(
                                    at,
                                    at,
                                    candidate.ya.min(candidate.yb),
                                    candidate.ya.max(candidate.yb),
                                ))
                            || touch(at, f64::INFINITY, candidate.yb, candidate.yb)
                    }
                }
            })
        };
        let mut existing = candidates(slots_before, slots_after);
        let mut choice = existing
            .iter()
            .copied()
            .find(|(zone, rect)| !blocked(*zone, *rect, &placed) && !on_line(*zone, *rect));
        if choice.is_none() {
            choice = [true, false]
                .into_iter()
                .map(|above| (true, lane(true, slots_before, label.y, above)))
                .find(|(zone, rect)| !blocked(*zone, *rect, &placed) && !on_line(*zone, *rect));
            if choice.is_some() {
                slots_before += 1;
            }
        }
        if choice.is_none() {
            if let Some(hop) = hop {
                choice = [true, false]
                    .into_iter()
                    .map(|above| {
                        let mut rect = lane(false, slots_after, hop.yb, above);
                        rect.x += after_start;
                        (false, rect)
                    })
                    .find(|(zone, rect)| !blocked(*zone, *rect, &placed) && !on_line(*zone, *rect));
                if choice.is_some() {
                    slots_after += 1;
                }
            }
        }
        if choice.is_none() {
            choice = existing
                .drain(..)
                .find(|(zone, rect)| !blocked(*zone, *rect, &placed));
        }
        let choice = choice.unwrap_or_else(|| {
            let result = (true, lane(true, slots_before, label.y, true));
            slots_before += 1;
            result
        });
        placed.push(choice);
        chosen.insert(label.edge, choice);
    }
    let lane_width = placed
        .iter()
        .filter(|entry| entry.0)
        .map(|entry| entry.1.x + entry.1.w)
        .fold(0.0, f64::max);
    let middle = placed.iter().filter(|entry| !entry.0).collect::<Vec<_>>();
    let has_middle = tracks > 0 || !middle.is_empty();
    let middle_width = middle
        .iter()
        .map(|entry| entry.1.x + entry.1.w)
        .chain([
            tracks_span,
            if slots_after > 0 {
                after_start + slots_after as f64 * slot_step - LABEL_GAP
            } else {
                0.0
            },
        ])
        .fold(0.0, f64::max);
    let lane_gap = if lane_width > 0.0 && has_middle {
        LANE_GAP
    } else {
        0.0
    };
    let needed = clear_before
        + lane_width
        + lane_gap
        + if has_middle { middle_width } else { 0.0 }
        + clear_after;
    let width = 64.0_f64.max(needed);
    let lane_start = start + clear_before;
    let middle_start = lane_start + lane_width + lane_gap + ((width - needed) / 2.0).floor();
    ChannelResult {
        width,
        tracks: track_of
            .into_iter()
            .map(|(hop, x)| (hop, middle_start + x))
            .collect(),
        labels: chosen
            .into_iter()
            .map(|(edge, (before, mut rect))| {
                rect.x += if before { lane_start } else { middle_start };
                (edge, rect)
            })
            .collect(),
    }
}

fn sketch(hop: ChannelHop, track: f64) -> Vec<Point> {
    vec![
        Point { x: 0.0, y: hop.ya },
        Point {
            x: track * 12.0,
            y: hop.ya,
        },
        Point {
            x: track * 12.0,
            y: hop.yb,
        },
        Point { x: 36.0, y: hop.yb },
    ]
}

fn conflicts(left: &[Point], right: &[Point]) -> usize {
    let mut total = 0;
    for a in left.windows(2) {
        for b in right.windows(2) {
            let a_flat = a[0].y == a[1].y;
            let b_flat = b[0].y == b[1].y;
            if a_flat != b_flat {
                let (h0, h1, v0, v1) = if a_flat {
                    (a[0], a[1], b[0], b[1])
                } else {
                    (b[0], b[1], a[0], a[1])
                };
                if v0.x > h0.x.min(h1.x)
                    && v0.x < h0.x.max(h1.x)
                    && h0.y > v0.y.min(v1.y)
                    && h0.y < v0.y.max(v1.y)
                {
                    total += 1;
                }
            } else {
                let (a0, a1, b0, b1, gap) = if a_flat {
                    (
                        a[0].x.min(a[1].x),
                        a[0].x.max(a[1].x),
                        b[0].x.min(b[1].x),
                        b[0].x.max(b[1].x),
                        (a[0].y - b[0].y).abs(),
                    )
                } else {
                    (
                        a[0].y.min(a[1].y),
                        a[0].y.max(a[1].y),
                        b[0].y.min(b[1].y),
                        b[0].y.max(b[1].y),
                        (a[0].x - b[0].x).abs(),
                    )
                };
                if gap < 4.0 && a1.min(b1) > a0.max(b0) {
                    total += 4;
                }
            }
        }
    }
    total
}

fn inset(shape: &str, box_: Rect, offset: f64, down: bool) -> f64 {
    let away = offset.abs();
    let half = box_.h / 2.0;
    let rounded = |radius: f64| {
        let straight = half - radius;
        if away <= straight {
            return 0.0;
        }
        let into = radius.min(away - straight);
        js_round(radius - (radius * radius - into * into).sqrt())
    };
    match shape {
        "round" => rounded(10.0_f64.min(box_.w / 2.0).min(half)),
        "pill" => rounded(box_.w.min(box_.h) / 2.0),
        "diamond" => js_round(away.min(half) / half * (box_.w / 2.0)),
        "cylinder" if down => {
            let radius_x = js_round(box_.h / 2.0);
            let radius_y = js_round(js_round(box_.w * 0.18) / 2.0);
            let share = (away / radius_x).min(1.0);
            js_round(radius_y - radius_y * (1.0 - share * share).sqrt())
        }
        _ => 0.0,
    }
}

fn loose_route(source: Rect, target: Rect, loop_: bool, down: bool) -> Vec<Point> {
    let from = center(source);
    let to = center(target);
    if loop_ {
        let right = source.x + source.w;
        return vec![
            Point {
                x: right,
                y: from.y - 6.0,
            },
            Point {
                x: right + LOOP,
                y: from.y - 6.0,
            },
            Point {
                x: right + LOOP,
                y: from.y + 6.0,
            },
            Point {
                x: right,
                y: from.y + 6.0,
            },
        ];
    }
    let stacked = target.y >= source.y + source.h || target.y + target.h <= source.y;
    if !(down && stacked) && target.x >= source.x + source.w {
        let middle = js_round((source.x + source.w + target.x) / 2.0);
        return simplify(vec![
            Point {
                x: source.x + source.w,
                y: from.y,
            },
            Point {
                x: middle,
                y: from.y,
            },
            Point { x: middle, y: to.y },
            Point {
                x: target.x,
                y: to.y,
            },
        ]);
    }
    if !(down && stacked) && target.x + target.w <= source.x {
        let middle = js_round((target.x + target.w + source.x) / 2.0);
        return simplify(vec![
            Point {
                x: source.x,
                y: from.y,
            },
            Point {
                x: middle,
                y: from.y,
            },
            Point { x: middle, y: to.y },
            Point {
                x: target.x + target.w,
                y: to.y,
            },
        ]);
    }
    let middle = js_round((from.y + to.y) / 2.0);
    let start = if to.y < from.y {
        source.y
    } else {
        source.y + source.h
    };
    let end = if to.y < from.y {
        target.y + target.h
    } else {
        target.y
    };
    simplify(vec![
        Point {
            x: from.x,
            y: start,
        },
        Point {
            x: from.x,
            y: middle,
        },
        Point { x: to.x, y: middle },
        Point { x: to.x, y: end },
    ])
}

pub(super) fn layout(document: &Value) -> DiagramLayout {
    let nodes = document["nodes"].as_array().unwrap();
    let edges = document["edges"].as_array().unwrap();
    let groups = document["groups"].as_array().unwrap();
    let down = document.pointer("/meta/direction").and_then(Value::as_str) == Some("down");
    let layers = layers_of(nodes, edges);
    let sizes = nodes
        .iter()
        .map(|node| diagram_node_size(node.as_object().unwrap()))
        .collect::<Vec<_>>();
    let known = nodes
        .iter()
        .filter_map(|node| node["id"].as_str())
        .collect::<HashSet<_>>();

    let mut units = Vec::new();
    let mut unit_of = HashMap::<&str, usize>::new();
    let mut unit_of_node = HashMap::<usize, usize>::new();
    for (index, node) in nodes.iter().enumerate() {
        if node.get("pos").is_some() {
            continue;
        }
        let (w, h, _, _) = &sizes[index];
        unit_of.insert(node["id"].as_str().unwrap(), units.len());
        unit_of_node.insert(index, units.len());
        units.push(Unit {
            layer: layers[index],
            node: Some(index),
            band: None,
            w: if down { *h } else { *w },
            h: if down { *w } else { *h },
            margin: NODE_MARGIN,
            line: None,
            up: Vec::new(),
            down: Vec::new(),
        });
    }

    let mut bands = Vec::new();
    let mut band_of_group = HashMap::new();
    for (group_index, group) in groups.iter().enumerate() {
        let inside = group["wraps"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
            .filter_map(|id| unit_of.get(id).copied())
            .filter(|unit| units[*unit].band.is_none())
            .collect::<Vec<_>>();
        if inside.is_empty() {
            continue;
        }
        let first = inside.iter().map(|unit| units[*unit].layer).min().unwrap();
        let last = inside.iter().map(|unit| units[*unit].layer).max().unwrap();
        let band_index = bands.len();
        band_of_group.insert(group_index, band_index);
        for &unit in &inside {
            units[unit].band = Some(band_index);
        }
        bands.push(Band {
            first,
            last,
            members: vec![Vec::new(); last - first + 1],
            top: 0.0,
            height: 0.0,
            before: GROUP_PADDING + if down { 0.0 } else { GROUP_LABEL_BAND },
            after: GROUP_PADDING,
            rank: 0,
            label_width: estimate_diagram_text(group["label"].as_str().unwrap(), 12.0, true),
        });
    }

    let mut hops = Vec::new();
    let mut chains = Vec::new();
    let mut loops = Vec::new();
    let mut loose = Vec::new();
    let mut lines = Vec::new();
    for (edge_index, edge) in edges.iter().enumerate() {
        let from_id = edge["from"].as_str().unwrap();
        let to_id = edge["to"].as_str().unwrap();
        if !known.contains(from_id) || !known.contains(to_id) {
            continue;
        }
        let source = unit_of.get(from_id).copied();
        let target = unit_of.get(to_id).copied();
        let (Some(source), Some(target)) = (source, target) else {
            loose.push(edge_index);
            continue;
        };
        if source == target {
            loops.push(Loop {
                edge: edge_index,
                unit: source,
            });
            continue;
        }
        let reversed = units[source].layer > units[target].layer;
        let (low, high) = if reversed {
            (target, source)
        } else {
            (source, target)
        };
        if units[low].layer == units[high].layer {
            loose.push(edge_index);
            continue;
        }
        let band = if units[low].band.is_some() && units[low].band == units[high].band {
            units[low].band
        } else {
            None
        };
        let mut chain = Vec::new();
        let mut line = Vec::new();
        let mut previous = low;
        for layer in units[low].layer + 1..=units[high].layer {
            let next = if layer < units[high].layer {
                let next = units.len();
                line.push(next);
                units.push(Unit {
                    layer,
                    node: None,
                    band,
                    w: 0.0,
                    h: 0.0,
                    margin: DUMMY_MARGIN,
                    line: Some(lines.len()),
                    up: Vec::new(),
                    down: Vec::new(),
                });
                next
            } else {
                high
            };
            chain.push(hops.len());
            hops.push(Hop {
                edge: edge_index,
                from: previous,
                to: next,
            });
            units[previous].down.push(next);
            units[next].up.push(previous);
            previous = next;
        }
        if !line.is_empty() {
            lines.push(line);
        }
        chains.push(Chain {
            edge: edge_index,
            hops: chain,
            reversed,
        });
    }

    let layer_count = units.iter().map(|unit| unit.layer + 1).max().unwrap_or(0);
    let mut items = vec![Vec::new(); layer_count];
    for (index, unit) in units.iter().enumerate() {
        if let Some(band_index) = unit.band {
            let band = &mut bands[band_index];
            let slot = &mut band.members[unit.layer - band.first];
            if slot.is_empty() {
                items[unit.layer].push(band_code(band_index));
            }
            slot.push(index);
        } else {
            items[unit.layer].push(index as i32);
        }
    }
    for (index, band) in bands.iter_mut().enumerate() {
        for (offset, slot) in band.members.iter().enumerate() {
            if slot.is_empty() {
                items[band.first + offset].push(band_code(index));
            }
        }
        let tallest = band
            .members
            .iter()
            .map(|slot| {
                slot.iter()
                    .enumerate()
                    .map(|(position, unit)| {
                        units[*unit].h
                            + if position > 0 {
                                units[slot[position - 1]].margin + units[*unit].margin
                            } else {
                                0.0
                            }
                    })
                    .sum::<f64>()
            })
            .fold(0.0, f64::max);
        band.height = band.before + tallest + band.after;
        if down {
            band.height = band.height.max(band.label_width + GROUP_LABEL_INSET * 2.0);
        }
    }
    let mut layering = Layering {
        units,
        hops,
        bands,
        lines,
        items,
    };
    order_layers(&mut layering);
    let top = place_across(&mut layering);
    let center_of = |unit: usize| top[unit] + layering.units[unit].h / 2.0;

    #[derive(Clone, Copy)]
    struct Port {
        key: f64,
        edge: usize,
        order: usize,
        output: usize,
    }
    let mut hop_start = vec![0.0; layering.hops.len()];
    let mut hop_end = vec![0.0; layering.hops.len()];
    let mut loop_start = vec![0.0; loops.len()];
    let mut loop_end = vec![0.0; loops.len()];
    let mut exits = vec![Vec::<Port>::new(); layering.units.len()];
    let mut entries = vec![Vec::<Port>::new(); layering.units.len()];
    for (index, hop) in layering.hops.iter().enumerate() {
        exits[hop.from].push(Port {
            key: center_of(hop.to),
            edge: hop.edge,
            order: 0,
            output: index,
        });
        entries[hop.to].push(Port {
            key: center_of(hop.from),
            edge: hop.edge,
            order: 0,
            output: index,
        });
    }
    for (index, loop_) in loops.iter().enumerate() {
        let key = center_of(loop_.unit);
        exits[loop_.unit].push(Port {
            key,
            edge: loop_.edge,
            order: 0,
            output: layering.hops.len() + index * 2,
        });
        exits[loop_.unit].push(Port {
            key,
            edge: loop_.edge,
            order: 1,
            output: layering.hops.len() + index * 2 + 1,
        });
    }
    for unit in 0..layering.units.len() {
        for (is_entry, ports) in [(false, &mut exits[unit]), (true, &mut entries[unit])] {
            ports.sort_by(|left, right| {
                left.key
                    .total_cmp(&right.key)
                    .then_with(|| left.edge.cmp(&right.edge))
                    .then_with(|| left.order.cmp(&right.order))
            });
            if ports.is_empty() {
                continue;
            }
            let middle = center_of(unit);
            let room = (layering.units[unit].h - PORT_INSET * 2.0).max(0.0);
            let step = if ports.len() > 1 {
                PORT_GAP.min((room / (ports.len() - 1) as f64).floor())
            } else {
                0.0
            };
            for (position, port) in ports.iter().enumerate() {
                let value =
                    js_round(middle + (position as f64 - (ports.len() - 1) as f64 / 2.0) * step);
                if port.output < layering.hops.len() {
                    if is_entry {
                        hop_end[port.output] = value;
                    } else {
                        hop_start[port.output] = value;
                    }
                } else {
                    let output = port.output - layering.hops.len();
                    if output % 2 == 0 {
                        loop_start[output / 2] = value;
                    } else {
                        loop_end[output / 2] = value;
                    }
                }
            }
        }
    }
    for (index, hop) in layering.hops.iter().enumerate() {
        let gap = (hop_end[index] - hop_start[index]).abs();
        if gap == 0.0 || gap > SNAP {
            continue;
        }
        let room = |unit: usize, y: f64| {
            layering.units[unit].node.is_some()
                && y >= top[unit] + PORT_INSET
                && y <= top[unit] + layering.units[unit].h - PORT_INSET
        };
        if entries[hop.to].len() == 1 && room(hop.to, hop_start[index]) {
            hop_end[index] = hop_start[index];
        } else if exits[hop.from].len() == 1 && room(hop.from, hop_end[index]) {
            hop_start[index] = hop_end[index];
        }
    }

    let mut by_layer = vec![Vec::new(); layer_count];
    for (index, unit) in layering.units.iter().enumerate() {
        by_layer[unit.layer].push(index);
    }
    let column_width = by_layer
        .iter()
        .map(|column| {
            (column
                .iter()
                .map(|unit| layering.units[*unit].w)
                .fold(0.0, f64::max)
                / 2.0)
                .ceil()
                * 2.0
        })
        .collect::<Vec<_>>();
    let mut column_x = vec![0.0; layer_count];
    let mut unit_x = vec![0.0; layering.units.len()];
    let mut hops_by_layer = vec![Vec::new(); layer_count];
    for (index, hop) in layering.hops.iter().enumerate() {
        hops_by_layer[layering.units[hop.from].layer].push(index);
    }
    let label_sizes = edges
        .iter()
        .map(|edge| {
            edge.get("label")
                .and_then(Value::as_str)
                .map(diagram_edge_label_size)
        })
        .collect::<Vec<_>>();
    let mut label_hop = HashMap::new();
    for chain in &chains {
        if label_sizes[chain.edge].is_some() {
            label_hop.insert(chain.hops[(chain.hops.len() - 1) / 2], chain.edge);
        }
    }
    let mut frame_labels = HashMap::new();
    let mut track_x = HashMap::new();
    let along_before = GROUP_PADDING + if down { GROUP_LABEL_BAND } else { 0.0 };
    for layer in 0..layer_count {
        for &unit in &by_layer[layer] {
            unit_x[unit] =
                column_x[layer] + ((column_width[layer] - layering.units[unit].w) / 2.0).floor();
        }
        if layer + 1 == layer_count {
            break;
        }
        let start = column_x[layer] + column_width[layer];
        let channel_hops = hops_by_layer[layer]
            .iter()
            .map(|index| ChannelHop {
                hop: *index,
                ya: hop_start[*index],
                yb: hop_end[*index],
            })
            .collect::<Vec<_>>();
        let mut channel_labels = Vec::new();
        for &hop in &hops_by_layer[layer] {
            if let Some(&edge) = label_hop.get(&hop) {
                let size = label_sizes[edge].as_ref().unwrap();
                channel_labels.push(ChannelLabel {
                    edge,
                    hop: Some(hop),
                    y: hop_start[hop],
                    along: if down { size.h } else { size.w },
                    across: if down { size.w } else { size.h },
                });
            }
        }
        for (index, loop_) in loops.iter().enumerate() {
            if layering.units[loop_.unit].layer == layer {
                if let Some(size) = &label_sizes[loop_.edge] {
                    channel_labels.push(ChannelLabel {
                        edge: loop_.edge,
                        hop: None,
                        y: loop_end[index],
                        along: if down { size.h } else { size.w },
                        across: if down { size.w } else { size.h },
                    });
                }
            }
        }
        channel_labels.sort_by_key(|label| label.edge);
        let mut obstacles = Vec::new();
        for band in &layering.bands {
            if band.first > layer || band.last <= layer {
                continue;
            }
            obstacles.push(Rect {
                x: 0.0,
                y: band.top - 3.0,
                w: 0.0,
                h: if down { 6.0 } else { GROUP_LABEL_BAND },
            });
            obstacles.push(Rect {
                x: 0.0,
                y: band.top + band.height - 3.0,
                w: 0.0,
                h: 6.0,
            });
        }
        let ends_here = layering.bands.iter().any(|band| band.last == layer);
        let starts_next = layering.bands.iter().any(|band| band.first == layer + 1);
        let channel = route_channel(
            start,
            EDGE_CLEAR + if ends_here { GROUP_PADDING } else { 0.0 },
            EDGE_CLEAR + if starts_next { along_before } else { 0.0 },
            &channel_hops,
            &channel_labels,
            &obstacles,
        );
        track_x.extend(channel.tracks);
        frame_labels.extend(channel.labels);
        column_x[layer + 1] = start + channel.width;
    }

    let frame_box = |unit: usize| Rect {
        x: unit_x[unit],
        y: top[unit],
        w: layering.units[unit].w,
        h: layering.units[unit].h,
    };
    let exit_x = |unit: usize, y: f64| {
        if let Some(node) = layering.units[unit].node {
            let box_ = frame_box(unit);
            box_.x + box_.w
                - inset(
                    nodes[node]
                        .get("shape")
                        .and_then(Value::as_str)
                        .unwrap_or("rect"),
                    box_,
                    y - center_of(unit),
                    down,
                )
        } else {
            column_x[layering.units[unit].layer] + column_width[layering.units[unit].layer]
        }
    };
    let entry_x = |unit: usize, y: f64| {
        if let Some(node) = layering.units[unit].node {
            let box_ = frame_box(unit);
            box_.x
                + inset(
                    nodes[node]
                        .get("shape")
                        .and_then(Value::as_str)
                        .unwrap_or("rect"),
                    box_,
                    y - center_of(unit),
                    down,
                )
        } else {
            column_x[layering.units[unit].layer]
        }
    };

    let mut node_boxes = Vec::new();
    for (index, node) in nodes.iter().enumerate() {
        let (w, h, label, sub) = &sizes[index];
        let (rect, pinned) = if let Some(unit) = unit_of_node.get(&index).copied() {
            let frame = frame_box(unit);
            (if down { flip(frame) } else { frame }, false)
        } else {
            let pos = node["pos"].as_array().unwrap();
            (
                Rect {
                    x: js_round(pos[0].as_f64().unwrap()),
                    y: js_round(pos[1].as_f64().unwrap()),
                    w: *w,
                    h: *h,
                },
                true,
            )
        };
        node_boxes.push(NodeBox {
            id: node["id"].as_str().unwrap().to_owned(),
            shape: node
                .get("shape")
                .and_then(Value::as_str)
                .unwrap_or("rect")
                .to_owned(),
            tone: node
                .get("tone")
                .and_then(Value::as_str)
                .unwrap_or("ink")
                .to_owned(),
            rect,
            pinned,
            label: label.clone(),
            sub: sub.clone(),
        });
    }
    let by_id = node_boxes
        .iter()
        .map(|node| (node.id.as_str(), node))
        .collect::<HashMap<_, _>>();
    let label_of = |edge: usize, frame: Option<Rect>| {
        let size = label_sizes[edge].as_ref()?;
        Some(LabelBox {
            rect: if down { flip(frame?) } else { frame? },
            lines: size.lines.clone(),
        })
    };
    let mut routes = vec![None; edges.len()];
    let mut unplaced = loose.iter().copied().collect::<HashSet<_>>();
    for chain in &chains {
        let mut points = Vec::new();
        for &index in &chain.hops {
            let hop = layering.hops[index];
            let ya = hop_start[index];
            let yb = hop_end[index];
            points.push(Point {
                x: exit_x(hop.from, ya),
                y: ya,
            });
            if ya != yb {
                let x = track_x[&index];
                points.push(Point { x, y: ya });
                points.push(Point { x, y: yb });
            }
            points.push(Point {
                x: entry_x(hop.to, yb),
                y: yb,
            });
        }
        let mut points = simplify(points);
        if chain.reversed {
            points.reverse();
        }
        if down {
            points = points.into_iter().map(flip_point).collect();
        }
        routes[chain.edge] = Some(EdgeBox {
            index: chain.edge,
            points,
            label: label_of(chain.edge, frame_labels.get(&chain.edge).copied()),
        });
    }
    for (index, loop_) in loops.iter().enumerate() {
        let box_ = frame_box(loop_.unit);
        let reach = box_.x + box_.w + LOOP;
        let start_y = loop_start[index];
        let end_y = loop_end[index];
        let mut points = vec![
            Point {
                x: exit_x(loop_.unit, start_y),
                y: start_y,
            },
            Point {
                x: reach,
                y: start_y,
            },
            Point { x: reach, y: end_y },
            Point {
                x: exit_x(loop_.unit, end_y),
                y: end_y,
            },
        ];
        if !frame_labels.contains_key(&loop_.edge) {
            unplaced.insert(loop_.edge);
        }
        let frame = frame_labels.get(&loop_.edge).copied().or_else(|| {
            let size = label_sizes[loop_.edge].as_ref()?;
            Some(Rect {
                x: reach + 6.0,
                y: js_round((start_y + end_y) / 2.0)
                    - (if down { size.w } else { size.h } / 2.0).floor(),
                w: if down { size.h } else { size.w },
                h: if down { size.w } else { size.h },
            })
        });
        if down {
            points = points.into_iter().map(flip_point).collect();
        }
        routes[loop_.edge] = Some(EdgeBox {
            index: loop_.edge,
            points,
            label: label_of(loop_.edge, frame),
        });
    }
    for &index in &loose {
        let edge = &edges[index];
        let source = by_id[edge["from"].as_str().unwrap()].rect;
        let target = by_id[edge["to"].as_str().unwrap()].rect;
        let points = loose_route(source, target, edge["from"] == edge["to"], down);
        let label = label_sizes[index].as_ref().map(|size| {
            let at = points.len().saturating_sub(2) / 2;
            let first = points[at];
            let second = points.get(at + 1).copied().unwrap_or(first);
            let middle = Point {
                x: js_round((first.x + second.x) / 2.0),
                y: js_round((first.y + second.y) / 2.0),
            };
            LabelBox {
                rect: Rect {
                    x: middle.x - size.w / 2.0,
                    y: middle.y - size.h - 4.0,
                    w: size.w,
                    h: size.h,
                },
                lines: size.lines.clone(),
            }
        });
        routes[index] = Some(EdgeBox {
            index,
            points,
            label,
        });
    }
    let mut edge_boxes = routes.into_iter().flatten().collect::<Vec<_>>();

    let mut group_boxes = Vec::new();
    for (group_index, group) in groups.iter().enumerate() {
        let mut rects = Vec::new();
        if let Some(&band_index) = band_of_group.get(&group_index) {
            let band = &layering.bands[band_index];
            let members = band
                .members
                .iter()
                .flatten()
                .filter(|unit| layering.units[**unit].node.is_some())
                .copied()
                .collect::<Vec<_>>();
            let along_start = band.members[0]
                .iter()
                .map(|unit| unit_x[*unit])
                .fold(f64::INFINITY, f64::min)
                - along_before;
            let along_end = members
                .iter()
                .map(|unit| unit_x[*unit] + layering.units[*unit].w)
                .fold(f64::NEG_INFINITY, f64::max)
                + GROUP_PADDING;
            let frame = Rect {
                x: along_start,
                y: band.top,
                w: along_end - along_start,
                h: band.height,
            };
            rects.push(if down { flip(frame) } else { frame });
        }
        for id in group["wraps"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(Value::as_str)
        {
            if let Some(box_) = by_id.get(id).filter(|box_| box_.pinned) {
                rects.push(Rect {
                    x: box_.rect.x - GROUP_PADDING,
                    y: box_.rect.y - GROUP_PADDING - GROUP_LABEL_BAND,
                    w: box_.rect.w + GROUP_PADDING * 2.0,
                    h: box_.rect.h + GROUP_PADDING * 2.0 + GROUP_LABEL_BAND,
                });
            }
        }
        if rects.is_empty() {
            continue;
        }
        let rect = union(rects);
        group_boxes.push(GroupBox {
            index: group_index,
            label: Rect {
                x: rect.x + GROUP_LABEL_INSET,
                y: rect.y + 4.0,
                w: estimate_diagram_text(group["label"].as_str().unwrap(), 12.0, true),
                h: 16.0,
            },
            rect,
        });
    }

    let mut settled = edge_boxes
        .iter()
        .filter(|edge| !unplaced.contains(&edge.index))
        .filter_map(|edge| edge.label.as_ref().map(|label| label.rect))
        .collect::<Vec<_>>();
    for edge in &mut edge_boxes {
        if !unplaced.contains(&edge.index) {
            continue;
        }
        let Some(label) = &mut edge.label else {
            continue;
        };
        for _ in 0..1000 {
            let taken = node_boxes
                .iter()
                .any(|node| overlaps(node.rect, label.rect))
                || group_boxes
                    .iter()
                    .any(|group| overlaps(group.label, label.rect))
                || settled.iter().any(|other| {
                    overlaps(
                        Rect {
                            x: other.x - 4.0,
                            y: other.y - 4.0,
                            w: other.w + 8.0,
                            h: other.h + 8.0,
                        },
                        label.rect,
                    )
                });
            if !taken {
                break;
            }
            label.rect.y += 4.0;
        }
        settled.push(label.rect);
    }
    let bounds = union(
        node_boxes
            .iter()
            .map(|node| node.rect)
            .chain(
                group_boxes
                    .iter()
                    .flat_map(|group| [group.rect, group.label]),
            )
            .chain(edge_boxes.iter().flat_map(|edge| {
                edge.points
                    .iter()
                    .map(|point| Rect {
                        x: point.x,
                        y: point.y,
                        w: 0.0,
                        h: 0.0,
                    })
                    .chain(edge.label.iter().map(|label| label.rect))
            })),
    );
    DiagramLayout {
        nodes: node_boxes,
        groups: group_boxes,
        edges: edge_boxes,
        bounds,
    }
}
