#[tokio::main]
async fn main() {
    let args = std::env::args().skip(1).collect();
    std::process::exit(ruimte_cli::cli::run_context(args).await);
}
