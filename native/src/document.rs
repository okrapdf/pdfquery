use std::collections::{BTreeMap, HashMap, HashSet};

use lopdf::{decode_text_string, Dictionary, Document, Object, ObjectId};
use serde_json::{Map, Number, Value};
use thiserror::Error;

use crate::selector::{self, SelectorNode};

const MAX_DEPTH: usize = 96;
const MAX_NODES: usize = 50_000;
const MAX_STRUCTURE_WORK: usize = 100_000;

#[derive(Debug, Error)]
pub enum PdfQueryError {
    #[error("PDF has no StructTreeRoot; PDF DOM only supports tagged PDFs.")]
    Untagged,
    #[error("{0}")]
    Pdf(String),
    #[error("PDF structure exceeds the supported complexity limit")]
    ComplexityLimit,
    #[error(transparent)]
    Selector(#[from] selector::SelectorSyntaxError),
}

#[derive(Debug, Clone)]
enum Kid {
    Node(usize),
    Content(ContentRef),
}

#[derive(Debug, Clone)]
struct ContentRef {
    kind: &'static str,
    page: Option<u32>,
    mcid: Option<i64>,
    object_ref: Option<String>,
    stream_ref: Option<String>,
}

#[derive(Debug, Clone)]
struct StructureNode {
    id: String,
    role: String,
    raw_role: String,
    parent: Option<usize>,
    children: Vec<usize>,
    kids: Vec<Kid>,
    title: Option<String>,
    alt_text: Option<String>,
    actual_text: Option<String>,
    language: Option<String>,
    expanded_text: Option<String>,
    raw_attributes: Map<String, Value>,
    attribute_objects: Map<String, Value>,
    structure_bbox: Option<[f64; 4]>,
    structure_page: Option<u32>,
    text: String,
    own_text: String,
    pages: Vec<u32>,
    mcids: Vec<i64>,
    boxes: Vec<PdfBox>,
}

#[derive(Debug, Clone)]
struct PdfBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    page: u32,
    source: &'static str,
}

#[derive(Debug, Clone)]
struct PageInfo {
    page: u32,
    width: f64,
    height: f64,
    transform: [f64; 6],
    identity_top_left: bool,
    font_ascents: HashMap<String, f64>,
    cid_fonts: HashSet<String>,
}

#[derive(Debug, Clone, Default)]
struct ExtractionGuard {
    work: usize,
}

impl ExtractionGuard {
    fn charge(&mut self, amount: usize) -> Result<(), PdfQueryError> {
        self.work = self.work.saturating_add(amount);
        if self.work > MAX_STRUCTURE_WORK {
            Err(PdfQueryError::ComplexityLimit)
        } else {
            Ok(())
        }
    }
}

#[derive(Debug, Clone, Default)]
struct ResolvedContent {
    text: String,
    boxes: Vec<PdfBox>,
    last_y: Option<f64>,
    last_height: f64,
}

type ResolvedText = (
    HashMap<(u32, i64), ResolvedContent>,
    HashMap<u32, String>,
    Vec<Value>,
);

pub struct QueryResult<'a> {
    pub result_ids: Vec<&'a str>,
    pub diagnostics: &'a [Value],
    pub handles: &'a [Value],
}

pub struct ParsedDocument {
    universe: Vec<SelectorNode>,
    handles: Vec<Value>,
    diagnostics: Vec<Value>,
}

impl ParsedDocument {
    pub fn query(&self, selector_text: &str) -> Result<QueryResult<'_>, PdfQueryError> {
        let matches = selector::query(&self.universe, selector_text)?;
        Ok(QueryResult {
            result_ids: matches
                .into_iter()
                .filter_map(|index| self.universe.get(index).map(|node| node.id.as_str()))
                .collect(),
            diagnostics: &self.diagnostics,
            handles: &self.handles,
        })
    }
}

pub fn open_pdf(bytes: &[u8]) -> Result<ParsedDocument, PdfQueryError> {
    let document =
        Document::load_mem(bytes).map_err(|error| PdfQueryError::Pdf(error.to_string()))?;
    if document.is_encrypted() {
        return Err(PdfQueryError::Pdf(
            "encrypted PDFs require a password and are not supported".to_owned(),
        ));
    }

    let pages = read_pages(&document)?;
    let mut nodes = build_structure(&document, &pages)?;
    let (resolved, page_text, diagnostics) = resolve_text(&document, &pages)?;
    resolve_nodes(&mut nodes, &resolved, &pages, 0);

    let mut universe = Vec::with_capacity(pages.len() + nodes.len());
    let mut serialized = Vec::with_capacity(pages.len() + nodes.len());
    for page in &pages {
        let text = page_text
            .get(&page.page)
            .cloned()
            .unwrap_or_else(|| text_for_page(&nodes, page.page));
        universe.push(SelectorNode {
            id: format!("page-{}", page.page),
            role: Some("page".to_owned()),
            raw_role: Some("page".to_owned()),
            text: text.clone(),
            page: Some(page.page),
            pages: vec![page.page],
            attributes: page_selector_attributes(page, &text),
            parent: None,
            children: Vec::new(),
            virtual_page: true,
        });
        serialized.push(page_json(page, &text));
    }

    let structure_offset = universe.len();
    for node in &nodes {
        universe.push(SelectorNode {
            id: node.id.clone(),
            role: Some(node.role.clone()),
            raw_role: Some(node.raw_role.clone()),
            text: node.text.clone(),
            page: single_page(&node.pages),
            pages: node.pages.clone(),
            attributes: Value::Object(selector_attributes(node)),
            parent: node.parent.map(|parent| structure_offset + parent),
            children: node
                .children
                .iter()
                .map(|child| structure_offset + child)
                .collect(),
            virtual_page: false,
        });
        serialized.push(node_json(node));
    }
    materialize_relationship_ids(&mut serialized, &nodes, structure_offset);

    // The public CLI serializes `toJSON()` snapshots, but `--attribute` reads
    // properties from the live pdfdom-style handles. Keep the two shapes
    // separate so relationship properties can remain objects at runtime while
    // their JSON representation stays stable IDs.
    let handles = universe
        .iter()
        .zip(serialized.iter())
        .enumerate()
        .map(|(index, (selector_node, snapshot))| {
            if index < structure_offset {
                page_handle_json(selector_node, snapshot)
            } else {
                node_handle_json(&nodes[index - structure_offset], snapshot)
            }
        })
        .collect();

    Ok(ParsedDocument {
        universe,
        handles,
        diagnostics,
    })
}

fn build_structure(
    document: &Document,
    pages: &[PageInfo],
) -> Result<Vec<StructureNode>, PdfQueryError> {
    let catalog = document
        .catalog()
        .map_err(|error| PdfQueryError::Pdf(error.to_string()))?;
    let raw_root = catalog
        .get(b"StructTreeRoot")
        .map_err(|_| PdfQueryError::Untagged)?;
    let root_dict = resolve_dict(document, raw_root).ok_or(PdfQueryError::Untagged)?;
    let role_map = read_role_map(document, root_dict);
    let page_by_id: HashMap<ObjectId, u32> = document
        .get_pages()
        .into_iter()
        .map(|(page, id)| (id, page))
        .collect();

    let mut nodes = vec![StructureNode {
        id: object_id(raw_root, "struct-root"),
        role: "Root".to_owned(),
        raw_role: "StructTreeRoot".to_owned(),
        parent: None,
        children: Vec::new(),
        kids: Vec::new(),
        title: None,
        alt_text: None,
        actual_text: None,
        language: None,
        expanded_text: None,
        raw_attributes: read_raw_attributes(root_dict),
        attribute_objects: Map::new(),
        structure_bbox: None,
        structure_page: None,
        text: String::new(),
        own_text: String::new(),
        pages: Vec::new(),
        mcids: Vec::new(),
        boxes: Vec::new(),
    }];
    let mut state = BuildState {
        document,
        role_map,
        page_by_id,
        nodes: &mut nodes,
        active_refs: HashSet::new(),
        next_id: 0,
        guard: ExtractionGuard::default(),
    };
    if let Object::Reference(id) = raw_root {
        state.active_refs.insert(*id);
    }
    let root_kids = root_dict.get(b"K").ok().cloned();
    let kids = match root_kids.as_ref() {
        Some(value) => read_kids(value, None, Some(0), 0, &mut state)?,
        None => Vec::new(),
    };
    state.nodes[0].children = kids
        .iter()
        .filter_map(|kid| match kid {
            Kid::Node(index) => Some(*index),
            _ => None,
        })
        .collect();
    state.nodes[0].kids = kids;
    let _ = pages;
    Ok(nodes)
}

struct BuildState<'a, 'b> {
    document: &'a Document,
    role_map: HashMap<String, String>,
    page_by_id: HashMap<ObjectId, u32>,
    nodes: &'b mut Vec<StructureNode>,
    active_refs: HashSet<ObjectId>,
    next_id: usize,
    guard: ExtractionGuard,
}

fn read_kids(
    raw: &Object,
    inherited_page: Option<u32>,
    parent: Option<usize>,
    depth: usize,
    state: &mut BuildState<'_, '_>,
) -> Result<Vec<Kid>, PdfQueryError> {
    if depth > MAX_DEPTH || state.nodes.len() >= MAX_NODES {
        return Err(PdfQueryError::ComplexityLimit);
    }
    state.guard.charge(1)?;
    let resolved = match resolve_object(state.document, raw) {
        Some(value) => value,
        None => return Ok(Vec::new()),
    };
    match resolved {
        Object::Null => Ok(Vec::new()),
        Object::Array(values) => {
            let mut kids = Vec::new();
            for value in values {
                state.guard.charge(1)?;
                kids.extend(read_kids(value, inherited_page, parent, depth + 1, state)?);
            }
            Ok(kids)
        }
        Object::Integer(mcid) => Ok(vec![Kid::Content(ContentRef {
            kind: "content",
            page: inherited_page,
            mcid: Some(*mcid),
            object_ref: None,
            stream_ref: None,
        })]),
        Object::Dictionary(dict) | Object::Stream(lopdf::Stream { dict, .. }) => {
            let kind = read_name(state.document, dict, b"Type");
            let page = read_page_number(dict.get(b"Pg").ok(), inherited_page, state);
            if kind.as_deref() == Some("MCR") {
                return Ok(read_integer(state.document, dict, b"MCID")
                    .map(|mcid| {
                        vec![Kid::Content(ContentRef {
                            kind: "content",
                            page,
                            mcid: Some(mcid),
                            object_ref: None,
                            stream_ref: dict.get(b"Stm").ok().and_then(reference_string),
                        })]
                    })
                    .unwrap_or_default());
            }
            if kind.as_deref() == Some("OBJR") {
                let target = dict.get(b"Obj").ok();
                let target_dict = target.and_then(|value| resolve_dict(state.document, value));
                let annotation = target_dict.is_some_and(|value| {
                    read_name(state.document, value, b"Type").as_deref() == Some("Annot")
                        || value.has(b"Subtype")
                });
                return Ok(vec![Kid::Content(ContentRef {
                    kind: if annotation { "annotation" } else { "object" },
                    page,
                    mcid: None,
                    object_ref: target.and_then(reference_string),
                    stream_ref: None,
                })]);
            }
            let Some(raw_role) = read_name(state.document, dict, b"S") else {
                return Ok(Vec::new());
            };
            let role = state
                .role_map
                .get(&raw_role)
                .cloned()
                .unwrap_or_else(|| raw_role.clone());
            let reference = match raw {
                Object::Reference(id) => Some(*id),
                _ => None,
            };
            if reference.is_some_and(|id| state.active_refs.contains(&id)) {
                return Ok(Vec::new());
            }
            if let Some(id) = reference {
                state.active_refs.insert(id);
            }

            let index = state.nodes.len();
            let fallback = format!("struct-{}", state.next_id);
            state.next_id += 1;
            state.nodes.push(StructureNode {
                id: object_id(raw, &fallback),
                role,
                raw_role,
                parent,
                children: Vec::new(),
                kids: Vec::new(),
                title: read_text(state.document, dict, b"T"),
                alt_text: read_text(state.document, dict, b"Alt"),
                actual_text: read_text(state.document, dict, b"ActualText"),
                language: read_text(state.document, dict, b"Lang"),
                expanded_text: read_text(state.document, dict, b"E"),
                raw_attributes: read_raw_attributes(dict),
                attribute_objects: dict
                    .get(b"A")
                    .ok()
                    .map(|value| read_attribute_objects(state.document, value))
                    .unwrap_or_default(),
                structure_bbox: dict
                    .get(b"A")
                    .ok()
                    .and_then(|value| read_structure_bbox(state.document, value)),
                structure_page: page,
                text: String::new(),
                own_text: String::new(),
                pages: Vec::new(),
                mcids: Vec::new(),
                boxes: Vec::new(),
            });
            let child_raw = dict.get(b"K").ok().cloned();
            let kids = match child_raw.as_ref() {
                Some(value) => read_kids(value, page, Some(index), depth + 1, state)?,
                None => Vec::new(),
            };
            state.nodes[index].children = kids
                .iter()
                .filter_map(|kid| match kid {
                    Kid::Node(child) => Some(*child),
                    _ => None,
                })
                .collect();
            state.nodes[index].kids = kids;
            if let Some(id) = reference {
                state.active_refs.remove(&id);
            }
            Ok(vec![Kid::Node(index)])
        }
        _ => Ok(Vec::new()),
    }
}

fn resolve_text(document: &Document, pages: &[PageInfo]) -> Result<ResolvedText, PdfQueryError> {
    let mut resolved: HashMap<(u32, i64), ResolvedContent> = HashMap::new();
    let mut page_parts: HashMap<u32, ResolvedContent> = pages
        .iter()
        .map(|page| (page.page, ResolvedContent::default()))
        .collect();
    let mut diagnostics = Vec::new();
    let items = match pdf_inspector::extractor::extract_text_with_positions_from_document_options(
        document, None, true,
    ) {
        Ok(items) => items,
        Err(error) => {
            if matches!(error, pdf_inspector::PdfError::ResourceLimit(_)) {
                return Err(PdfQueryError::Pdf(error.to_string()));
            }
            let mut recovered_items = Vec::new();
            for page in pages {
                let filter = HashSet::from([page.page]);
                match pdf_inspector::extractor::extract_text_with_positions_from_document_options(
                    document,
                    Some(&filter),
                    true,
                ) {
                    Ok(items) => recovered_items.extend(items),
                    Err(error) if matches!(error, pdf_inspector::PdfError::ResourceLimit(_)) => {
                        return Err(PdfQueryError::Pdf(error.to_string()));
                    }
                    Err(error) => {
                        let mut diagnostic = Map::new();
                        diagnostic.insert("level".to_owned(), Value::String("warning".to_owned()));
                        diagnostic.insert("page".to_owned(), Value::from(page.page));
                        diagnostic.insert(
                            "message".to_owned(),
                            Value::String(format!(
                                "Could not resolve marked-content text for page {}: {error}",
                                page.page
                            )),
                        );
                        diagnostics.push(Value::Object(diagnostic));
                    }
                }
            }
            recovered_items
        }
    };

    let page_map: HashMap<u32, &PageInfo> = pages.iter().map(|page| (page.page, page)).collect();
    for item in items {
        if !matches!(item.item_type, pdf_inspector::types::ItemType::Text) {
            continue;
        }
        if !item.text.is_empty() {
            append_text_item(page_parts.entry(item.page).or_default(), &item);
        }
        let Some(mcid) = item.mcid else { continue };
        let content = resolved.entry((item.page, mcid)).or_default();
        if !item.text.is_empty() {
            append_text_item(content, &item);
        }
        if let Some(page) = page_map.get(&item.page) {
            if let Some(bbox) = text_item_box(&item, page) {
                content.boxes.push(bbox);
            }
        }
    }
    let page_text = page_parts
        .into_iter()
        .map(|(page, content)| (page, content.text))
        .collect();
    Ok((resolved, page_text, diagnostics))
}

fn append_text_item(content: &mut ResolvedContent, item: &pdf_inspector::TextItem) {
    append_positioned_text(
        content,
        &item.text,
        clean_number(item.y as f64),
        clean_number(item.height as f64).abs(),
    );
}

fn append_positioned_text(content: &mut ResolvedContent, text: &str, y: f64, height: f64) {
    let starts_new_line = content.last_y.is_some_and(|last_y| {
        let threshold = (content.last_height.max(height) * 0.5).max(1.0);
        (last_y - y).abs() > threshold
    });
    if starts_new_line {
        let next = join_text([text]);
        if !next.is_empty() {
            if !content.text.is_empty() {
                content.text.push('\n');
            }
            content.text.push_str(&next);
        }
    } else {
        content.text = join_text([content.text.as_str(), text]);
    }
    content.last_y = Some(y);
    content.last_height = height;
}

fn resolve_nodes(
    nodes: &mut [StructureNode],
    content: &HashMap<(u32, i64), ResolvedContent>,
    pages: &[PageInfo],
    index: usize,
) {
    let child_indices = nodes[index].children.clone();
    for child in child_indices {
        resolve_nodes(nodes, content, pages, child);
    }

    let kids = nodes[index].kids.clone();
    let mut own_parts = Vec::new();
    let mut aggregate_parts = Vec::new();
    let mut page_numbers = Vec::new();
    let mut direct_mcids = Vec::new();
    let mut boxes: BTreeMap<u32, Vec<PdfBox>> = BTreeMap::new();
    for kid in kids {
        match kid {
            Kid::Node(child) => {
                if !nodes[child].text.is_empty() {
                    aggregate_parts.push(nodes[child].text.clone());
                }
                page_numbers.extend(nodes[child].pages.iter().copied());
                for bbox in &nodes[child].boxes {
                    boxes.entry(bbox.page).or_default().push(bbox.clone());
                }
            }
            Kid::Content(reference) => {
                if let Some(page) = reference.page {
                    page_numbers.push(page);
                }
                if reference.kind != "content" {
                    continue;
                }
                let (Some(page), Some(mcid)) = (reference.page, reference.mcid) else {
                    continue;
                };
                direct_mcids.push(mcid);
                if let Some(value) = content.get(&(page, mcid)) {
                    if !value.text.is_empty() {
                        own_parts.push(value.text.clone());
                        aggregate_parts.push(value.text.clone());
                    }
                    for bbox in &value.boxes {
                        boxes.entry(bbox.page).or_default().push(bbox.clone());
                    }
                }
            }
        }
    }
    if let Some(page) = nodes[index].structure_page {
        page_numbers.push(page);
    }
    page_numbers.sort_unstable();
    page_numbers.dedup();
    let mut seen_mcids = HashSet::new();
    direct_mcids.retain(|mcid| seen_mcids.insert(*mcid));

    if let (Some(rectangle), Some(page_number)) =
        (nodes[index].structure_bbox, nodes[index].structure_page)
    {
        if let Some(page) = pages.iter().find(|page| page.page == page_number) {
            if let Some(bbox) = normalize_pdf_rectangle(rectangle, page) {
                boxes.insert(page_number, vec![bbox]);
            }
        }
    }
    let unioned = boxes
        .into_iter()
        .filter_map(|(page, boxes)| union_boxes(page, &boxes))
        .collect();
    nodes[index].own_text = nodes[index]
        .actual_text
        .clone()
        .unwrap_or_else(|| join_text(own_parts.iter().map(String::as_str)));
    nodes[index].text = nodes[index]
        .actual_text
        .clone()
        .unwrap_or_else(|| join_text(aggregate_parts.iter().map(String::as_str)));
    nodes[index].pages = page_numbers;
    nodes[index].mcids = direct_mcids;
    nodes[index].boxes = unioned;
}

fn read_pages(document: &Document) -> Result<Vec<PageInfo>, PdfQueryError> {
    document
        .get_pages()
        .into_iter()
        .map(|(page, id)| {
            let dict = document
                .get_dictionary(id)
                .map_err(|error| PdfQueryError::Pdf(error.to_string()))?;
            let media_box = inherited_object(document, dict, b"MediaBox")
                .and_then(|value| page_box(document, value))
                .unwrap_or([0.0, 0.0, 612.0, 792.0]);
            let crop_box = inherited_object(document, dict, b"CropBox")
                .and_then(|value| page_box(document, value))
                .unwrap_or(media_box);
            let view_box = intersect_page_boxes(media_box, crop_box).unwrap_or(media_box);
            let rotation = inherited_object(document, dict, b"Rotate")
                .and_then(|value| number_value(document, value))
                .unwrap_or(0.0) as i32;
            let user_unit = inherited_object(document, dict, b"UserUnit")
                .and_then(|value| number_value(document, value))
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or(1.0);
            let (width, height, transform) = page_viewport(view_box, user_unit, rotation);
            let (font_ascents, cid_fonts) = read_font_info(document, id);
            Ok(PageInfo {
                page,
                width,
                height,
                transform,
                identity_top_left: rotation.rem_euclid(360) == 0
                    && user_unit == 1.0
                    && view_box[0] == 0.0
                    && view_box[1] == 0.0,
                font_ascents,
                cid_fonts,
            })
        })
        .collect()
}

fn page_box(document: &Document, value: &Object) -> Option<[f64; 4]> {
    let values = number_array(document, value)?;
    if values.len() < 4 || values[..4].iter().any(|value| !value.is_finite()) {
        return None;
    }
    Some([
        values[0].min(values[2]),
        values[1].min(values[3]),
        values[0].max(values[2]),
        values[1].max(values[3]),
    ])
}

fn intersect_page_boxes(media: [f64; 4], crop: [f64; 4]) -> Option<[f64; 4]> {
    let intersection = [
        media[0].max(crop[0]),
        media[1].max(crop[1]),
        media[2].min(crop[2]),
        media[3].min(crop[3]),
    ];
    (intersection[2] > intersection[0] && intersection[3] > intersection[1]).then_some(intersection)
}

fn page_viewport(view_box: [f64; 4], user_unit: f64, rotation: i32) -> (f64, f64, [f64; 6]) {
    let center_x = (view_box[2] + view_box[0]) / 2.0;
    let center_y = (view_box[3] + view_box[1]) / 2.0;
    let normalized_rotation = rotation.rem_euclid(360);
    let (rotate_a, rotate_b, rotate_c, rotate_d) = match normalized_rotation {
        90 => (0.0, 1.0, 1.0, 0.0),
        180 => (-1.0, 0.0, 0.0, 1.0),
        270 => (0.0, -1.0, -1.0, 0.0),
        _ => (1.0, 0.0, 0.0, -1.0),
    };
    let (offset_x, offset_y, width, height) = if rotate_a == 0.0 {
        (
            (center_y - view_box[1]).abs() * user_unit,
            (center_x - view_box[0]).abs() * user_unit,
            (view_box[3] - view_box[1]).abs() * user_unit,
            (view_box[2] - view_box[0]).abs() * user_unit,
        )
    } else {
        (
            (center_x - view_box[0]).abs() * user_unit,
            (center_y - view_box[1]).abs() * user_unit,
            (view_box[2] - view_box[0]).abs() * user_unit,
            (view_box[3] - view_box[1]).abs() * user_unit,
        )
    };
    let transform = [
        rotate_a * user_unit,
        rotate_b * user_unit,
        rotate_c * user_unit,
        rotate_d * user_unit,
        offset_x - rotate_a * user_unit * center_x - rotate_c * user_unit * center_y,
        offset_y - rotate_b * user_unit * center_x - rotate_d * user_unit * center_y,
    ];
    (width, height, transform)
}

fn transform_point(transform: [f64; 6], x: f64, y: f64) -> (f64, f64) {
    (
        transform[0] * x + transform[2] * y + transform[4],
        transform[1] * x + transform[3] * y + transform[5],
    )
}

fn read_font_info(
    document: &Document,
    page_id: ObjectId,
) -> (HashMap<String, f64>, HashSet<String>) {
    let mut cid_fonts = HashSet::new();
    let mut ascents: HashMap<String, f64> = document
        .get_page_fonts(page_id)
        .unwrap_or_default()
        .into_iter()
        .map(|(resource, font)| {
            let resource = String::from_utf8_lossy(&resource).into_owned();
            if is_cid_font(document, font) {
                cid_fonts.insert(resource.clone());
            }
            (resource, font_ascent(document, font))
        })
        .collect();
    if let Ok((inline, references)) = document.get_page_resources(page_id) {
        let mut active_forms = HashSet::new();
        if let Some(resources) = inline {
            collect_form_font_info(
                document,
                resources,
                &mut ascents,
                &mut cid_fonts,
                &mut active_forms,
                0,
            );
        }
        for id in references {
            if let Ok(resources) = document.get_dictionary(id) {
                collect_form_font_info(
                    document,
                    resources,
                    &mut ascents,
                    &mut cid_fonts,
                    &mut active_forms,
                    0,
                );
            }
        }
    }
    (ascents, cid_fonts)
}

fn collect_form_font_info(
    document: &Document,
    resources: &Dictionary,
    ascents: &mut HashMap<String, f64>,
    cid_fonts: &mut HashSet<String>,
    active_forms: &mut HashSet<ObjectId>,
    depth: usize,
) {
    if depth > MAX_DEPTH {
        return;
    }
    let Some(xobjects) = resources
        .get(b"XObject")
        .ok()
        .and_then(|value| resolve_dict(document, value))
    else {
        return;
    };
    for (_, raw) in xobjects.iter() {
        let Ok(id) = raw.as_reference() else {
            continue;
        };
        if !active_forms.insert(id) {
            continue;
        }
        let Some(stream) = resolve_object(document, raw).and_then(|value| value.as_stream().ok())
        else {
            active_forms.remove(&id);
            continue;
        };
        let is_form = read_name(document, &stream.dict, b"Subtype").as_deref() == Some("Form");
        if is_form {
            if let Some(form_resources) = stream
                .dict
                .get(b"Resources")
                .ok()
                .and_then(|value| resolve_dict(document, value))
            {
                collect_resource_font_info(document, form_resources, ascents, cid_fonts);
                collect_form_font_info(
                    document,
                    form_resources,
                    ascents,
                    cid_fonts,
                    active_forms,
                    depth + 1,
                );
            }
        }
        active_forms.remove(&id);
    }
}

fn collect_resource_font_info(
    document: &Document,
    resources: &Dictionary,
    ascents: &mut HashMap<String, f64>,
    cid_fonts: &mut HashSet<String>,
) {
    let Some(fonts) = resources
        .get(b"Font")
        .ok()
        .and_then(|value| resolve_dict(document, value))
    else {
        return;
    };
    for (resource, raw_font) in fonts.iter() {
        let Some(font) = resolve_dict(document, raw_font) else {
            continue;
        };
        let resource = String::from_utf8_lossy(resource).into_owned();
        if is_cid_font(document, font) {
            cid_fonts.insert(resource.clone());
        }
        ascents
            .entry(resource)
            .or_insert_with(|| font_ascent(document, font));
    }
}

fn font_ascent(document: &Document, font: &Dictionary) -> f64 {
    let metrics_font = if is_cid_font(document, font) {
        font.get(b"DescendantFonts")
            .ok()
            .and_then(|value| resolve_object(document, value))
            .and_then(|value| value.as_array().ok())
            .and_then(|values| values.first())
            .and_then(|value| resolve_dict(document, value))
            .unwrap_or(font)
    } else {
        font
    };
    let base_name = metrics_font
        .get(b"BaseFont")
        .ok()
        .and_then(|value| read_name_object(document, value))
        .unwrap_or_default();
    metrics_font
        .get(b"FontDescriptor")
        .ok()
        .and_then(|value| resolve_dict(document, value))
        .and_then(|descriptor| descriptor.get(b"Ascent").ok())
        .and_then(|value| number_value(document, value))
        .map(|value| value / 1000.0)
        .or_else(|| base14_ascent(&base_name))
        .unwrap_or(0.8)
}

fn is_cid_font(document: &Document, font: &Dictionary) -> bool {
    read_name(document, font, b"Subtype").as_deref() == Some("Type0")
}

fn text_item_box(item: &pdf_inspector::TextItem, page: &PageInfo) -> Option<PdfBox> {
    let width = if page.cid_fonts.contains(&item.font) {
        item.width as f64
    } else {
        clean_number(item.width as f64)
    };
    let height = clean_number(item.height as f64);
    let x = clean_number(item.x as f64);
    let y = clean_number(item.y as f64);
    if width <= 0.0 || height <= 0.0 || page.width <= 0.0 || page.height <= 0.0 {
        return None;
    }
    let ascent = page.font_ascents.get(&item.font).copied().unwrap_or(0.8);
    let item_transform = item.transform.map(f64::from);
    let item_has_rotation =
        item_transform[1].abs() > f64::EPSILON || item_transform[2].abs() > f64::EPSILON;
    if page.identity_top_left && !item_has_rotation {
        let top = page.height - y - height * ascent;
        return Some(PdfBox {
            x: clamp01(x / page.width),
            y: clamp01(top / page.height),
            width: (clamp01((x + width) / page.width) - clamp01(x / page.width)).max(0.0),
            height: (clamp01((top + height) / page.height) - clamp01(top / page.height)).max(0.0),
            page: page.page,
            source: "text",
        });
    }
    let combined = multiply_transforms(page.transform, item_transform);
    let viewport_x = combined[4];
    let viewport_baseline = combined[5];
    let font_height = combined[2].hypot(combined[3]);
    if ![viewport_x, viewport_baseline, width, font_height]
        .into_iter()
        .all(f64::is_finite)
        || font_height <= 0.0
    {
        return None;
    }
    let angle = combined[1].atan2(combined[0]);
    let font_ascent = font_height * ascent;
    let left = viewport_x + font_ascent * angle.sin();
    let top = viewport_baseline - font_ascent * angle.cos();
    let width_vector = (angle.cos() * width, angle.sin() * width);
    let height_vector = (-angle.sin() * font_height, angle.cos() * font_height);
    let points = [
        (left, top),
        (left + width_vector.0, top + width_vector.1),
        (left + height_vector.0, top + height_vector.1),
        (
            left + width_vector.0 + height_vector.0,
            top + width_vector.1 + height_vector.1,
        ),
    ];
    let min_x = points
        .iter()
        .map(|point| point.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = points
        .iter()
        .map(|point| point.1)
        .fold(f64::INFINITY, f64::min);
    let max_x = points
        .iter()
        .map(|point| point.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = points
        .iter()
        .map(|point| point.1)
        .fold(f64::NEG_INFINITY, f64::max);
    Some(PdfBox {
        x: clamp01(min_x / page.width),
        y: clamp01(min_y / page.height),
        width: (clamp01(max_x / page.width) - clamp01(min_x / page.width)).max(0.0),
        height: (clamp01(max_y / page.height) - clamp01(min_y / page.height)).max(0.0),
        page: page.page,
        source: "text",
    })
}

fn multiply_transforms(left: [f64; 6], right: [f64; 6]) -> [f64; 6] {
    [
        left[0] * right[0] + left[2] * right[1],
        left[1] * right[0] + left[3] * right[1],
        left[0] * right[2] + left[2] * right[3],
        left[1] * right[2] + left[3] * right[3],
        left[0] * right[4] + left[2] * right[5] + left[4],
        left[1] * right[4] + left[3] * right[5] + left[5],
    ]
}

fn normalize_pdf_rectangle(rectangle: [f64; 4], page: &PageInfo) -> Option<PdfBox> {
    if page.width <= 0.0 || page.height <= 0.0 || rectangle.iter().any(|value| !value.is_finite()) {
        return None;
    }
    let left = rectangle[0].min(rectangle[2]);
    let right = rectangle[0].max(rectangle[2]);
    let bottom = rectangle[1].min(rectangle[3]);
    let top = rectangle[1].max(rectangle[3]);
    let points = [
        transform_point(page.transform, left, bottom),
        transform_point(page.transform, left, top),
        transform_point(page.transform, right, bottom),
        transform_point(page.transform, right, top),
    ];
    let min_x = points
        .iter()
        .map(|point| point.0)
        .fold(f64::INFINITY, f64::min);
    let min_y = points
        .iter()
        .map(|point| point.1)
        .fold(f64::INFINITY, f64::min);
    let max_x = points
        .iter()
        .map(|point| point.0)
        .fold(f64::NEG_INFINITY, f64::max);
    let max_y = points
        .iter()
        .map(|point| point.1)
        .fold(f64::NEG_INFINITY, f64::max);
    Some(PdfBox {
        x: clamp01(min_x / page.width),
        y: clamp01(min_y / page.height),
        width: (clamp01(max_x / page.width) - clamp01(min_x / page.width)).max(0.0),
        height: (clamp01(max_y / page.height) - clamp01(min_y / page.height)).max(0.0),
        page: page.page,
        source: "structure",
    })
}

fn union_boxes(page: u32, boxes: &[PdfBox]) -> Option<PdfBox> {
    let first = boxes.first()?;
    let x = boxes
        .iter()
        .map(|bbox| bbox.x)
        .fold(f64::INFINITY, f64::min);
    let y = boxes
        .iter()
        .map(|bbox| bbox.y)
        .fold(f64::INFINITY, f64::min);
    let right = boxes
        .iter()
        .map(|bbox| bbox.x + bbox.width)
        .fold(f64::NEG_INFINITY, f64::max);
    let bottom = boxes
        .iter()
        .map(|bbox| bbox.y + bbox.height)
        .fold(f64::NEG_INFINITY, f64::max);
    Some(PdfBox {
        x,
        y,
        width: right - x,
        height: bottom - y,
        page,
        source: if boxes.iter().any(|bbox| bbox.source == "structure") {
            "structure"
        } else {
            first.source
        },
    })
}

fn node_json(node: &StructureNode) -> Value {
    let mut value = Map::new();
    value.insert("id".to_owned(), Value::String(node.id.clone()));
    value.insert("role".to_owned(), Value::String(node.role.clone()));
    value.insert("rawRole".to_owned(), Value::String(node.raw_role.clone()));
    value.insert("parent".to_owned(), Value::Null);
    value.insert("children".to_owned(), Value::Array(Vec::new()));
    value.insert("text".to_owned(), Value::String(node.text.clone()));
    value.insert("ownText".to_owned(), Value::String(node.own_text.clone()));
    value.insert("page".to_owned(), optional_u32(single_page(&node.pages)));
    value.insert("pages".to_owned(), u32_array(&node.pages));
    value.insert(
        "mcids".to_owned(),
        Value::Array(node.mcids.iter().copied().map(Value::from).collect()),
    );
    value.insert(
        "content".to_owned(),
        Value::Array(
            node.kids
                .iter()
                .filter_map(|kid| match kid {
                    Kid::Content(reference) => Some(content_json(reference)),
                    Kid::Node(_) => None,
                })
                .collect(),
        ),
    );
    insert_optional(&mut value, "altText", node.alt_text.as_deref());
    insert_optional(&mut value, "actualText", node.actual_text.as_deref());
    insert_optional(&mut value, "language", node.language.as_deref());
    value.insert(
        "bbox".to_owned(),
        if node.boxes.len() == 1 {
            box_json(&node.boxes[0])
        } else {
            Value::Null
        },
    );
    value.insert(
        "bboxes".to_owned(),
        Value::Array(node.boxes.iter().map(box_json).collect()),
    );
    value.insert(
        "attributes".to_owned(),
        Value::Object(node_attributes(node)),
    );
    value.insert(
        "rawAttributes".to_owned(),
        Value::Object(node.raw_attributes.clone()),
    );
    Value::Object(value)
}

// Parent and child identities are filled in a second pass because the public JSON
// stores stable IDs rather than arena indexes.
fn materialize_relationship_ids(results: &mut [Value], nodes: &[StructureNode], page_count: usize) {
    for (index, node) in nodes.iter().enumerate() {
        let Some(Value::Object(value)) = results.get_mut(page_count + index) else {
            continue;
        };
        value.insert(
            "parent".to_owned(),
            node.parent
                .and_then(|parent| nodes.get(parent))
                .map(|parent| Value::String(parent.id.clone()))
                .unwrap_or(Value::Null),
        );
        value.insert(
            "children".to_owned(),
            Value::Array(
                node.children
                    .iter()
                    .filter_map(|child| nodes.get(*child))
                    .map(|child| Value::String(child.id.clone()))
                    .collect(),
            ),
        );
    }
}

fn page_json(page: &PageInfo, text: &str) -> Value {
    let mut value = Map::new();
    value.insert(
        "id".to_owned(),
        Value::String(format!("page-{}", page.page)),
    );
    value.insert("role".to_owned(), Value::String("page".to_owned()));
    value.insert("page".to_owned(), Value::from(page.page));
    value.insert("pages".to_owned(), u32_array(&[page.page]));
    value.insert("text".to_owned(), Value::String(text.to_owned()));
    value.insert("width".to_owned(), number_json(page.width));
    value.insert("height".to_owned(), number_json(page.height));
    Value::Object(value)
}

fn page_attributes(page: &PageInfo) -> Value {
    let mut value = Map::new();
    value.insert("page".to_owned(), Value::from(page.page));
    value.insert("pageNumber".to_owned(), Value::from(page.page));
    value.insert("width".to_owned(), number_json(page.width));
    value.insert("height".to_owned(), number_json(page.height));
    Value::Object(value)
}

fn page_selector_attributes(page: &PageInfo, text: &str) -> Value {
    let mut value = page_attributes(page)
        .as_object()
        .cloned()
        .unwrap_or_default();
    value.insert("ownText".to_owned(), Value::String(text.to_owned()));
    value.insert("rawAttributes".to_owned(), page_attributes(page));
    value.insert("content".to_owned(), Value::Array(Vec::new()));
    Value::Object(value)
}

fn page_handle_json(node: &SelectorNode, snapshot: &Value) -> Value {
    let mut value = Map::new();
    value.insert("snapshot".to_owned(), snapshot.clone());
    value.insert("type".to_owned(), Value::String("page".to_owned()));
    value.insert("rawRole".to_owned(), Value::String("page".to_owned()));
    value.insert("parentId".to_owned(), Value::Null);
    value.insert("childIds".to_owned(), Value::Array(Vec::new()));
    value.insert("ownText".to_owned(), Value::String(node.text.clone()));
    if let Some(page) = node.page {
        value.insert("pageNumber".to_owned(), Value::from(page));
    }
    let attributes = node
        .attributes
        .as_object()
        .map(|attributes| {
            let mut attributes = attributes.clone();
            attributes.remove("ownText");
            attributes.remove("rawAttributes");
            attributes.remove("content");
            Value::Object(attributes)
        })
        .unwrap_or_else(|| Value::Object(Map::new()));
    value.insert("attributes".to_owned(), attributes.clone());
    value.insert("rawAttributes".to_owned(), attributes);
    Value::Object(value)
}

fn node_handle_json(node: &StructureNode, snapshot: &Value) -> Value {
    let mut value = Map::new();
    value.insert("snapshot".to_owned(), snapshot.clone());
    value.insert("type".to_owned(), Value::String(node.role.clone()));
    value.insert(
        "parentId".to_owned(),
        snapshot.get("parent").cloned().unwrap_or(Value::Null),
    );
    value.insert(
        "childIds".to_owned(),
        snapshot
            .get("children")
            .cloned()
            .unwrap_or_else(|| Value::Array(Vec::new())),
    );
    insert_optional(&mut value, "title", node.title.as_deref());
    insert_optional(&mut value, "expandedText", node.expanded_text.as_deref());
    Value::Object(value)
}

fn node_attributes(node: &StructureNode) -> Map<String, Value> {
    let mut value = node.raw_attributes.clone();
    for (key, entry) in &node.attribute_objects {
        value.insert(key.clone(), entry.clone());
    }
    value.insert("role".to_owned(), Value::String(node.role.clone()));
    value.insert("type".to_owned(), Value::String(node.role.clone()));
    value.insert("rawRole".to_owned(), Value::String(node.raw_role.clone()));
    insert_optional(&mut value, "title", node.title.as_deref());
    insert_optional(&mut value, "alt", node.alt_text.as_deref());
    insert_optional(&mut value, "altText", node.alt_text.as_deref());
    insert_optional(&mut value, "actualText", node.actual_text.as_deref());
    insert_optional(&mut value, "lang", node.language.as_deref());
    insert_optional(&mut value, "language", node.language.as_deref());
    value.insert("page".to_owned(), optional_u32(single_page(&node.pages)));
    value.insert("pages".to_owned(), u32_array(&node.pages));
    value.insert(
        "mcids".to_owned(),
        Value::Array(node.mcids.iter().copied().map(Value::from).collect()),
    );
    value.insert(
        "bbox".to_owned(),
        if node.boxes.len() == 1 {
            box_json(&node.boxes[0])
        } else {
            Value::Null
        },
    );
    value.insert(
        "bboxes".to_owned(),
        Value::Array(node.boxes.iter().map(box_json).collect()),
    );
    value
}

fn selector_attributes(node: &StructureNode) -> Map<String, Value> {
    let mut value = node_attributes(node);
    value.insert("ownText".to_owned(), Value::String(node.own_text.clone()));
    insert_optional(&mut value, "expandedText", node.expanded_text.as_deref());
    value.insert(
        "rawAttributes".to_owned(),
        Value::Object(node.raw_attributes.clone()),
    );
    value.insert(
        "content".to_owned(),
        Value::Array(
            node.kids
                .iter()
                .filter_map(|kid| match kid {
                    Kid::Content(reference) => Some(content_json(reference)),
                    Kid::Node(_) => None,
                })
                .collect(),
        ),
    );
    value
}

fn content_json(reference: &ContentRef) -> Value {
    let mut value = Map::new();
    value.insert("type".to_owned(), Value::String(reference.kind.to_owned()));
    value.insert("page".to_owned(), optional_u32(reference.page));
    if let Some(mcid) = reference.mcid {
        value.insert("mcid".to_owned(), Value::from(mcid));
    }
    insert_optional(&mut value, "objectRef", reference.object_ref.as_deref());
    insert_optional(&mut value, "streamRef", reference.stream_ref.as_deref());
    Value::Object(value)
}

fn box_json(bbox: &PdfBox) -> Value {
    let mut value = Map::new();
    value.insert("x".to_owned(), number_json(bbox.x));
    value.insert("y".to_owned(), number_json(bbox.y));
    value.insert("width".to_owned(), number_json(bbox.width));
    value.insert("height".to_owned(), number_json(bbox.height));
    value.insert("page".to_owned(), Value::from(bbox.page));
    value.insert("source".to_owned(), Value::String(bbox.source.to_owned()));
    value.insert(
        "coordinateSpace".to_owned(),
        Value::String("normalized-page".to_owned()),
    );
    Value::Object(value)
}

fn text_for_page(nodes: &[StructureNode], page: u32) -> String {
    join_text(nodes.iter().filter_map(|node| {
        node.kids
            .iter()
            .any(|kid| match kid {
                Kid::Content(reference) => reference.page == Some(page),
                Kid::Node(_) => false,
            })
            .then_some(node.own_text.as_str())
    }))
}

fn read_role_map(document: &Document, root: &Dictionary) -> HashMap<String, String> {
    let Some(dict) = root
        .get(b"RoleMap")
        .ok()
        .and_then(|value| resolve_dict(document, value))
    else {
        return HashMap::new();
    };
    dict.iter()
        .filter_map(|(key, value)| {
            read_name_object(document, value)
                .map(|mapped| (String::from_utf8_lossy(key).into_owned(), mapped))
        })
        .collect()
}

fn read_raw_attributes(dict: &Dictionary) -> Map<String, Value> {
    dict.iter()
        .filter(|(key, _)| key.as_slice() != b"K" && key.as_slice() != b"P")
        .map(|(key, value)| {
            (
                String::from_utf8_lossy(key).into_owned(),
                pdf_object_value(value, 0),
            )
        })
        .collect()
}

fn pdf_object_value(value: &Object, depth: usize) -> Value {
    match value {
        Object::Null => Value::Null,
        Object::Boolean(value) => Value::Bool(*value),
        Object::Integer(value) => Value::from(*value),
        Object::Real(value) => number_json(clean_pdf_real(*value)),
        Object::Name(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        Object::String(_, _) => Value::String(decode_text_string(value).unwrap_or_default()),
        Object::Reference(id) => {
            let mut reference = Map::new();
            reference.insert("ref".to_owned(), Value::String(reference_id(*id)));
            Value::Object(reference)
        }
        Object::Array(values) if depth < 3 => Value::Array(
            values
                .iter()
                .map(|value| pdf_object_value(value, depth + 1))
                .collect(),
        ),
        Object::Dictionary(dict) if depth < 3 => Value::Object(
            dict.iter()
                .map(|(key, value)| {
                    (
                        String::from_utf8_lossy(key).into_owned(),
                        pdf_object_value(value, depth + 1),
                    )
                })
                .collect(),
        ),
        Object::Stream(stream) if depth < 3 => Value::Object(
            stream
                .dict
                .iter()
                .map(|(key, value)| {
                    (
                        String::from_utf8_lossy(key).into_owned(),
                        pdf_object_value(value, depth + 1),
                    )
                })
                .collect(),
        ),
        other => Value::String(format!("{other:?}")),
    }
}

// Structure attribute objects (/A) hold owner-specific standard attributes
// such as Table /Scope and List /ListNumbering. They may be a single
// dictionary or an array of dictionaries, direct or indirect, so they are
// resolved here into a flat selectable map instead of surfacing as an
// unresolved reference like they do in `rawAttributes`.
fn read_attribute_objects(document: &Document, raw: &Object) -> Map<String, Value> {
    let mut attributes = Map::new();
    collect_attribute_objects(document, raw, 0, &mut HashSet::new(), &mut attributes);
    attributes
}

fn collect_attribute_objects(
    document: &Document,
    raw: &Object,
    depth: usize,
    active_refs: &mut HashSet<ObjectId>,
    attributes: &mut Map<String, Value>,
) {
    if depth > MAX_DEPTH {
        return;
    }
    match raw {
        Object::Reference(id) => {
            if !active_refs.insert(*id) {
                return;
            }
            if let Ok(value) = document.get_object(*id) {
                collect_attribute_objects(document, value, depth + 1, active_refs, attributes);
            }
            active_refs.remove(id);
        }
        Object::Array(values) => {
            for value in values {
                collect_attribute_objects(document, value, depth + 1, active_refs, attributes);
            }
        }
        Object::Dictionary(dict) => {
            for (key, value) in dict.iter() {
                // /O names the attribute owner (Table, List, ...); it is not
                // itself a selectable attribute.
                if key.as_slice() == b"O" {
                    continue;
                }
                attributes.insert(
                    attribute_object_key(key),
                    attribute_object_value(document, value, 0, &mut HashSet::new()),
                );
            }
        }
        _ => {}
    }
}

// Attribute keys are exposed camelCased like /Alt -> alt and /Lang -> lang,
// with the HTML-style all-lowercase spellings for the spanning attributes.
fn attribute_object_key(key: &[u8]) -> String {
    let name = String::from_utf8_lossy(key).into_owned();
    match name.as_str() {
        "ColSpan" => "colspan".to_owned(),
        "RowSpan" => "rowspan".to_owned(),
        _ => {
            let mut characters = name.chars();
            match characters.next() {
                Some(first) => first.to_lowercase().collect::<String>() + characters.as_str(),
                None => name,
            }
        }
    }
}

fn attribute_object_value(
    document: &Document,
    value: &Object,
    depth: usize,
    visited: &mut HashSet<ObjectId>,
) -> Value {
    if depth > MAX_DEPTH {
        return Value::Null;
    }
    match value {
        Object::Reference(id) => {
            if !visited.insert(*id) {
                return Value::Null;
            }
            let resolved = document
                .get_object(*id)
                .map(|object| attribute_object_value(document, object, depth + 1, visited))
                .unwrap_or(Value::Null);
            visited.remove(id);
            resolved
        }
        Object::Null => Value::Null,
        Object::Boolean(value) => Value::Bool(*value),
        Object::Integer(value) => Value::from(*value),
        Object::Real(value) => number_json(clean_pdf_real(*value)),
        Object::Name(value) => Value::String(String::from_utf8_lossy(value).into_owned()),
        Object::String(_, _) => Value::String(decode_text_string(value).unwrap_or_default()),
        Object::Array(values) => Value::Array(
            values
                .iter()
                .map(|value| attribute_object_value(document, value, depth + 1, visited))
                .collect(),
        ),
        Object::Dictionary(dict) => Value::Object(
            dict.iter()
                .map(|(key, value)| {
                    (
                        String::from_utf8_lossy(key).into_owned(),
                        attribute_object_value(document, value, depth + 1, visited),
                    )
                })
                .collect(),
        ),
        Object::Stream(stream) => Value::Object(
            stream
                .dict
                .iter()
                .map(|(key, value)| {
                    (
                        String::from_utf8_lossy(key).into_owned(),
                        attribute_object_value(document, value, depth + 1, visited),
                    )
                })
                .collect(),
        ),
    }
}

fn read_structure_bbox(document: &Document, raw: &Object) -> Option<[f64; 4]> {
    read_structure_bbox_inner(document, raw, 0, &mut HashSet::new())
}

fn read_structure_bbox_inner(
    document: &Document,
    raw: &Object,
    depth: usize,
    active_refs: &mut HashSet<ObjectId>,
) -> Option<[f64; 4]> {
    if depth > MAX_DEPTH {
        return None;
    }
    let reference = raw.as_reference().ok();
    if reference.is_some_and(|id| !active_refs.insert(id)) {
        return None;
    }
    let result = match resolve_object(document, raw) {
        Some(Object::Dictionary(dict)) => dict
            .get(b"BBox")
            .ok()
            .and_then(|value| four_numbers(document, value)),
        Some(Object::Array(values)) => four_numbers(document, raw).or_else(|| {
            values.iter().find_map(|value| {
                read_structure_bbox_inner(document, value, depth + 1, active_refs)
            })
        }),
        _ => None,
    };
    if let Some(id) = reference {
        active_refs.remove(&id);
    }
    result
}

fn four_numbers(document: &Document, raw: &Object) -> Option<[f64; 4]> {
    let values = number_array(document, raw)?;
    (values.len() == 4).then(|| [values[0], values[1], values[2], values[3]])
}

fn number_array(document: &Document, raw: &Object) -> Option<Vec<f64>> {
    resolve_object(document, raw)?
        .as_array()
        .ok()?
        .iter()
        .map(|value| number_value(document, value))
        .collect()
}

fn number_value(document: &Document, value: &Object) -> Option<f64> {
    match resolve_object(document, value)? {
        Object::Integer(value) => Some(*value as f64),
        Object::Real(value) => Some(clean_pdf_real(*value)),
        _ => None,
    }
}

fn read_page_number(
    raw: Option<&Object>,
    inherited: Option<u32>,
    state: &BuildState<'_, '_>,
) -> Option<u32> {
    match raw {
        Some(Object::Reference(id)) => state.page_by_id.get(id).copied().or(inherited),
        _ => inherited,
    }
}

fn inherited_object<'a>(
    document: &'a Document,
    dict: &'a Dictionary,
    key: &[u8],
) -> Option<&'a Object> {
    let mut current = dict;
    let mut visited = HashSet::new();
    for _ in 0..=MAX_DEPTH {
        if let Ok(value) = current.get(key) {
            return Some(value);
        }
        let parent = current.get(b"Parent").ok()?;
        if let Ok(id) = parent.as_reference() {
            if !visited.insert(id) {
                return None;
            }
        }
        current = resolve_dict(document, parent)?;
    }
    None
}

fn resolve_object<'a>(document: &'a Document, value: &'a Object) -> Option<&'a Object> {
    let mut current = value;
    let mut visited = HashSet::new();
    for _ in 0..=MAX_DEPTH {
        match current {
            Object::Reference(id) => {
                if !visited.insert(*id) {
                    return None;
                }
                current = document.get_object(*id).ok()?;
            }
            _ => return Some(current),
        }
    }
    None
}

fn resolve_dict<'a>(document: &'a Document, value: &'a Object) -> Option<&'a Dictionary> {
    match resolve_object(document, value)? {
        Object::Dictionary(dict) => Some(dict),
        Object::Stream(stream) => Some(&stream.dict),
        _ => None,
    }
}

fn read_name(document: &Document, dict: &Dictionary, key: &[u8]) -> Option<String> {
    resolve_object(document, dict.get(key).ok()?)?
        .as_name()
        .ok()
        .map(|value| String::from_utf8_lossy(value).into_owned())
}

fn read_name_object(document: &Document, value: &Object) -> Option<String> {
    resolve_object(document, value)?
        .as_name()
        .ok()
        .map(|value| String::from_utf8_lossy(value).into_owned())
}

fn read_text(document: &Document, dict: &Dictionary, key: &[u8]) -> Option<String> {
    let value = resolve_object(document, dict.get(key).ok()?)?;
    decode_text_string(value)
        .ok()
        .map(|value| value.trim_end_matches('\0').to_owned())
}

fn read_integer(document: &Document, dict: &Dictionary, key: &[u8]) -> Option<i64> {
    resolve_object(document, dict.get(key).ok()?)?.as_i64().ok()
}

fn object_id(value: &Object, fallback: &str) -> String {
    match value {
        Object::Reference(id) => format!("struct-{}-{}", id.0, id.1),
        _ => fallback.to_owned(),
    }
}

fn reference_string(value: &Object) -> Option<String> {
    value.as_reference().ok().map(reference_id)
}

fn reference_id(id: ObjectId) -> String {
    format!("{} {} R", id.0, id.1)
}

fn base14_ascent(name: &str) -> Option<f64> {
    let name = name.rsplit('+').next().unwrap_or(name);
    if name.starts_with("Helvetica") {
        Some(0.718)
    } else if name.starts_with("Times") {
        Some(0.683)
    } else if name.starts_with("Courier") {
        Some(0.629)
    } else if name == "Symbol" || name == "ZapfDingbats" {
        Some(0.0)
    } else {
        None
    }
}

fn single_page(pages: &[u32]) -> Option<u32> {
    match pages {
        [page] => Some(*page),
        _ => None,
    }
}

fn optional_u32(value: Option<u32>) -> Value {
    value.map(Value::from).unwrap_or(Value::Null)
}

fn u32_array(values: &[u32]) -> Value {
    Value::Array(values.iter().copied().map(Value::from).collect())
}

fn insert_optional(map: &mut Map<String, Value>, key: &str, value: Option<&str>) {
    if let Some(value) = value {
        map.insert(key.to_owned(), Value::String(value.to_owned()));
    }
}

fn number_json(value: f64) -> Value {
    Number::from_f64(value)
        .map(Value::Number)
        .unwrap_or(Value::Null)
}

fn clean_number(value: f64) -> f64 {
    // pdf-inspector exposes geometry as f32. Quantizing to PDF's customary
    // thousandth-point precision removes f32 noise before normalization and
    // matches the JavaScript/PDF.js contract for ordinary content streams.
    (value * 1_000.0).round() / 1_000.0
}

fn clean_pdf_real(value: f64) -> f64 {
    value
}

fn clamp01(value: f64) -> f64 {
    value.clamp(0.0, 1.0)
}

fn join_text<'a>(parts: impl IntoIterator<Item = &'a str>) -> String {
    let mut result = String::new();
    for raw in parts {
        let part = raw.replace('\r', "");
        if part.is_empty() {
            continue;
        }
        let punctuation = part
            .chars()
            .next()
            .is_some_and(|value| ",.;:!?)}]".contains(value));
        if result.is_empty()
            || result.chars().last().is_some_and(char::is_whitespace)
            || part.chars().next().is_some_and(char::is_whitespace)
            || punctuation
        {
            result.push_str(&part);
        } else {
            result.push(' ');
            result.push_str(&part);
        }
    }
    result
        .lines()
        .map(str::trim)
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_text_like_the_typescript_contract() {
        assert_eq!(join_text(["Quarterly", "revenue"]), "Quarterly revenue");
        assert_eq!(join_text(["Hello", ", world"]), "Hello, world");
        assert_eq!(join_text(["a \n", " b"]), "a\nb");
    }

    #[test]
    fn sparse_structure_nodes_have_no_single_page() {
        assert_eq!(single_page(&[]), None);
        assert_eq!(single_page(&[3]), Some(3));
        assert_eq!(single_page(&[3, 4]), None);
    }

    #[test]
    fn positioned_text_preserves_line_breaks() {
        let mut content = ResolvedContent::default();
        append_positioned_text(&mut content, "Quarterly", 700.0, 12.0);
        append_positioned_text(&mut content, "revenue", 700.0, 12.0);
        append_positioned_text(&mut content, "Total", 650.0, 12.0);
        assert_eq!(content.text, "Quarterly revenue\nTotal");
    }

    #[test]
    fn crop_box_is_intersected_with_media_box() {
        assert_eq!(
            intersect_page_boxes([0.0, 0.0, 600.0, 800.0], [0.0, 0.0, 800.0, 1000.0]),
            Some([0.0, 0.0, 600.0, 800.0])
        );
        assert_eq!(
            intersect_page_boxes([0.0, 0.0, 600.0, 800.0], [700.0, 900.0, 800.0, 1000.0]),
            None
        );
    }

    #[test]
    fn pdf_reals_do_not_expose_f32_expansion_noise() {
        assert_eq!(clean_pdf_real(0.24), 0.24);
        assert_eq!(clean_pdf_real(531.589), 531.589);
        assert_eq!(clean_pdf_real(0.000_000_1), 0.000_000_1);
    }

    #[test]
    fn cyclic_indirect_objects_are_bounded() {
        let mut document = Document::new();
        let id = (1, 0);
        document.objects.insert(id, Object::Reference(id));
        assert!(resolve_object(&document, &Object::Reference(id)).is_none());
    }

    fn table_attribute_document() -> Document {
        let mut document = Document::new();
        let mut attributes = Dictionary::new();
        attributes.set("O", Object::Name(b"Table".to_vec()));
        attributes.set("Scope", Object::Name(b"Row".to_vec()));
        attributes.set("ColSpan", Object::Integer(3));
        attributes.set("RowSpan", Object::Integer(2));
        document
            .objects
            .insert((10, 0), Object::Dictionary(attributes));
        document
    }

    #[test]
    fn indirect_attribute_objects_expose_owner_attributes() {
        let document = table_attribute_document();
        let attributes = read_attribute_objects(&document, &Object::Reference((10, 0)));
        assert_eq!(
            attributes.get("scope"),
            Some(&Value::String("Row".to_owned()))
        );
        assert_eq!(attributes.get("colspan"), Some(&Value::from(3)));
        assert_eq!(attributes.get("rowspan"), Some(&Value::from(2)));
        assert!(!attributes.contains_key("O"));
        assert!(!attributes.contains_key("o"));
    }

    #[test]
    fn direct_and_array_attribute_objects_are_merged() {
        let document = table_attribute_document();
        let mut list_attributes = Dictionary::new();
        list_attributes.set("O", Object::Name(b"List".to_vec()));
        list_attributes.set("ListNumbering", Object::Name(b"Disc".to_vec()));

        let direct = read_attribute_objects(&document, &Object::Dictionary(list_attributes.clone()));
        assert_eq!(
            direct.get("listNumbering"),
            Some(&Value::String("Disc".to_owned()))
        );

        let array = read_attribute_objects(
            &document,
            &Object::Array(vec![
                Object::Reference((10, 0)),
                Object::Dictionary(list_attributes),
            ]),
        );
        assert_eq!(array.get("scope"), Some(&Value::String("Row".to_owned())));
        assert_eq!(
            array.get("listNumbering"),
            Some(&Value::String("Disc".to_owned()))
        );
    }

    #[test]
    fn cyclic_attribute_object_references_are_bounded() {
        let mut document = Document::new();
        let id = (11, 0);
        document.objects.insert(id, Object::Reference(id));
        assert!(read_attribute_objects(&document, &Object::Reference(id)).is_empty());

        let array_id = (12, 0);
        document
            .objects
            .insert(array_id, Object::Array(vec![Object::Reference(array_id)]));
        assert!(read_attribute_objects(&document, &Object::Reference(array_id)).is_empty());
    }

    #[test]
    fn cyclic_parent_and_structure_attribute_references_are_bounded() {
        let mut document = Document::new();
        let parent_id = (1, 0);
        let mut parent = Dictionary::new();
        parent.set("Parent", Object::Reference(parent_id));
        document
            .objects
            .insert(parent_id, Object::Dictionary(parent));
        let parent = document
            .get_dictionary(parent_id)
            .expect("test parent dictionary");
        assert!(inherited_object(&document, parent, b"MediaBox").is_none());

        let attribute_id = (2, 0);
        document.objects.insert(
            attribute_id,
            Object::Array(vec![Object::Reference(attribute_id)]),
        );
        assert!(read_structure_bbox(&document, &Object::Reference(attribute_id)).is_none());
    }
}
