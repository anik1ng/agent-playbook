- **Rust rides two more jobs, one per workflow**, because this repo holds a Cargo.toml:
  **CI** carries `rust (format, clippy, test)` — rustfmt, clippy with warnings denied, and
  `cargo test`, through the `format:check:rust` / `lint:rust` / `test:rust` scripts in
  `package.json`. The pre-push hook runs the first two; `test:rust` compiles the whole
  crate and stays with CI. `ci-docs.yml` carries its no-op twin, so it can be a required
  check like `checks`. **Security** carries `cargo audit (RustSec advisories)`, through
  `audit:rust`. A red `cargo audit` on a PR that touched no Rust is the quarantine
  working, not a broken pipeline: an advisory was published against a crate already in
  `Cargo.lock`. The fix is a bump — Dependabot's cargo PRs usually carry it, and a
  security update bypasses the cooldown — and `--ignore RUSTSEC-…` in the script is the
  last resort, with its reason and a removal date in a comment, the same rule as a
  package-manager exclude. Locally, the two hook scripts need
  `rustup component add rustfmt clippy` once, and `audit:rust` needs
  `cargo install cargo-audit`; CI installs its own.
