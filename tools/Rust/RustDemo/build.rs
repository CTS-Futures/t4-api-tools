//! Compile the shared T4 protos into Rust with a pure-Rust pipeline
//! (`protox` parser -> `prost-build` codegen), so no external `protoc` is
//! required. The canonical proto tree at `../../../proto` stays the single
//! source of truth — we only stage a BOM-stripped copy into `OUT_DIR` before
//! compiling (protox rejects the UTF-8 BOM that some of the files carry).

use std::fs;
use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let src_root = PathBuf::from("../../../proto");
    let out_dir = PathBuf::from(std::env::var("OUT_DIR")?);
    let staged_root = out_dir.join("proto");

    // Order-independent; matches `proto/protos.txt`.
    let files = [
        "t4/v1/common/enums.proto",
        "t4/v1/common/price.proto",
        "t4/v1/auth/auth.proto",
        "t4/v1/market/market.proto",
        "t4/v1/account/account.proto",
        "t4/v1/orderrouting/orderrouting.proto",
        "t4/v1/service.proto",
    ];

    for f in files {
        let src = src_root.join(f);
        println!("cargo:rerun-if-changed={}", src.display());

        let mut bytes = fs::read(&src)?;
        if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            bytes.drain(0..3); // strip UTF-8 BOM
        }

        let dst = staged_root.join(f);
        if let Some(parent) = dst.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&dst, &bytes)?;
    }

    // protox resolves imports (including the bundled google.protobuf well-known
    // types) and produces a FileDescriptorSet that prost-build turns into Rust.
    let file_descriptors = protox::compile(files, [&staged_root])?;
    prost_build::Config::new().compile_fds(file_descriptors)?;

    Ok(())
}
