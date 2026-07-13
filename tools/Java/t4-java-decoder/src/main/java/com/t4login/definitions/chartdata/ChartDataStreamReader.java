package com.t4login.definitions.chartdata;

import com.t4login.Log;
import com.t4login.connection.CountingInputStream;
import com.t4login.datetime.NDateTime;
import com.t4login.definitions.BidOffer;
import com.t4login.definitions.MarketMode;
import com.t4login.definitions.priceconversion.Price;
import com.t4login.messages.Message;
import com.t4login.util.EncodingUtil;

import java.io.IOException;
import java.io.InputStream;
import java.math.BigDecimal;
import java.util.HashMap;
import java.util.Map;

/**
 * Reads chart data from an input stream.
 */
public class ChartDataStreamReader {

    public static final String TAG = "ChartDataStreamReader";

    private final CountingInputStream mIn;
    private final ChartDataType mDataType;
    private Map<String, ChartDataState> mMarketStates = new HashMap<>();
    private Map<Integer, String> mMarketKeys = new HashMap<>();
    private ChartDataState mState;
    private boolean mIsConsolidated = false;
    private boolean mEOF = false;
    @SuppressWarnings({"FieldCanBeLocal", "unused"})
    private int mBinVersion = ChartFormat.CVAL_T4BIN_VERSION;

    public ChartDataStreamReader(InputStream in, NDateTime tradeDate, String marketID, ChartDataType dataType) {
        if (in != null) {
            mIn = new CountingInputStream(in);
        } else {
            mIn = null;
        }

        mState = getMarketState(marketID);

        mState.TradeDate = tradeDate;
        mState.TradeDateTicks = tradeDate.getTicks();
        mState.MarketID = marketID;
        mDataType = dataType;
    }

    public void close() {
        if (mIn != null) {
            try {
                mIn.close();
            } catch (IOException ioex) {
                Log.e(TAG, "Error.", ioex);
            }
        }
    }

    /**
     * Gets the current state of the chart data stream.
     *
     * @return The stream status.
     */
    public ChartDataState getState() {
        return mState;
    }

    /**
     * Reads the next chart data record from the stream.
     *
     * @return true if there was another record and we read it. false if the end of the stream was reached.
     */
    public boolean read() throws IOException {
        return readT4Bin();
    }

    /**
     * Reads the next T4Bin formatted chart data record from the stream.
     *
     * @return true if there was another record and we read it. false if the end of the stream was reached.
     */
    private boolean readT4Bin() throws IOException {

        if (mEOF || mIn == null) {
            return false;
        }

        if (mIn.available() == 0) {
            // End of stream.
            return false;
        }

        long len = EncodingUtil.decode7BitInt(mIn);
        mIn.resetCount();

        if (len > 0) {
            int tag = EncodingUtil.decode7BitInt(mIn);

            switch (tag) {
                case ChartFormat.CTAG_CONSOLIDATED:
                    mIsConsolidated = true;
                    break;
                case ChartFormat.CTAG_SOF: {
                    if (len > 12) {
                        mBinVersion = Message.readInteger(mIn);
                        mState.TradeDate = Message.readDateTime(mIn);
                        mState.TradeDateTicks = mState.TradeDate.getTicks();
                    } else {
                        mBinVersion = 0;
                        mState.TradeDate = Message.readDateTime(mIn);
                        mState.TradeDateTicks = mState.TradeDate.getTicks();
                    }

                    mMarketStates.clear();
                    ChartDataState newState = new ChartDataState();
                    newState.MarketID = mState.MarketID;
                    newState.TradeDate = mState.TradeDate;
                    newState.TradeDateTicks = mState.TradeDateTicks;
                    mState = newState;
                    mMarketStates.put(mState.MarketID, mState);

                    mState.Change = ChartDataChange.TradeDate;
                }
                break;
                case ChartFormat.CTAG_MARKET_KEY: {
                    int mktKey = EncodingUtil.decode7BitInt(mIn);
                    String mktID = Message.readString(mIn);
                    mMarketKeys.put(mktKey, mktID);
                    getMarketState(mktID);
                    mState.Change = ChartDataChange.None;
                    break;
                }
                case ChartFormat.CTAG_MARKET_SWITCH: {
                    int mktKey = EncodingUtil.decode7BitInt(mIn);
                    String mktID = mMarketKeys.get(mktKey);
                    getMarketState(mktID);
                    mState.Change = ChartDataChange.MarketSwitch;
                    break;
                }
                case ChartFormat.CTAG_MARKET_DEFINITION: {
                    String mktID = Message.readString(mIn);
                    getMarketState(mktID);
                    mState.MarketDefined = true;
                    mState.Numerator = EncodingUtil.decode7BitInt(mIn);
                    mState.Denominator = EncodingUtil.decode7BitInt(mIn);
                    mState.PriceCode = Message.readString(mIn);
                    mState.TickValue = Message.readDouble(mIn);

                    if (mIn.getCount() < len) {
                        // There is additional information in this record.
                        mState.VPT = Message.readString(mIn);
                        mState.MinCabPrice = Message.readPrice(mIn);
                    }

                    mState.MinPriceIncrement = null;
                    mState.PointValue = null;

                    mState.Change = ChartDataChange.MarketDefinition;
                    break;
                }
                case ChartFormat.CTAG_TICKDATAPOINT_7BIT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = mState.LastTradePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        if (mState.OrderVolumes != null && mState.OrderVolumes.length > 0) {
                            mState.OrderVolumes = new int[0];
                        }

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TICKDATAPOINT_NEG_7BIT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = mState.LastTradePrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        if (mState.OrderVolumes != null && mState.OrderVolumes.length > 0) {
                            mState.OrderVolumes = new int[0];
                        }

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TRADE_PRICE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastPriceIncrements = mState.LastPriceIncrements.add(EncodingUtil.decodeDecimal(mIn));
                        mState.LastTradePrice = Price.fromIncrements(mState, mState.LastPriceIncrements);
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        if (mState.OrderVolumes != null && mState.OrderVolumes.length > 0) {
                            mState.OrderVolumes = new int[0];
                        }

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TRADE_PRICE_DEC:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        if (mState.OrderVolumes != null && mState.OrderVolumes.length > 0) {
                            mState.OrderVolumes = new int[0];
                        }

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TICKDATAPOINT_ALT_7BIT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = mState.LastTradePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        int nOrderVolumes = EncodingUtil.decode7BitInt(mIn);
                        int[] orderVolumes = new int[nOrderVolumes];

                        for (int i = 0; i < nOrderVolumes; i++) {
                            // Bug fix - volumes may have been stored incorrectly as a negative so remove the negative sign.
                            orderVolumes[i] = Math.abs(EncodingUtil.decode7BitInt(mIn));
                        }

                        mState.OrderVolumes = orderVolumes;

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TICKDATAPOINT_ALT_NEG_7BIT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = mState.LastTradePrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        int nOrderVolumes = EncodingUtil.decode7BitInt(mIn);
                        int[] orderVolumes = new int[nOrderVolumes];

                        for (int i = 0; i < nOrderVolumes; i++) {
                            // Bug fix - volumes may have been stored incorrectly as a negative so remove the negative sign.
                            orderVolumes[i] = Math.abs(EncodingUtil.decode7BitInt(mIn));
                        }

                        mState.OrderVolumes = orderVolumes;

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TRADE_PRICE_ALT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastPriceIncrements = mState.LastPriceIncrements.add(EncodingUtil.decodeDecimal(mIn));
                        mState.LastTradePrice = Price.fromIncrements(mState, mState.LastPriceIncrements);
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        int nOrderVolumes = EncodingUtil.decode7BitInt(mIn);
                        int[] orderVolumes = new int[nOrderVolumes];

                        for (int i = 0; i < nOrderVolumes; i++) {
                            // Bug fix - volumes may have been stored incorrectly as a negative so remove the negative sign.
                            orderVolumes[i] = Math.abs(EncodingUtil.decode7BitInt(mIn));
                        }

                        mState.OrderVolumes = orderVolumes;

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TRADE_PRICE_DEC_ALT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.TradeVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.LastTradePrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                        mState.LastTTV += EncodingUtil.decode7BitInt(mIn);

                        int attr = EncodingUtil.decode7BitInt(mIn);
                        mState.DueToSpread = ((attr & ChartFormat.TRADE_DUE_TO_SPREAD) != 0);

                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.AtBidOrOffer = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.AtBidOrOffer = BidOffer.Offer;
                        } else {
                            mState.AtBidOrOffer = BidOffer.Undefined;
                        }

                        int nOrderVolumes = EncodingUtil.decode7BitInt(mIn);
                        int[] orderVolumes = new int[nOrderVolumes];

                        for (int i = 0; i < nOrderVolumes; i++) {
                            // Bug fix - volumes may have been stored incorrectly as a negative so remove the negative sign.
                            orderVolumes[i] = Math.abs(EncodingUtil.decode7BitInt(mIn));
                        }

                        mState.OrderVolumes = orderVolumes;

                        mState.Change = ChartDataChange.Trade;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_TICKCHANGEDATAPOINT_7BIT: {
                    mState.BarStartTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarCloseTime = mState.BarStartTime + EncodingUtil.decode7BitLong(mIn);
                    mState.BarClosePrice = mState.BarClosePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TickChange;
                    break;
                }
                case ChartFormat.CTAG_TICKCHANGEDATAPOINT_NEG_7BIT: {
                    mState.BarStartTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarCloseTime = mState.BarStartTime + EncodingUtil.decode7BitLong(mIn);
                    mState.BarClosePrice = mState.BarClosePrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TickChange;
                    break;
                }
                case ChartFormat.CTAG_PRICE_CHANGE: {
                    mState.BarStartTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarCloseTime = mState.BarStartTime + EncodingUtil.decode7BitLong(mIn);
                    mState.BarClosePrice = mState.BarClosePrice.add(EncodingUtil.decodeDecimal(mIn));
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TickChange;
                    break;
                }
                case ChartFormat.CTAG_PRICE_CHANGE_DEC: {
                    mState.BarStartTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarCloseTime = mState.BarStartTime + EncodingUtil.decode7BitLong(mIn);
                    mState.BarClosePrice = new Price(EncodingUtil.decodeDecimal(mIn));
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TickChange;
                    break;
                }
                case ChartFormat.CTAG_BARDATAPOINT_7BIT_DELTA_LOW: {
                    mState.BarCloseTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarStartTime = ChartFormat.getBarStartTime(mState.BarCloseTime, mState.TradeDateTicks, mDataType);
                    mState.BarOpenPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarHighPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarLowPrice = mState.BarLowPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.BarClosePrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOpenPrice = mState.BarOpenPrice.add(mState.BarLowPrice);
                    mState.BarHighPrice = mState.BarHighPrice.add(mState.BarLowPrice);
                    mState.BarClosePrice = mState.BarClosePrice.add(mState.BarLowPrice);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TradeBar;
                    break;
                }
                case ChartFormat.CTAG_BARDATAPOINT_NEG_7BIT_DELTA_LOW: {
                    mState.BarCloseTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarStartTime = ChartFormat.getBarStartTime(mState.BarCloseTime, mState.TradeDateTicks, mDataType);
                    mState.BarOpenPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarHighPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarLowPrice = mState.BarLowPrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.BarClosePrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOpenPrice = mState.BarOpenPrice.add(mState.BarLowPrice);
                    mState.BarHighPrice = mState.BarHighPrice.add(mState.BarLowPrice);
                    mState.BarClosePrice = mState.BarClosePrice.add(mState.BarLowPrice);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TradeBar;
                    break;
                }
                case ChartFormat.CTAG_BAR_PRICE: {
                    mState.BarCloseTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarStartTime = ChartFormat.getBarStartTime(mState.BarCloseTime, mState.TradeDateTicks, mDataType);

                    BigDecimal barOpenIncrements = EncodingUtil.decodeDecimal(mIn);
                    BigDecimal barHighIncrements = EncodingUtil.decodeDecimal(mIn);
                    BigDecimal barLowIncrements = mState.LastBarLowPriceIncrements.add(EncodingUtil.decodeDecimal(mIn));
                    mState.LastBarLowPriceIncrements = barLowIncrements;
                    BigDecimal barCloseIncrements = EncodingUtil.decodeDecimal(mIn);

                    mState.BarOpenPrice = Price.fromIncrements(mState, barOpenIncrements.add(barLowIncrements));
                    mState.BarHighPrice = Price.fromIncrements(mState, barHighIncrements.add(barLowIncrements));
                    mState.BarLowPrice = Price.fromIncrements(mState, barLowIncrements);
                    mState.BarClosePrice = Price.fromIncrements(mState, barCloseIncrements.add(barLowIncrements));

                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TradeBar;
                    break;
                }
                case ChartFormat.CTAG_BAR_PRICE_DEC: {
                    mState.BarCloseTime = getIncrementalTime(mState.BarCloseTime, EncodingUtil.decode7BitLong(mIn));
                    mState.BarStartTime = ChartFormat.getBarStartTime(mState.BarCloseTime, mState.TradeDateTicks, mDataType);

                    BigDecimal barOpenIncrements = EncodingUtil.decodeDecimal(mIn);
                    BigDecimal barHighIncrements = EncodingUtil.decodeDecimal(mIn);
                    BigDecimal barLowIncrements = EncodingUtil.decodeDecimal(mIn);
                    BigDecimal barCloseIncrements = EncodingUtil.decodeDecimal(mIn);
                    mState.BarOpenPrice = Price.fromIncrements(mState, barOpenIncrements);
                    mState.BarHighPrice = Price.fromIncrements(mState, barHighIncrements);
                    mState.BarLowPrice = Price.fromIncrements(mState, barLowIncrements);
                    mState.BarClosePrice = Price.fromIncrements(mState, barCloseIncrements);

                    mState.BarVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarBidVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarOfferVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTrades = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.BarTradesAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.Change = ChartDataChange.TradeBar;
                    break;
                }
                case ChartFormat.CTAG_TPO_START: {
                    mState.TPOStartTime = getIncrementalTime(mState.TPOStartTime, EncodingUtil.decode7BitLong(mIn));
                    mState.TPOBasePrice = mState.TPOBasePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.Change = ChartDataChange.None;
                    break;
                }
                case ChartFormat.CTAG_TPO_START_NEGBASE: {
                    mState.TPOStartTime = getIncrementalTime(mState.TPOStartTime, EncodingUtil.decode7BitLong(mIn));
                    mState.TPOBasePrice = mState.TPOBasePrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.Change = ChartDataChange.None;
                    break;
                }
                case ChartFormat.CTAG_TPO_START_PRICE: {
                    mState.TPOStartTime = getIncrementalTime(mState.TPOStartTime, EncodingUtil.decode7BitLong(mIn));
                    mState.LastTPOBasePriceIncrements = mState.LastTPOBasePriceIncrements.add(EncodingUtil.decodeDecimal(mIn));
                    mState.TPOBasePrice = Price.fromIncrements(mState, mState.LastTPOBasePriceIncrements);
                    mState.Change = ChartDataChange.None;
                    break;
                }
                case ChartFormat.CTAG_TPO_START_PRICE_DEC: {
                    mState.TPOStartTime = getIncrementalTime(mState.TPOStartTime, EncodingUtil.decode7BitLong(mIn));
                    mState.TPOBasePrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                    mState.Change = ChartDataChange.None;
                    break;
                }
                case ChartFormat.CTAG_TPO_DATAPOINT:
                    mState.TPOPrice = mState.TPOBasePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = false;
                    mState.TPOIsClosing = false;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_PRICE:
                    mState.TPOPrice = Price.fromIncrements(mState, mState.LastTPOBasePriceIncrements.add(EncodingUtil.decodeDecimal(mIn)));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = false;
                    mState.TPOIsClosing = false;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_DATAPOINT_OPEN:
                    mState.TPOPrice = mState.TPOBasePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = true;
                    mState.TPOIsClosing = false;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_OPEN_PRICE:
                    mState.TPOPrice = Price.fromIncrements(mState, mState.LastTPOBasePriceIncrements.add(EncodingUtil.decodeDecimal(mIn)));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = true;
                    mState.TPOIsClosing = false;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_DATAPOINT_CLOSE:
                    mState.TPOPrice = mState.TPOBasePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = false;
                    mState.TPOIsClosing = true;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_CLOSE_PRICE:
                    mState.TPOPrice = Price.fromIncrements(mState, mState.LastTPOBasePriceIncrements.add(EncodingUtil.decodeDecimal(mIn)));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = false;
                    mState.TPOIsClosing = true;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_DATAPOINT_OPENCLOSE:
                    mState.TPOPrice = mState.TPOBasePrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = true;
                    mState.TPOIsClosing = true;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_TPO_OPENCLOSE_PRICE:
                    mState.TPOPrice = Price.fromIncrements(mState, mState.LastTPOBasePriceIncrements.add(EncodingUtil.decodeDecimal(mIn)));
                    mState.TPOVolume = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtBid = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOVolumeAtOffer = EncodingUtil.decode7BitInt(mIn);
                    mState.TPOIsOpening = true;
                    mState.TPOIsClosing = true;
                    mState.Change = ChartDataChange.TPO;
                    break;
                case ChartFormat.CTAG_QUOTE_7BIT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.BidPrice = mState.BidPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.BidRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.BidImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferPrice = mState.BidPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.OfferRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.Quote;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_QUOTE_NEG_7BIT: {
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.BidPrice = mState.BidPrice.subtract(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.BidRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.BidImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferPrice = mState.BidPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.OfferRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.Quote;
                    } else {
                        mEOF = true;
                    }
                    break;
                }
                case ChartFormat.CTAG_QUOTE_PRICE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.LastBidPriceIncrements = mState.LastBidPriceIncrements.add(EncodingUtil.decodeDecimal(mIn));
                        mState.BidPrice = Price.fromIncrements(mState, mState.LastBidPriceIncrements);
                        mState.BidRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.BidImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferPrice = mState.BidPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.OfferRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.Quote;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_QUOTE_PRICE_DEC:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.BidPrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                        mState.BidRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.BidImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferPrice = mState.BidPrice.add(Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator));
                        mState.OfferRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferImpliedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.Quote;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_QUOTE_VOLUME_DELTA:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.BidRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.OfferRealVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.Quote;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_MODE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.Mode = MarketMode.get(EncodingUtil.decode7BitInt(mIn));
                        mState.Change = ChartDataChange.MarketMode;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_SETTLEMENT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.SettlementPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                        mState.Change = ChartDataChange.Settlement;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_SETTLEMENT_PRICE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.SettlementPrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                        mState.Change = ChartDataChange.Settlement;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_HELD_SETTLEMENT:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.SettlementHeldPrice = Price.fromTicks(mState, EncodingUtil.decode7BitInt(mIn) * mState.Numerator);
                        mState.Change = ChartDataChange.HeldSettlement;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_HELD_SETTLEMENT_PRICE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.SettlementHeldPrice = Price.fromIncrements(mState, EncodingUtil.decodeDecimal(mIn));
                        mState.Change = ChartDataChange.HeldSettlement;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_CLEARED_VOLUME:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.ClearedVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.ClearedVolume;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_OPEN_INTEREST:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        mState.OpenInterest = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.OpenInterest;
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_VWAP:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        int iPriceTicks = EncodingUtil.decode7BitInt(mIn);

                        // Check that the definition was read.
                        if (mState.MarketDefined) {
                            mState.VWAP = Price.fromTicks(mState, iPriceTicks);
                            mState.Change = ChartDataChange.VWAP;
                        }
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_VWAP_PRICE:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        BigDecimal iPriceIncrements = EncodingUtil.decodeDecimal(mIn);

                        // Check that the definition was read.
                        if (mState.MarketDefined) {
                            mState.VWAP = Price.fromIncrements(mState, iPriceIncrements);
                            mState.Change = ChartDataChange.VWAP;
                        }
                    } else {
                        mEOF = true;
                    }
                    break;
                case ChartFormat.CTAG_MARKET_RFQ:
                    if (incrementTimeTicks(EncodingUtil.decode7BitLong(mIn))) {
                        int attr = EncodingUtil.decode7BitInt(mIn);
                        if ((attr & ChartFormat.TRADE_AT_BID) != 0) {
                            mState.RFQBuySell = BidOffer.Bid;
                        } else if ((attr & ChartFormat.TRADE_AT_OFFER) != 0) {
                            mState.RFQBuySell = BidOffer.Offer;
                        } else {
                            mState.RFQBuySell = BidOffer.Undefined;
                        }

                        mState.RFQVolume = EncodingUtil.decode7BitInt(mIn);
                        mState.Change = ChartDataChange.RFQ;
                    } else {
                        mEOF = true;
                    }
                    break;
                default:
                    Log.v(TAG, "readT4Bin(), Unknown tag [" + tag + "]. Not supported.");
                    mState.Change = ChartDataChange.None;
                    break;
            }
        }

        // Ensure we read the full record.
        long nRead = mIn.getCount();
        if (nRead < len) {
            //noinspection ResultOfMethodCallIgnored
            mIn.skip(len - nRead);
        }

        return !mEOF;
    }

    /**
     * Gets the current reader state for the specified market id.
     *
     * @param marketID Teh market id to retreive state for.
     * @return The state.
     */
    private ChartDataState getMarketState(String marketID) {
        if (mState == null || !mState.MarketID.equals(marketID)) {
            mState = mMarketStates.get(marketID);

            if (mState == null) {
                mState = mMarketStates.get("");
                if (mState != null && !mIsConsolidated) {
                    // Workaround for reading non-consolidated T4Bin files when marketid was not intially specified.
                    mMarketStates.put(marketID, mState);
                } else if (mState == null) {
                    mState = new ChartDataState();
                    mState.MarketID = marketID;
                    mMarketStates.put(marketID, mState);
                } else {
                    mState.MarketID = marketID;
                    mMarketStates.put(marketID, mState);
                }
            }
        }

        return mState;
    }

    /**
     * Increment the incremental time value.
     *
     * @param ticks The amount to increment the time.
     * @return Whether this time is allowed.
     */
    private boolean incrementTimeTicks(long ticks) {

        // Differentiate incremental time values from full time values.
        mState.LastTimeTicks = getIncrementalTime(mState.LastTimeTicks, ticks);

        // The API version supports "mostRecentAllowedTime" to cut off reading records after a particular time
        // (to support delayed data.) This API does not support it, so we always return true.
        return true;
    }

    /**
     * Increments the time value with the specified ticks.
     *
     * @param baseTicks The base time ticks.
     * @param ticks     The amount to increment.
     * @return The new time value in ticks.
     */
    private long getIncrementalTime(long baseTicks, long ticks) {

        if (ticks > 599266080000000000L) {
            return ticks;
        } else {
            return baseTicks + ticks;
        }
    }
}
