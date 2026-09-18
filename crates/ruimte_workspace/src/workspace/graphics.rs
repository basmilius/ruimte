#![allow(clippy::collapsible_if, clippy::too_many_arguments)]

use std::f64::consts::PI;

use perfect_freehand::{InputPoint, StrokeOptions, get_stroke, get_stroke_points};
use serde_json::{Map, Value, json};

use crate::rpc::RpcError;

#[derive(Clone, Copy)]
pub(super) struct Point {
    pub(super) x: f64,
    pub(super) y: f64,
}

#[derive(Clone, Copy)]
pub(super) struct Rect {
    pub(super) x: f64,
    pub(super) y: f64,
    pub(super) w: f64,
    pub(super) h: f64,
}

#[derive(Clone)]
enum Op {
    Move(Point),
    Curve([f64; 6]),
    Line(Point),
}

#[derive(Clone, Copy, PartialEq)]
enum PathRole {
    Stroke,
    Fill,
}

struct RoughPath {
    ops: Vec<Op>,
    role: PathRole,
    stroke_width: f64,
}

struct RoughOptions {
    random: Random,
    roughness: f64,
    bowing: f64,
    stroke_width: f64,
    disable_multi_stroke: bool,
    fill: Option<&'static str>,
}

impl RoughOptions {
    fn from_element(element: &Map<String, Value>) -> Self {
        let roughness = match element
            .get("roughness")
            .and_then(Value::as_u64)
            .unwrap_or(1)
        {
            0 => 0.0,
            2 => 2.5,
            _ => 1.0,
        };
        Self {
            random: Random::new(element.get("seed").and_then(Value::as_u64).unwrap_or(0) + 1),
            roughness,
            bowing: if roughness == 0.0 {
                0.0
            } else if roughness == 2.5 {
                2.0
            } else {
                1.0
            },
            stroke_width: number(element, "strokeWidth"),
            disable_multi_stroke: roughness == 0.0,
            fill: match element.get("fill").and_then(Value::as_str) {
                Some("solid") => Some("solid"),
                Some("hachure") => Some("hachure"),
                _ => None,
            },
        }
    }

    fn offset(&mut self, extent: f64, gain: f64) -> f64 {
        self.roughness * gain * (self.random.next() * extent * 2.0 - extent)
    }
}

#[derive(Clone, Copy)]
struct Random(u32);

impl Random {
    fn new(seed: u64) -> Self {
        Self(seed as u32)
    }

    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(48_271) & 0x7fff_ffff;
        self.0 as f64 / 2_147_483_648.0
    }
}

pub fn render_drawing(document: &Value) -> Result<Value, RpcError> {
    let elements = document
        .get("elements")
        .and_then(Value::as_array)
        .ok_or_else(|| RpcError::new("drawing-invalid", "A drawing needs elements"))?;
    let bounds = drawing_bounds(elements);
    let rendered = elements
        .iter()
        .map(render_drawing_element)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "rev": document.get("rev").and_then(Value::as_u64).unwrap_or(0),
        "bounds": { "x": bounds.x, "y": bounds.y, "w": bounds.w, "h": bounds.h },
        "elements": rendered
    }))
}

#[derive(Clone)]
struct DiagramNodeLayout {
    shape: String,
    label: Vec<String>,
    sub: Vec<String>,
    real: Rect,
}

pub fn render_diagram(document: &Value) -> Result<Value, RpcError> {
    document["nodes"]
        .as_array()
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs nodes"))?;
    let edges = document["edges"]
        .as_array()
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs edges"))?;
    let groups = document["groups"]
        .as_array()
        .ok_or_else(|| RpcError::new("diagram-invalid", "A diagram needs groups"))?;
    let layout = super::diagram_layout::layout(document);
    let mut rendered = Vec::new();
    for group in &layout.groups {
        let source = groups[group.index].as_object().unwrap();
        let tone = source
            .get("tone")
            .and_then(Value::as_str)
            .unwrap_or("muted");
        rendered.push(diagram_element(
            &format!("group:{}", string(source, "id")),
            vec![render_path(
                diagram_shape_path("round", group.rect).0,
                Some(color(tone, "ink")),
                None,
                1.0,
                Some(vec![6.0, 4.0]),
            )],
            vec![json!({
                "text": string(source, "label"),
                "x": group.label.x,
                "y": group.rect.y + 17.0,
                "size": 12,
                "bold": true,
                "align": "left",
                "font": "sans",
                "color": color(tone, "ink")
            })],
        ));
    }
    for route in &layout.edges {
        let edge = edges[route.index].as_object().unwrap();
        let tone = edge.get("tone").and_then(Value::as_str).unwrap_or("muted");
        let dash = match edge.get("style").and_then(Value::as_str) {
            Some("dashed") => Some(vec![8.0, 6.0]),
            Some("dotted") => Some(vec![2.0, 5.0]),
            _ => None,
        };
        let mut paths = vec![render_path(
            diagram_edge_path(&route.points),
            Some(color(tone, "ink")),
            None,
            2.0,
            dash,
        )];
        if !route.points.is_empty() {
            paths.push(render_path(
                diagram_arrow_path(&route.points),
                None,
                Some(color(tone, "ink")),
                0.0,
                None,
            ));
        }
        let text = route.label.as_ref().map_or_else(Vec::new, |label| {
            label
                .lines
                .iter()
                .enumerate()
                .map(|(line, text)| {
                    json!({
                        "text": text,
                        "x": (label.rect.x + label.rect.w / 2.0).round(),
                        "y": label.rect.y + 2.0 + line as f64 * 16.0 + 12.0,
                        "size": 12,
                        "bold": false,
                        "align": "center",
                        "font": "sans",
                        "color": color(tone, "ink")
                    })
                })
                .collect()
        });
        rendered.push(diagram_element(
            &format!("edge:{}", route.index),
            paths,
            text,
        ));
    }
    for node in &layout.nodes {
        let (body, detail) = diagram_shape_path(&node.shape, node.rect);
        let mut paths = vec![render_path(
            body,
            Some(color(&node.tone, "ink")),
            Some(color(&node.tone, "paper")),
            2.0,
            None,
        )];
        if let Some(detail) = detail {
            paths.push(render_path(
                detail,
                Some(color(&node.tone, "ink")),
                None,
                2.0,
                None,
            ));
        }
        let text_node = DiagramNodeLayout {
            shape: node.shape.clone(),
            label: node.label.clone(),
            sub: node.sub.clone(),
            real: node.rect,
        };
        rendered.push(diagram_element(
            &format!("node:{}", node.id),
            paths,
            diagram_node_text(&text_node),
        ));
    }
    Ok(json!({
        "rev": document.get("rev").and_then(Value::as_u64).unwrap_or(0),
        "bounds": {
            "x": layout.bounds.x,
            "y": layout.bounds.y,
            "w": layout.bounds.w,
            "h": layout.bounds.h
        },
        "elements": rendered
    }))
}

pub(crate) fn drawing_svg(document: &Value) -> Result<String, RpcError> {
    scene_svg(&render_drawing(document)?, false)
}

pub(crate) fn diagram_svg(document: &Value) -> Result<String, RpcError> {
    scene_svg(&render_diagram(document)?, true)
}

fn scene_svg(scene: &Value, diagram: bool) -> Result<String, RpcError> {
    let bounds = scene["bounds"]
        .as_object()
        .ok_or_else(|| RpcError::new("render-invalid", "A rendered scene needs bounds"))?;
    let margin = 32.0;
    let x = round_svg(number(bounds, "x") - margin);
    let y = round_svg(number(bounds, "y") - margin);
    let w = round_svg(number(bounds, "w") + margin * 2.0);
    let h = round_svg(number(bounds, "h") + margin * 2.0);
    let font = if diagram {
        " font-family=\"system-ui, -apple-system, &quot;Segoe UI&quot;, sans-serif\""
    } else {
        ""
    };
    let mut body = String::new();
    for element in scene["elements"].as_array().into_iter().flatten() {
        let transform = if diagram {
            String::new()
        } else {
            let x = round_svg(element["x"].as_f64().unwrap_or(0.0));
            let y = round_svg(element["y"].as_f64().unwrap_or(0.0));
            let angle = element["angle"].as_f64().unwrap_or(0.0);
            let turn = if angle == 0.0 {
                String::new()
            } else {
                format!(
                    " rotate({} {} {})",
                    round_svg(angle * 180.0 / PI),
                    round_svg(element["centerX"].as_f64().unwrap_or(0.0)),
                    round_svg(element["centerY"].as_f64().unwrap_or(0.0))
                )
            };
            format!(" transform=\"translate({x} {y}){turn}\"")
        };
        body.push_str(&format!("<g{transform}>"));
        for path in element["paths"].as_array().into_iter().flatten() {
            let dash = path["dash"].as_array().map_or_else(String::new, |dash| {
                format!(
                    " stroke-dasharray=\"{}\"",
                    dash.iter()
                        .filter_map(Value::as_f64)
                        .map(round_svg)
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            });
            let d = escape_xml(path["d"].as_str().unwrap_or_default());
            if let Some(stroke) = path.get("stroke").filter(|value| !value.is_null()) {
                body.push_str(&format!(
                    "<path d=\"{d}\" fill=\"none\" stroke=\"{}\" stroke-width=\"{}\" stroke-linecap=\"round\"{dash}/>",
                    scene_color(stroke),
                    round_svg(path["strokeWidth"].as_f64().unwrap_or(0.0))
                ));
            } else if let Some(fill) = path.get("fill").filter(|value| !value.is_null()) {
                body.push_str(&format!(
                    "<path d=\"{d}\" fill=\"{}\" stroke=\"none\"/>",
                    scene_color(fill)
                ));
            }
        }
        let text = element["text"].as_array().cloned().unwrap_or_default();
        if diagram {
            for line in &text {
                body.push_str(&scene_text(line, false));
            }
        } else if let Some(first) = text.first() {
            let family = font_stack(first["font"].as_str().unwrap_or("hand"));
            let anchor = text_anchor(first["align"].as_str().unwrap_or("left"));
            body.push_str(&format!(
                "<text font-family=\"{}\" font-size=\"{}\" fill=\"{}\" text-anchor=\"{anchor}\">",
                escape_xml(family),
                round_svg(first["size"].as_f64().unwrap_or(0.0)),
                scene_color(&first["color"])
            ));
            for line in &text {
                body.push_str(&format!(
                    "<tspan x=\"{}\" y=\"{}\">{}</tspan>",
                    round_svg(line["x"].as_f64().unwrap_or(0.0)),
                    round_svg(line["y"].as_f64().unwrap_or(0.0)),
                    escape_xml(line["text"].as_str().unwrap_or_default())
                ));
            }
            body.push_str("</text>");
        }
        body.push_str("</g>");
    }
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"{x} {y} {w} {h}\"{font}>{body}</svg>"
    ))
}

fn scene_text(line: &Value, include_family: bool) -> String {
    let family = if include_family {
        format!(
            " font-family=\"{}\"",
            escape_xml(font_stack(line["font"].as_str().unwrap_or("sans")))
        )
    } else {
        String::new()
    };
    let weight = if line["bold"] == true {
        " font-weight=\"600\""
    } else {
        ""
    };
    format!(
        "<text x=\"{}\" y=\"{}\" font-size=\"{}\"{weight} text-anchor=\"{}\" fill=\"{}\"{family}>{}</text>",
        round_svg(line["x"].as_f64().unwrap_or(0.0)),
        round_svg(line["y"].as_f64().unwrap_or(0.0)),
        round_svg(line["size"].as_f64().unwrap_or(0.0)),
        text_anchor(line["align"].as_str().unwrap_or("left")),
        scene_color(&line["color"]),
        escape_xml(line["text"].as_str().unwrap_or_default())
    )
}

fn scene_color(color: &Value) -> &'static str {
    let tone = color["tone"].as_str().unwrap_or("ink");
    match color["palette"].as_str().unwrap_or("ink") {
        "paper" => match tone {
            "muted" => "#ececef",
            "accent" => "#e2e5fd",
            "red" => "#fddfdf",
            "orange" => "#fde9d0",
            "yellow" => "#fff3bf",
            "green" => "#dcf5e3",
            "blue" => "#dbe9ff",
            "purple" => "#eadffb",
            "pink" => "#fde2ea",
            _ => "#f4f4f6",
        },
        "edge" => match tone {
            "muted" => "#d6d6da",
            "accent" => "#c3cbf7",
            "red" => "#f4bebe",
            "orange" => "#f3d3a8",
            "yellow" => "#f0dc94",
            "green" => "#b9e3c6",
            "blue" => "#b6cff2",
            "purple" => "#d5bef0",
            "pink" => "#f3c0d1",
            _ => "#dedee2",
        },
        _ => match tone {
            "muted" => "#6f6f78",
            "accent" => "#4f46e5",
            "red" => "#d64545",
            "orange" => "#d97706",
            "yellow" => "#b7860b",
            "green" => "#2f8a4f",
            "blue" => "#2563eb",
            "purple" => "#7c3aed",
            "pink" => "#db2777",
            _ => "#18181b",
        },
    }
}

fn font_stack(font: &str) -> &'static str {
    match font {
        "sans" => "system-ui, -apple-system, \"Segoe UI\", sans-serif",
        "mono" => "ui-monospace, SFMono-Regular, Menlo, monospace",
        _ => "Kalam, \"Comic Sans MS\", cursive",
    }
}

fn text_anchor(align: &str) -> &'static str {
    match align {
        "center" => "middle",
        "right" => "end",
        _ => "start",
    }
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn round_svg(value: f64) -> String {
    js((value * 100.0).round() / 100.0)
}

#[derive(Clone)]
pub(super) struct DiagramLabelSize {
    pub(super) w: f64,
    pub(super) h: f64,
    pub(super) lines: Vec<String>,
}

pub(super) fn diagram_node_size(node: &Map<String, Value>) -> (f64, f64, Vec<String>, Vec<String>) {
    let diamond = node.get("shape").and_then(Value::as_str) == Some("diamond");
    let max_width = if diamond { 160.0 } else { 248.0 };
    let label = wrap_diagram_text(string(node, "label"), 14.0, true, max_width);
    let sub = node
        .get("sub")
        .and_then(Value::as_str)
        .map(|text| wrap_diagram_text(text, 12.0, false, max_width))
        .unwrap_or_default();
    let text_width = label
        .iter()
        .map(|line| estimate_diagram_text(line, 14.0, true))
        .chain(
            sub.iter()
                .map(|line| estimate_diagram_text(line, 12.0, false)),
        )
        .fold(0.0_f64, f64::max);
    let text_height = label.len() as f64 * 18.0 + sub.len() as f64 * 16.0;
    if diamond {
        return (
            even(168.0_f64.max((text_width + 16.0) * 2.0)),
            even(72.0_f64.max((text_height + 8.0) * 2.0)),
            label,
            sub,
        );
    }
    let mut h = text_height + 26.0;
    let padding = if node.get("shape").and_then(Value::as_str) == Some("pill") {
        16.0_f64.max(h.round() / 2.0 - 4.0)
    } else {
        16.0
    };
    if node.get("shape").and_then(Value::as_str) == Some("cylinder") {
        h += 10.0;
    }
    (
        even(120.0_f64.max(text_width + padding * 2.0)),
        even(h),
        label,
        sub,
    )
}

pub(super) fn diagram_edge_label_size(text: &str) -> DiagramLabelSize {
    let lines = wrap_diagram_text(text, 12.0, false, 160.0);
    DiagramLabelSize {
        w: even(
            lines
                .iter()
                .map(|line| estimate_diagram_text(line, 12.0, false))
                .fold(0.0_f64, f64::max)
                + 8.0,
        ),
        h: lines.len() as f64 * 16.0 + 4.0,
        lines,
    }
}

pub(super) fn estimate_diagram_text(text: &str, size: f64, bold: bool) -> f64 {
    let narrow = "ijl.,:;!|'";
    let semi = " ftrI-()[]{}/\\`\"*";
    let wide_lower = "mw";
    let wide = "MW@%&";
    let units = text
        .chars()
        .map(|character| {
            if narrow.contains(character) {
                0.3
            } else if semi.contains(character) {
                0.4
            } else if wide_lower.contains(character) {
                0.86
            } else if wide.contains(character) {
                1.0
            } else if character.is_ascii_lowercase() {
                0.6
            } else if character.is_ascii_uppercase() {
                0.74
            } else if character.is_ascii_digit() {
                0.64
            } else if character as u32 >= 0x2e80 {
                1.0
            } else {
                0.64
            }
        })
        .sum::<f64>();
    (units * size * if bold { 1.0 } else { 0.94 }).ceil()
}

fn wrap_diagram_text(text: &str, size: f64, bold: bool, max_width: f64) -> Vec<String> {
    let words = text.split_whitespace().collect::<Vec<_>>();
    let mut lines = Vec::new();
    let mut line = String::new();
    for word in words {
        let pieces = if estimate_diagram_text(word, size, bold) > max_width {
            let mut pieces = Vec::new();
            let mut piece = String::new();
            for character in word.chars() {
                if !piece.is_empty()
                    && estimate_diagram_text(&format!("{piece}{character}"), size, bold) > max_width
                {
                    pieces.push(std::mem::take(&mut piece));
                }
                piece.push(character);
            }
            pieces.push(piece);
            pieces
        } else {
            vec![word.to_owned()]
        };
        for piece in pieces {
            let joined = if line.is_empty() {
                piece.clone()
            } else {
                format!("{line} {piece}")
            };
            if !line.is_empty() && estimate_diagram_text(&joined, size, bold) > max_width {
                lines.push(std::mem::replace(&mut line, piece));
            } else {
                line = joined;
            }
        }
    }
    lines.push(line);
    lines
}

fn diagram_shape_path(shape: &str, box_: Rect) -> (String, Option<String>) {
    let right = box_.x + box_.w;
    let bottom = box_.y + box_.h;
    let middle_x = (box_.x + box_.w / 2.0).round();
    let middle_y = (box_.y + box_.h / 2.0).round();
    match shape {
        "round" => (diagram_rounded_rect(box_, 10.0), None),
        "pill" => (diagram_rounded_rect(box_, box_.h / 2.0), None),
        "diamond" => (
            format!(
                "M{} {} L{} {} L{} {} L{} {} Z",
                js(middle_x),
                js(box_.y),
                js(right),
                js(middle_y),
                js(middle_x),
                js(bottom),
                js(box_.x),
                js(middle_y)
            ),
            None,
        ),
        "cylinder" => {
            let lid = (box_.h * 0.18).round();
            let rx = (box_.w / 2.0).round();
            let ry = (lid / 2.0).round();
            let top = box_.y + ry;
            let base = bottom - ry;
            (
                format!(
                    "M{} {} A{} {} 0 0 1 {} {} V{} A{} {} 0 0 1 {} {} Z",
                    js(box_.x),
                    js(top),
                    js(rx),
                    js(ry),
                    js(right),
                    js(top),
                    js(base),
                    js(rx),
                    js(ry),
                    js(box_.x),
                    js(base)
                ),
                Some(format!(
                    "M{} {} A{} {} 0 0 0 {} {}",
                    js(box_.x),
                    js(top),
                    js(rx),
                    js(ry),
                    js(right),
                    js(top)
                )),
            )
        }
        _ => (
            format!(
                "M{} {} H{} V{} H{} Z",
                js(box_.x),
                js(box_.y),
                js(right),
                js(bottom),
                js(box_.x)
            ),
            None,
        ),
    }
}

fn diagram_rounded_rect(box_: Rect, radius: f64) -> String {
    let r = radius.min(box_.w / 2.0).min(box_.h / 2.0).round();
    let right = box_.x + box_.w;
    let bottom = box_.y + box_.h;
    format!(
        "M{} {} H{} A{} {} 0 0 1 {} {} V{} A{} {} 0 0 1 {} {} H{} A{} {} 0 0 1 {} {} V{} A{} {} 0 0 1 {} {} Z",
        js(box_.x + r),
        js(box_.y),
        js(right - r),
        js(r),
        js(r),
        js(right),
        js(box_.y + r),
        js(bottom - r),
        js(r),
        js(r),
        js(right - r),
        js(bottom),
        js(box_.x + r),
        js(r),
        js(r),
        js(box_.x),
        js(bottom - r),
        js(box_.y + r),
        js(r),
        js(r),
        js(box_.x + r),
        js(box_.y)
    )
}

fn diagram_edge_path(points: &[Point]) -> String {
    points
        .iter()
        .enumerate()
        .map(|(index, point)| {
            format!(
                "{}{} {}",
                if index == 0 { "M" } else { "L" },
                js(point.x),
                js(point.y)
            )
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn diagram_arrow_path(points: &[Point]) -> String {
    let tip = *points.last().unwrap();
    let before = points
        .get(points.len().saturating_sub(2))
        .copied()
        .unwrap_or(tip);
    let length = (tip.x - before.x).hypot(tip.y - before.y).max(1.0);
    let ux = (tip.x - before.x) / length;
    let uy = (tip.y - before.y) / length;
    let bx = tip.x - ux * 10.0;
    let by = tip.y - uy * 10.0;
    format!(
        "M{} {} L{} {} L{} {} Z",
        js(tip.x),
        js(tip.y),
        js((bx - uy * 6.0).round()),
        js((by + ux * 6.0).round()),
        js((bx + uy * 6.0).round()),
        js((by - ux * 6.0).round())
    )
}

fn diagram_node_text(node: &DiagramNodeLayout) -> Vec<Value> {
    let x = (node.real.x + node.real.w / 2.0).round();
    let height = node.label.len() as f64 * 18.0 + node.sub.len() as f64 * 16.0;
    let top = (node.real.y + (node.real.h - height) / 2.0).round()
        + if node.shape == "cylinder" { 5.0 } else { 0.0 };
    node.label.iter().enumerate().map(|(index,text)| json!({"text":text,"x":x,"y":top+index as f64*18.0+14.0,"size":14,"bold":true,"align":"center","font":"sans","color":color("ink","ink")})).chain(node.sub.iter().enumerate().map(|(index,text)|json!({"text":text,"x":x,"y":top+node.label.len() as f64*18.0+index as f64*16.0+12.0,"size":12,"bold":false,"align":"center","font":"sans","color":color("muted","ink")}))).collect()
}

fn diagram_element(id: &str, paths: Vec<Value>, text: Vec<Value>) -> Value {
    json!({"id":id,"x":0,"y":0,"angle":0,"centerX":0,"centerY":0,"paths":paths,"text":text})
}

fn even(value: f64) -> f64 {
    (value / 2.0).ceil() * 2.0
}

fn render_drawing_element(value: &Value) -> Result<Value, RpcError> {
    let element = value
        .as_object()
        .ok_or_else(|| RpcError::new("drawing-invalid", "A drawing element must be an object"))?;
    let paths = drawing_paths(element)?;
    let text = drawing_text(element);
    Ok(json!({
        "id": string(element, "id"),
        "x": number(element, "x"),
        "y": number(element, "y"),
        "angle": optional_number(element, "angle", 0.0),
        "centerX": number(element, "w") / 2.0,
        "centerY": number(element, "h") / 2.0,
        "paths": paths,
        "text": text
    }))
}

fn drawing_bounds(elements: &[Value]) -> Rect {
    if elements.is_empty() {
        return Rect {
            x: 0.0,
            y: 0.0,
            w: 0.0,
            h: 0.0,
        };
    }
    let mut left = f64::INFINITY;
    let mut top = f64::INFINITY;
    let mut right = f64::NEG_INFINITY;
    let mut bottom = f64::NEG_INFINITY;
    for value in elements {
        let element = value.as_object().unwrap();
        let x = number(element, "x");
        let y = number(element, "y");
        let w = number(element, "w");
        let h = number(element, "h");
        let center = Point {
            x: x + w / 2.0,
            y: y + h / 2.0,
        };
        let angle = optional_number(element, "angle", 0.0);
        for point in [
            Point { x, y },
            Point { x: x + w, y },
            Point { x, y: y + h },
            Point { x: x + w, y: y + h },
        ] {
            let point = rotate(point, center, angle);
            left = left.min(point.x);
            top = top.min(point.y);
            right = right.max(point.x);
            bottom = bottom.max(point.y);
        }
    }
    Rect {
        x: left,
        y: top,
        w: right - left,
        h: bottom - top,
    }
}

fn rotate(point: Point, center: Point, angle: f64) -> Point {
    if angle == 0.0 {
        return point;
    }
    let (sin, cos) = angle.sin_cos();
    let dx = point.x - center.x;
    let dy = point.y - center.y;
    Point {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
    }
}

fn drawing_paths(element: &Map<String, Value>) -> Result<Vec<Value>, RpcError> {
    let kind = string(element, "kind");
    if kind == "text" {
        return Ok(Vec::new());
    }
    if kind == "note" {
        let d = rounded_rect_path(number(element, "w"), number(element, "h"), 8.0);
        let fill = element
            .get("fillColor")
            .and_then(Value::as_str)
            .unwrap_or_else(|| string(element, "stroke"));
        return Ok(vec![
            render_path(d.clone(), None, Some(color(fill, "paper")), 0.0, None),
            render_path(
                d,
                Some(color(fill, "edge")),
                None,
                number(element, "strokeWidth"),
                None,
            ),
        ]);
    }
    if kind == "freehand" {
        return Ok(vec![render_path(
            freehand_path(element),
            None,
            Some(color(string(element, "stroke"), "ink")),
            0.0,
            None,
        )]);
    }

    let mut options = RoughOptions::from_element(element);
    let rough = match kind {
        "rect"
            if element
                .get("radius")
                .and_then(Value::as_f64)
                .is_some_and(|radius| radius != 0.0) =>
        {
            rough_rounded_rect(
                number(element, "w"),
                number(element, "h"),
                number(element, "radius"),
                &mut options,
            )
        }
        "rect" => rough_polygon(
            &[
                Point { x: 0.0, y: 0.0 },
                Point {
                    x: number(element, "w"),
                    y: 0.0,
                },
                Point {
                    x: number(element, "w"),
                    y: number(element, "h"),
                },
                Point {
                    x: 0.0,
                    y: number(element, "h"),
                },
            ],
            &mut options,
        ),
        "diamond" => rough_polygon(
            &[
                Point {
                    x: number(element, "w") / 2.0,
                    y: 0.0,
                },
                Point {
                    x: number(element, "w"),
                    y: number(element, "h") / 2.0,
                },
                Point {
                    x: number(element, "w") / 2.0,
                    y: number(element, "h"),
                },
                Point {
                    x: 0.0,
                    y: number(element, "h") / 2.0,
                },
            ],
            &mut options,
        ),
        "ellipse" => rough_ellipse(number(element, "w"), number(element, "h"), &mut options),
        "line" => rough_line(points(element), &mut options),
        _ => {
            return Err(RpcError::new(
                "drawing-invalid",
                "Unknown drawing element kind",
            ));
        }
    };
    let stroke_tone = string(element, "stroke");
    let fill_tone = element
        .get("fillColor")
        .and_then(Value::as_str)
        .unwrap_or(stroke_tone);
    let dash = dash(element);
    let mut paths = rough
        .into_iter()
        .map(|path| {
            let d = ops_to_path(&path.ops);
            if path.role == PathRole::Stroke {
                render_path(
                    d,
                    Some(color(stroke_tone, "ink")),
                    None,
                    path.stroke_width,
                    dash.clone(),
                )
            } else if options.fill == Some("hachure") {
                render_path(
                    d,
                    Some(color(fill_tone, "ink")),
                    None,
                    path.stroke_width,
                    None,
                )
            } else {
                render_path(
                    d,
                    None,
                    Some(color(fill_tone, "ink")),
                    path.stroke_width,
                    None,
                )
            }
        })
        .collect::<Vec<_>>();
    if kind == "line" {
        let points = points(element);
        let size = 12.0 + number(element, "strokeWidth") * 4.0;
        let mut heads = Vec::new();
        if element
            .get("arrowEnd")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            heads.extend(arrow_head(
                *points.last().unwrap(),
                points[points.len() - 2],
                size,
            ));
        }
        if element
            .get("arrowStart")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            heads.extend(arrow_head(points[0], points[1], size));
        }
        if !heads.is_empty() {
            let d = heads
                .into_iter()
                .map(|(from, to)| {
                    format!(
                        "M {} {} L {} {}",
                        js(from.x),
                        js(from.y),
                        js(to.x),
                        js(to.y)
                    )
                })
                .collect::<Vec<_>>()
                .join(" ");
            paths.push(render_path(
                d,
                Some(color(stroke_tone, "ink")),
                None,
                number(element, "strokeWidth"),
                None,
            ));
        }
    }
    Ok(paths)
}

fn drawing_text(element: &Map<String, Value>) -> Vec<Value> {
    let kind = string(element, "kind");
    if kind != "text" && kind != "note" {
        return Vec::new();
    }
    let note = kind == "note";
    let size = number(element, "size");
    let font = element
        .get("font")
        .and_then(Value::as_str)
        .unwrap_or("hand");
    let align = element
        .get("align")
        .and_then(Value::as_str)
        .unwrap_or("left");
    let frame_x = if note { 16.0 } else { 0.0 };
    let frame_y = if note { 16.0 } else { 0.0 };
    let frame_w = if note {
        (number(element, "w") - 32.0).max(1.0)
    } else {
        number(element, "w")
    };
    let lines = if note
        || element
            .get("sized")
            .and_then(Value::as_bool)
            .unwrap_or(false)
    {
        wrap_lines(string(element, "text"), frame_w, size, font)
    } else {
        string(element, "text")
            .split('\n')
            .map(str::to_owned)
            .collect()
    };
    let x = frame_x
        + match align {
            "center" => frame_w / 2.0,
            "right" => frame_w,
            _ => 0.0,
        };
    lines
        .into_iter()
        .enumerate()
        .map(|(index, text)| {
            json!({
                "text": text,
                "x": x,
                "y": frame_y + (index as f64 + 0.8) * size * 1.25,
                "size": size,
                "bold": false,
                "align": align,
                "font": font,
                "color": color(string(element, "stroke"), "ink")
            })
        })
        .collect()
}

fn wrap_lines(text: &str, width: f64, size: f64, font: &str) -> Vec<String> {
    let glyph = if font == "mono" { 0.6 } else { 0.55 };
    text.split('\n')
        .flat_map(|paragraph| {
            let mut lines = Vec::new();
            let mut line = String::new();
            for word in paragraph.split(' ') {
                let candidate = if line.is_empty() {
                    word.to_owned()
                } else {
                    format!("{line} {word}")
                };
                if candidate.encode_utf16().count() as f64 * size * glyph <= width {
                    line = candidate;
                    continue;
                }
                if !line.is_empty() {
                    lines.push(std::mem::take(&mut line));
                }
                if word.encode_utf16().count() as f64 * size * glyph <= width {
                    line = word.to_owned();
                    continue;
                }
                for character in word.chars() {
                    if !line.is_empty()
                        && format!("{line}{character}").encode_utf16().count() as f64 * size * glyph
                            > width
                    {
                        lines.push(std::mem::take(&mut line));
                    }
                    line.push(character);
                }
            }
            lines.push(line);
            lines
        })
        .collect()
}

fn rough_polygon(points: &[Point], options: &mut RoughOptions) -> Vec<RoughPath> {
    let outline = linear_ops(points, true, options, false);
    let mut paths = fill_polygon(points, options);
    paths.push(RoughPath {
        ops: outline,
        role: PathRole::Stroke,
        stroke_width: options.stroke_width,
    });
    paths
}

fn rough_line(points: Vec<Point>, options: &mut RoughOptions) -> Vec<RoughPath> {
    vec![RoughPath {
        ops: linear_ops(&points, false, options, false),
        role: PathRole::Stroke,
        stroke_width: options.stroke_width,
    }]
}

fn linear_ops(points: &[Point], close: bool, options: &mut RoughOptions, filling: bool) -> Vec<Op> {
    let mut ops = Vec::new();
    for pair in points.windows(2) {
        ops.extend(double_line(pair[0], pair[1], options, filling));
    }
    if close && points.len() > 2 {
        ops.extend(double_line(
            *points.last().unwrap(),
            points[0],
            options,
            filling,
        ));
    }
    ops
}

fn double_line(from: Point, to: Point, options: &mut RoughOptions, filling: bool) -> Vec<Op> {
    let mut result = one_line(from, to, options, false);
    if !(if filling {
        false
    } else {
        options.disable_multi_stroke
    }) {
        result.extend(one_line(from, to, options, true));
    }
    result
}

fn one_line(from: Point, to: Point, options: &mut RoughOptions, overlay: bool) -> Vec<Op> {
    let length_squared = (from.x - to.x).powi(2) + (from.y - to.y).powi(2);
    let length = length_squared.sqrt();
    let gain = if length < 200.0 {
        1.0
    } else if length > 500.0 {
        0.4
    } else {
        -0.0016668 * length + 1.233334
    };
    let mut offset = 2.0;
    if offset * offset * 100.0 > length_squared {
        offset = length / 10.0;
    }
    let half = offset / 2.0;
    let diverge = 0.2 + options.random.next() * 0.2;
    let mut middle_x = options.bowing * 2.0 * (to.y - from.y) / 200.0;
    let mut middle_y = options.bowing * 2.0 * (from.x - to.x) / 200.0;
    middle_x = options.offset(middle_x, gain);
    middle_y = options.offset(middle_y, gain);
    let reach = if overlay { half } else { offset };
    let move_point = Point {
        x: from.x + options.offset(reach, gain),
        y: from.y + options.offset(reach, gain),
    };
    let curve = [
        middle_x + from.x + (to.x - from.x) * diverge + options.offset(reach, gain),
        middle_y + from.y + (to.y - from.y) * diverge + options.offset(reach, gain),
        middle_x + from.x + 2.0 * (to.x - from.x) * diverge + options.offset(reach, gain),
        middle_y + from.y + 2.0 * (to.y - from.y) * diverge + options.offset(reach, gain),
        to.x + options.offset(reach, gain),
        to.y + options.offset(reach, gain),
    ];
    vec![Op::Move(move_point), Op::Curve(curve)]
}

fn fill_polygon(points: &[Point], options: &mut RoughOptions) -> Vec<RoughPath> {
    match options.fill {
        None => Vec::new(),
        Some("solid") => {
            let ops = points
                .iter()
                .enumerate()
                .map(|(index, point)| {
                    let point = Point {
                        x: point.x + options.offset(2.0, 1.0),
                        y: point.y + options.offset(2.0, 1.0),
                    };
                    if index == 0 {
                        Op::Move(point)
                    } else {
                        Op::Line(point)
                    }
                })
                .collect();
            vec![RoughPath {
                ops,
                role: PathRole::Fill,
                stroke_width: 0.0,
            }]
        }
        Some("hachure") => {
            let gap = 8.0;
            let skip = if options.roughness >= 1.0 && options.random.next() > 0.7 {
                gap
            } else {
                1.0
            };
            let lines = hachure_lines(points, gap, 49.0, skip);
            let mut ops = Vec::new();
            for (from, to) in lines {
                ops.extend(double_line(from, to, options, true));
            }
            vec![RoughPath {
                ops,
                role: PathRole::Fill,
                stroke_width: options.stroke_width / 2.0,
            }]
        }
        _ => Vec::new(),
    }
}

fn rough_ellipse(w: f64, h: f64, options: &mut RoughOptions) -> Vec<RoughPath> {
    let circumference = (PI * 2.0 * (((w / 2.0).powi(2) + (h / 2.0).powi(2)) / 2.0).sqrt()).sqrt();
    let steps = 9.0_f64.max(9.0 / 200.0_f64.sqrt() * circumference).ceil();
    let increment = PI * 2.0 / steps;
    let mut rx = w.abs() / 2.0;
    let mut ry = h.abs() / 2.0;
    rx += options.offset(rx * 0.05, 1.0);
    ry += options.offset(ry * 0.05, 1.0);
    let (outline, estimated) = ellipse_ops(w / 2.0, h / 2.0, rx, ry, increment, options);
    let mut paths = match options.fill {
        Some("solid") => {
            let (mut fill, _) = ellipse_ops(w / 2.0, h / 2.0, rx, ry, increment, options);
            vec![RoughPath {
                ops: std::mem::take(&mut fill),
                role: PathRole::Fill,
                stroke_width: 0.0,
            }]
        }
        Some("hachure") => fill_polygon(&estimated, options),
        _ => Vec::new(),
    };
    paths.push(RoughPath {
        ops: outline,
        role: PathRole::Stroke,
        stroke_width: options.stroke_width,
    });
    paths
}

fn ellipse_ops(
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    increment: f64,
    options: &mut RoughOptions,
) -> (Vec<Op>, Vec<Point>) {
    let overlap_max = offset_range(options, 0.4, 1.0);
    let overlap = increment * offset_range(options, 0.1, overlap_max);
    let (points, core) = ellipse_points(cx, cy, rx, ry, increment, 1.0, overlap, options);
    let mut ops = curve_ops(&points);
    if !options.disable_multi_stroke && options.roughness != 0.0 {
        let (second, _) = ellipse_points(cx, cy, rx, ry, increment, 1.5, 0.0, options);
        ops.extend(curve_ops(&second));
    }
    (ops, core)
}

fn ellipse_points(
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    mut increment: f64,
    offset: f64,
    overlap: f64,
    options: &mut RoughOptions,
) -> (Vec<Point>, Vec<Point>) {
    let mut points = Vec::new();
    let mut core = Vec::new();
    if options.roughness == 0.0 {
        increment /= 4.0;
        points.push(Point {
            x: cx + rx * (-increment).cos(),
            y: cy + ry * (-increment).sin(),
        });
        let mut angle = 0.0;
        while angle <= PI * 2.0 {
            let point = Point {
                x: cx + rx * angle.cos(),
                y: cy + ry * angle.sin(),
            };
            core.push(point);
            points.push(point);
            angle += increment;
        }
        points.push(Point { x: cx + rx, y: cy });
        points.push(Point {
            x: cx + rx * increment.cos(),
            y: cy + ry * increment.sin(),
        });
    } else {
        let start = options.offset(0.5, 1.0) - PI / 2.0;
        points.push(ellipse_point(
            cx,
            cy,
            rx,
            ry,
            start - increment,
            0.9,
            offset,
            options,
        ));
        let end = PI * 2.0 + start - 0.01;
        let mut angle = start;
        while angle < end {
            let point = ellipse_point(cx, cy, rx, ry, angle, 1.0, offset, options);
            core.push(point);
            points.push(point);
            angle += increment;
        }
        points.push(ellipse_point(
            cx,
            cy,
            rx,
            ry,
            start + PI * 2.0 + overlap * 0.5,
            1.0,
            offset,
            options,
        ));
        points.push(ellipse_point(
            cx,
            cy,
            rx,
            ry,
            start + overlap,
            0.98,
            offset,
            options,
        ));
        points.push(ellipse_point(
            cx,
            cy,
            rx,
            ry,
            start + overlap * 0.5,
            0.9,
            offset,
            options,
        ));
    }
    (points, core)
}

fn ellipse_point(
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    angle: f64,
    scale: f64,
    offset: f64,
    options: &mut RoughOptions,
) -> Point {
    Point {
        x: options.offset(offset, 1.0) + cx + scale * rx * angle.cos(),
        y: options.offset(offset, 1.0) + cy + scale * ry * angle.sin(),
    }
}

fn curve_ops(points: &[Point]) -> Vec<Op> {
    let mut ops = Vec::new();
    if points.len() > 3 {
        ops.push(Op::Move(points[1]));
        for index in 1..points.len() - 2 {
            let before = points[index - 1];
            let current = points[index];
            let next = points[index + 1];
            let after = points[index + 2];
            ops.push(Op::Curve([
                current.x + (next.x - before.x) / 6.0,
                current.y + (next.y - before.y) / 6.0,
                next.x + (current.x - after.x) / 6.0,
                next.y + (current.y - after.y) / 6.0,
                next.x,
                next.y,
            ]));
        }
    }
    ops
}

fn offset_range(options: &mut RoughOptions, minimum: f64, maximum: f64) -> f64 {
    options.roughness * (options.random.next() * (maximum - minimum) + minimum)
}

fn rough_rounded_rect(w: f64, h: f64, radius: f64, options: &mut RoughOptions) -> Vec<RoughPath> {
    let r = radius.min(w / 2.0).min(h / 2.0);
    let segments = rounded_segments(w, h, r);
    let outline = rough_segments(&segments, options);
    let mut paths = match options.fill {
        Some("solid") => {
            let saved = options.roughness;
            let saved_multi_stroke = options.disable_multi_stroke;
            options.roughness = if saved == 0.0 { 0.0 } else { saved + 0.8 };
            options.disable_multi_stroke = true;
            let mut fill = rough_segments(&segments, options);
            options.roughness = saved;
            options.disable_multi_stroke = saved_multi_stroke;
            fill.retain_with_index(|index, op| index == 0 || !matches!(op, Op::Move(_)));
            vec![RoughPath {
                ops: fill,
                role: PathRole::Fill,
                stroke_width: 0.0,
            }]
        }
        Some("hachure") => fill_polygon(&rounded_outline_points(w, h, r), options),
        _ => Vec::new(),
    };
    paths.push(RoughPath {
        ops: outline,
        role: PathRole::Stroke,
        stroke_width: options.stroke_width,
    });
    paths
}

trait RetainIndex<T> {
    fn retain_with_index(&mut self, predicate: impl FnMut(usize, &T) -> bool);
}

impl<T> RetainIndex<T> for Vec<T> {
    fn retain_with_index(&mut self, mut predicate: impl FnMut(usize, &T) -> bool) {
        let mut index = 0;
        self.retain(|value| {
            let keep = predicate(index, value);
            index += 1;
            keep
        });
    }
}

#[derive(Clone, Copy)]
enum Segment {
    Line(Point, Point),
    Cubic(Point, [f64; 6]),
}

fn rounded_segments(w: f64, h: f64, r: f64) -> Vec<Segment> {
    let k = 2.0 / 3.0;
    vec![
        Segment::Line(Point { x: r, y: 0.0 }, Point { x: w - r, y: 0.0 }),
        Segment::Cubic(
            Point { x: w - r, y: 0.0 },
            [w - r + k * r, 0.0, w, r - k * r, w, r],
        ),
        Segment::Line(Point { x: w, y: r }, Point { x: w, y: h - r }),
        Segment::Cubic(
            Point { x: w, y: h - r },
            [w, h - r + k * r, w - r + k * r, h, w - r, h],
        ),
        Segment::Line(Point { x: w - r, y: h }, Point { x: r, y: h }),
        Segment::Cubic(
            Point { x: r, y: h },
            [r - k * r, h, 0.0, h - r + k * r, 0.0, h - r],
        ),
        Segment::Line(Point { x: 0.0, y: h - r }, Point { x: 0.0, y: r }),
        Segment::Cubic(
            Point { x: 0.0, y: r },
            [0.0, r - k * r, r - k * r, 0.0, r, 0.0],
        ),
        Segment::Line(Point { x: r, y: 0.0 }, Point { x: r, y: 0.0 }),
    ]
}

fn rough_segments(segments: &[Segment], options: &mut RoughOptions) -> Vec<Op> {
    let mut ops = Vec::new();
    for segment in segments {
        match *segment {
            Segment::Line(from, to) => ops.extend(double_line(from, to, options, false)),
            Segment::Cubic(from, curve) => {
                let passes = if options.disable_multi_stroke { 1 } else { 2 };
                for pass in 0..passes {
                    let reach = if pass == 0 { 2.0 } else { 2.3 };
                    let start = if pass == 0 {
                        from
                    } else {
                        Point {
                            x: from.x + options.offset(2.0, 1.0),
                            y: from.y + options.offset(2.0, 1.0),
                        }
                    };
                    ops.push(Op::Move(start));
                    let end = Point {
                        x: curve[4] + options.offset(reach, 1.0),
                        y: curve[5] + options.offset(reach, 1.0),
                    };
                    ops.push(Op::Curve([
                        curve[0] + options.offset(reach, 1.0),
                        curve[1] + options.offset(reach, 1.0),
                        curve[2] + options.offset(reach, 1.0),
                        curve[3] + options.offset(reach, 1.0),
                        end.x,
                        end.y,
                    ]));
                }
            }
        }
    }
    ops
}

fn rounded_outline_points(w: f64, h: f64, r: f64) -> Vec<Point> {
    let mut points = Vec::new();
    for index in 0..=8 {
        let angle = -PI / 2.0 + index as f64 * PI / 16.0;
        points.push(Point {
            x: w - r + r * angle.cos(),
            y: r + r * angle.sin(),
        });
    }
    for index in 0..=8 {
        let angle = index as f64 * PI / 16.0;
        points.push(Point {
            x: w - r + r * angle.cos(),
            y: h - r + r * angle.sin(),
        });
    }
    for index in 0..=8 {
        let angle = PI / 2.0 + index as f64 * PI / 16.0;
        points.push(Point {
            x: r + r * angle.cos(),
            y: h - r + r * angle.sin(),
        });
    }
    for index in 0..=8 {
        let angle = PI + index as f64 * PI / 16.0;
        points.push(Point {
            x: r + r * angle.cos(),
            y: r + r * angle.sin(),
        });
    }
    points
}

fn hachure_lines(points: &[Point], gap: f64, degrees: f64, step: f64) -> Vec<(Point, Point)> {
    #[derive(Clone)]
    struct Edge {
        ymin: f64,
        ymax: f64,
        x: f64,
        slope: f64,
    }
    let angle = degrees.to_radians();
    let (sin, cos) = angle.sin_cos();
    let rotate = |point: Point| Point {
        x: point.x * cos - point.y * sin,
        y: point.x * sin + point.y * cos,
    };
    let unrotate = |point: Point| Point {
        x: point.x * cos + point.y * sin,
        y: -point.x * sin + point.y * cos,
    };
    let rotated = points.iter().copied().map(rotate).collect::<Vec<_>>();
    let mut edges = Vec::new();
    for index in 0..rotated.len() {
        let first = rotated[index];
        let second = rotated[(index + 1) % rotated.len()];
        if first.y != second.y {
            let ymin = first.y.min(second.y);
            edges.push(Edge {
                ymin,
                ymax: first.y.max(second.y),
                x: if ymin == first.y { first.x } else { second.x },
                slope: (second.x - first.x) / (second.y - first.y),
            });
        }
    }
    edges.sort_by(|left, right| {
        left.ymin
            .total_cmp(&right.ymin)
            .then(left.x.total_cmp(&right.x))
            .then(left.ymax.total_cmp(&right.ymax))
    });
    if edges.is_empty() {
        return Vec::new();
    }
    let mut active: Vec<Edge> = Vec::new();
    let mut y = edges[0].ymin;
    let mut iteration = 0.0;
    let mut lines = Vec::new();
    while !active.is_empty() || !edges.is_empty() {
        let count = edges.iter().take_while(|edge| edge.ymin <= y).count();
        active.extend(edges.drain(0..count).map(|mut edge| {
            edge.x += 0.0;
            edge
        }));
        active.retain(|edge| edge.ymax > y);
        active.sort_by(|left, right| left.x.total_cmp(&right.x));
        if step != 1.0 || iteration % gap == 0.0 {
            for pair in active.chunks(2) {
                if pair.len() == 2 {
                    lines.push((
                        unrotate(Point {
                            x: pair[0].x.round(),
                            y,
                        }),
                        unrotate(Point {
                            x: pair[1].x.round(),
                            y,
                        }),
                    ));
                }
            }
        }
        y += step;
        for edge in &mut active {
            edge.x += step * edge.slope;
        }
        iteration += 1.0;
    }
    lines
}

fn freehand_path(element: &Map<String, Value>) -> String {
    let raw = element.get("points").and_then(Value::as_array).unwrap();
    let simulate = raw.iter().all(|point| point.as_array().unwrap().len() == 2);
    let points = raw
        .iter()
        .map(|point| {
            let point = point.as_array().unwrap();
            InputPoint::Array(
                [point[0].as_f64().unwrap(), point[1].as_f64().unwrap()],
                Some(point.get(2).and_then(Value::as_f64).unwrap_or(0.5)),
            )
        })
        .collect::<Vec<_>>();
    let options = StrokeOptions {
        size: Some(number(element, "strokeWidth") * 4.0 + 2.0),
        thinning: Some(0.6),
        smoothing: Some(0.5),
        streamline: Some(0.5),
        simulate_pressure: Some(simulate),
        ..StrokeOptions::default()
    };
    let mut outline = get_stroke(&points, &options);
    restore_freehand_end(&points, &options, &mut outline);
    if outline.is_empty() {
        return String::new();
    }
    let mut path = format!("M {} {}", js(outline[0][0]), js(outline[0][1]));
    for point in &outline[1..] {
        path.push_str(&format!(" L {} {}", js(point[0]), js(point[1])));
    }
    path.push_str(" Z");
    path
}

fn restore_freehand_end(
    points: &[InputPoint],
    options: &StrokeOptions,
    outline: &mut Vec<[f64; 2]>,
) {
    let stroke = get_stroke_points(points, options);
    if stroke.len() < 2 || outline.is_empty() {
        return;
    }
    let size = options.size.unwrap_or(16.0);
    let thinning = options.thinning.unwrap_or(0.5);
    let simulate = options.simulate_pressure.unwrap_or(true);
    let mut previous_pressure = stroke
        .iter()
        .take(10)
        .fold(stroke[0].pressure, |acc, point| {
            let pressure = if simulate {
                simulated_pressure(acc, point.distance, size)
            } else {
                point.pressure
            };
            (acc + pressure) / 2.0
        });
    let total = stroke.last().unwrap().running_length;
    let mut radius = size * (0.5 - thinning * (0.5 - stroke.last().unwrap().pressure));
    for (index, point) in stroke.iter().enumerate() {
        if index + 1 < stroke.len() && total - point.running_length < 3.0 {
            continue;
        }
        let pressure = if simulate {
            simulated_pressure(previous_pressure, point.distance, size)
        } else {
            point.pressure
        };
        radius = if thinning == 0.0 {
            size / 2.0
        } else {
            size * (0.5 - thinning * (0.5 - pressure))
        };
        previous_pressure = pressure;
    }
    let last = stroke.last().unwrap();
    let perpendicular = [last.vector[1], -last.vector[0]];
    let start = [
        last.point[0] - perpendicular[0] * radius,
        last.point[1] - perpendicular[1] * radius,
    ];
    let mut turn = 1.0 / 29.0;
    let mut missing = start;
    while turn < 1.0 {
        missing = rotate_array(start, last.point, (PI + 0.0001) * 3.0 * turn);
        turn += 1.0 / 29.0;
    }
    let (index, distance) = outline
        .iter()
        .enumerate()
        .map(|(index, point)| {
            let distance = (point[0] - missing[0]).powi(2) + (point[1] - missing[1]).powi(2);
            (index, distance)
        })
        .min_by(|left, right| left.1.total_cmp(&right.1))
        .unwrap();
    if distance > 1e-18 && distance < 0.1 {
        outline.insert(index, missing);
    }
}

fn rotate_array(point: [f64; 2], center: [f64; 2], angle: f64) -> [f64; 2] {
    let (sin, cos) = angle.sin_cos();
    let x = point[0] - center[0];
    let y = point[1] - center[1];
    [x * cos - y * sin + center[0], x * sin + y * cos + center[1]]
}

fn simulated_pressure(previous: f64, distance: f64, size: f64) -> f64 {
    let speed = (distance / size).min(1.0);
    let rate = (1.0 - speed).min(1.0);
    (previous + (rate - previous) * (speed * 0.275)).min(1.0)
}

fn arrow_head(tip: Point, from: Point, size: f64) -> [(Point, Point); 2] {
    let angle = (tip.y - from.y).atan2(tip.x - from.x);
    let spread = PI / 7.0;
    [
        (
            tip,
            Point {
                x: tip.x - size * (angle - spread).cos(),
                y: tip.y - size * (angle - spread).sin(),
            },
        ),
        (
            tip,
            Point {
                x: tip.x - size * (angle + spread).cos(),
                y: tip.y - size * (angle + spread).sin(),
            },
        ),
    ]
}

fn rounded_rect_path(w: f64, h: f64, radius: f64) -> String {
    let r = radius.min(w / 2.0).min(h / 2.0);
    format!(
        "M {} 0 L {} 0 Q {} 0 {} {} L {} {} Q {} {} {} {} L {} {} Q 0 {} 0 {} L 0 {} Q 0 0 {} 0 Z",
        js(r),
        js(w - r),
        js(w),
        js(w),
        js(r),
        js(w),
        js(h - r),
        js(w),
        js(h),
        js(w - r),
        js(h),
        js(r),
        js(h),
        js(h),
        js(h - r),
        js(r),
        js(r)
    )
}

fn ops_to_path(ops: &[Op]) -> String {
    ops.iter()
        .map(|op| match op {
            Op::Move(point) => format!("M{} {}", js(point.x), js(point.y)),
            Op::Curve(data) => format!(
                "C{} {}, {} {}, {} {}",
                js(data[0]),
                js(data[1]),
                js(data[2]),
                js(data[3]),
                js(data[4]),
                js(data[5])
            ),
            Op::Line(point) => format!("L{} {}", js(point.x), js(point.y)),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn render_path(
    d: String,
    stroke: Option<Value>,
    fill: Option<Value>,
    stroke_width: f64,
    dash: Option<Vec<f64>>,
) -> Value {
    json!({ "d": d, "stroke": stroke, "fill": fill, "strokeWidth": stroke_width, "dash": dash })
}

fn color(tone: &str, palette: &str) -> Value {
    json!({ "tone": tone, "palette": palette })
}

fn dash(element: &Map<String, Value>) -> Option<Vec<f64>> {
    let width = number(element, "strokeWidth");
    match element.get("strokeStyle").and_then(Value::as_str) {
        Some("dashed") => Some(vec![width * 4.0, width * 4.0]),
        Some("dotted") => Some(vec![width, width * 3.0]),
        _ => None,
    }
}

fn points(element: &Map<String, Value>) -> Vec<Point> {
    element["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(|point| {
            let point = point.as_array().unwrap();
            Point {
                x: point[0].as_f64().unwrap(),
                y: point[1].as_f64().unwrap(),
            }
        })
        .collect()
}

fn string<'a>(object: &'a Map<String, Value>, key: &str) -> &'a str {
    object.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn number(object: &Map<String, Value>, key: &str) -> f64 {
    object.get(key).and_then(Value::as_f64).unwrap_or_default()
}

fn optional_number(object: &Map<String, Value>, key: &str, default: f64) -> f64 {
    object.get(key).and_then(Value::as_f64).unwrap_or(default)
}

fn js(value: f64) -> String {
    if value == 0.0 {
        "0".to_owned()
    } else if value.abs() < 1e-6 || value.abs() >= 1e21 {
        let mut text = format!("{value:e}");
        if let Some(at) = text.find('e') {
            if !text[at + 1..].starts_with('-') && !text[at + 1..].starts_with('+') {
                text.insert(at + 1, '+');
            }
        }
        text
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renderer_matches_typescript_oracle() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("fixtures/render-oracle.json")).unwrap();
        for case in &cases {
            let actual = if case["kind"] == "drawing" {
                render_drawing(&case["input"]).unwrap()
            } else {
                render_diagram(&case["input"]).unwrap()
            };
            compare(&actual, &case["output"], &format!("{}", case["name"]));
        }
    }

    #[test]
    fn diagram_renderer_matches_typescript_oracle() {
        let cases: Vec<Value> =
            serde_json::from_str(include_str!("fixtures/diagram-oracle.json")).unwrap();
        for case in &cases {
            let actual = render_diagram(&case["input"]).unwrap();
            compare(&actual, &case["output"], &format!("{}", case["name"]));
        }
    }

    fn compare(actual: &Value, expected: &Value, path: &str) {
        match (actual, expected) {
            (Value::Number(left), Value::Number(right)) => assert!(
                (left.as_f64().unwrap() - right.as_f64().unwrap()).abs() < 1e-9,
                "{path}: {left} != {right}"
            ),
            (Value::Array(left), Value::Array(right)) => {
                assert_eq!(left.len(), right.len(), "{path}: array length");
                for (index, (left, right)) in left.iter().zip(right).enumerate() {
                    compare(left, right, &format!("{path}[{index}]"));
                }
            }
            (Value::Object(left), Value::Object(right)) => {
                assert_eq!(left.len(), right.len(), "{path}: object size");
                for (key, right) in right {
                    if key == "d" {
                        compare_path(left[key].as_str().unwrap(), right.as_str().unwrap(), path);
                    } else {
                        compare(&left[key], right, &format!("{path}.{key}"));
                    }
                }
            }
            _ => assert_eq!(actual, expected, "{path}"),
        }
    }

    fn compare_path(actual: &str, expected: &str, path: &str) {
        let number = regex::Regex::new(r"-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?").unwrap();
        let actual_shape = number.replace_all(actual, "#");
        let expected_shape = number.replace_all(expected, "#");
        assert_eq!(actual_shape, expected_shape, "{path}.d commands");
        let actual_numbers = number
            .find_iter(actual)
            .map(|value| value.as_str().parse::<f64>().unwrap());
        let expected_numbers = number
            .find_iter(expected)
            .map(|value| value.as_str().parse::<f64>().unwrap());
        for (index, (left, right)) in actual_numbers.zip(expected_numbers).enumerate() {
            assert!(
                (left - right).abs() < 1e-9,
                "{path}.d[{index}]: {left} != {right}"
            );
        }
    }
}
