//! What the name or variable under a position refers to.

use php_index::{Name, Type};
use php_syntax::SyntaxKind::*;
use php_syntax::{SyntaxNode, SyntaxToken, TextRange, TokenAtOffset};

use crate::ast::{child_of, has_token, start, text_of};
use crate::infer::Analyzer;

/// A thing a position can refer to.
#[derive(Clone, Debug, PartialEq)]
pub enum Target {
    Class(Name),
    Function(Name),
    Constant(Name),
    /// A method on the classes a type stands for.
    Method {
        receiver: Type,
        name: String,
    },
    Property {
        receiver: Type,
        name: String,
    },
    ClassConst {
        receiver: Type,
        name: String,
    },
    /// A local variable or parameter, with the type it has there.
    Variable {
        name: String,
        ty: Type,
    },
}

/// A target with the range of the token it was found on.
#[derive(Clone, Debug, PartialEq)]
pub struct Found {
    pub target: Target,
    pub range: TextRange,
}

/// The token a navigation request is about: the one the offset is in or at the end of.
pub fn token_at(root: &SyntaxNode, offset: u32) -> Option<SyntaxToken> {
    let usable = |token: &SyntaxToken| {
        !token.kind().is_trivia()
            && (token.kind() == VARIABLE
                || token.parent().is_some_and(|parent| parent.kind() == NAME)
                || matches!(token.kind(), IDENT))
    };
    match root.token_at_offset(php_syntax::TextSize::from(offset)) {
        TokenAtOffset::None => None,
        TokenAtOffset::Single(token) => usable(&token).then_some(token),
        TokenAtOffset::Between(left, right) => {
            if usable(&right) {
                Some(right)
            } else if usable(&left) {
                Some(left)
            } else {
                None
            }
        }
    }
}

impl Analyzer<'_> {
    /// The targets under an offset. A member of a union has one per class that has it.
    pub fn targets_at(&self, offset: u32) -> Vec<Found> {
        let Some(token) = token_at(&self.root, offset) else {
            return Vec::new();
        };
        let range = token.text_range();
        let targets = if token.kind() == VARIABLE {
            self.variable_targets(&token)
        } else {
            self.name_targets(&token)
        };
        targets.into_iter().map(|target| Found { target, range }).collect()
    }

    fn variable_targets(&self, token: &SyntaxToken) -> Vec<Target> {
        let Some(parent) = token.parent() else {
            return Vec::new();
        };
        let name = token.text().trim_start_matches('$').to_string();
        match parent.kind() {
            VARIABLE_EXPR => {
                if let Some(grand) = parent.parent().filter(|grand| grand.kind() == STATIC_PROPERTY_EXPR) {
                    let qualifier = grand.children().next();
                    if qualifier.as_ref() != Some(&parent) {
                        if let Some(qualifier) = qualifier {
                            let env = self.env_at(start(&grand));
                            return vec![Target::Property {
                                receiver: self.receiver_type(&self.qualifier_type(&qualifier, &env)),
                                name,
                            }];
                        }
                    }
                }
                if name == "this" {
                    return self
                        .class
                        .as_ref()
                        .map(|class| Target::Class(class.name.clone()))
                        .into_iter()
                        .collect();
                }
                let env = self.env_at(start(&parent));
                let ty = env.get(&name).cloned().unwrap_or(Type::Unknown);
                vec![Target::Variable { name, ty }]
            }
            PROPERTY_ELEMENT => vec![Target::Property {
                receiver: self.this_type(),
                name,
            }],
            PARAMETER | CLOSURE_USE_VARIABLE | STATIC_VARIABLE => {
                let env = self.env_at(start(&parent) + 1);
                let ty = env.get(&name).cloned().unwrap_or(Type::Unknown);
                vec![Target::Variable { name, ty }]
            }
            _ => Vec::new(),
        }
    }

    fn name_targets(&self, token: &SyntaxToken) -> Vec<Target> {
        let Some(name_node) = token.parent().filter(|parent| parent.kind() == NAME) else {
            return Vec::new();
        };
        let Some(parent) = name_node.parent() else {
            return Vec::new();
        };
        let text = text_of(&name_node);
        let is_first_child = parent.children().next().as_ref() == Some(&name_node);
        match parent.kind() {
            CLASS_DECLARATION | INTERFACE_DECLARATION | TRAIT_DECLARATION | ENUM_DECLARATION => {
                vec![Target::Class(self.resolver.qualify(&text))]
            }
            FUNCTION_DECLARATION => vec![Target::Function(self.resolver.qualify(&text))],
            METHOD_DECLARATION => vec![Target::Method {
                receiver: self.this_type(),
                name: text,
            }],
            ENUM_CASE => vec![Target::ClassConst {
                receiver: self.this_type(),
                name: text,
            }],
            CONST_ELEMENT => {
                let in_class = parent
                    .parent()
                    .is_some_and(|grand| grand.kind() == CLASS_CONST_DECLARATION);
                if in_class {
                    vec![Target::ClassConst {
                        receiver: self.this_type(),
                        name: text,
                    }]
                } else {
                    vec![Target::Constant(self.resolver.qualify(&text))]
                }
            }
            NAMED_TYPE | NEW_EXPR | ATTRIBUTE | TRAIT_USE | TRAIT_PRECEDENCE | TRAIT_ALIAS => self.class_targets(&text),
            BINARY_EXPR => self.class_targets(&text),
            PROPERTY_FETCH_EXPR => {
                if is_first_child {
                    return self.expression_name_targets(&text);
                }
                let Some(object) = parent.children().next() else {
                    return Vec::new();
                };
                let env = self.env_at(start(&parent));
                let receiver = self.receiver_type(&self.type_of(&object, &env));
                let is_call = parent.parent().is_some_and(|grand| {
                    grand.kind() == CALL_EXPR && grand.children().next().as_ref() == Some(&parent)
                });
                if is_call {
                    vec![Target::Method { receiver, name: text }]
                } else {
                    vec![Target::Property { receiver, name: text }]
                }
            }
            SCOPED_ACCESS_EXPR => {
                if is_first_child {
                    return self.class_targets(&text);
                }
                let Some(qualifier) = parent.children().next() else {
                    return Vec::new();
                };
                let env = self.env_at(start(&parent));
                let receiver = self.receiver_type(&self.qualifier_type(&qualifier, &env));
                let is_call = parent.parent().is_some_and(|grand| {
                    grand.kind() == CALL_EXPR && grand.children().next().as_ref() == Some(&parent)
                });
                if is_call {
                    vec![Target::Method { receiver, name: text }]
                } else if text == "class" {
                    Vec::new()
                } else {
                    vec![Target::ClassConst { receiver, name: text }]
                }
            }
            STATIC_PROPERTY_EXPR => self.class_targets(&text),
            USE_CLAUSE => self.use_targets(&parent, &text),
            USE_GROUP => self.class_targets(&text),
            CALL_EXPR => {
                if is_first_child {
                    let candidates = self.resolver.function_candidates(&text);
                    return match self.index.first_function(&candidates) {
                        Some(function) => vec![Target::Function(function.decl.name.clone())],
                        None => Vec::new(),
                    };
                }
                self.expression_name_targets(&text)
            }
            EXTENDS_CLAUSE | IMPLEMENTS_CLAUSE => self.class_targets(&text),
            _ => self.expression_name_targets(&text),
        }
    }

    fn class_targets(&self, text: &str) -> Vec<Target> {
        match self.class_type(text) {
            Type::Class { name, .. } => vec![Target::Class(name)],
            Type::Static => self
                .class
                .as_ref()
                .map(|class| Target::Class(class.name.clone()))
                .into_iter()
                .collect(),
            _ => Vec::new(),
        }
    }

    fn expression_name_targets(&self, text: &str) -> Vec<Target> {
        if matches!(text.to_ascii_lowercase().as_str(), "true" | "false" | "null") {
            return Vec::new();
        }
        let candidates = self.resolver.constant_candidates(text);
        match self.index.first_constant(&candidates) {
            Some(constant) => vec![Target::Constant(constant.decl.name.clone())],
            None => Vec::new(),
        }
    }

    fn use_targets(&self, clause: &SyntaxNode, text: &str) -> Vec<Target> {
        let statement = clause.ancestors().find(|node| node.kind() == USE_STATEMENT);
        let kind_token = |node: &SyntaxNode| {
            if has_token(node, FUNCTION_KW) {
                Some(FUNCTION_KW)
            } else if has_token(node, CONST_KW) {
                Some(CONST_KW)
            } else {
                None
            }
        };
        let kind = kind_token(clause).or_else(|| statement.as_ref().and_then(kind_token));
        let mut full = text.trim_start_matches('\\').to_string();
        if let Some(group) = clause.parent().filter(|parent| parent.kind() == USE_GROUP) {
            if let Some(prefix) = child_of(&group, NAME) {
                full = format!("{}\\{}", text_of(&prefix).trim_end_matches('\\'), full);
            }
        }
        match kind {
            Some(FUNCTION_KW) => vec![Target::Function(full)],
            Some(CONST_KW) => vec![Target::Constant(full)],
            _ => vec![Target::Class(full)],
        }
    }
}
