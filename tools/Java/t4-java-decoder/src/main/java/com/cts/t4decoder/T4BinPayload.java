package com.cts.t4decoder;

import java.util.Arrays;

/**
 * Locates the embedded T4Bin / T4BinAggr payload inside an HTTP chart response.
 *
 * <p>The REST {@code /chart/barchart} endpoint returns the hand-rolled binary
 * chart stream wrapped in a transport envelope; the decoder wants the raw stream
 * starting at the Start-Of-Frame (SOF) record. This is a pure, transport-free
 * port of the C++/Rust {@code extractT4BinPayload} helpers.
 */
public final class T4BinPayload {

    // SOF record signatures: length, tag=SOF(1), version=1 (little-endian int32).
    /** Aggregated (T4BinAggr): record length 5. */
    private static final byte[] AGGR_SOF = {0x05, 0x01, 0x01, 0x00, 0x00, 0x00};
    /** Non-aggregated (T4Bin): record length 13. */
    private static final byte[] BIN_SOF = {0x0d, 0x01, 0x01, 0x00, 0x00, 0x00};

    private T4BinPayload() {
    }

    /**
     * Returns the payload slice starting at the first T4Bin or T4BinAggr SOF
     * signature. Empty input returns an empty array.
     *
     * @throws IllegalArgumentException if a non-empty input contains no SOF signature
     */
    public static byte[] extract(byte[] content) {
        if (content == null || content.length == 0) {
            return new byte[0];
        }

        int aggrIdx = indexOf(content, AGGR_SOF);
        int binIdx = indexOf(content, BIN_SOF);

        int start;
        if (aggrIdx >= 0 && binIdx >= 0) {
            start = Math.min(aggrIdx, binIdx);
        } else if (aggrIdx >= 0) {
            start = aggrIdx;
        } else if (binIdx >= 0) {
            start = binIdx;
        } else {
            throw new IllegalArgumentException("no T4Bin SOF signature found in chart response");
        }

        return Arrays.copyOfRange(content, start, content.length);
    }

    /** First index of {@code needle} in {@code haystack}, or -1. */
    private static int indexOf(byte[] haystack, byte[] needle) {
        if (haystack.length < needle.length) {
            return -1;
        }
        outer:
        for (int i = 0; i <= haystack.length - needle.length; i++) {
            for (int j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    continue outer;
                }
            }
            return i;
        }
        return -1;
    }
}
