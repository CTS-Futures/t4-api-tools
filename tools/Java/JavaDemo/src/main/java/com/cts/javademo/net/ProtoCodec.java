package com.cts.javademo.net;

import t4proto.v1.service.Service;

import java.util.function.Consumer;

/** Helpers for building/serializing the {@code ClientMessage} oneof envelope. */
public final class ProtoCodec {

    private ProtoCodec() {
    }

    /**
     * Build a {@link Service.ClientMessage} by setting one oneof payload on the
     * builder, and serialize it to bytes (mirrors RustDemo's {@code encode_client}).
     */
    public static byte[] encodeClient(Consumer<Service.ClientMessage.Builder> setPayload) {
        Service.ClientMessage.Builder b = Service.ClientMessage.newBuilder();
        setPayload.accept(b);
        return b.build().toByteArray();
    }
}
