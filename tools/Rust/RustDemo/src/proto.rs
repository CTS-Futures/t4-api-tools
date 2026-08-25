//! Generated protobuf types.
//!
//! `build.rs` emits one file per proto package into `OUT_DIR`
//! (`t4proto.v1.common.rs`, `…auth.rs`, …). We re-nest them here so the module
//! path matches the package path (`t4proto::v1::common`, …), which is what the
//! prost-generated cross-references (`super::common::…`) expect.

pub mod t4proto {
    pub mod v1 {
        pub mod common {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.common.rs"));
        }
        pub mod auth {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.auth.rs"));
        }
        pub mod market {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.market.rs"));
        }
        pub mod account {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.account.rs"));
        }
        pub mod orderrouting {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.orderrouting.rs"));
        }
        pub mod service {
            include!(concat!(env!("OUT_DIR"), "/t4proto.v1.service.rs"));
        }
    }
}

// Convenient flat aliases used throughout the crate.
pub use t4proto::v1::account;
pub use t4proto::v1::auth;
pub use t4proto::v1::common;
pub use t4proto::v1::market;
pub use t4proto::v1::orderrouting;
pub use t4proto::v1::service;

use prost::Message;
use service::{client_message, ClientMessage};

/// Wrap a oneof payload in a `ClientMessage` and serialize it to bytes.
pub fn encode_client(payload: client_message::Payload) -> Vec<u8> {
    ClientMessage {
        payload: Some(payload),
    }
    .encode_to_vec()
}
