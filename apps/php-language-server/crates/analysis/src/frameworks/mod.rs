//! What Laravel and Symfony add that the type layer cannot read from declarations alone: strings that
//! name config keys, routes, views and services, and the rest of what the frameworks make up at run
//! time. The members that Eloquent and the facades make up live in `php-index`, which is where the
//! type layer finds members.

#[cfg(test)]
mod tests;
