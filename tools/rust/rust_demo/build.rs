use std::path::PathBuf;
use walkdir::WalkDir;

fn main() {
    // Find all .proto files recursively under src/t4/v1
    let proto_files: Vec<PathBuf> = WalkDir::new("src/t4/v1")
        .into_iter()
        .filter_map(Result::ok)
        .filter(|entry| {
            entry.path().extension().map(|ext| ext == "proto").unwrap_or(false)
        })
        .map(|entry| entry.into_path())
        .collect();

    // Include path for protoc so imports like t4/v1/... work
    let proto_includes = &["src"];

    // Compile the .proto files into Rust code
    prost_build::Config::new()
        .out_dir(PathBuf::from(std::env::var("OUT_DIR").unwrap())) // optional, default is OUT_DIR
        .compile_protos(&proto_files, proto_includes)
        .expect("Failed to compile .proto files");

    println!("cargo:rerun-if-changed=src/t4/v1");
}
