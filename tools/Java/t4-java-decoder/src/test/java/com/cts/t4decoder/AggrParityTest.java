package com.cts.t4decoder;

import com.t4login.datetime.NDateTime;
import com.t4login.definitions.MarketMode;
import com.t4login.definitions.chartdata.ChartDataStreamReaderAggr;
import com.t4login.definitions.chartdata.ChartFormatAggr;
import com.t4login.definitions.priceconversion.Price;
import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;

/**
 * Golden-fixture parity: decode {@code fixtures/sample.bin} with the aggregated
 * reader and reproduce {@code fixtures/sample_expected.csv} field-for-field.
 *
 * <p>Mirrors the C++ {@code test_aggr.cpp} / Rust {@code parity.rs} harnesses:
 * records are grouped by type (defs, bars, modes, settlements, open-interest) and
 * emitted into a 25-column CSV.
 */
public class AggrParityTest {

    private static final String HEADER =
            "type,market_id,trade_date,time,close_time,open,high,low,close,volume,"
                    + "volume_at_bid,volume_at_offer,trades,trades_at_bid,trades_at_offer,"
                    + "numerator,denominator,price_code,tick_value,vpt,min_cab_price,mode,"
                    + "settlement_price,held,open_interest";

    /** A 25-column CSV row; unused fields stay empty. */
    private static final class Row {
        String type = "", marketId = "", tradeDate = "", time = "", closeTime = "";
        String open = "", high = "", low = "", close = "";
        String volume = "", volumeAtBid = "", volumeAtOffer = "";
        String trades = "", tradesAtBid = "", tradesAtOffer = "";
        String numerator = "", denominator = "", priceCode = "", tickValue = "", vpt = "", minCabPrice = "";
        String mode = "", settlementPrice = "", held = "", openInterest = "";

        String join() {
            return String.join(",",
                    type, marketId, tradeDate, time, closeTime,
                    open, high, low, close,
                    volume, volumeAtBid, volumeAtOffer,
                    trades, tradesAtBid, tradesAtOffer,
                    numerator, denominator, priceCode, tickValue, vpt, minCabPrice,
                    mode, settlementPrice, held, openInterest);
        }
    }

    @Test
    public void aggrGoldenFixtureParity() throws IOException {
        byte[] data = readResource("/fixtures/sample.bin");
        String expected = new String(readResource("/fixtures/sample_expected.csv"), StandardCharsets.UTF_8);

        final List<Row> mds = new ArrayList<>();
        final List<Row> bars = new ArrayList<>();
        final List<Row> modes = new ArrayList<>();
        final List<Row> settlements = new ArrayList<>();
        final List<Row> ois = new ArrayList<>();

        ChartDataStreamReaderAggr.read(data, new ChartDataStreamReaderAggr.ChartDataHandler() {
            @Override
            public void onMarketDefinition(ChartFormatAggr.MarketDefinition m) {
                Row r = new Row();
                r.type = "market_definition";
                r.marketId = m.MarketID;
                r.numerator = Integer.toString(m.Numerator);
                r.denominator = Integer.toString(m.Denominator);
                r.priceCode = nz(m.PriceCode);
                r.tickValue = decimalStr(m.TickValue);
                r.vpt = nz(m.VPT);
                r.minCabPrice = priceStr(m.MinCabPrice);
                mds.add(r);
            }

            @Override
            public void onBar(ChartFormatAggr.Bar b) {
                Row r = new Row();
                r.type = "bar";
                r.marketId = b.MarketID;
                r.tradeDate = dateStr(b.TradeDate);
                r.time = dateStr(b.Time);
                r.closeTime = dateStr(b.CloseTime);
                r.open = priceStr(b.OpenPrice);
                r.high = priceStr(b.HighPrice);
                r.low = priceStr(b.LowPrice);
                r.close = priceStr(b.ClosePrice);
                r.volume = Integer.toString(b.Volume);
                r.volumeAtBid = Integer.toString(b.VolumeAtBid);
                r.volumeAtOffer = Integer.toString(b.VolumeAtOffer);
                r.trades = Integer.toString(b.Trades);
                r.tradesAtBid = Integer.toString(b.TradesAtBid);
                r.tradesAtOffer = Integer.toString(b.TradesAtOffer);
                bars.add(r);
            }

            @Override
            public void onModeChange(String marketID, NDateTime tradeDate, NDateTime time, MarketMode mode) {
                Row r = new Row();
                r.type = "mode_change";
                r.marketId = marketID;
                r.tradeDate = dateStr(tradeDate);
                r.time = dateStr(time);
                r.mode = Integer.toString(mode.getValue());
                modes.add(r);
            }

            @Override
            public void onSettlement(String marketID, NDateTime tradeDate, NDateTime time, Price settlmentPrice, boolean held) {
                Row r = new Row();
                r.type = "settlement";
                r.marketId = marketID;
                r.tradeDate = dateStr(tradeDate);
                r.time = dateStr(time);
                r.settlementPrice = priceStr(settlmentPrice);
                r.held = held ? "true" : "false";
                settlements.add(r);
            }

            @Override
            public void onOpenInterest(String marketID, NDateTime tradeDate, NDateTime time, int openInterest) {
                Row r = new Row();
                r.type = "open_interest";
                r.marketId = marketID;
                r.tradeDate = dateStr(tradeDate);
                r.time = dateStr(time);
                r.openInterest = Integer.toString(openInterest);
                ois.add(r);
            }
        });

        List<String> got = new ArrayList<>();
        got.add(HEADER);
        for (List<Row> group : List.of(mds, bars, modes, settlements, ois)) {
            for (Row r : group) {
                got.add(r.join());
            }
        }

        List<String> exp = new ArrayList<>();
        for (String line : expected.split("\n", -1)) {
            String trimmed = line.endsWith("\r") ? line.substring(0, line.length() - 1) : line;
            if (!trimmed.isEmpty()) {
                exp.add(trimmed);
            }
        }

        assertEquals("row count mismatch", exp.size(), got.size());
        for (int i = 0; i < got.size(); i++) {
            assertEquals("line " + i + " mismatch", exp.get(i), got.get(i));
        }
    }

    // --- formatting helpers (match the C++/Rust CSV output exactly) ---

    private static String nz(String s) {
        return s == null ? "" : s;
    }

    /** Price → fixed scale-18 plain string (e.g. "5000.250000000000000000"); null → "". */
    private static String priceStr(Price p) {
        return p == null ? "" : p.getDecimalValue().toPlainString();
    }

    /** Decimal with trailing zeros stripped (e.g. "12.5"); null → "". */
    private static String decimalStr(BigDecimal d) {
        return d == null ? "" : d.stripTrailingZeros().toPlainString();
    }

    /** NDateTime → "yyyy-MM-dd HH:mm:ss.SSS" from its calendar components. */
    private static String dateStr(NDateTime dt) {
        if (dt == null) {
            return "";
        }
        return String.format("%04d-%02d-%02d %02d:%02d:%02d.%03d",
                dt.getYear(), dt.getMonth(), dt.getDay(),
                dt.getHour(), dt.getMinute(), dt.getSecond(), dt.getMillisecond());
    }

    private static byte[] readResource(String path) throws IOException {
        try (InputStream in = AggrParityTest.class.getResourceAsStream(path)) {
            if (in == null) {
                throw new IOException("missing test resource: " + path);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) {
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }
}
