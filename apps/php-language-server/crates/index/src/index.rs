//! The index of one project: the declarations of its files, of the packages it installed and of the
//! standard library, with the maps that find a declaration by name.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use php_syntax::PhpVersion;
use serde::{Deserialize, Serialize};

use crate::model::{ClassDecl, ConstDecl, FileSymbols, Function};
use crate::types::Name;

pub type FileId = u32;

/// Where a file comes from. A project file wins over a package that declares the same name, and a
/// package over the standard library.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub enum Origin {
    Project,
    Vendor,
    Stub,
}

#[derive(Clone, Debug)]
pub struct FileEntry {
    pub path: PathBuf,
    pub origin: Origin,
    pub symbols: Arc<FileSymbols>,
}

/// A file of the standard library, ready to be added to the index of a project.
#[derive(Clone, Debug)]
pub struct StubFile {
    pub path: PathBuf,
    /// The normalized name of the extension folder.
    pub extension: String,
    pub symbols: Arc<FileSymbols>,
}

#[derive(Clone, Copy)]
pub struct Class<'a> {
    pub file: &'a FileEntry,
    pub decl: &'a ClassDecl,
}

#[derive(Clone, Copy)]
pub struct FunctionRef<'a> {
    pub file: &'a FileEntry,
    pub decl: &'a Function,
}

#[derive(Clone, Copy)]
pub struct ConstRef<'a> {
    pub file: &'a FileEntry,
    pub decl: &'a ConstDecl,
}

type Slot = (FileId, u32);

pub struct Index {
    pub level: PhpVersion,
    files: Vec<Option<FileEntry>>,
    by_path: HashMap<PathBuf, FileId>,
    classes: HashMap<String, Vec<Slot>>,
    functions: HashMap<String, Vec<Slot>>,
    constants: HashMap<String, Vec<Slot>>,
    /// Direct subtypes by the lowercase name of the class they extend, implement or use.
    subtypes: HashMap<String, Vec<Slot>>,
    /// The folders of the standard library this index shows, by normalized name.
    pub stub_extensions: Vec<String>,
}

fn class_key(name: &str) -> String {
    name.to_ascii_lowercase()
}

/// A constant's namespace is case-insensitive and its own name is not.
fn constant_key(name: &str) -> String {
    match name.rsplit_once('\\') {
        Some((namespace, short)) => format!("{}\\{short}", namespace.to_ascii_lowercase()),
        None => name.to_string(),
    }
}

impl Index {
    pub fn new(level: PhpVersion) -> Index {
        Index {
            level,
            files: Vec::new(),
            by_path: HashMap::new(),
            classes: HashMap::new(),
            functions: HashMap::new(),
            constants: HashMap::new(),
            subtypes: HashMap::new(),
            stub_extensions: Vec::new(),
        }
    }

    pub fn file_count(&self) -> usize {
        self.by_path.len()
    }

    pub fn class_count(&self) -> usize {
        self.classes.values().map(Vec::len).sum()
    }

    pub fn function_count(&self) -> usize {
        self.functions.values().map(Vec::len).sum()
    }

    pub fn file(&self, path: &Path) -> Option<&FileEntry> {
        let id = *self.by_path.get(path)?;
        self.files.get(id as usize)?.as_ref()
    }

    pub fn contains_file(&self, path: &Path) -> bool {
        self.by_path.contains_key(path)
    }

    /// Adds a file, or replaces what the index knew of it.
    pub fn set_file(&mut self, path: PathBuf, origin: Origin, symbols: Arc<FileSymbols>) {
        self.remove_file(&path);
        let id = self.files.len() as FileId;
        for (index, class) in symbols.classes.iter().enumerate() {
            let slot = (id, index as u32);
            self.classes.entry(class_key(&class.name)).or_default().push(slot);
            for parent in class
                .extends
                .iter()
                .chain(&class.implements)
                .chain(class.trait_uses.iter().map(|usage| &usage.ty))
            {
                for name in parent.class_names() {
                    self.subtypes.entry(class_key(name)).or_default().push(slot);
                }
            }
        }
        for (index, function) in symbols.functions.iter().enumerate() {
            self.functions
                .entry(class_key(&function.name))
                .or_default()
                .push((id, index as u32));
        }
        for (index, constant) in symbols.constants.iter().enumerate() {
            self.constants
                .entry(constant_key(&constant.name))
                .or_default()
                .push((id, index as u32));
        }
        self.by_path.insert(path.clone(), id);
        self.files.push(Some(FileEntry { path, origin, symbols }));
    }

    pub fn remove_file(&mut self, path: &Path) {
        let Some(id) = self.by_path.remove(path) else {
            return;
        };
        let Some(entry) = self.files[id as usize].take() else {
            return;
        };
        let drop_slots = |map: &mut HashMap<String, Vec<Slot>>, key: String| {
            if let Some(slots) = map.get_mut(&key) {
                slots.retain(|(file, _)| *file != id);
                if slots.is_empty() {
                    map.remove(&key);
                }
            }
        };
        for class in &entry.symbols.classes {
            drop_slots(&mut self.classes, class_key(&class.name));
            for parent in class
                .extends
                .iter()
                .chain(&class.implements)
                .chain(class.trait_uses.iter().map(|usage| &usage.ty))
            {
                for name in parent.class_names() {
                    drop_slots(&mut self.subtypes, class_key(name));
                }
            }
        }
        for function in &entry.symbols.functions {
            drop_slots(&mut self.functions, class_key(&function.name));
        }
        for constant in &entry.symbols.constants {
            drop_slots(&mut self.constants, constant_key(&constant.name));
        }
    }

    /// Adds the standard library files of the extensions this index shows, and forgets the ones it
    /// showed before.
    pub fn set_stubs(&mut self, stubs: &[StubFile], extensions: &[String]) {
        let old: Vec<PathBuf> = self
            .files
            .iter()
            .flatten()
            .filter(|entry| entry.origin == Origin::Stub)
            .map(|entry| entry.path.clone())
            .collect();
        for path in old {
            self.remove_file(&path);
        }
        self.stub_extensions = extensions.to_vec();
        for stub in stubs {
            if extensions.contains(&stub.extension) || stub.extension.is_empty() {
                self.set_file(stub.path.clone(), Origin::Stub, stub.symbols.clone());
            }
        }
    }

    fn pick<'a, T>(
        &'a self,
        slots: &[Slot],
        get: impl Fn(&'a FileEntry, u32) -> Option<(&'a T, bool)>,
    ) -> Option<(&'a FileEntry, &'a T)> {
        let mut best: Option<(&'a FileEntry, &'a T)> = None;
        for (file, index) in slots {
            let Some(entry) = self.files.get(*file as usize).and_then(Option::as_ref) else {
                continue;
            };
            let Some((decl, available)) = get(entry, *index) else {
                continue;
            };
            if !available {
                continue;
            }
            match best {
                Some((current, _)) if current.origin <= entry.origin => {}
                _ => best = Some((entry, decl)),
            }
        }
        best
    }

    pub fn class(&self, name: &str) -> Option<Class<'_>> {
        let slots = self.classes.get(&class_key(name.trim_start_matches('\\')))?;
        self.pick(slots, |entry, index| {
            let decl = entry.symbols.classes.get(index as usize)?;
            Some((decl, decl.availability.contains(self.level)))
        })
        .map(|(file, decl)| Class { file, decl })
    }

    pub fn function(&self, name: &str) -> Option<FunctionRef<'_>> {
        let slots = self.functions.get(&class_key(name.trim_start_matches('\\')))?;
        self.pick(slots, |entry, index| {
            let decl = entry.symbols.functions.get(index as usize)?;
            Some((decl, decl.availability.contains(self.level)))
        })
        .map(|(file, decl)| FunctionRef { file, decl })
    }

    pub fn constant(&self, name: &str) -> Option<ConstRef<'_>> {
        let slots = self.constants.get(&constant_key(name.trim_start_matches('\\')))?;
        self.pick(slots, |entry, index| {
            let decl = entry.symbols.constants.get(index as usize)?;
            Some((decl, decl.availability.contains(self.level)))
        })
        .map(|(file, decl)| ConstRef { file, decl })
    }

    /// The first function of a list of candidate names, which is how PHP falls back to the global
    /// namespace.
    pub fn first_function(&self, candidates: &[Name]) -> Option<FunctionRef<'_>> {
        candidates.iter().find_map(|name| self.function(name))
    }

    pub fn first_constant(&self, candidates: &[Name]) -> Option<ConstRef<'_>> {
        candidates.iter().find_map(|name| self.constant(name))
    }

    pub fn classes(&self) -> impl Iterator<Item = Class<'_>> {
        self.files
            .iter()
            .flatten()
            .flat_map(|file| file.symbols.classes.iter().map(move |decl| Class { file, decl }))
            .filter(|class| class.decl.availability.contains(self.level))
    }

    pub fn functions(&self) -> impl Iterator<Item = FunctionRef<'_>> {
        self.files
            .iter()
            .flatten()
            .flat_map(|file| {
                file.symbols
                    .functions
                    .iter()
                    .map(move |decl| FunctionRef { file, decl })
            })
            .filter(|function| function.decl.availability.contains(self.level))
    }

    pub fn constants(&self) -> impl Iterator<Item = ConstRef<'_>> {
        self.files
            .iter()
            .flatten()
            .flat_map(|file| file.symbols.constants.iter().map(move |decl| ConstRef { file, decl }))
            .filter(|constant| constant.decl.availability.contains(self.level))
    }

    /// The classes that name another class in `extends`, `implements` or a trait `use`.
    pub fn direct_subtypes(&self, name: &str) -> Vec<Class<'_>> {
        let Some(slots) = self.subtypes.get(&class_key(name.trim_start_matches('\\'))) else {
            return Vec::new();
        };
        slots
            .iter()
            .filter_map(|(file, index)| {
                let entry = self.files.get(*file as usize)?.as_ref()?;
                let decl = entry.symbols.classes.get(*index as usize)?;
                Some(Class { file: entry, decl })
            })
            .filter(|class| class.decl.availability.contains(self.level))
            .collect()
    }

    /// Every class below another one, through any number of steps.
    pub fn all_subtypes(&self, name: &str) -> Vec<Class<'_>> {
        let mut out: Vec<Class<'_>> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut queue = vec![name.to_string()];
        while let Some(current) = queue.pop() {
            for class in self.direct_subtypes(&current) {
                if seen.insert(class_key(&class.decl.name)) {
                    queue.push(class.decl.name.clone());
                    out.push(class);
                }
            }
        }
        out
    }

    /// Every file's path and origin.
    pub fn files(&self) -> impl Iterator<Item = &FileEntry> {
        self.files.iter().flatten()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::extract::{ExtractOptions, extract};
    use php_syntax::parse;

    fn symbols(text: &str, stub: bool) -> Arc<FileSymbols> {
        Arc::new(extract(&parse(text).syntax(), ExtractOptions { stub }))
    }

    #[test]
    fn finds_declarations_by_name_and_prefers_the_project() {
        let mut index = Index::new(PhpVersion::V8_4);
        index.set_file(
            PathBuf::from("/stubs/a.php"),
            Origin::Stub,
            symbols("<?php class Foo {} function strlen() {} const E = 1;", true),
        );
        index.set_file(
            PathBuf::from("/p/foo.php"),
            Origin::Project,
            symbols("<?php namespace P; class Foo {} function strlen() {}", false),
        );
        assert_eq!(index.class("foo").unwrap().file.origin, Origin::Stub);
        assert_eq!(index.class("P\\FOO").unwrap().file.origin, Origin::Project);
        assert_eq!(index.function("strlen").unwrap().file.origin, Origin::Stub);
        assert!(index.constant("E").is_some());
        assert!(index.constant("e").is_none());
        index.remove_file(Path::new("/stubs/a.php"));
        assert!(index.class("Foo").is_none());
    }

    #[test]
    fn hides_what_the_level_does_not_have() {
        let text = "<?php /** @since 8.2 */ class New82 {} /** @removed 8.0 */ class Gone80 {} class Always {}";
        let mut old = Index::new(PhpVersion::V8_1);
        old.set_file(PathBuf::from("/s.php"), Origin::Stub, symbols(text, true));
        assert!(old.class("New82").is_none());
        assert!(old.class("Gone80").is_none());
        assert!(old.class("Always").is_some());
        let mut new = Index::new(PhpVersion::V8_4);
        new.set_file(PathBuf::from("/s.php"), Origin::Stub, symbols(text, true));
        assert!(new.class("New82").is_some());
        assert_eq!(new.classes().count(), 2);
    }

    #[test]
    fn tracks_subtypes_and_replaces_a_file() {
        let mut index = Index::new(PhpVersion::V8_4);
        index.set_file(
            PathBuf::from("/a.php"),
            Origin::Project,
            symbols(
                "<?php interface I {} class A implements I {} class B extends A {}",
                false,
            ),
        );
        let names: Vec<&str> = index
            .all_subtypes("I")
            .iter()
            .map(|class| class.decl.name.as_str())
            .collect();
        assert_eq!(names.len(), 2);
        index.set_file(
            PathBuf::from("/a.php"),
            Origin::Project,
            symbols("<?php interface I {} class A {}", false),
        );
        assert!(index.all_subtypes("I").is_empty());
        assert_eq!(index.class_count(), 2);
    }

    #[test]
    fn only_shows_the_selected_extensions() {
        let stubs = vec![
            StubFile {
                path: PathBuf::from("/s/standard/a.php"),
                extension: "standard".into(),
                symbols: symbols("<?php function a() {}", true),
            },
            StubFile {
                path: PathBuf::from("/s/swoole/b.php"),
                extension: "swoole".into(),
                symbols: symbols("<?php function b() {}", true),
            },
        ];
        let mut index = Index::new(PhpVersion::V8_4);
        index.set_stubs(&stubs, &["standard".to_string()]);
        assert!(index.function("a").is_some());
        assert!(index.function("b").is_none());
        index.set_stubs(&stubs, &["swoole".to_string()]);
        assert!(index.function("a").is_none());
        assert!(index.function("b").is_some());
    }
}
