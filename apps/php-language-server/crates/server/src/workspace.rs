//! The projects the server knows and the background work that fills their indexes.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crossbeam_channel::Sender;
use php_index::cache::path_key;
use php_index::indexer::{self, IndexEvent, IndexedFile};
use php_index::{Project, StubFile, stubs};
use php_syntax::PhpVersion;

/// What a background thread tells the main loop.
pub enum Internal {
    Project {
        root: PathBuf,
        event: IndexEvent,
    },
    StubsEvent(IndexEvent),
    /// The stubs are on disk at this path and are about to be read.
    StubsLocated(PathBuf),
    StubsFailed(String),
}

/// The names every standard library stub declares, for telling a name that a project's extensions
/// leave out from one that does not exist.
#[derive(Default)]
pub struct StubNames {
    classes: HashSet<String>,
    functions: HashSet<String>,
    constants: HashSet<String>,
}

impl StubNames {
    fn of(stubs: &[StubFile]) -> StubNames {
        let mut names = StubNames::default();
        for stub in stubs {
            names
                .classes
                .extend(stub.summary.classes.iter().map(|class| class.name.to_ascii_lowercase()));
            names.functions.extend(
                stub.summary
                    .functions
                    .iter()
                    .map(|function| function.name.to_ascii_lowercase()),
            );
            names
                .constants
                .extend(stub.summary.constants.iter().map(|constant| constant.name.clone()));
        }
        names
    }

    pub fn has_class(&self, name: &str) -> bool {
        self.classes.contains(&name.to_ascii_lowercase())
    }

    pub fn has_function(&self, name: &str) -> bool {
        self.functions.contains(&name.to_ascii_lowercase())
    }

    pub fn has_constant(&self, name: &str) -> bool {
        self.constants.contains(name)
    }
}

pub struct Workspace {
    pub projects: Vec<Project>,
    /// What belongs to no folder the client opened: the standard library and the document itself.
    pub loose: Project,
    pub stubs: Vec<StubFile>,
    pub stubs_loaded: bool,
    pub stub_names: StubNames,
    /// The folders whose files have all been read, so that a name the index lacks is missing for real.
    pub indexed: HashSet<PathBuf>,
    pub stubs_dir: Option<PathBuf>,
    pub storage: Option<PathBuf>,
    pub stubs_override: Option<PathBuf>,
    pub default_level: PhpVersion,
}

impl Workspace {
    pub fn new(storage: Option<PathBuf>, stubs_override: Option<PathBuf>, default_level: PhpVersion) -> Workspace {
        Workspace {
            projects: Vec::new(),
            loose: Project::loose(default_level),
            stubs: Vec::new(),
            stubs_loaded: false,
            stub_names: StubNames::default(),
            indexed: HashSet::new(),
            stubs_dir: None,
            storage,
            stubs_override,
            default_level,
        }
    }

    /// The index of the project a file belongs to: the deepest folder that holds it, else the loose one.
    pub fn project_position(&self, path: &Path) -> Option<usize> {
        self.projects
            .iter()
            .enumerate()
            .filter(|(_, project)| project.contains(path))
            .max_by_key(|(_, project)| project.root.components().count())
            .map(|(position, _)| position)
    }

    /// Whether the index that serves a file holds everything its project can see: the project is
    /// read, so are the standard library and the packages the project requires.
    pub fn is_ready(&self, path: &Path) -> bool {
        let Some(position) = self.project_position(path) else {
            return false;
        };
        let project = &self.projects[position];
        let packages_missing = project
            .composer
            .as_ref()
            .is_some_and(|composer| composer.requires_packages && composer.packages.is_empty());
        self.stubs_loaded && self.indexed.contains(&project.root) && !packages_missing
    }

    pub fn project_for(&self, path: &Path) -> &Project {
        match self.project_position(path) {
            Some(position) => &self.projects[position],
            None => &self.loose,
        }
    }

    pub fn project_for_mut(&mut self, path: &Path) -> &mut Project {
        match self.project_position(path) {
            Some(position) => &mut self.projects[position],
            None => &mut self.loose,
        }
    }

    pub fn project_by_root(&mut self, root: &Path) -> Option<&mut Project> {
        self.projects.iter_mut().find(|project| project.root == root)
    }

    /// Adds a folder as a project, with the stubs it needs when they are already here.
    pub fn add_folder(&mut self, root: &Path) -> bool {
        if self.projects.iter().any(|project| project.root == root) {
            return false;
        }
        let mut project = Project::open(root, self.default_level);
        if self.stubs_loaded {
            let extensions = project.extensions();
            project.index.set_stubs(&self.stubs, &extensions);
        }
        self.projects.push(project);
        true
    }

    pub fn remove_folder(&mut self, root: &Path) {
        self.indexed.remove(root);
        self.projects.retain(|project| project.root != root);
    }

    /// A new default level reaches every project that did not get its level from `composer.json`.
    pub fn set_default_level(&mut self, level: PhpVersion) {
        self.default_level = level;
        for project in self.projects.iter_mut().chain(std::iter::once(&mut self.loose)) {
            if !project.level_from_composer {
                project.level = level;
                project.index.level = level;
            }
        }
    }

    /// Every project takes the stubs its extensions ask for.
    pub fn apply_stubs(&mut self) {
        let stubs = std::mem::take(&mut self.stubs);
        for project in self.projects.iter_mut().chain(std::iter::once(&mut self.loose)) {
            let extensions = project.extensions();
            project.index.set_stubs(&stubs, &extensions);
        }
        self.stub_names = StubNames::of(&stubs);
        self.stubs = stubs;
        self.stubs_loaded = true;
    }

    pub fn start_project_job(&self, root: &Path, sender: &Sender<Internal>) {
        let Some(project) = self.projects.iter().find(|project| project.root == root) else {
            return;
        };
        let root = project.root.clone();
        let composer = project.composer.clone();
        let cache = self.storage.as_ref().map(|storage| project.cache_path(storage));
        let sender = sender.clone();
        std::thread::spawn(move || {
            let files = indexer::discover_project(&root, composer.as_ref());
            let threads = std::thread::available_parallelism().map_or(4, usize::from);
            indexer::run(files, cache.as_deref(), None, threads, &|event| {
                let _ = sender.send(Internal::Project {
                    root: root.clone(),
                    event,
                });
            });
        });
    }

    /// Finds, fetches if need be, and reads the standard library stubs.
    pub fn start_stubs_job(&self, sender: &Sender<Internal>) {
        let storage = self.storage.clone();
        let override_dir = self.stubs_override.clone();
        if storage.is_none() && override_dir.is_none() {
            return;
        }
        let sender = sender.clone();
        std::thread::spawn(move || {
            let dir = match (&override_dir, &storage) {
                (Some(dir), _) => dir.clone(),
                (None, Some(storage)) => match stubs::locate(storage) {
                    Some(dir) => dir,
                    None => match stubs::fetch(storage) {
                        Ok(dir) => dir,
                        Err(error) => {
                            let _ = sender.send(Internal::StubsFailed(error));
                            return;
                        }
                    },
                },
                (None, None) => return,
            };
            let _ = sender.send(Internal::StubsLocated(dir.clone()));
            let cache = storage
                .as_ref()
                .map(|storage| storage.join("cache").join(format!("stubs-{}.bin", path_key(&dir))));
            let files = indexer::discover_stubs(&dir);
            let threads = std::thread::available_parallelism().map_or(4, usize::from);
            indexer::run(files, cache.as_deref(), Some(&dir), threads, &|event| {
                let _ = sender.send(Internal::StubsEvent(event));
            });
        });
    }

    /// The stubs were written to the cache file: read them from there from now on.
    pub fn move_stubs_to_cache(&mut self, moved: Vec<(PathBuf, php_index::SymbolSource)>) {
        let mut sources: std::collections::HashMap<PathBuf, php_index::SymbolSource> = moved.into_iter().collect();
        for stub in &mut self.stubs {
            if let Some(source) = sources.remove(&stub.path) {
                stub.source = source;
            }
        }
    }

    /// Frees what the indexes read from the cache file and have not used lately.
    pub fn trim_indexes(&mut self, keep: usize) {
        for project in self.projects.iter_mut().chain(std::iter::once(&mut self.loose)) {
            project.index.trim(keep);
        }
    }

    pub fn add_stub_files(&mut self, files: Vec<IndexedFile>) {
        self.stubs.extend(files.into_iter().map(StubFile::from_indexed));
    }
}
