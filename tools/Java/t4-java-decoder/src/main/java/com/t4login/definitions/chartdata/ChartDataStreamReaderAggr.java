package com.t4login.definitions.chartdata;

import com.t4login.Log;
import com.t4login.connection.CountingInputStream;
import com.t4login.datetime.NDateTime;
import com.t4login.definitions.MarketMode;
import com.t4login.definitions.priceconversion.Price;
import com.t4login.messages.Message;
import com.t4login.util.EncodingUtil;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;

/**
 * Reads chart data from an input stream.
 */
public class ChartDataStreamReaderAggr {

    public static final String TAG = "ChartDataStreamReaderAggr";

    public interface ChartDataHandler {
        void onMarketDefinition(ChartFormatAggr.MarketDefinition marketDefinition);

        void onBar(ChartFormatAggr.Bar bar);

        void onModeChange(String marketID, NDateTime tradeDate, NDateTime time, MarketMode mode);

        void onSettlement(String marketID, NDateTime tradeDate, NDateTime time, Price settlmentPrice, boolean held);

        void onOpenInterest(String marketID, NDateTime tradeDate, NDateTime time, int openInterest);
    }

    private ChartDataStreamReaderAggr() {

    }

    public static void read(byte[] data, ChartDataHandler handler) {

        try {
            readStream(new ByteArrayInputStream(data), handler);
        } catch (IOException e) {
            Log.e(TAG, "read(), Error reading chart data. ", e);
        }
    }

    /**
     * Reads the chart data records from the stream.
     **/
    public static void readStream(InputStream inputStream, ChartDataHandler handler) throws IOException {

        if (inputStream == null) {
            Log.w(TAG, "readStream(), No stream.");
            return;
        }

        if (handler == null) {
            Log.e(TAG, "readStream(), Handler is null.");
            return;
        }

        // Wrap the streamso we can count the bytes. (This helps support different record versions.)
        CountingInputStream in = new CountingInputStream(inputStream);

        // binVersion is not used now. It will be used if the format evolves and backward compatibility is necessary.
        @SuppressWarnings("unused")
        int binVersion = ChartFormatAggr.CVAL_T4BINAGGR_VERSION;

        ChartFormatAggr.MarketDefinition market = null;
        NDateTime tradeDate = NDateTime.MinValue;
        String marketID = "";

        while (in.available() > 0) {

            long len = EncodingUtil.decode7BitInt(in);
            in.resetCount();

            if (len > 0) {
                int tag = EncodingUtil.decode7BitInt(in);

                switch (tag) {
                    case ChartFormatAggr.CTAG_SOF: {
                        // Read the version
                        //noinspection UnusedAssignment
                        binVersion = Message.readInteger(in);

                        // Clear the reader state.
                        tradeDate = NDateTime.MinValue;
                        marketID = "";
                        break;
                    }
                    case ChartFormatAggr.CTAG_MARKET_DEFINITION: {
                        String mktID = Message.readString(in);
                        int numerator = EncodingUtil.decode7BitInt(in);
                        int denominator = EncodingUtil.decode7BitInt(in);
                        String priceCode = Message.readString(in);
                        BigDecimal tickValue = EncodingUtil.decodeDecimal(in);
                        String vpt = Message.readString(in);
                        Price minCabPrice = EncodingUtil.decodePriceN(in);

                        market = new ChartFormatAggr.MarketDefinition(mktID, numerator, denominator, priceCode, tickValue, vpt, minCabPrice);
                        handler.onMarketDefinition(market);
                        break;
                    }
                    case ChartFormatAggr.CTAG_TRADEDATE_SWITCH: {
                        tradeDate = Message.read7BitDateTime(in);
                        break;
                    }
                    case ChartFormatAggr.CTAG_MARKET_SWITCH: {
                        marketID = Message.readString(in);
                        break;
                    }
                    case ChartFormatAggr.CTAG_BAR_DELTA: {
                        NDateTime time = Message.read7BitDateTime(in);
                        NDateTime closeTime = new NDateTime(time.getTicks() + EncodingUtil.decode7BitLong(in));

                        int barOpenIncrements = EncodingUtil.decode7BitInt(in);
                        int barHighIncrements = EncodingUtil.decode7BitInt(in);
                        int barLowIncrements = EncodingUtil.decode7BitInt(in);
                        int barCloseIncrements = EncodingUtil.decode7BitInt(in);

                        int volume = EncodingUtil.decode7BitInt(in);
                        int volumeAtBid = EncodingUtil.decode7BitInt(in);
                        int volumeAtOffer = EncodingUtil.decode7BitInt(in);
                        int trades = EncodingUtil.decode7BitInt(in);
                        int tradesAtBid = EncodingUtil.decode7BitInt(in);
                        int tradesAtOffer = EncodingUtil.decode7BitInt(in);

                        ChartFormatAggr.Bar bar = new ChartFormatAggr.Bar(tradeDate,
                                time,
                                closeTime, marketID,
                                Price.fromIncrements(market, barOpenIncrements + barLowIncrements),
                                Price.fromIncrements(market, barHighIncrements + barLowIncrements),
                                Price.fromIncrements(market, barLowIncrements),
                                Price.fromIncrements(market, barCloseIncrements + barLowIncrements),
                                volume,
                                volumeAtBid,
                                volumeAtOffer,
                                trades,
                                tradesAtBid,
                                tradesAtOffer
                        );
                        handler.onBar(bar);
                        break;
                    }
                    case ChartFormatAggr.CTAG_BAR: {
                        NDateTime time = Message.read7BitDateTime(in);
                        NDateTime closeTime = new NDateTime(time.getTicks() + EncodingUtil.decode7BitLong(in));

                        Price barOpenPrice = EncodingUtil.decodePrice(in);
                        Price barHighPrice = EncodingUtil.decodePrice(in);
                        Price barLowPrice = EncodingUtil.decodePrice(in);
                        Price barClosePrice = EncodingUtil.decodePrice(in);

                        int volume = EncodingUtil.decode7BitInt(in);
                        int volumeAtBid = EncodingUtil.decode7BitInt(in);
                        int volumeAtOffer = EncodingUtil.decode7BitInt(in);
                        int trades = EncodingUtil.decode7BitInt(in);
                        int tradesAtBid = EncodingUtil.decode7BitInt(in);
                        int tradesAtOffer = EncodingUtil.decode7BitInt(in);

                        ChartFormatAggr.Bar bar = new ChartFormatAggr.Bar(tradeDate,
                                time,
                                closeTime, marketID,
                                barOpenPrice,
                                barHighPrice,
                                barLowPrice,
                                barClosePrice,
                                volume,
                                volumeAtBid,
                                volumeAtOffer,
                                trades,
                                tradesAtBid,
                                tradesAtOffer
                        );
                        handler.onBar(bar);
                        break;
                    }
                    case ChartFormatAggr.CTAG_MARKET_MODE: {
                        NDateTime time = Message.read7BitDateTime(in);
                        MarketMode mode = MarketMode.get(EncodingUtil.decode7BitInt(in));
                        handler.onModeChange(marketID, tradeDate, time, mode);
                        break;
                    }
                    case ChartFormatAggr.CTAG_SETTLEMENT_PRICE: {
                        NDateTime time = Message.read7BitDateTime(in);
                        Price settlementPrice = EncodingUtil.decodePrice(in);
                        boolean held = Message.readBoolean(in);
                        handler.onSettlement(marketID, tradeDate, time, settlementPrice, held);
                        break;
                    }
                    case ChartFormatAggr.CTAG_OPEN_INTEREST: {
                        NDateTime time = Message.read7BitDateTime(in);
                        int openInterest = EncodingUtil.decode7BitInt(in);
                        handler.onOpenInterest(marketID, tradeDate, time, openInterest);
                        break;
                    }
                    default:
                        Log.v(TAG, "readStream(), Unknown tag [" + tag + "]. Not supported.");
                        break;
                }
            }

            // Ensure we read the full record.
            long nRead = in.getCount();
            if (nRead < len) {
                //noinspection ResultOfMethodCallIgnored
                in.skip(len - nRead);
            }
        }
    }
}
