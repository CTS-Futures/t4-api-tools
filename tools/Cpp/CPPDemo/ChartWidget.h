#ifndef CHARTWIDGET_H
#define CHARTWIDGET_H

#include <QWidget>
#include <QVector>
#include <QPoint>
#include <QSet>
#include "ChartTypes.h"

class QTimer;

// Lightweight candlestick chart drawn with QPainter (no QtCharts dependency).
// History is loaded via setBars(); live trades extend the most recent candle
// via onTrade(), bucketed to the current bar interval.
//
// Rendering uses a viewport (fixed candle pixel width + a pan/zoom window) so
// candles stay readable and the price scale is computed over only the visible
// range. Repaints are coalesced through a timer so bursts of live ticks don't
// flicker.
class ChartWidget : public QWidget {
    Q_OBJECT
public:
    explicit ChartWidget(QWidget* parent = nullptr);

    // Bar interval in milliseconds, used to bucket live trades into candles.
    void setIntervalMs(qint64 intervalMs);

public slots:
    // Replace the full history (e.g. after a barchart fetch).
    void setBars(const QVector<Candle>& bars);
    // Fold a live trade into the current (or a new) candle.
    void onTrade(double price, int volume, qint64 timeMs);
    // Prepend an older chunk fetched on scroll-back; noMore stops further asks.
    void prependBars(const QVector<Candle>& older, bool noMore);

    // Explicit controls (toolbar buttons).
    void zoomIn();
    void zoomOut();
    void scrollToLatest();  // re-enable follow-latest

    // Rendering options (toolbar).
    void setChartType(ChartType type);
    void setShowVolume(bool on);
    void setIndicatorEnabled(IndicatorType type, bool on);
    void setLogScale(bool on);
    void setToolMode(ToolMode mode);
    void clearDrawings();
    void saveSnapshot();   // grab the widget to a PNG the user chooses

signals:
    // Emitted (single-flight) when the view nears the oldest loaded candle.
    void needOlderHistory();

protected:
    void paintEvent(QPaintEvent* event) override;
    void wheelEvent(QWheelEvent* event) override;
    void mousePressEvent(QMouseEvent* event) override;
    void mouseReleaseEvent(QMouseEvent* event) override;
    void mouseMoveEvent(QMouseEvent* event) override;
    void leaveEvent(QEvent* event) override;

private:
    // Coalesce repaints to ~25 fps so live ticks don't thrash the widget.
    void scheduleRepaint();
    // Largest valid left index given the current width/zoom (0 if all fit).
    double maxFirstVisible(int visibleCount) const;
    int visibleCountForWidth() const;
    // Ask for older history if the view is within a screen of the oldest bar.
    void maybeRequestOlder();
    // Zoom by a factor, keeping the given plot x-coordinate anchored.
    void zoomAt(double factor, double anchorX);
    // Candle index under the cursor, or -1 when the cursor is off the plot.
    int hoveredIndex() const;
    // Series actually drawn: the raw candles, or the Heikin-Ashi transform when
    // that chart type is selected (recomputed lazily, cached on m_candles).
    const QVector<Candle>& drawSeries() const;
    void invalidateHeikinAshi();

    // Indicator series, aligned to m_candles indices (NaN where undefined for
    // want of lookback). Computed over full history so the leftmost visible
    // value is correct.
    QVector<double> computeSMA(int period) const;
    QVector<double> computeEMA(int period) const;
    QVector<double> computeVWAP() const;
    void computeBollinger(int period, double mult, QVector<double>& mid,
                          QVector<double>& upper, QVector<double>& lower) const;
    QVector<double> computeRSI(int period) const;
    void computeMACD(int fast, int slow, int signal, QVector<double>& macd,
                     QVector<double>& signalLine, QVector<double>& hist) const;
    bool indicatorOn(IndicatorType t) const { return m_indicators.contains(static_cast<int>(t)); }

    // Pixel <-> (time, price) mapping. These read the scale cached from the last
    // paint (m_price*/m_v*/m_baseShift) so mouse handlers and the draw pass agree.
    double yForPrice(double price) const;   // price -> pixel y (respects log scale)
    double priceForY(double y) const;       // pixel y -> price
    double xForIdxF(double idxF) const;      // fractional candle index -> pixel x
    double idxFForX(double x) const;         // pixel x -> fractional candle index
    qint64 timeForIdxF(double idxF) const;   // fractional index -> ms since epoch
    double idxFForTime(qint64 t) const;      // ms since epoch -> fractional index
    double xForTime(qint64 t) const { return xForIdxF(idxFForTime(t)); }
    qint64 timeForX(double x) const { return timeForIdxF(idxFForX(x)); }
    // Index of the drawing nearest to a pixel point within a threshold, or -1.
    int hitTestDrawing(const QPoint& pt) const;

    QVector<Candle> m_candles;
    qint64 m_intervalMs = 60'000; // default 1 minute

    // Rendering options.
    ChartType m_chartType = ChartType::Candles;
    bool m_showVolume = false;
    bool m_logScale = false;
    QSet<int> m_indicators;   // enabled IndicatorType values (cast to int)

    // Drawing tools.
    ToolMode m_toolMode = ToolMode::Cursor;
    QVector<Drawing> m_drawings;
    bool m_drawing = false;             // a trend line is being dragged out
    Drawing m_pending;                  // the in-progress trend line
    bool m_measuring = false;           // a measure drag is in progress
    qint64 m_measT1 = 0; double m_measP1 = 0.0;   // measure anchor A
    qint64 m_measT2 = 0; double m_measP2 = 0.0;   // measure anchor B

    // Price scale cached from the last paint so the mapping helpers work outside
    // paintEvent. m_vMin/m_vMax are in the transformed domain (log10 when
    // m_logScale, else linear price).
    double m_priceTop = 0.0;
    double m_priceBottom = 0.0;
    double m_vMin = 0.0;
    double m_vMax = 1.0;

    // Heikin-Ashi cache: recomputed only when m_candles changes.
    mutable QVector<Candle> m_haCandles;
    mutable bool m_haValid = false;

    // Horizontal shift cached from the last paint (non-zero only when fewer
    // candles exist than fit the viewport) so hoveredIndex() maps the cursor to
    // the same candle that was actually drawn.
    double m_baseShift = 0.0;

    // Viewport / zoom state.
    double m_candleWidth = 8.0;    // pixels per candle slot
    double m_firstVisible = 0.0;   // fractional index of leftmost visible candle
    bool m_follow = true;          // stick to the newest candle

    // Drag-to-pan state.
    bool m_dragging = false;
    int m_dragStartX = 0;
    double m_dragStartFirst = 0.0;

    // Scroll-back history paging.
    bool m_loadingOlder = false; // a needOlderHistory() request is in flight
    bool m_noMore = false;       // reached the history floor; stop asking

    // Live-tick price calibration: the decoder bars are the source of truth, so
    // scale incoming live prices to match them by a power of ten (one-shot).
    double m_refClose = 0.0;     // newest historical close, the calibration anchor
    double m_liveScale = 1.0;    // multiplier applied to live prices
    bool m_liveScaleKnown = false;

    // Crosshair.
    QPoint m_cursor{-1, -1};
    bool m_hasCursor = false;

    QTimer* m_repaintTimer = nullptr;

    // Zoom range: capped so wheel zoom-out can't collapse the view into a
    // sliver ("panned all the way out"), and a wide zoom-in ceiling.
    static constexpr double kMinCandleWidth = 3.0;
    static constexpr double kMaxCandleWidth = 200.0;

    // Right-side price axis + bottom time axis margins (pixels).
    static constexpr int kMarginLeft = 8;
    static constexpr int kMarginRight = 64;
    static constexpr int kMarginTop = 8;
    static constexpr int kMarginBottom = 22;

    // Bottom sub-pane (volume / oscillators): fraction of the plot height it
    // takes, plus the gap separating it from the price pane.
    static constexpr double kSubPaneFraction = 0.22;
    static constexpr int kSubPaneGap = 6;
};

#endif // CHARTWIDGET_H
