package com.t4login.messages;

import com.t4login.Log;
import com.t4login.datetime.NDateTime;
import com.t4login.definitions.priceconversion.Price;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

/**
 * Trimmed, dependency-free copy of {@code com.t4login.messages.Message} for the
 * standalone chart decoder.
 *
 * <p>The original class is a large message-serialization base with a factory that
 * pulls in the entire message-type hierarchy. The chart-data readers only use its
 * static, transport-free binary <em>read</em> helpers (.NET {@code BinaryWriter}
 * wire format), so only those are retained here — byte-for-byte identical to the
 * source so decode results stay in parity with the Java API.
 */
public final class Message {

    public static final String TAG = "Message";

    private Message() {
    }

    /**
     * Reads off the input stream to fill the specified buffer. Does not return
     * until the buffer is full (or EOF).
     */
    public static int fillBuffer(InputStream in, byte[] buffer) throws IOException {
        int nread = buffer.length;
        int off = 0;

        while (nread > 0) {
            int len = in.read(buffer, off, nread);

            if (len < 0) {
                return len;
            }

            off += len;
            nread -= len;
        }

        return off;
    }

    /**
     * Reads a string value (.NET {@code BinaryWriter} format: 7-bit encoded length
     * prefix followed by UTF-8 bytes).
     */
    public static String readString(InputStream in) throws IOException {
        int len = read7BitInteger(in);

        byte[] buffer = new byte[len];
        if (Message.fillBuffer(in, buffer) < 0) {
            throw new IOException("EOF");
        }

        return new String(buffer, StandardCharsets.UTF_8);
    }

    /**
     * Reads a short string (single-byte length prefix, then UTF-8 bytes).
     */
    public static String readShortString(InputStream in) throws IOException {
        int len = in.read();
        byte[] buffer = new byte[len];
        if (Message.fillBuffer(in, buffer) < 0) {
            throw new IOException("EOF");
        }
        return new String(buffer, StandardCharsets.UTF_8);
    }

    /**
     * Reads a .NET encoded (little-endian) integer.
     */
    public static int readInteger(InputStream in) throws IOException {
        byte[] buffer = new byte[4];
        if (Message.fillBuffer(in, buffer) < 0) {
            throw new IOException("EOF");
        }

        ByteBuffer bb = ByteBuffer.wrap(buffer);
        bb.order(ByteOrder.LITTLE_ENDIAN);
        bb.position(0);
        return bb.getInt();
    }

    /**
     * Reads a .NET encoded (little-endian) long.
     */
    public static long readLong(InputStream in) throws IOException {
        byte[] buffer = new byte[8];
        if (Message.fillBuffer(in, buffer) < 0) {
            throw new IOException("EOF");
        }

        ByteBuffer bb = ByteBuffer.wrap(buffer);
        bb.order(ByteOrder.LITTLE_ENDIAN);
        bb.position(0);
        return bb.getLong();
    }

    /**
     * Reads a .NET encoded (little-endian) double.
     */
    public static double readDouble(InputStream in) throws IOException {
        byte[] buffer = new byte[8];
        if (Message.fillBuffer(in, buffer) < 0) {
            throw new IOException("EOF");
        }

        ByteBuffer bb = ByteBuffer.wrap(buffer);
        bb.order(ByteOrder.LITTLE_ENDIAN);
        bb.position(0);
        return bb.getDouble();
    }

    /**
     * Reads a .NET {@code BinaryWriter} encoded boolean (non-zero == true).
     */
    public static boolean readBoolean(InputStream in) throws IOException {
        return in.read() != (byte) 0;
    }

    /**
     * Reads a date/time value stored as a little-endian tick count.
     */
    public static NDateTime readDateTime(InputStream in) throws IOException {
        long ticks = readLong(in);
        return new NDateTime(ticks);
    }

    /**
     * Reads a 7-bit encoded date/time value (tick count).
     */
    public static NDateTime read7BitDateTime(InputStream in) throws IOException {
        long timeTicks = read7BitLong(in);
        return new NDateTime(timeTicks);
    }

    /**
     * Reads a 7-bit encoded date/time value relative to {@code ref}.
     */
    public static NDateTime read7BitDateTime(InputStream in, NDateTime ref) throws IOException {
        long timeTicks = read7BitLong(in);
        return new NDateTime(timeTicks + ref.getTicks());
    }

    /**
     * Reads a 7-bit encoded integer (the length prefix for {@link #readString}).
     */
    public static int read7BitInteger(InputStream in) throws IOException {
        int count = 0;
        int shift = 0;
        boolean more = true;
        while (more) {
            byte b = (byte) in.read();
            count |= (b & 0x7F) << shift;
            shift += 7;
            if ((b & 0x80) == 0) {
                more = false;
            }
        }
        return count;
    }

    /**
     * Reads a 7-bit encoded long value.
     */
    public static long read7BitLong(InputStream in) throws IOException {
        long count = 0;
        long shift = 0;
        int b;

        do {
            b = (byte) in.read();
            count |= (((long) (b & 0x7F)) << shift);
            shift += 7;
        } while ((b & 0x80) != 0);

        return count;
    }

    /**
     * Reads a string-encoded price value (short-string body, parsed as decimal).
     */
    public static Price readPrice(InputStream in) throws IOException {
        String stringValue = readShortString(in);

        try {
            if (!stringValue.isEmpty()) {
                BigDecimal decValue = new BigDecimal(stringValue).setScale(Price.Scale, BigDecimal.ROUND_HALF_EVEN);
                return new Price(decValue);
            } else {
                return null;
            }
        } catch (Exception ex) {
            Log.e(TAG, "readPrice(), Error converting '" + stringValue + "' to a price.");
            throw ex;
        }
    }
}
