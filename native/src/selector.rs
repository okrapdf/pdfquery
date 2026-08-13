//! Tagged-PDF structural selector parsing and matching.
//!
//! The grammar and matching rules in this module intentionally mirror
//! `pdfdom/src/structure-selector.ts`. `SelectorNode::text` is the aggregate
//! text for the node (its own text plus descendant text), while `page` and
//! `pages` are direct page associations. The matcher derives aggregate page
//! associations from `children` so synthetic page nodes can act as virtual
//! ancestors without replacing the native `parent` relationship.

use serde_json::Value;
use std::collections::{BTreeSet, HashSet};
use std::error::Error;
use std::fmt;

/// Self-contained node shape consumed by the selector engine.
///
/// Indices in `parent` and `children` refer to positions in the slice passed to
/// [`query`]. The slice order is therefore both node identity and document
/// order. Nodes with `virtual_page` set are selectable like ordinary nodes and
/// are additionally considered virtual descendant ancestors for nodes whose
/// aggregate pages overlap their direct pages.
#[derive(Clone, Debug, PartialEq)]
pub struct SelectorNode {
    pub id: String,
    pub role: Option<String>,
    pub raw_role: Option<String>,
    pub text: String,
    pub page: Option<u32>,
    pub pages: Vec<u32>,
    pub attributes: Value,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub virtual_page: bool,
}

impl Default for SelectorNode {
    fn default() -> Self {
        Self {
            id: String::new(),
            role: None,
            raw_role: None,
            text: String::new(),
            page: None,
            pages: Vec::new(),
            attributes: Value::Null,
            parent: None,
            children: Vec::new(),
            virtual_page: false,
        }
    }
}

/// A selector parse failure.
///
/// `index` uses JavaScript string-index semantics (UTF-16 code units), matching
/// the TypeScript implementation even when a selector contains non-BMP text.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SelectorSyntaxError {
    pub selector: String,
    pub index: usize,
    pub message: String,
}

impl fmt::Display for SelectorSyntaxError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let selector = serde_json::to_string(&self.selector)
            .unwrap_or_else(|_| format!("{:?}", self.selector));
        write!(
            formatter,
            "{} at index {} in {}",
            self.message, self.index, selector
        )
    }
}

impl Error for SelectorSyntaxError {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum AttributeOperator {
    Equal,
    Contains,
    Prefix,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AttributeSelector {
    name: String,
    operator: AttributeOperator,
    value: String,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
struct CompoundSelector {
    role: Option<String>,
    attributes: Vec<AttributeSelector>,
    contains: Vec<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Combinator {
    Descendant,
    Child,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SelectorStep {
    compound: CompoundSelector,
    /// Relationship from the preceding (left-hand) step to this step.
    combinator: Option<Combinator>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct SelectorBranch {
    steps: Vec<SelectorStep>,
}

struct SelectorGroup<'a> {
    value: &'a str,
    /// Byte offset into the original selector. It is converted to UTF-16 only
    /// when constructing a public error.
    offset: usize,
}

/// Match `selector` against `nodes`, returning matching node indices in the
/// input slice's deterministic document order.
///
/// Comma groups are unioned by node identity, so an index appears at most once
/// even if more than one branch matches it.
pub fn query(nodes: &[SelectorNode], selector: &str) -> Result<Vec<usize>, SelectorSyntaxError> {
    let branches = parse_selector(selector)?;
    let mut context = QueryContext::new(nodes);
    let mut matches = Vec::new();

    for node_index in 0..nodes.len() {
        if branches
            .iter()
            .any(|branch| matches_branch(node_index, branch, &mut context))
        {
            matches.push(node_index);
        }
    }

    Ok(matches)
}

fn parse_selector(selector: &str) -> Result<Vec<SelectorBranch>, SelectorSyntaxError> {
    if trim_bounds(selector).0 == selector.len() {
        return Err(syntax_error(selector, 0, "Selector cannot be empty"));
    }

    split_groups(selector)?
        .into_iter()
        .map(|group| parse_branch(selector, group.value, group.offset))
        .collect()
}

fn split_groups(selector: &str) -> Result<Vec<SelectorGroup<'_>>, SelectorSyntaxError> {
    let mut groups = Vec::new();
    let mut group_start = 0;
    let mut bracket_depth = 0usize;
    let mut paren_depth = 0usize;
    let mut quote = None;
    let mut escaped = false;

    for (index, character) in selector.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }

        match character {
            '"' | '\'' => quote = Some(character),
            '[' => bracket_depth += 1,
            ']' => {
                if bracket_depth == 0 {
                    return Err(syntax_error(selector, index, "Unexpected closing bracket"));
                }
                bracket_depth -= 1;
            }
            '(' => paren_depth += 1,
            ')' => {
                if paren_depth == 0 {
                    return Err(syntax_error(
                        selector,
                        index,
                        "Unexpected closing parenthesis",
                    ));
                }
                paren_depth -= 1;
            }
            ',' if bracket_depth == 0 && paren_depth == 0 => {
                push_group(selector, &mut groups, group_start, index)?;
                group_start = index + character.len_utf8();
            }
            _ => {}
        }
    }

    if quote.is_some() {
        return Err(syntax_error(
            selector,
            selector.len(),
            "Unterminated quoted value",
        ));
    }
    if bracket_depth != 0 {
        return Err(syntax_error(
            selector,
            selector.len(),
            "Unterminated attribute selector",
        ));
    }
    if paren_depth != 0 {
        return Err(syntax_error(
            selector,
            selector.len(),
            "Unterminated pseudo-class",
        ));
    }

    push_group(selector, &mut groups, group_start, selector.len())?;
    Ok(groups)
}

fn push_group<'a>(
    selector: &'a str,
    groups: &mut Vec<SelectorGroup<'a>>,
    start: usize,
    end: usize,
) -> Result<(), SelectorSyntaxError> {
    let raw = &selector[start..end];
    let (trimmed_start, trimmed_end) = trim_bounds(raw);
    if trimmed_start == raw.len() {
        return Err(syntax_error(
            selector,
            start,
            "Selector group cannot be empty",
        ));
    }

    groups.push(SelectorGroup {
        value: &raw[trimmed_start..trimmed_end],
        offset: start + trimmed_start,
    });
    Ok(())
}

fn parse_branch(
    selector: &str,
    branch: &str,
    offset: usize,
) -> Result<SelectorBranch, SelectorSyntaxError> {
    let mut steps = Vec::new();
    let mut index = 0;
    let mut next_combinator = None;

    while index < branch.len() {
        let (compound, next_index) = parse_compound(selector, branch, index, offset)?;
        steps.push(SelectorStep {
            compound,
            combinator: next_combinator,
        });
        index = next_index;

        let whitespace_start = index;
        index = skip_whitespace(branch, index);
        let had_whitespace = index > whitespace_start;
        if index >= branch.len() {
            break;
        }

        if char_at(branch, index) == Some('>') {
            next_combinator = Some(Combinator::Child);
            index += 1;
            index = skip_whitespace(branch, index);
            if index >= branch.len() || char_at(branch, index) == Some('>') {
                return Err(syntax_error(
                    selector,
                    offset + index,
                    "Child combinator requires a selector on both sides",
                ));
            }
            continue;
        }

        if had_whitespace {
            next_combinator = Some(Combinator::Descendant);
            continue;
        }

        let token = branch[index..]
            .encode_utf16()
            .next()
            .expect("index is within branch");
        let token = if (0xD800..=0xDFFF).contains(&token) {
            format!("\"\\u{token:04x}\"")
        } else {
            let token = char::from_u32(u32::from(token)).expect("non-surrogate UTF-16 unit");
            serde_json::to_string(&token.to_string()).unwrap_or_else(|_| format!("{:?}", token))
        };
        return Err(syntax_error(
            selector,
            offset + index,
            format!("Unexpected token {token}"),
        ));
    }

    if steps.is_empty() {
        return Err(syntax_error(
            selector,
            offset,
            "Selector group cannot be empty",
        ));
    }

    Ok(SelectorBranch { steps })
}

fn parse_compound(
    selector: &str,
    branch: &str,
    start_index: usize,
    offset: usize,
) -> Result<(CompoundSelector, usize), SelectorSyntaxError> {
    let mut index = start_index;
    let mut role = None;
    let mut attributes = Vec::new();
    let mut contains = Vec::new();

    if char_at(branch, index) == Some('*') {
        role = Some("*".to_owned());
        index += 1;
    } else if char_at(branch, index).is_some_and(is_identifier_start) {
        let (value, next_index) = read_identifier(branch, index);
        role = Some(value.to_owned());
        index = next_index;
    }

    while index < branch.len() {
        match char_at(branch, index) {
            Some('[') => {
                let (attribute, next_index) = parse_attribute(selector, branch, index, offset)?;
                attributes.push(attribute);
                index = next_index;
            }
            Some(':') => {
                let (value, next_index) = parse_pseudo(selector, branch, index, offset)?;
                contains.push(value);
                index = next_index;
            }
            _ => break,
        }
    }

    if role.is_none() && attributes.is_empty() && contains.is_empty() {
        return Err(syntax_error(
            selector,
            offset + start_index,
            "Expected a role, attribute, or :contains() selector",
        ));
    }

    Ok((
        CompoundSelector {
            role,
            attributes,
            contains,
        },
        index,
    ))
}

fn parse_attribute(
    selector: &str,
    branch: &str,
    start_index: usize,
    offset: usize,
) -> Result<(AttributeSelector, usize), SelectorSyntaxError> {
    let end_index = find_closing_delimiter(selector, branch, start_index, offset, '[', ']')?;
    let content_start = start_index + 1;
    let content = &branch[content_start..end_index];
    let mut cursor = skip_whitespace(content, 0);

    let name_start = cursor;
    if !char_at(content, cursor).is_some_and(is_identifier_start) {
        return Err(attribute_operator_error(selector, offset + start_index));
    }
    cursor = advance_while(content, cursor, is_attribute_name_continue);
    let name = &content[name_start..cursor];
    cursor = skip_whitespace(content, cursor);

    let (operator, operator_len) = if content[cursor..].starts_with("*=") {
        (AttributeOperator::Contains, 2)
    } else if content[cursor..].starts_with("^=") {
        (AttributeOperator::Prefix, 2)
    } else if content[cursor..].starts_with('=') {
        (AttributeOperator::Equal, 1)
    } else {
        return Err(attribute_operator_error(selector, offset + start_index));
    };
    cursor += operator_len;
    cursor = skip_whitespace(content, cursor);

    // The source regex uses a non-greedy value capture followed by `\s*$`, so
    // whitespace outside the value is consumed here before parsing it.
    let raw_end = trim_end_index(content, cursor);
    let raw_value = &content[cursor..raw_end];
    // Preserve the source's `content.indexOf(rawValue)` behavior for error
    // offsets, including its slightly surprising result for an empty value.
    let value_position = content.find(raw_value).unwrap_or(cursor);
    let value = parse_selector_value(
        selector,
        raw_value,
        offset + content_start + value_position,
        false,
    )?;

    Ok((
        AttributeSelector {
            name: name.to_owned(),
            operator,
            value,
        },
        end_index + 1,
    ))
}

fn attribute_operator_error(selector: &str, index: usize) -> SelectorSyntaxError {
    syntax_error(selector, index, "Attribute selectors require =, *=, or ^=")
}

fn parse_pseudo(
    selector: &str,
    branch: &str,
    start_index: usize,
    offset: usize,
) -> Result<(String, usize), SelectorSyntaxError> {
    let name_start = start_index + 1;
    let (name, name_end) = read_identifier(branch, name_start);
    if name.is_empty() {
        return Err(syntax_error(
            selector,
            offset + start_index,
            "Expected a pseudo-class name",
        ));
    }
    if !name.eq_ignore_ascii_case("contains") {
        return Err(syntax_error(
            selector,
            offset + start_index,
            format!("Unsupported pseudo-class :{name}"),
        ));
    }
    if char_at(branch, name_end) != Some('(') {
        return Err(syntax_error(
            selector,
            offset + name_end,
            ":contains requires parentheses",
        ));
    }

    let end_index = find_closing_delimiter(selector, branch, name_end, offset, '(', ')')?;
    let raw_value = &branch[name_end + 1..end_index];
    let value = parse_selector_value(selector, raw_value, offset + name_end + 1, true)?;
    Ok((value, end_index + 1))
}

fn find_closing_delimiter(
    selector: &str,
    branch: &str,
    start_index: usize,
    offset: usize,
    open: char,
    close: char,
) -> Result<usize, SelectorSyntaxError> {
    let mut depth = 1usize;
    let mut quote = None;
    let mut escaped = false;

    for (relative_index, character) in branch[start_index + 1..].char_indices() {
        let index = start_index + 1 + relative_index;
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == active_quote {
                quote = None;
            }
            continue;
        }

        if matches!(character, '"' | '\'') {
            quote = Some(character);
        } else if character == open {
            depth += 1;
        } else if character == close {
            depth -= 1;
            if depth == 0 {
                return Ok(index);
            }
        }
    }

    let kind = if open == '[' {
        "attribute selector"
    } else {
        "pseudo-class"
    };
    Err(syntax_error(
        selector,
        offset + start_index,
        format!("Unterminated {kind}"),
    ))
}

fn parse_selector_value(
    selector: &str,
    raw_value: &str,
    value_offset: usize,
    allow_whitespace: bool,
) -> Result<String, SelectorSyntaxError> {
    let (leading_whitespace, value_end) = trim_bounds(raw_value);
    if leading_whitespace == raw_value.len() {
        return Err(syntax_error(
            selector,
            value_offset,
            "Selector value cannot be empty",
        ));
    }
    let value = &raw_value[leading_whitespace..value_end];
    let quote = char_at(value, 0).expect("trimmed selector value is non-empty");

    if matches!(quote, '"' | '\'') {
        let (last_index, last_character) = value
            .char_indices()
            .next_back()
            .expect("trimmed selector value is non-empty");
        if last_index == 0 || last_character != quote || is_escaped(value, last_index) {
            return Err(syntax_error(
                selector,
                value_offset + leading_whitespace,
                "Unterminated quoted value",
            ));
        }

        for (index, character) in value.char_indices() {
            if index == 0 || index == last_index {
                continue;
            }
            if character == quote && !is_escaped(value, index) {
                return Err(syntax_error(
                    selector,
                    value_offset + leading_whitespace + index,
                    "Unexpected content after quoted value",
                ));
            }
        }

        return Ok(unescape_quoted(&value[quote.len_utf8()..last_index]));
    }

    if value
        .chars()
        .any(|character| matches!(character, '"' | '\'' | '[' | ']'))
    {
        return Err(syntax_error(
            selector,
            value_offset + leading_whitespace,
            "Invalid unquoted selector value",
        ));
    }
    if !allow_whitespace && value.chars().any(is_javascript_whitespace) {
        return Err(syntax_error(
            selector,
            value_offset + leading_whitespace,
            "Unquoted attribute values cannot contain whitespace",
        ));
    }
    Ok(value.to_owned())
}

fn matches_branch(
    node_index: usize,
    branch: &SelectorBranch,
    context: &mut QueryContext<'_>,
) -> bool {
    matches_step(
        node_index,
        &branch.steps,
        branch.steps.len() - 1,
        context,
        &HashSet::new(),
    )
}

fn matches_step(
    node_index: usize,
    steps: &[SelectorStep],
    step_index: usize,
    context: &mut QueryContext<'_>,
    visited: &HashSet<usize>,
) -> bool {
    if node_index >= context.nodes.len() || visited.contains(&node_index) {
        return false;
    }
    if !matches_compound(node_index, &steps[step_index].compound, context) {
        return false;
    }
    if step_index == 0 {
        return true;
    }

    let mut next_visited = visited.clone();
    next_visited.insert(node_index);

    match steps[step_index].combinator {
        Some(Combinator::Child) => context.read_parent(node_index).is_some_and(|parent| {
            matches_step(parent, steps, step_index - 1, context, &next_visited)
        }),
        Some(Combinator::Descendant) => {
            let ancestors = context.read_ancestors(node_index, &next_visited);
            ancestors.into_iter().any(|ancestor| {
                matches_step(ancestor, steps, step_index - 1, context, &next_visited)
            })
        }
        None => false,
    }
}

fn matches_compound(
    node_index: usize,
    compound: &CompoundSelector,
    context: &mut QueryContext<'_>,
) -> bool {
    let node = &context.nodes[node_index];
    if let Some(role) = compound.role.as_deref().filter(|role| *role != "*") {
        let target = role.to_lowercase();
        if !read_role_values(node)
            .into_iter()
            .any(|value| value.to_lowercase() == target)
        {
            return false;
        }
    }

    for attribute in &compound.attributes {
        let values = read_attribute_values(node, &attribute.name);
        let matches = match attribute.operator {
            AttributeOperator::Equal => values.iter().any(|value| value == &attribute.value),
            AttributeOperator::Contains => {
                values.iter().any(|value| value.contains(&attribute.value))
            }
            AttributeOperator::Prefix => values
                .iter()
                .any(|value| value.starts_with(&attribute.value)),
        };
        if !matches {
            return false;
        }
    }

    let text = context.aggregate_text(node_index, &mut HashSet::new());
    compound.contains.iter().all(|needle| text.contains(needle))
}

struct QueryContext<'a> {
    nodes: &'a [SelectorNode],
    inferred_parent: Vec<Option<usize>>,
    virtual_pages: Vec<usize>,
    page_cache: Vec<Option<BTreeSet<u32>>>,
    text_cache: Vec<Option<String>>,
}

impl<'a> QueryContext<'a> {
    fn new(nodes: &'a [SelectorNode]) -> Self {
        let mut inferred_parent = vec![None; nodes.len()];
        for (parent, node) in nodes.iter().enumerate() {
            for &child in &node.children {
                if let Some(slot) = inferred_parent.get_mut(child) {
                    if slot.is_none() {
                        *slot = Some(parent);
                    }
                }
            }
        }

        Self {
            nodes,
            inferred_parent,
            virtual_pages: nodes
                .iter()
                .enumerate()
                .filter_map(|(index, node)| node.virtual_page.then_some(index))
                .collect(),
            page_cache: vec![None; nodes.len()],
            text_cache: vec![None; nodes.len()],
        }
    }

    fn read_parent(&self, node_index: usize) -> Option<usize> {
        let parent = self
            .nodes
            .get(node_index)
            .and_then(|node| node.parent)
            .or_else(|| self.inferred_parent.get(node_index).copied().flatten());
        parent.filter(|parent| *parent < self.nodes.len())
    }

    fn read_ancestors(&mut self, node_index: usize, visited: &HashSet<usize>) -> Vec<usize> {
        let mut ancestors = Vec::new();
        let mut seen = visited.clone();
        let mut parent = self.read_parent(node_index);
        while let Some(parent_index) = parent {
            if !seen.insert(parent_index) {
                break;
            }
            ancestors.push(parent_index);
            parent = self.read_parent(parent_index);
        }

        let pages = self.aggregate_pages(node_index, &mut HashSet::new());
        for &virtual_index in &self.virtual_pages {
            if virtual_index == node_index || seen.contains(&virtual_index) {
                continue;
            }
            let virtual_page = &self.nodes[virtual_index];
            if read_direct_pages(virtual_page)
                .iter()
                .any(|page| pages.contains(page))
            {
                ancestors.push(virtual_index);
            }
        }
        ancestors
    }

    fn aggregate_pages(&mut self, node_index: usize, active: &mut HashSet<usize>) -> BTreeSet<u32> {
        if node_index >= self.nodes.len() {
            return BTreeSet::new();
        }
        if let Some(cached) = &self.page_cache[node_index] {
            return cached.clone();
        }
        if !active.insert(node_index) {
            return BTreeSet::new();
        }

        let mut pages = read_direct_pages(&self.nodes[node_index]);
        let children = self.nodes[node_index].children.clone();
        for child in children {
            pages.extend(self.aggregate_pages(child, active));
        }
        active.remove(&node_index);
        self.page_cache[node_index] = Some(pages.clone());
        pages
    }

    fn aggregate_text(&mut self, node_index: usize, active: &mut HashSet<usize>) -> String {
        if node_index >= self.nodes.len() {
            return String::new();
        }
        if let Some(cached) = &self.text_cache[node_index] {
            return cached.clone();
        }
        if !active.insert(node_index) {
            return String::new();
        }

        let mut parts = vec![self.nodes[node_index].text.clone()];
        let children = self.nodes[node_index].children.clone();
        for child in children {
            let text = self.aggregate_text(child, active);
            if !text.is_empty() {
                parts.push(text);
            }
        }
        active.remove(&node_index);
        let aggregate = parts
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        self.text_cache[node_index] = Some(aggregate.clone());
        aggregate
    }
}

fn read_role_values(node: &SelectorNode) -> Vec<&str> {
    let mut values = Vec::new();
    if let Some(role) = node.role.as_deref() {
        values.push(role);
    }
    for key in ["role", "type"] {
        if let Some(value) = read_json_property(&node.attributes, key).and_then(Value::as_str) {
            values.push(value);
        }
    }
    values
}

enum AttributeValueRef<'a> {
    String(&'a str),
    Number(u64),
    Numbers(&'a [u32]),
    Json(&'a Value),
    Boolean(bool),
    Object,
    Objects(usize),
}

fn read_attribute_values(node: &SelectorNode, name: &str) -> Vec<String> {
    let aliases = attribute_aliases(name);

    for alias in &aliases {
        if let Some(value) = read_direct_property(node, alias) {
            return flatten_attribute_ref(value);
        }
    }
    for alias in aliases {
        if let Some(value) = read_json_property(&node.attributes, alias) {
            if !value.is_null() {
                return flatten_json_attribute(value);
            }
        }
    }
    Vec::new()
}

fn attribute_aliases(name: &str) -> Vec<&str> {
    match name.to_lowercase().as_str() {
        "role" => vec!["role", "type"],
        "type" => vec!["type", "role"],
        "page" => vec!["page", "pages", "data-page"],
        "pages" => vec!["pages", "page", "data-page"],
        "alt" => vec!["alt", "altText", "alt-text"],
        "alttext" => vec!["altText", "alt", "alt-text"],
        "actualtext" => vec!["actualText", "actual-text"],
        "lang" => vec!["lang", "language"],
        "language" => vec!["language", "lang"],
        "mcid" => vec!["mcid", "mcids", "data-mcid", "data-mcids"],
        "mcids" => vec!["mcids", "mcid", "data-mcids", "data-mcid"],
        _ => vec![name],
    }
}

fn read_direct_property<'a>(node: &'a SelectorNode, key: &str) -> Option<AttributeValueRef<'a>> {
    match key.to_lowercase().as_str() {
        "id" => Some(AttributeValueRef::String(&node.id)),
        // `PdfStructureNode.type` is an alias of the normalized role. The raw
        // role remains independently addressable as `rawRole`.
        "role" | "type" => node.role.as_deref().map(AttributeValueRef::String),
        "rawrole" | "raw_role" | "raw-role" => {
            node.raw_role.as_deref().map(AttributeValueRef::String)
        }
        "text" | "textcontent" | "text_content" | "text-content" => {
            Some(AttributeValueRef::String(&node.text))
        }
        "page" => node
            .page
            .map(|page| AttributeValueRef::Number(u64::from(page))),
        // An empty vector represents an absent optional `pages` property in
        // the bridge, allowing attributes.page/data-page to remain visible.
        "pages" if !node.pages.is_empty() => Some(AttributeValueRef::Numbers(&node.pages)),
        "attributes" if !node.attributes.is_null() => {
            Some(AttributeValueRef::Json(&node.attributes))
        }
        "parent" => node.parent.map(|_| AttributeValueRef::Object),
        "children" => Some(AttributeValueRef::Objects(node.children.len())),
        "virtualpage" | "virtual_page" | "virtual-page" => {
            Some(AttributeValueRef::Boolean(node.virtual_page))
        }
        _ => None,
    }
}

fn flatten_attribute_ref(value: AttributeValueRef<'_>) -> Vec<String> {
    match value {
        AttributeValueRef::String(value) => vec![value.to_owned()],
        AttributeValueRef::Number(value) => vec![value.to_string()],
        AttributeValueRef::Numbers(values) => values.iter().map(ToString::to_string).collect(),
        AttributeValueRef::Json(value) => flatten_json_attribute(value),
        AttributeValueRef::Boolean(value) => vec![value.to_string()],
        AttributeValueRef::Object => vec!["[object Object]".to_owned()],
        AttributeValueRef::Objects(count) => {
            vec!["[object Object]".to_owned(); count]
        }
    }
}

fn flatten_json_attribute(value: &Value) -> Vec<String> {
    match value {
        Value::Array(values) => values.iter().flat_map(flatten_json_attribute).collect(),
        Value::Null => Vec::new(),
        Value::String(value) => vec![value.clone()],
        Value::Bool(value) => vec![value.to_string()],
        Value::Number(value) => vec![javascript_number_string(value)],
        Value::Object(_) => vec!["[object Object]".to_owned()],
    }
}

fn javascript_number_string(number: &serde_json::Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    if let Some(value) = number.as_f64() {
        if value == 0.0 {
            return "0".to_owned();
        }
        let absolute = value.abs();
        if !(1e-6..1e21).contains(&absolute) {
            let scientific = format!("{value:e}");
            if let Some((mantissa, exponent)) = scientific.split_once('e') {
                let exponent = exponent.parse::<i32>().unwrap_or_default();
                return format!("{mantissa}e{exponent:+}");
            }
        }
        return value.to_string();
    }
    number.to_string()
}

fn read_json_property<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    let object = value.as_object()?;
    if let Some(value) = object.get(key) {
        return Some(value);
    }
    let normalized_key = key.to_lowercase();
    object.iter().find_map(|(candidate, value)| {
        (candidate.to_lowercase() == normalized_key).then_some(value)
    })
}

fn read_direct_pages(node: &SelectorNode) -> BTreeSet<u32> {
    let mut pages = BTreeSet::new();
    if let Some(page) = node.page.filter(|page| *page > 0) {
        pages.insert(page);
    }
    pages.extend(node.pages.iter().copied().filter(|page| *page > 0));

    for key in ["page", "pages", "data-page"] {
        if let Some(value) = read_json_property(&node.attributes, key) {
            collect_json_pages(value, &mut pages);
        }
    }
    pages
}

fn collect_json_pages(value: &Value, pages: &mut BTreeSet<u32>) {
    match value {
        Value::Array(values) => {
            for value in values {
                collect_json_pages(value, pages);
            }
        }
        Value::Number(number) => {
            if let Some(page) = number
                .as_u64()
                .filter(|page| *page > 0 && *page <= u64::from(u32::MAX))
            {
                pages.insert(page as u32);
            } else if let Some(page) = number.as_f64().and_then(valid_page_number) {
                pages.insert(page);
            }
        }
        Value::String(value) => {
            if let Some(page) = parse_javascript_number(value).and_then(valid_page_number) {
                pages.insert(page);
            }
        }
        Value::Bool(true) => {
            pages.insert(1);
        }
        Value::Null | Value::Bool(false) | Value::Object(_) => {}
    }
}

fn parse_javascript_number(value: &str) -> Option<f64> {
    let (start, end) = trim_bounds(value);
    let value = &value[start..end];
    if value.is_empty() {
        return Some(0.0);
    }

    let (sign, unsigned) = if let Some(value) = value.strip_prefix('+') {
        (1.0, value)
    } else if let Some(value) = value.strip_prefix('-') {
        (-1.0, value)
    } else {
        (1.0, value)
    };
    if let Some(hex) = unsigned
        .strip_prefix("0x")
        .or_else(|| unsigned.strip_prefix("0X"))
    {
        return u64::from_str_radix(hex, 16)
            .ok()
            .map(|value| sign * value as f64);
    }
    if let Some(octal) = unsigned
        .strip_prefix("0o")
        .or_else(|| unsigned.strip_prefix("0O"))
    {
        return u64::from_str_radix(octal, 8)
            .ok()
            .map(|value| sign * value as f64);
    }
    if let Some(binary) = unsigned
        .strip_prefix("0b")
        .or_else(|| unsigned.strip_prefix("0B"))
    {
        return u64::from_str_radix(binary, 2)
            .ok()
            .map(|value| sign * value as f64);
    }
    value.parse::<f64>().ok()
}

fn valid_page_number(value: f64) -> Option<u32> {
    (value.is_finite() && value.fract() == 0.0 && value > 0.0 && value <= f64::from(u32::MAX))
        .then_some(value as u32)
}

fn read_identifier(value: &str, start_index: usize) -> (&str, usize) {
    if !char_at(value, start_index).is_some_and(is_identifier_start) {
        return ("", start_index);
    }
    let end = advance_while(value, start_index, is_identifier_continue);
    (&value[start_index..end], end)
}

fn is_identifier_start(value: char) -> bool {
    value.is_ascii_alphabetic() || value == '_'
}

fn is_identifier_continue(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '_' | '-')
}

fn is_attribute_name_continue(value: char) -> bool {
    value.is_ascii_alphanumeric() || matches!(value, '_' | ':' | '.' | '-')
}

fn advance_while(value: &str, start_index: usize, predicate: fn(char) -> bool) -> usize {
    let mut index = start_index;
    while let Some(character) = char_at(value, index) {
        if !predicate(character) {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn skip_whitespace(value: &str, start_index: usize) -> usize {
    let mut index = start_index;
    while let Some(character) = char_at(value, index) {
        if !is_javascript_whitespace(character) {
            break;
        }
        index += character.len_utf8();
    }
    index
}

fn trim_bounds(value: &str) -> (usize, usize) {
    let start = skip_whitespace(value, 0);
    if start == value.len() {
        return (start, start);
    }
    (start, trim_end_index(value, start))
}

fn trim_end_index(value: &str, floor: usize) -> usize {
    value[floor..]
        .char_indices()
        .rev()
        .find_map(|(index, character)| {
            (!is_javascript_whitespace(character)).then_some(floor + index + character.len_utf8())
        })
        .unwrap_or(floor)
}

fn is_javascript_whitespace(value: char) -> bool {
    matches!(
        value,
        '\u{0009}'
            ..='\u{000d}'
                | '\u{0020}'
                | '\u{00a0}'
                | '\u{1680}'
                | '\u{2000}'..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn char_at(value: &str, byte_index: usize) -> Option<char> {
    value.get(byte_index..)?.chars().next()
}

fn is_escaped(value: &str, index: usize) -> bool {
    let bytes = value.as_bytes();
    let mut cursor = index;
    let mut backslashes = 0usize;
    while cursor > 0 && bytes[cursor - 1] == b'\\' {
        backslashes += 1;
        cursor -= 1;
    }
    backslashes % 2 == 1
}

fn unescape_quoted(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\\' {
            if let Some(next) = characters.peek().copied() {
                if matches!(next, '\\' | '"' | '\'') {
                    result.push(next);
                    characters.next();
                    continue;
                }
            }
        }
        result.push(character);
    }
    result
}

fn syntax_error(
    selector: &str,
    byte_index: usize,
    message: impl Into<String>,
) -> SelectorSyntaxError {
    let byte_index = byte_index.min(selector.len());
    debug_assert!(selector.is_char_boundary(byte_index));
    let index = selector[..byte_index].encode_utf16().count();
    SelectorSyntaxError {
        selector: selector.to_owned(),
        index,
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn node(id: &str, role: &str, text: &str) -> SelectorNode {
        SelectorNode {
            id: id.to_owned(),
            role: Some(role.to_owned()),
            text: text.to_owned(),
            attributes: json!({}),
            ..SelectorNode::default()
        }
    }

    fn fixture() -> Vec<SelectorNode> {
        let mut nodes = vec![
            node(
                "document",
                "Document",
                "Annual report revenue increased in 2025. Nested note Quarterly results Metric Cell Revenue Custom semantic role",
            ), // 0
            node(
                "section-1",
                "Sect",
                "Annual report revenue increased in 2025. Nested note",
            ), // 1
            node("heading-1", "H1", "Annual report"), // 2
            node("paragraph-1", "P", "revenue increased in 2025."), // 3
            node("list", "L", "Nested note"),         // 4
            node("list-item", "LI", "Nested note"),  // 5
            node("list-body", "LBody", "Nested note"), // 6
            node("paragraph-2", "P", "Nested note"), // 7
            node(
                "section-4",
                "Sect",
                "Quarterly results Metric Cell Revenue Custom semantic role",
            ), // 8
            node("heading-2", "H2", "Quarterly results"), // 9
            node("table", "Table", "Metric Cell Revenue"), // 10
            node("row", "TR", "Metric Cell Revenue"), // 11
            node("header-cell", "TH", "Metric"),      // 12
            node("data-cell", "TD", "Cell Revenue"), // 13
            node("figure", "Figure", ""),             // 14
            node("custom", "AcmeWidget", "Custom semantic role"), // 15
            node("page-1", "page", ""),               // 16
            node("page-4", "page", ""),               // 17
        ];

        nodes[0].children = vec![1, 8];
        nodes[1].parent = Some(0);
        nodes[8].parent = Some(0);

        nodes[1].children = vec![2, 3, 4];
        nodes[2].parent = Some(1);
        nodes[3].parent = Some(1);
        nodes[4].parent = Some(1);
        nodes[2].page = Some(1);
        nodes[3].page = Some(1);
        nodes[3].attributes = json!({ "LANGUAGE": "en-US" });

        nodes[4].children = vec![5];
        nodes[5].parent = Some(4);
        nodes[5].children = vec![6];
        nodes[6].parent = Some(5);
        nodes[6].children = vec![7];
        // Exercise the child-list fallback used when `parent` is absent.
        nodes[7].page = Some(1);

        nodes[8].children = vec![9, 10, 14, 15];
        for child in [9, 10, 14, 15] {
            nodes[child].parent = Some(8);
        }
        nodes[9].pages = vec![4];
        nodes[10].pages = vec![4];
        nodes[10].children = vec![11];
        nodes[11].parent = Some(10);
        nodes[11].children = vec![12, 13];
        nodes[12].parent = Some(11);
        nodes[13].parent = Some(11);
        nodes[12].page = Some(4);
        nodes[12].attributes = json!({ "mcid": 12 });
        nodes[13].pages = vec![4];
        nodes[13].attributes = json!({ "mcids": [13, 14] });
        nodes[14].page = Some(4);
        nodes[14].attributes = json!({
            "altText": "Quarterly revenue chart",
            "actualText": "Figure one"
        });
        nodes[15].raw_role = Some("ReportHeading".to_owned());
        nodes[15].attributes = json!({ "language": "en-GB" });

        nodes[16].page = Some(1);
        nodes[16].virtual_page = true;
        nodes[17].attributes = json!({ "page": 4 });
        nodes[17].virtual_page = true;
        nodes
    }

    #[test]
    fn matches_normalized_and_unknown_roles_case_insensitively() {
        let nodes = fixture();
        assert_eq!(query(&nodes, "h1").unwrap(), vec![2]);
        assert_eq!(query(&nodes, "ACMEWIDGET").unwrap(), vec![15]);
        assert!(query(&nodes, "reportheading").unwrap().is_empty());
        assert_eq!(query(&nodes, "[rawRole=ReportHeading]").unwrap(), vec![15]);
    }

    #[test]
    fn supports_descendant_and_direct_child_combinators() {
        let nodes = fixture();
        assert_eq!(query(&nodes, "Sect > P").unwrap(), vec![3]);
        assert_eq!(query(&nodes, "Sect P").unwrap(), vec![3, 7]);
        assert_eq!(query(&nodes, "Document Sect P").unwrap(), vec![3, 7]);
        assert_eq!(query(&nodes, "Table TD").unwrap(), vec![13]);
        assert_eq!(query(&nodes, "Table > TR > TH").unwrap(), vec![12]);
    }

    #[test]
    fn matches_attribute_operators_aliases_arrays_and_case_insensitive_keys() {
        let nodes = fixture();
        assert_eq!(
            query(&nodes, "Figure[alt*=\"revenue chart\"]").unwrap(),
            vec![14]
        );
        assert_eq!(
            query(&nodes, "Figure[actualText='Figure one']").unwrap(),
            vec![14]
        );
        assert_eq!(query(&nodes, "P[language^=en]").unwrap(), vec![3]);
        assert_eq!(query(&nodes, "TD[mcid=14]").unwrap(), vec![13]);
        assert_eq!(query(&nodes, "[lang^=\"en-\"]").unwrap(), vec![3, 15]);
        assert_eq!(query(&nodes, "[type=AcmeWidget]").unwrap(), vec![15]);
        assert_eq!(query(&nodes, "[rawRole=ReportHeading]").unwrap(), vec![15]);
    }

    #[test]
    fn stringifies_numbers_like_javascript_attribute_values() {
        assert_eq!(
            javascript_number_string(serde_json::json!(1e-7).as_number().unwrap()),
            "1e-7"
        );
        assert_eq!(
            javascript_number_string(serde_json::json!(1e21).as_number().unwrap()),
            "1e+21"
        );
        assert_eq!(
            javascript_number_string(serde_json::json!(1e-6).as_number().unwrap()),
            "0.000001"
        );
        assert_eq!(
            javascript_number_string(serde_json::json!(0.24).as_number().unwrap()),
            "0.24"
        );
    }

    #[test]
    fn contains_matches_aggregate_text_and_unescapes_quotes() {
        let mut nodes = fixture();
        nodes[3].text = "revenue says a\"b".to_owned();
        assert_eq!(query(&nodes, "P:contains(revenue)").unwrap(), vec![3]);
        assert_eq!(query(&nodes, "P:contains(\"a\\\"b\")").unwrap(), vec![3]);
        assert_eq!(
            query(&nodes, "Sect:contains(\"Cell Revenue\")").unwrap(),
            vec![8]
        );
    }

    #[test]
    fn virtual_pages_add_descendant_but_not_child_ancestry() {
        let nodes = fixture();
        assert_eq!(query(&nodes, "page[page=4] H2").unwrap(), vec![9]);
        assert_eq!(query(&nodes, "page[pages=4] TD").unwrap(), vec![13]);
        assert_eq!(
            query(&nodes, "page[page=4] > H2").unwrap(),
            Vec::<usize>::new()
        );
        assert_eq!(nodes[9].parent, Some(8));
        assert_eq!(query(&nodes, "page[page=4]").unwrap(), vec![17]);
    }

    #[test]
    fn unions_groups_in_document_order_without_duplicates() {
        let nodes = fixture();
        assert_eq!(query(&nodes, "TD, H1, H2, H1").unwrap(), vec![2, 9, 13]);

        let mut comma = node("comma", "P", "Revenue, net");
        comma.page = Some(1);
        assert_eq!(
            query(&[comma], "P:contains(\"Revenue, net\"), H1").unwrap(),
            vec![0]
        );
    }

    #[test]
    fn rejects_the_same_invalid_selector_forms() {
        let nodes = fixture();
        for selector in [
            "",
            "H1,",
            ",H1",
            "> H1",
            "Sect >",
            "Sect >> P",
            "Figure[alt]",
            "Figure[alt$=chart]",
            "Figure[alt=\"chart]",
            "Figure[alt=\"chart\" \"other\"]",
            "P:unknown(revenue)",
            "P:contains()",
            "P:contains(\"revenue\"",
            "H1 .class",
        ] {
            assert!(query(&nodes, selector).is_err(), "accepted {selector:?}");
        }
    }

    #[test]
    fn reports_source_compatible_messages_and_utf16_indices() {
        let nodes = fixture();
        let error = query(&nodes, "H1,").unwrap_err();
        assert_eq!(error.index, 3);
        assert_eq!(
            error.to_string(),
            "Selector group cannot be empty at index 3 in \"H1,\""
        );

        let selector = "P:contains(\"🦀\"),";
        let error = query(&nodes, selector).unwrap_err();
        assert_eq!(error.index, selector.encode_utf16().count());

        let error = query(&nodes, "H1🦀").unwrap_err();
        assert_eq!(
            error.to_string(),
            "Unexpected token \"\\ud83e\" at index 2 in \"H1🦀\""
        );
    }

    #[test]
    fn parent_and_child_cycles_do_not_recurse_forever() {
        let mut nodes = vec![node("a", "Sect", "cycle"), node("b", "P", "cycle")];
        nodes[0].parent = Some(1);
        nodes[0].children = vec![1];
        nodes[1].parent = Some(0);
        nodes[1].children = vec![0];
        assert_eq!(query(&nodes, "Sect P").unwrap(), vec![1]);
        assert_eq!(query(&nodes, "page P").unwrap(), Vec::<usize>::new());
    }
}
