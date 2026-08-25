package com.t4login.util;

import com.t4login.Log;
import com.t4login.definitions.priceconversion.Price;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.math.RoundingMode;

@SuppressWarnings({"WeakerAccess", "SpellCheckingInspection", "unused"})
public final class EncodingUtil {

    private EncodingUtil() {
    }

    public static byte[] encode7BitInt(int value) {

        if (value >= 0) {
            byte[] buffer = new byte[5];
            int n = 0;

            while (value >= 0x80) {
                buffer[n] = (byte) (value | 0x80);
                n++;
                value >>= 7;
            }
            buffer[n] = (byte) value;
            n++;

            byte[] retbuf = new byte[n];

            System.arraycopy(buffer, 0, retbuf, 0, n);

            return retbuf;

        } else {
            byte[] buffer = new byte[5];
            buffer[0] = (byte) (value | 0x80);
            value >>= 7;
            buffer[1] = (byte) (value | 0x80);
            value >>= 7;
            buffer[2] = (byte) (value | 0x80);
            value >>= 7;
            buffer[3] = (byte) (value | 0x80);
            value >>= 7;
            buffer[4] = (byte) (value & 0x0F);
            return buffer;
        }
    }

    public static byte[] encode7BitLong(long value) {

        if (value >= 0) {
            byte[] buffer = new byte[9];
            int n = 0;

            while (value >= 0x80) {
                buffer[n] = (byte) (value | 0x80);
                n++;
                value >>= 7;
            }
            buffer[n] = (byte) value;
            n++;

            byte[] retbuf = new byte[n];

            System.arraycopy(buffer, 0, retbuf, 0, n);

            return retbuf;

        } else {
            byte[] buffer = new byte[10];
            buffer[0] = (byte) (value | 0x80);
            value >>= 7;
            buffer[1] = (byte) (value | 0x80);
            value >>= 7;
            buffer[2] = (byte) (value | 0x80);
            value >>= 7;
            buffer[3] = (byte) (value | 0x80);
            value >>= 7;
            buffer[4] = (byte) (value | 0x80);
            value >>= 7;
            buffer[5] = (byte) (value | 0x80);
            value >>= 7;
            buffer[6] = (byte) (value | 0x80);
            value >>= 7;
            buffer[7] = (byte) (value | 0x80);
            value >>= 7;
            buffer[8] = (byte) (value | 0x80);
            value >>= 7;
            buffer[9] = (byte) (value & 0x0F);
            return buffer;
        }
    }

    public static void encode7BitInt(int value, OutputStream out) {

        try {
            if (value >= 0) {
                while (value >= 0x80) {
                    out.write((byte) (value | 0x80));
                    value >>= 7;
                }
                out.write((byte) value);
            } else {
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value & 0x0F));
            }
        } catch (IOException ioex) {
            Log.e("EncodingUtil", "encode7BitInt(), IO error.", ioex);
        }
    }

    public static void encode7BitLong(long value, OutputStream out) {

        try {
            if (value >= 0) {
                while (value >= 0x80) {
                    out.write((byte) (value | 0x80));
                    value >>= 7;
                }
                out.write((byte) value);
            } else {
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value | 0x80));
                value >>= 7;
                out.write((byte) (value & 0x0F));
            }
        } catch (IOException ioex) {
            Log.e("EncodingUtil", "encode7BitLong(), IO error.", ioex);
        }
    }

    public static int decode7BitInt(byte[] bytes) {
        ByteArrayInputStream in = new ByteArrayInputStream(bytes);
        return decode7BitInt(in);
    }

    public static long decode7BitLong(byte[] bytes) {
        ByteArrayInputStream in = new ByteArrayInputStream(bytes);
        return decode7BitLong(in);
    }

    public static int decode7BitInt(InputStream in) {
        int count = 0;
        int shift = 0;
        int b;

        try {
            do {
                b = in.read();
                count |= (b & 0x7F) << shift;
                shift += 7;
            } while ((b & 0x80) != 0);
        } catch (IOException ioex) {
            Log.e("EncodingUtil", "decode7BitInt(), IO error.", ioex);
        }

        return count;
    }

    public static long decode7BitLong(InputStream in) {
        long count = 0;
        long shift = 0;
        int b;

        try {
            do {
                b = (byte) in.read();
                count |= (((long) (b & 0x7F)) << shift);
                shift += 7;
            } while ((b & 0x80) != 0);
        } catch (IOException ioex) {
            Log.e("EncodingUtil", "decode7BitLong(), IO error.", ioex);
        }

        return count;
    }

    public static byte[] encodeDecimal(BigDecimal value) {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        encodeDecimal(value, outputStream);
        return outputStream.toByteArray();
    }

    public static void encodeDecimal(BigDecimal value, OutputStream out) {

        int[] priceBits = new int[4];

        // Scale and negation.
        priceBits[3] = value.scale() << 16;

        if (value.compareTo(BigDecimal.ZERO) < 0) {
            //priceBits[3] *= -1;
            priceBits[3] = priceBits[3] | 0x80000000;
        }

        // Unscaled value.
        BigInteger mask = new BigInteger(new byte[]{0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff});
        BigInteger unscaled = value.unscaledValue().abs();
        priceBits[2] = unscaled.shiftRight(64).intValue();
        priceBits[1] = unscaled.and(mask.shiftLeft(32)).shiftRight(32).intValue();
        priceBits[0] = unscaled.and(mask).intValue();

        byte hdr = 0x00;

        hdr = (byte) (hdr | (priceBits[0] == Integer.MIN_VALUE ? 0xC0 : (priceBits[0] < 0 ? 0x80 : (priceBits[0] > 0 ? 0x40 : 0x00))));
        hdr = (byte) (hdr | (priceBits[1] == Integer.MIN_VALUE ? 0x30 : (priceBits[1] < 0 ? 0x20 : (priceBits[1] > 0 ? 0x10 : 0x00))));
        hdr = (byte) (hdr | (priceBits[2] == Integer.MIN_VALUE ? 0x0C : (priceBits[2] < 0 ? 0x08 : (priceBits[2] > 0 ? 0x04 : 0x00))));
        hdr = (byte) (hdr | (priceBits[3] == Integer.MIN_VALUE ? 0x03 : (priceBits[3] < 0 ? 0x02 : (priceBits[3] > 0 ? 0x01 : 0x00))));

        try {
            out.write(hdr);

            if (priceBits[0] != 0 && priceBits[0] != Integer.MIN_VALUE) {
                encode7BitInt(Math.abs(priceBits[0]), out);
            }

            if (priceBits[1] != 0 && priceBits[1] != Integer.MIN_VALUE) {
                encode7BitInt(Math.abs(priceBits[1]), out);
            }

            if (priceBits[2] != 0 && priceBits[2] != Integer.MIN_VALUE) {
                encode7BitInt(Math.abs(priceBits[2]), out);
            }

            if (priceBits[3] != 0 && priceBits[3] != Integer.MIN_VALUE) {
                encode7BitInt(Math.abs(priceBits[3]), out);
            }
        } catch (IOException ioex) {
            Log.e("EncodingUtil", "encodeDecimal(), IO error.", ioex);
        }
    }

    public static BigDecimal decodeDecimal(byte[] bytes) {
        ByteArrayInputStream in = new ByteArrayInputStream(bytes);
        return decodeDecimal(in);
    }

    public static BigDecimal decodeDecimal(InputStream in) {

        int[] priceBits = new int[4];

        try {
            int hdr = in.read();

            if ((hdr & 0xC0) == 0xC0) {
                priceBits[0] = Integer.MIN_VALUE;
            } else if ((hdr & 0x80) == 0x80) {
                priceBits[0] = -1 * decode7BitInt(in);
            } else if ((hdr & 0x40) == 0x40) {
                priceBits[0] = decode7BitInt(in);
            }

            if ((hdr & 0x30) == 0x30) {
                priceBits[1] = Integer.MIN_VALUE;
            } else if ((hdr & 0x20) == 0x20) {
                priceBits[1] = -1 * decode7BitInt(in);
            } else if ((hdr & 0x10) == 0x10) {
                priceBits[1] = decode7BitInt(in);
            }

            if ((hdr & 0x0C) == 0x0C) {
                priceBits[2] = Integer.MIN_VALUE;
            } else if ((hdr & 0x08) == 0x08) {
                priceBits[2] = -1 * decode7BitInt(in);
            } else if ((hdr & 0x04) == 0x04) {
                priceBits[2] = decode7BitInt(in);
            }

            if ((hdr & 0x03) == 0x03) {
                priceBits[3] = Integer.MIN_VALUE;
            } else if ((hdr & 0x02) == 0x02) {
                priceBits[3] = -1 * decode7BitInt(in);
            } else if ((hdr & 0x01) == 0x01) {
                priceBits[3] = decode7BitInt(in);
            }

            BigInteger int2 = BigInteger.valueOf(priceBits[2] & 0xffffffffL).shiftLeft(32);
            BigInteger int1 = int2.add(BigInteger.valueOf(priceBits[1] & 0xffffffffL)).shiftLeft(32);
            BigInteger integer = int1.add(BigInteger.valueOf(priceBits[0] & 0xffffffffL));

            BigDecimal decimal = new BigDecimal(integer, (priceBits[3] & 0xff0000) >> 16);

            if (priceBits[3] < 0) // Bit 31 set
            {
                decimal = decimal.negate();
            }

            return decimal;

        } catch (IOException ioex) {
            Log.e("EncodingUtil", "decodeDecimal(), IO error.", ioex);
        }

        return BigDecimal.ZERO;
    }

    public static Price decodePrice(InputStream in) {

        return new Price(EncodingUtil.decodeDecimal(in));
    }

    public static Price decodePriceN(InputStream in) {

        try {
            int hdr = in.read();

            if ((hdr & 0x01) == 0x01) {
                return new Price(EncodingUtil.decodeDecimal(in).setScale(Price.Scale, RoundingMode.HALF_EVEN));
            } else {
                return null;
            }

        } catch (IOException e) {
            Log.e("EncodingUtil", "decodePriceN(), IO error.", e);
            return null;
        }
    }
}
