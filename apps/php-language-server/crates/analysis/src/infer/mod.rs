//! A type layer good enough to complete members: what a variable or an expression is at a point of a
//! file. Declared types, PHPDoc types, assignments, `new`, calls with template arguments bound from
//! their arguments, `instanceof` and null checks, `foreach` and destructuring are followed. What is
//! not followed (references, loops reaching a fixed point, dynamic names, return types inferred from
//! bodies) comes out as `Type::Unknown`.

mod calls;
mod expr;
mod flow;
mod unify;

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::rc::Rc;

use php_index::extract::resolver_at;
use php_index::{ClassKind, Index, Name, NameResolver, Type};
use php_syntax::SyntaxKind::*;
use php_syntax::SyntaxNode;

use crate::ast::{self, child_of, node_at, text_of};

pub use calls::{Arg, ResolvedCallable};

/// The variables in scope and their types, without the `$`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Env {
    pub vars: BTreeMap<String, Type>,
}

impl Env {
    pub fn get(&self, name: &str) -> Option<&Type> {
        self.vars.get(name)
    }

    pub fn set(&mut self, name: impl Into<String>, ty: Type) {
        self.vars.insert(name.into(), ty);
    }
}

/// The class around a point of a file.
#[derive(Clone, Debug, PartialEq)]
pub struct ClassContext {
    pub name: Name,
    pub parent: Option<Name>,
    pub kind: ClassKind,
    pub anonymous: bool,
}

pub struct Analyzer<'a> {
    pub index: &'a Index,
    pub root: SyntaxNode,
    /// The namespace and imports at the offset the analyzer was made for.
    pub resolver: NameResolver,
    pub class: Option<ClassContext>,
    depth: Cell<u32>,
    /// The variables at the start of a statement, by the offset of that start.
    envs: RefCell<HashMap<u32, Rc<Env>>>,
}

const MAX_DEPTH: u32 = 48;

impl<'a> Analyzer<'a> {
    pub fn new(index: &'a Index, root: &SyntaxNode, offset: u32) -> Analyzer<'a> {
        let resolver = resolver_at(root, offset);
        let class = class_context(root, offset, &resolver);
        Analyzer {
            index,
            root: root.clone(),
            resolver,
            class,
            depth: Cell::new(0),
            envs: RefCell::new(HashMap::new()),
        }
    }

    /// The variables in scope where the statement around a node begins. Everything in one statement
    /// shares the answer, so a pass over a whole file follows each function body once per statement.
    pub fn env_around(&self, node: &SyntaxNode) -> Rc<Env> {
        let anchor = ast::statement_anchor(node);
        if let Some(env) = self.envs.borrow().get(&anchor) {
            return env.clone();
        }
        let env = Rc::new(self.env_at(anchor));
        self.envs.borrow_mut().insert(anchor, env.clone());
        env
    }

    pub fn level(&self) -> php_syntax::PhpVersion {
        self.index.level
    }

    /// Runs a step of inference with a guard against runaway recursion.
    fn guarded<T>(&self, fallback: T, step: impl FnOnce() -> T) -> T {
        if self.depth.get() >= MAX_DEPTH {
            return fallback;
        }
        self.depth.set(self.depth.get() + 1);
        let result = step();
        self.depth.set(self.depth.get() - 1);
        result
    }

    /// The class a written name stands for in a type or `new`: `self`, `static` and `parent` follow
    /// the class around the offset.
    pub fn class_type(&self, raw: &str) -> Type {
        match raw.to_ascii_lowercase().as_str() {
            "self" => self
                .class
                .as_ref()
                .map_or(Type::Unknown, |class| Type::class(class.name.clone())),
            "static" => Type::Static,
            "parent" => self
                .class
                .as_ref()
                .and_then(|class| class.parent.clone())
                .map_or(Type::Unknown, Type::class),
            _ => Type::class(self.resolver.resolve_class(raw)),
        }
    }

    /// The type `$this` has: the enclosing class.
    pub fn this_type(&self) -> Type {
        match &self.class {
            Some(class) if class.anonymous => class.parent.clone().map_or(Type::Unknown, Type::class),
            Some(class) => Type::class(class.name.clone()),
            None => Type::Unknown,
        }
    }

    /// Binds `static` in a type to the receiver the member was found on.
    pub fn bind_static(&self, ty: &Type, receiver: &Type) -> Type {
        ty.substitute(&Default::default(), Some(receiver), None)
    }

    /// The function-like node around an offset, or the file.
    pub fn scope_at(&self, offset: u32) -> SyntaxNode {
        let node = node_at(&self.root, offset);
        for ancestor in node.ancestors() {
            if ast::is_function_like(ancestor.kind()) {
                return ancestor;
            }
        }
        self.root.clone()
    }
}

fn class_context(root: &SyntaxNode, offset: u32, resolver: &NameResolver) -> Option<ClassContext> {
    let node = node_at(root, offset);
    for ancestor in node.ancestors() {
        let kind = match ancestor.kind() {
            CLASS_DECLARATION => ClassKind::Class,
            INTERFACE_DECLARATION => ClassKind::Interface,
            TRAIT_DECLARATION => ClassKind::Trait,
            ENUM_DECLARATION => ClassKind::Enum,
            ANONYMOUS_CLASS => ClassKind::Class,
            _ => continue,
        };
        let anonymous = ancestor.kind() == ANONYMOUS_CLASS;
        let parent = child_of(&ancestor, EXTENDS_CLAUSE)
            .and_then(|clause| clause.descendants().find(|node| node.kind() == NAME))
            .map(|name| resolver.resolve_class(&text_of(&name)))
            .or_else(|| {
                anonymous
                    .then(|| {
                        child_of(&ancestor, IMPLEMENTS_CLAUSE)
                            .and_then(|clause| clause.descendants().find(|node| node.kind() == NAME))
                            .map(|name| resolver.resolve_class(&text_of(&name)))
                    })
                    .flatten()
            });
        let name = if anonymous {
            "class@anonymous".to_string()
        } else {
            child_of(&ancestor, NAME).map(|name| resolver.qualify(&text_of(&name)))?
        };
        return Some(ClassContext {
            name,
            parent,
            kind,
            anonymous,
        });
    }
    None
}

#[cfg(test)]
mod tests;
