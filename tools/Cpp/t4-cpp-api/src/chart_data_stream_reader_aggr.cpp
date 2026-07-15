#include "t4decoder/chart_data_stream_reader_aggr.hpp"

#include "t4decoder/encoding.hpp"
#include "t4decoder/message_reader.hpp"

namespace t4 {

void ChartDataStreamReaderAggr::read(const std::vector<std::uint8_t>& data,
                                     AggrHandler& handler) {
  ByteReader reader(data);
  readStream(reader, handler);
}

void ChartDataStreamReaderAggr::readStream(InputStream& reader,
                                           AggrHandler& handler) {
  CountingInputStream cin(reader);

  MarketDefinition market;
  bool haveMarket = false;
  NDateTime tradeDate(0);
  std::string marketId;

  while (cin.available() > 0) {
    std::int32_t length = decode7BitInt(cin);
    cin.resetCount();

    if (length > 0) {
      std::int32_t tag = decode7BitInt(cin);

      switch (tag) {
        case CTAG_AGGR_SOF: {
          readInteger(cin);  // format version (unused)
          tradeDate = NDateTime(0);
          marketId.clear();
          break;
        }

        case CTAG_AGGR_MARKET_DEFINITION: {
          std::string mktId = readString(cin);
          int numerator = decode7BitInt(cin);
          int denominator = decode7BitInt(cin);
          std::string priceCode = readString(cin);
          Decimal tickValue = decodeDecimal(cin);
          std::string vpt = readString(cin);
          std::optional<Price> minCabPrice = decodePriceN(cin);

          market = MarketDefinition(mktId, numerator, denominator, priceCode,
                                    tickValue, vpt, minCabPrice);
          haveMarket = true;
          handler.onMarketDefinition(market);
          break;
        }

        case CTAG_AGGR_TRADEDATE_SWITCH:
          tradeDate = read7BitDatetime(cin);
          break;

        case CTAG_AGGR_MARKET_SWITCH:
          marketId = readString(cin);
          break;

        case CTAG_AGGR_BAR_DELTA: {
          NDateTime time = read7BitDatetime(cin);
          NDateTime closeTime(time.ticks() + decode7BitLong(cin));

          int openInc = decode7BitInt(cin);
          int highInc = decode7BitInt(cin);
          int lowInc = decode7BitInt(cin);
          int closeInc = decode7BitInt(cin);

          Bar bar;
          bar.TradeDate = tradeDate;
          bar.Time = time;
          bar.CloseTime = closeTime;
          bar.MarketID = marketId;
          if (haveMarket) {
            bar.OpenPrice = Price::fromIncrements(
                market, Decimal(static_cast<long long>(openInc) + lowInc));
            bar.HighPrice = Price::fromIncrements(
                market, Decimal(static_cast<long long>(highInc) + lowInc));
            bar.LowPrice =
                Price::fromIncrements(market, Decimal(static_cast<long long>(lowInc)));
            bar.ClosePrice = Price::fromIncrements(
                market, Decimal(static_cast<long long>(closeInc) + lowInc));
          }
          bar.Volume = decode7BitInt(cin);
          bar.VolumeAtBid = decode7BitInt(cin);
          bar.VolumeAtOffer = decode7BitInt(cin);
          bar.Trades = decode7BitInt(cin);
          bar.TradesAtBid = decode7BitInt(cin);
          bar.TradesAtOffer = decode7BitInt(cin);
          handler.onBar(bar);
          break;
        }

        case CTAG_AGGR_BAR: {
          NDateTime time = read7BitDatetime(cin);
          NDateTime closeTime(time.ticks() + decode7BitLong(cin));

          Bar bar;
          bar.TradeDate = tradeDate;
          bar.Time = time;
          bar.CloseTime = closeTime;
          bar.MarketID = marketId;
          bar.OpenPrice = decodePrice(cin);
          bar.HighPrice = decodePrice(cin);
          bar.LowPrice = decodePrice(cin);
          bar.ClosePrice = decodePrice(cin);
          bar.Volume = decode7BitInt(cin);
          bar.VolumeAtBid = decode7BitInt(cin);
          bar.VolumeAtOffer = decode7BitInt(cin);
          bar.Trades = decode7BitInt(cin);
          bar.TradesAtBid = decode7BitInt(cin);
          bar.TradesAtOffer = decode7BitInt(cin);
          handler.onBar(bar);
          break;
        }

        case CTAG_AGGR_MARKET_MODE: {
          NDateTime time = read7BitDatetime(cin);
          MarketMode mode = marketModeFromInt(decode7BitInt(cin));
          handler.onModeChange(marketId, tradeDate, time, mode);
          break;
        }

        case CTAG_AGGR_SETTLEMENT_PRICE: {
          NDateTime time = read7BitDatetime(cin);
          Price settlementPrice = decodePrice(cin);
          bool held = readBoolean(cin);
          handler.onSettlement(marketId, tradeDate, time, settlementPrice, held);
          break;
        }

        case CTAG_AGGR_OPEN_INTEREST: {
          NDateTime time = read7BitDatetime(cin);
          int openInterest = decode7BitInt(cin);
          handler.onOpenInterest(marketId, tradeDate, time, openInterest);
          break;
        }

        default:
          break;  // unknown tag: trailing bytes skipped below
      }
    }

    std::size_t nRead = cin.getCount();
    if (nRead < static_cast<std::size_t>(length)) {
      cin.skip(static_cast<std::size_t>(length) - nRead);
    }
  }
}

}  // namespace t4
