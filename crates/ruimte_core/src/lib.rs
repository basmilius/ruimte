pub mod config;
pub mod events;
pub mod rpc;
pub mod streams;

pub const VERSION: &str = match option_env!("RUIMTE_BUILD_VERSION") {
    Some(version) => version,
    None => env!("CARGO_PKG_VERSION"),
};
pub const BUILD_ID: Option<&str> = option_env!("RUIMTE_BUILD_ID");
pub const PROTOCOL_VERSION: u64 = 1;
