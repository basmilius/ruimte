//! What the variables of a function do that a name alone does not say.

use std::collections::HashSet;

use php_syntax::SyntaxKind::*;
use php_syntax::SyntaxNode;

use crate::ast::start;
use crate::infer::arguments;
use crate::inspections::Cx;

/// The offsets of the variables that a call takes by reference, so that it may set them.
pub(crate) fn by_reference_variables(cx: &Cx, scope: &SyntaxNode) -> HashSet<u32> {
    let mut out = HashSet::new();
    for call in scope
        .descendants()
        .filter(|node| matches!(node.kind(), CALL_EXPR | NEW_EXPR))
    {
        let given = arguments(&call);
        if !given
            .iter()
            .any(|arg| arg.expr.as_ref().is_some_and(|expr| expr.kind() == VARIABLE_EXPR))
        {
            continue;
        }
        let analyzer = cx.file.analyzer(&call);
        let env = analyzer.env_around(&call);
        let callees = analyzer.callees(&call, &env);
        for (position, arg) in given.iter().enumerate() {
            let Some(expr) = arg.expr.as_ref().filter(|expr| expr.kind() == VARIABLE_EXPR) else {
                continue;
            };
            let takes_reference = callees.iter().any(|callee| {
                let params = &callee.callable.params;
                let param = match &arg.name {
                    Some(name) => params.iter().find(|param| &param.name == name),
                    None => params
                        .get(position)
                        .or_else(|| params.last().filter(|param| param.variadic)),
                };
                param.is_some_and(|param| param.by_ref)
            });
            if takes_reference {
                out.insert(start(expr));
            }
        }
    }
    out
}
