//! The service container: `app('cache')` and `$this->app->make('db')` give the class the container
//! holds under a name the framework or a service provider registered.

use php_index::Type;
use php_index::framework::container;
use php_index::framework::overlay::{Marker, markers_for};

use crate::infer::{Analyzer, Arg, ResolvedCallable, literal_string};

impl Analyzer<'_> {
    /// Refines what a call to a container's `make` gives when the declared type could not say: the
    /// name in the argument is looked up among the bindings of the project and the framework.
    pub(crate) fn container_call_type(&self, callees: &[ResolvedCallable], args: &[Arg], result: Type) -> Type {
        if !matches!(result, Type::Mixed | Type::Unknown) || !self.index.frameworks().any() {
            return result;
        }
        for callee in callees {
            let (class, method) = match callee.name.split_once("::") {
                Some((class, method)) => (Some(class), method),
                None => (None, callee.name.as_str()),
            };
            for marker in markers_for(self.index, class, None, method) {
                let Marker::Container { position } = marker else {
                    continue;
                };
                let Some(name) = args
                    .get(position)
                    .and_then(|arg| arg.expr.as_ref())
                    .and_then(literal_string)
                else {
                    continue;
                };
                if let Some(found) = container::type_of(self.index, &name) {
                    return found;
                }
            }
        }
        result
    }
}
