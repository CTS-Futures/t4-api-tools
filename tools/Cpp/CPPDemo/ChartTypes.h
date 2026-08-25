#ifndef CHARTTYPES_H
#define CHARTTYPES_H

#include <QMetaType>
#include <QVector>
#include <QtGlobal>

// A plain, Qt-friendly OHLCV candle. Decoder-internal types (t4::Bar, t4::Price,
// t4::NDateTime) are converted to this before crossing the Client -> UI signal
// boundary, so the UI never has to depend on the t4decoder headers.
struct Candle {
    qint64 timeMs = 0;   // bar open time, ms since Unix epoch
    double open = 0.0;
    double high = 0.0;
    double low = 0.0;
    double close = 0.0;
    long volume = 0;
};

Q_DECLARE_METATYPE(Candle)
Q_DECLARE_METATYPE(QVector<Candle>)

// How the price series is rendered. Candles is the default; the others reuse the
// same viewport/scale math and only change the per-bar draw pass.
enum class ChartType {
    Candles,    // classic OHLC candlesticks
    OhlcBars,   // open tick left, close tick right, high-low vertical
    Line,       // polyline through closes
    Area,       // line through closes with a translucent fill below
    HeikinAshi, // smoothed candles computed from a recursive HA series
};

// Technical indicators the chart can draw. The overlays render on the price pane;
// the oscillators each get their own stacked bottom sub-pane. Periods are fixed
// per type in this first pass (a config dialog can come later).
enum class IndicatorType {
    SMA20, SMA50, EMA20, VWAP, Bollinger,   // price-pane overlays
    RSI, MACD,                              // oscillator sub-panes
};

// What a left-drag does. In Cursor mode it pans (the original behaviour); the
// other modes draw/measure instead.
enum class ToolMode { Cursor, TrendLine, HorizontalLine, Measure };

// A user-drawn annotation, anchored to (time, price) rather than pixels so it
// stays put across pan/zoom/interval changes. Horizontal lines use anchor 1 only.
struct Drawing {
    enum Kind { Trend, Horizontal };
    Kind kind = Trend;
    qint64 t1 = 0;   double p1 = 0.0;   // anchor 1
    qint64 t2 = 0;   double p2 = 0.0;   // anchor 2 (Trend only)
};

#endif // CHARTTYPES_H
