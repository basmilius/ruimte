//! Hover, go to definition, go to type definition and go to implementation, all over the targets
//! that [`Analyzer::targets_at`] finds.

use std::path::PathBuf;

use php_index::{Class, Doc, FileEntry, Span, Type};
use php_syntax::SyntaxKind::*;
use php_syntax::TextRange;

use crate::infer::Analyzer;
use crate::render;
use crate::target::{Callee, Target};

/// A place in a file. `path` is `None` for the file the question was asked about.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Place {
    pub path: Option<PathBuf>,
    pub span: Span,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HoverResult {
    pub markdown: String,
    pub range: TextRange,
}

/// A declaration described for a person: what it is called, how it is written and what its doc says.
pub struct Description {
    pub title: String,
    pub signature: String,
    pub doc: Option<Doc>,
    pub place: Option<Place>,
}

fn place_of(file: &FileEntry, span: Span) -> Place {
    Place {
        path: Some(file.path.clone()),
        span,
    }
}

fn class_place(class: Class<'_>) -> Place {
    place_of(class.file, class.decl.name_span)
}

impl Analyzer<'_> {
    /// Everything the targets under an offset stand for, ready to show.
    pub fn describe(&self, target: &Target) -> Vec<Description> {
        let level = self.level();
        match target {
            Target::Class(name) => self
                .index
                .class(name)
                .map(|class| Description {
                    title: class.decl.name.clone(),
                    signature: render::class_signature(class.decl),
                    doc: class.decl.doc.as_deref().cloned(),
                    place: Some(class_place(class)),
                })
                .into_iter()
                .collect(),
            Target::Function(name) => self
                .index
                .function(name)
                .map(|function| Description {
                    title: function.decl.name.clone(),
                    signature: render::function_signature(
                        crate::short(&function.decl.name),
                        &function.decl.callable,
                        level,
                    ),
                    doc: function.decl.doc.as_deref().cloned(),
                    place: Some(place_of(function.file, function.decl.name_span)),
                })
                .into_iter()
                .collect(),
            Target::Constant(name) => self
                .index
                .constant(name)
                .map(|constant| {
                    let mut signature = format!("const {}", crate::short(&constant.decl.name));
                    if let Some(value) = &constant.decl.value {
                        signature.push_str(&format!(" = {value}"));
                    }
                    Description {
                        title: constant.decl.name.clone(),
                        signature,
                        doc: constant.decl.doc.as_deref().cloned(),
                        place: Some(place_of(constant.file, constant.decl.name_span)),
                    }
                })
                .into_iter()
                .collect(),
            Target::Method { receiver, name }
                if crate::pest::is_expectation(receiver)
                    && receiver
                        .members()
                        .iter()
                        .all(|member| self.index.find_method(member, name).is_none()) =>
            {
                self.custom_expectation(name)
                    .map(|expectation| Description {
                        title: format!("expect()->{name}()"),
                        signature: format!("expect()->extend('{name}', ...)"),
                        doc: None,
                        place: Some(Place {
                            path: expectation.path,
                            span: expectation.span,
                        }),
                    })
                    .into_iter()
                    .collect()
            }
            Target::Method { receiver, name } => receiver
                .members()
                .iter()
                .filter_map(|member| {
                    let found = self.index.find_method(member, name)?;
                    let doc = found
                        .member
                        .doc
                        .as_deref()
                        .filter(|doc| !doc.summary.is_empty() || !doc.params.is_empty() || doc.ret.is_some())
                        .cloned()
                        .or_else(|| self.inherited_method_doc(member, name));
                    Some(Description {
                        title: format!("{}::{}", found.class.decl.name, found.member.name),
                        signature: render::method_signature(&found.member, level),
                        doc,
                        place: Some(place_of(found.class.file, found.member.name_span)),
                    })
                })
                .collect(),
            Target::Property { receiver, name } => receiver
                .members()
                .iter()
                .filter_map(|member| {
                    let found = self.index.find_property(member, name)?;
                    Some(Description {
                        title: format!("{}::${}", found.class.decl.name, found.member.name),
                        signature: render::property_signature(&found.member, level),
                        doc: found.member.doc.as_deref().cloned(),
                        place: Some(place_of(found.class.file, found.member.name_span)),
                    })
                })
                .collect(),
            Target::ClassConst { receiver, name } => receiver
                .members()
                .iter()
                .filter_map(|member| {
                    let found = self.index.find_constant(member, name)?;
                    Some(Description {
                        title: format!("{}::{}", found.class.decl.name, found.member.name),
                        signature: render::constant_signature(&found.member, level),
                        doc: found.member.doc.as_deref().cloned(),
                        place: Some(place_of(found.class.file, found.member.name_span)),
                    })
                })
                .collect(),
            Target::Parameter { callee, name } => self.describe_parameter(callee, name),
            Target::Dataset(name) => crate::pest::dataset_declarations(self.index, name)
                .into_iter()
                .map(|declaration| Description {
                    title: format!("dataset '{name}'"),
                    signature: format!("dataset('{name}', ...)"),
                    doc: None,
                    place: Some(Place {
                        path: Some(declaration.path),
                        span: declaration.name_span,
                    }),
                })
                .collect(),
            Target::Variable { name, ty } => vec![Description {
                title: format!("${name}"),
                signature: format!("{} ${name}", ty.display(true)),
                doc: None,
                place: None,
            }],
        }
    }

    fn parameter_type(&self, callee: &Callee, name: &str) -> Option<Type> {
        let level = self.level();
        let callable = match callee {
            Callee::Function(function) => self.index.function(function)?.decl.callable.clone(),
            Callee::Method { class, name: method } => self.index.class(class)?.decl.method(method)?.callable.clone(),
        };
        let param = callable.params_at(level).find(|param| param.name == name)?;
        param.effective_type(level).cloned()
    }

    fn describe_parameter(&self, callee: &Callee, name: &str) -> Vec<Description> {
        let level = self.level();
        let (file, callable) = match callee {
            Callee::Function(function) => {
                let Some(found) = self.index.function(function) else {
                    return Vec::new();
                };
                (found.file, &found.decl.callable)
            }
            Callee::Method { class, name: method } => {
                let Some(class) = self.index.class(class) else {
                    return Vec::new();
                };
                let Some(found) = class.decl.method(method) else {
                    return Vec::new();
                };
                (class.file, &found.callable)
            }
        };
        let Some(param) = callable.params_at(level).find(|param| param.name == name) else {
            return Vec::new();
        };
        let doc = (!param.description.is_empty()).then(|| Doc {
            summary: param.description.clone(),
            ..Doc::default()
        });
        vec![Description {
            title: format!("${name}"),
            signature: render::param_text(param, level),
            doc,
            place: Some(place_of(file, param.span)),
        }]
    }

    /// The doc of a method with the same name further up, for a method that has none of its own.
    fn inherited_method_doc(&self, receiver: &Type, name: &str) -> Option<Doc> {
        for ancestor in self.index.ancestors(receiver) {
            let Some(method) = ancestor.class.decl.method(name) else {
                continue;
            };
            if let Some(doc) = method
                .doc
                .as_deref()
                .filter(|doc| !doc.summary.is_empty() || doc.ret.is_some())
            {
                return Some(doc.clone());
            }
        }
        None
    }

    pub fn hover(&self, offset: u32) -> Option<HoverResult> {
        let found = self.targets_at(offset);
        let range = found.first()?.range;
        let mut sections = Vec::new();
        for item in &found {
            for description in self.describe(&item.target) {
                sections.push(hover_markdown(&description));
            }
        }
        sections.dedup();
        if sections.is_empty() {
            return None;
        }
        Some(HoverResult {
            markdown: sections.join("\n\n---\n\n"),
            range,
        })
    }

    pub fn definitions(&self, offset: u32) -> Vec<Place> {
        let mut places = Vec::new();
        for found in self.targets_at(offset) {
            if let Target::Variable { name, .. } = &found.target {
                if let Some(place) = self.variable_declaration(name, offset) {
                    places.push(place);
                }
                continue;
            }
            for description in self.describe(&found.target) {
                places.extend(description.place);
            }
        }
        places.dedup();
        places
    }

    /// The first place a variable shows up in its scope, which is where it is declared or first set.
    fn variable_declaration(&self, name: &str, offset: u32) -> Option<Place> {
        let scope = self.scope_at(offset);
        let wanted = format!("${name}");
        scope
            .descendants_with_tokens()
            .filter_map(|element| element.into_token())
            .find(|token| token.kind() == VARIABLE && token.text() == wanted)
            .map(|token| Place {
                path: None,
                span: Span {
                    start: u32::from(token.text_range().start()),
                    end: u32::from(token.text_range().end()),
                },
            })
    }

    pub fn type_definitions(&self, offset: u32) -> Vec<Place> {
        let mut places = Vec::new();
        for found in self.targets_at(offset) {
            let ty = match &found.target {
                Target::Class(_) => {
                    for description in self.describe(&found.target) {
                        places.extend(description.place);
                    }
                    continue;
                }
                Target::Variable { ty, .. } => ty.clone(),
                Target::Property { receiver, name } => self.property_on(receiver, name),
                Target::Method { receiver, name } => {
                    let level = self.level();
                    Type::union(receiver.members().iter().filter_map(|member| {
                        let found = self.index.find_method(member, name)?;
                        let ret = found.member.callable.effective_return(level)?;
                        Some(self.bind_static(&found.resolve(ret), member))
                    }))
                }
                Target::ClassConst { receiver, name } => {
                    let level = self.level();
                    Type::union(receiver.members().iter().filter_map(|member| {
                        let found = self.index.find_constant(member, name)?;
                        if found.member.is_case {
                            return Some(member.clone());
                        }
                        found.member.effective_type(level).map(|ty| found.resolve(ty))
                    }))
                }
                Target::Function(name) => {
                    let level = self.level();
                    match self
                        .index
                        .function(name)
                        .and_then(|function| function.decl.callable.effective_return(level).cloned())
                    {
                        Some(ty) => ty,
                        None => continue,
                    }
                }
                Target::Constant(_) | Target::Dataset(_) => continue,
                Target::Parameter { callee, name } => match self.parameter_type(callee, name) {
                    Some(ty) => ty,
                    None => continue,
                },
            };
            let receiver = self.receiver_type(&ty);
            let mut names: Vec<String> = receiver.class_names().into_iter().map(str::to_string).collect();
            names.extend(class_names_in_args(&receiver));
            for name in names {
                if let Some(class) = self.index.class(&name) {
                    places.push(class_place(class));
                }
            }
        }
        places.dedup();
        places
    }

    pub fn implementations(&self, offset: u32) -> Vec<Place> {
        let mut places = Vec::new();
        for found in self.targets_at(offset) {
            match &found.target {
                Target::Class(name) => {
                    places.extend(self.index.all_subtypes(name).into_iter().map(class_place));
                }
                Target::Method { receiver, name } => {
                    for member in receiver.members() {
                        let Some(declaring) = self.index.find_method(member, name) else {
                            continue;
                        };
                        for subtype in self.index.all_subtypes(&declaring.class.decl.name) {
                            if let Some(method) = subtype.decl.method(name) {
                                places.push(place_of(subtype.file, method.name_span));
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        places.dedup();
        places
    }
}

fn class_names_in_args(ty: &Type) -> Vec<String> {
    let mut out = Vec::new();
    for member in ty.members() {
        if let Type::Class { args, .. } = member {
            for arg in args {
                out.extend(arg.class_names().into_iter().map(str::to_string));
            }
        }
    }
    out
}

/// A title line, the signature in a `php` block and the doc.
pub fn hover_markdown(description: &Description) -> String {
    let mut out = format!("**{}**\n\n```php\n{}\n```", description.title, description.signature);
    if let Some(doc) = &description.doc {
        let text = render::doc_markdown(doc);
        if !text.is_empty() {
            out.push_str("\n\n");
            out.push_str(&text);
        }
    }
    out
}
