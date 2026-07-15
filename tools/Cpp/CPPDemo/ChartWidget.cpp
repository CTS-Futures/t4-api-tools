#include "ChartWidget.h"

#include <QPainter>
#include <QPaintEvent>
#include <QMouseEvent>
#include <QWheelEvent>
#include <QDateTime>
#include <QFontMetrics>
#include <QPolygonF>
#include <QLineF>
#include <QFileDialog>
#include <QTimer>
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <limits>

ChartWidget::ChartWidget(QWidget* parent) : QWidget(parent) {
    setMinimumSize(480, 320);
    setMouseTracking(true);
    setAutoFillBackground(true);
    setCursor(Qt::OpenHandCursor);
    QPalette pal = palette();
    pal.setColor(QPalette::Window, QColor(0x1e, 0x1e, 0x1e));
    setPalette(pal);

    // Single-shot timer that coalesces repaint requests (~25 fps).
    m_repaintTimer = new QTimer(this);
    m_repaintTimer->setSingleShot(true);
    connect(m_repaintTimer, &QTimer::timeout, this, [this]() { update(); });
}

void ChartWidget::setIntervalMs(qint64 intervalMs) {
    if (intervalMs > 0)
        m_intervalMs = intervalMs;
}

void ChartWidget::setChartType(ChartType type) {
    if (m_chartType == type)
        return;
    m_chartType = type;
    scheduleRepaint();
}

void ChartWidget::setShowVolume(bool on) {
    if (m_showVolume == on)
        return;
    m_showVolume = on;
    scheduleRepaint();
}

void ChartWidget::setIndicatorEnabled(IndicatorType type, bool on) {
    const int key = static_cast<int>(type);
    if (on)
        m_indicators.insert(key);
    else
        m_indicators.remove(key);
    scheduleRepaint();
}

void ChartWidget::setLogScale(bool on) {
    if (m_logScale == on)
        return;
    m_logScale = on;
    scheduleRepaint();
}

void ChartWidget::setToolMode(ToolMode mode) {
    if (m_toolMode == mode)
        return;
    m_toolMode = mode;
    m_drawing = false;
    m_measuring = false;
    // Cursor mode pans (open hand); the other modes annotate (crosshair cursor).
    setCursor(mode == ToolMode::Cursor ? Qt::OpenHandCursor : Qt::CrossCursor);
    scheduleRepaint();
}

void ChartWidget::clearDrawings() {
    m_drawings.clear();
    scheduleRepaint();
}

void ChartWidget::saveSnapshot() {
    const QString path = QFileDialog::getSaveFileName(
        this, "Save chart snapshot", "chart.png", "PNG image (*.png)");
    if (path.isEmpty())
        return;
    grab().save(path, "PNG");
}

void ChartWidget::invalidateHeikinAshi() {
    m_haValid = false;
}

// --- Coordinate mapping -----------------------------------------------------
// These read the scale cached at the end of paintEvent, so they are valid
// between paints (for use in the mouse handlers).

double ChartWidget::yForPrice(double price) const {
    const double v = m_logScale ? std::log10(std::max(price, 1e-12)) : price;
    const double range = m_vMax - m_vMin;
    const double h = m_priceBottom - m_priceTop;
    if (range <= 0.0 || h <= 0.0)
        return m_priceBottom;
    return m_priceBottom - (v - m_vMin) / range * h;
}

double ChartWidget::priceForY(double y) const {
    const double range = m_vMax - m_vMin;
    const double h = m_priceBottom - m_priceTop;
    if (h <= 0.0)
        return m_vMin;
    const double v = m_vMin + (m_priceBottom - y) / h * range;
    return m_logScale ? std::pow(10.0, v) : v;
}

double ChartWidget::xForIdxF(double idxF) const {
    return kMarginLeft + m_baseShift + (idxF - m_firstVisible + 0.5) * m_candleWidth;
}

double ChartWidget::idxFForX(double x) const {
    if (m_candleWidth <= 0.0)
        return 0.0;
    return (x - kMarginLeft - m_baseShift) / m_candleWidth + m_firstVisible - 0.5;
}

qint64 ChartWidget::timeForIdxF(double idxF) const {
    if (m_candles.isEmpty())
        return 0;
    const int i = std::clamp(static_cast<int>(std::floor(idxF)), 0, static_cast<int>(m_candles.size()) - 1);
    const double frac = idxF - std::floor(idxF);
    return m_candles[i].timeMs + static_cast<qint64>(frac * m_intervalMs);
}

double ChartWidget::idxFForTime(qint64 t) const {
    const int n = m_candles.size();
    if (n == 0 || m_intervalMs <= 0)
        return 0.0;
    // Last candle with timeMs <= t (binary search), then interpolate by interval.
    int lo = 0, hi = n;
    while (lo < hi) {
        const int mid = (lo + hi) / 2;
        if (m_candles[mid].timeMs <= t) lo = mid + 1; else hi = mid;
    }
    const int idx = lo - 1;
    if (idx < 0)   // before the first candle: extrapolate off candle 0
        return static_cast<double>(t - m_candles[0].timeMs) / m_intervalMs;
    return idx + static_cast<double>(t - m_candles[idx].timeMs) / m_intervalMs;
}

int ChartWidget::hitTestDrawing(const QPoint& pt) const {
    const double kThresh = 6.0;
    int best = -1;
    double bestDist = kThresh;
    const QPointF p(pt);
    for (int i = 0; i < m_drawings.size(); ++i) {
        const Drawing& d = m_drawings[i];
        double dist;
        if (d.kind == Drawing::Horizontal) {
            dist = std::abs(yForPrice(d.p1) - pt.y());
        } else {
            const QPointF a(xForTime(d.t1), yForPrice(d.p1));
            const QPointF b(xForTime(d.t2), yForPrice(d.p2));
            const QLineF seg(a, b);
            const double len = seg.length();
            if (len < 1e-6) {
                dist = QLineF(a, p).length();
            } else {
                // Projection of p onto the segment, clamped to [0,1].
                const double tproj = std::clamp(
                    ((p.x() - a.x()) * (b.x() - a.x()) + (p.y() - a.y()) * (b.y() - a.y())) / (len * len),
                    0.0, 1.0);
                const QPointF proj(a.x() + tproj * (b.x() - a.x()), a.y() + tproj * (b.y() - a.y()));
                dist = QLineF(proj, p).length();
            }
        }
        if (dist < bestDist) {
            bestDist = dist;
            best = i;
        }
    }
    return best;
}

// --- Indicator math ---------------------------------------------------------
// All return series aligned to m_candles indices; NaN marks "not enough data".

static const double kNaN = std::numeric_limits<double>::quiet_NaN();

QVector<double> ChartWidget::computeSMA(int period) const {
    const int n = m_candles.size();
    QVector<double> out(n, kNaN);
    if (period <= 0)
        return out;
    double sum = 0.0;
    for (int i = 0; i < n; ++i) {
        sum += m_candles[i].close;
        if (i >= period)
            sum -= m_candles[i - period].close;
        if (i >= period - 1)
            out[i] = sum / period;
    }
    return out;
}

QVector<double> ChartWidget::computeEMA(int period) const {
    const int n = m_candles.size();
    QVector<double> out(n, kNaN);
    if (period <= 0 || n < period)
        return out;
    const double k = 2.0 / (period + 1);
    double seed = 0.0;
    for (int i = 0; i < period; ++i)
        seed += m_candles[i].close;
    out[period - 1] = seed / period;              // SMA seed
    for (int i = period; i < n; ++i)
        out[i] = m_candles[i].close * k + out[i - 1] * (1.0 - k);
    return out;
}

QVector<double> ChartWidget::computeVWAP() const {
    // Cumulative over the full loaded history (not session-anchored yet).
    const int n = m_candles.size();
    QVector<double> out(n, kNaN);
    double cumPV = 0.0, cumV = 0.0;
    for (int i = 0; i < n; ++i) {
        const Candle& c = m_candles[i];
        const double tp = (c.high + c.low + c.close) / 3.0;
        cumPV += tp * c.volume;
        cumV += c.volume;
        if (cumV > 0.0)
            out[i] = cumPV / cumV;
    }
    return out;
}

void ChartWidget::computeBollinger(int period, double mult, QVector<double>& mid,
                                   QVector<double>& upper, QVector<double>& lower) const {
    const int n = m_candles.size();
    mid = QVector<double>(n, kNaN);
    upper = QVector<double>(n, kNaN);
    lower = QVector<double>(n, kNaN);
    if (period <= 0)
        return;
    for (int i = period - 1; i < n; ++i) {
        double sum = 0.0;
        for (int j = i - period + 1; j <= i; ++j)
            sum += m_candles[j].close;
        const double m = sum / period;
        double var = 0.0;
        for (int j = i - period + 1; j <= i; ++j) {
            const double d = m_candles[j].close - m;
            var += d * d;
        }
        const double sd = std::sqrt(var / period);
        mid[i] = m;
        upper[i] = m + mult * sd;
        lower[i] = m - mult * sd;
    }
}

QVector<double> ChartWidget::computeRSI(int period) const {
    const int n = m_candles.size();
    QVector<double> out(n, kNaN);
    if (period <= 0 || n <= period)
        return out;
    auto rsiOf = [](double avgGain, double avgLoss) {
        if (avgLoss == 0.0)
            return 100.0;
        const double rs = avgGain / avgLoss;
        return 100.0 - 100.0 / (1.0 + rs);
    };
    double gain = 0.0, loss = 0.0;
    for (int i = 1; i <= period; ++i) {
        const double ch = m_candles[i].close - m_candles[i - 1].close;
        if (ch >= 0.0) gain += ch; else loss -= ch;
    }
    double avgGain = gain / period, avgLoss = loss / period;
    out[period] = rsiOf(avgGain, avgLoss);
    for (int i = period + 1; i < n; ++i) {
        const double ch = m_candles[i].close - m_candles[i - 1].close;
        const double g = ch > 0.0 ? ch : 0.0;
        const double l = ch < 0.0 ? -ch : 0.0;
        avgGain = (avgGain * (period - 1) + g) / period;   // Wilder smoothing
        avgLoss = (avgLoss * (period - 1) + l) / period;
        out[i] = rsiOf(avgGain, avgLoss);
    }
    return out;
}

void ChartWidget::computeMACD(int fast, int slow, int signal, QVector<double>& macd,
                              QVector<double>& signalLine, QVector<double>& hist) const {
    const int n = m_candles.size();
    macd = QVector<double>(n, kNaN);
    signalLine = QVector<double>(n, kNaN);
    hist = QVector<double>(n, kNaN);
    const QVector<double> emaFast = computeEMA(fast);
    const QVector<double> emaSlow = computeEMA(slow);
    for (int i = 0; i < n; ++i)
        if (!std::isnan(emaFast[i]) && !std::isnan(emaSlow[i]))
            macd[i] = emaFast[i] - emaSlow[i];

    // Signal = EMA(signal) of the MACD line, seeded with an SMA once `signal`
    // MACD values exist.
    int start = -1;
    for (int i = 0; i < n; ++i)
        if (!std::isnan(macd[i])) { start = i; break; }
    if (start < 0 || start + signal > n)
        return;
    double seed = 0.0;
    for (int i = start; i < start + signal; ++i)
        seed += macd[i];
    const int seedIdx = start + signal - 1;
    signalLine[seedIdx] = seed / signal;
    const double k = 2.0 / (signal + 1);
    for (int i = seedIdx + 1; i < n; ++i)
        signalLine[i] = macd[i] * k + signalLine[i - 1] * (1.0 - k);
    for (int i = 0; i < n; ++i)
        if (!std::isnan(macd[i]) && !std::isnan(signalLine[i]))
            hist[i] = macd[i] - signalLine[i];
}

// Heikin-Ashi is derived recursively from the raw series, so it's computed once
// and cached until the candles change. Non-HA chart types draw the raw candles.
const QVector<Candle>& ChartWidget::drawSeries() const {
    if (m_chartType != ChartType::HeikinAshi)
        return m_candles;
    if (!m_haValid) {
        m_haCandles.resize(m_candles.size());
        for (int i = 0; i < m_candles.size(); ++i) {
            const Candle& c = m_candles[i];
            Candle h;
            h.timeMs = c.timeMs;
            h.volume = c.volume;
            h.close = (c.open + c.high + c.low + c.close) / 4.0;
            h.open = (i == 0) ? (c.open + c.close) / 2.0
                              : (m_haCandles[i - 1].open + m_haCandles[i - 1].close) / 2.0;
            h.high = std::max({c.high, h.open, h.close});
            h.low = std::min({c.low, h.open, h.close});
            m_haCandles[i] = h;
        }
        m_haValid = true;
    }
    return m_haCandles;
}

// Candle index under the cursor, or -1 when the cursor is outside the plot. Uses
// m_baseShift cached from the last paint so it matches what was drawn.
int ChartWidget::hoveredIndex() const {
    if (!m_hasCursor || m_candles.isEmpty() || m_candleWidth <= 0.0)
        return -1;
    const int plotRight = width() - kMarginRight;
    if (m_cursor.x() < kMarginLeft || m_cursor.x() > plotRight)
        return -1;
    const int idx = static_cast<int>(
        m_firstVisible + (m_cursor.x() - kMarginLeft - m_baseShift) / m_candleWidth);
    if (idx < 0 || idx >= m_candles.size())
        return -1;
    return idx;
}

void ChartWidget::scheduleRepaint() {
    if (!m_repaintTimer->isActive())
        m_repaintTimer->start(40);
}

int ChartWidget::visibleCountForWidth() const {
    const int plotW = width() - kMarginLeft - kMarginRight;
    if (plotW <= 0 || m_candleWidth <= 0.0)
        return 1;
    return std::max(1, static_cast<int>(plotW / m_candleWidth));
}

double ChartWidget::maxFirstVisible(int visibleCount) const {
    return std::max(0.0, static_cast<double>(m_candles.size()) - visibleCount);
}

void ChartWidget::setBars(const QVector<Candle>& bars) {
    m_candles = bars;
    // Keep chronological order so the newest candle is always last.
    std::sort(m_candles.begin(), m_candles.end(),
              [](const Candle& a, const Candle& b) { return a.timeMs < b.timeMs; });
    // A fresh load re-anchors to the most recent candles and resets paging.
    m_follow = true;
    m_firstVisible = 0.0;
    m_loadingOlder = false;
    m_noMore = false;

    // Re-anchor live-price calibration to the newest historical close.
    m_refClose = m_candles.isEmpty() ? 0.0 : m_candles.last().close;
    m_liveScale = 1.0;
    m_liveScaleKnown = false;

    invalidateHeikinAshi();
    scheduleRepaint();
}

void ChartWidget::maybeRequestOlder() {
    if (m_loadingOlder || m_noMore || m_candles.isEmpty())
        return;
    // Within one screenful of the oldest loaded candle -> pull more.
    if (m_firstVisible <= visibleCountForWidth()) {
        m_loadingOlder = true;
        emit needOlderHistory();
    }
}

void ChartWidget::prependBars(const QVector<Candle>& older, bool noMore) {
    m_loadingOlder = false;
    m_noMore = noMore;

    if (!older.isEmpty() && !m_candles.isEmpty()) {
        const qint64 oldest = m_candles.first().timeMs;
        QVector<Candle> fresh;
        fresh.reserve(older.size());
        for (const Candle& c : older)
            if (c.timeMs < oldest)          // keep only strictly-older bars
                fresh.push_back(c);
        std::sort(fresh.begin(), fresh.end(),
                  [](const Candle& a, const Candle& b) { return a.timeMs < b.timeMs; });

        if (!fresh.isEmpty()) {
            const int added = fresh.size();
            fresh += m_candles;             // [older..., existing...]
            m_candles = std::move(fresh);
            // Keep the same candles under the viewport when scrolled back.
            if (!m_follow) {
                m_firstVisible += added;
                m_dragStartFirst += added;
            }
            invalidateHeikinAshi();
        }
    }

    scheduleRepaint();
    maybeRequestOlder();                    // still near the edge? keep filling
}

void ChartWidget::zoomAt(double factor, double anchorX) {
    if (m_candles.isEmpty() || m_candleWidth <= 0.0)
        return;
    const int plotLeft = kMarginLeft;
    // Candle index under the anchor before the zoom (kept fixed after).
    const double anchorIdx = m_firstVisible + (anchorX - plotLeft) / m_candleWidth;
    m_candleWidth = std::clamp(m_candleWidth * factor, kMinCandleWidth, kMaxCandleWidth);
    m_firstVisible = anchorIdx - (anchorX - plotLeft) / m_candleWidth;

    const int visibleCount = visibleCountForWidth();
    const double maxFirst = maxFirstVisible(visibleCount);
    m_firstVisible = std::clamp(m_firstVisible, 0.0, maxFirst);
    m_follow = (m_firstVisible >= maxFirst - 0.5);
    maybeRequestOlder();
    scheduleRepaint();
}

void ChartWidget::zoomIn() {
    zoomAt(1.25, (kMarginLeft + (width() - kMarginRight)) / 2.0);
}

void ChartWidget::zoomOut() {
    zoomAt(1.0 / 1.25, (kMarginLeft + (width() - kMarginRight)) / 2.0);
}

void ChartWidget::scrollToLatest() {
    m_follow = true;
    scheduleRepaint();
}

void ChartWidget::onTrade(double price, int volume, qint64 timeMs) {
    if (price <= 0.0)
        return; // ignore stray/zero ticks that would wreck the price scale

    // One-shot calibration: snap the live price onto the decoder-bar scale by the
    // nearest power of ten (no-op when the scales already agree).
    if (!m_liveScaleKnown && m_refClose > 0.0) {
        const double exp = std::clamp(std::round(std::log10(m_refClose / price)), -6.0, 6.0);
        m_liveScale = std::pow(10.0, exp);
        m_liveScaleKnown = true;
    }
    price *= m_liveScale;

    const qint64 barStart = timeMs - (timeMs % m_intervalMs);

    if (!m_candles.isEmpty() && m_candles.last().timeMs == barStart) {
        // Extend the current candle.
        Candle& c = m_candles.last();
        c.high = std::max(c.high, price);
        c.low = std::min(c.low, price);
        c.close = price;
        c.volume += volume;
    } else if (m_candles.isEmpty() || barStart > m_candles.last().timeMs) {
        // Start a new candle.
        Candle c;
        c.timeMs = barStart;
        c.open = c.high = c.low = c.close = price;
        c.volume = volume;
        m_candles.push_back(c);
    } else {
        // Out-of-order tick that belongs to an older bar; ignore for simplicity.
        return;
    }
    invalidateHeikinAshi();
    scheduleRepaint();
}

void ChartWidget::wheelEvent(QWheelEvent* event) {
    if (m_candles.isEmpty()) {
        event->accept();
        return;
    }

    const QPoint delta = event->angleDelta();

    // Horizontal scroll (touchpads / tilt wheels / shift+wheel) pans through
    // time — bounded, so it can never run off either edge.
    if (std::abs(delta.x()) > std::abs(delta.y())) {
        const double deltaCandles = (delta.x() / 120.0) * 3.0;
        const int visibleCount = visibleCountForWidth();
        const double maxFirst = maxFirstVisible(visibleCount);
        m_firstVisible = std::clamp(m_firstVisible + deltaCandles, 0.0, maxFirst);
        m_follow = (m_firstVisible >= maxFirst - 0.5);
        event->accept();
        maybeRequestOlder();
        scheduleRepaint();
        return;
    }

    if (delta.y() == 0) {
        event->accept();
        return;
    }

    // Vertical wheel zooms, anchored under the cursor. Zoom-out is capped by
    // kMinCandleWidth so it can't collapse the whole series into a sliver.
    const double factor = delta.y() > 0 ? 1.15 : (1.0 / 1.15);
    zoomAt(factor, event->position().x());
    event->accept();
}

void ChartWidget::mousePressEvent(QMouseEvent* event) {
    // Right-click deletes the nearest drawing, in any mode.
    if (event->button() == Qt::RightButton) {
        const int hit = hitTestDrawing(event->pos());
        if (hit >= 0) {
            m_drawings.remove(hit);
            scheduleRepaint();
        }
        QWidget::mousePressEvent(event);
        return;
    }

    if (event->button() == Qt::LeftButton) {
        const double price = priceForY(event->pos().y());
        const qint64 t = timeForX(event->pos().x());
        switch (m_toolMode) {
        case ToolMode::Cursor:
            m_dragging = true;
            m_dragStartX = event->pos().x();
            m_dragStartFirst = m_firstVisible;
            setCursor(Qt::ClosedHandCursor);
            break;
        case ToolMode::TrendLine:
            m_drawing = true;
            m_pending = Drawing{Drawing::Trend, t, price, t, price};
            break;
        case ToolMode::HorizontalLine:
            m_drawings.push_back(Drawing{Drawing::Horizontal, t, price, t, price});
            scheduleRepaint();
            break;
        case ToolMode::Measure:
            m_measuring = true;
            m_measT1 = m_measT2 = t;
            m_measP1 = m_measP2 = price;
            break;
        }
    }
    QWidget::mousePressEvent(event);
}

void ChartWidget::mouseReleaseEvent(QMouseEvent* event) {
    if (event->button() == Qt::LeftButton) {
        if (m_dragging) {
            m_dragging = false;
            setCursor(Qt::OpenHandCursor);
        }
        if (m_drawing) {                 // commit the trend line
            m_drawings.push_back(m_pending);
            m_drawing = false;
            scheduleRepaint();
        }
        if (m_measuring) {               // measurement is transient
            m_measuring = false;
            scheduleRepaint();
        }
    }
    QWidget::mouseReleaseEvent(event);
}

void ChartWidget::mouseMoveEvent(QMouseEvent* event) {
    m_cursor = event->pos();
    m_hasCursor = true;

    if (m_dragging && m_candleWidth > 0.0) {
        const double deltaCandles = (m_dragStartX - event->pos().x()) / m_candleWidth;
        const int visibleCount = visibleCountForWidth();
        const double maxFirst = maxFirstVisible(visibleCount);
        m_firstVisible = std::clamp(m_dragStartFirst + deltaCandles, 0.0, maxFirst);
        // Re-arm follow only when dragged back to the right edge.
        m_follow = (m_firstVisible >= maxFirst - 0.5);
        maybeRequestOlder();
    } else if (m_drawing) {
        m_pending.t2 = timeForX(event->pos().x());
        m_pending.p2 = priceForY(event->pos().y());
    } else if (m_measuring) {
        m_measT2 = timeForX(event->pos().x());
        m_measP2 = priceForY(event->pos().y());
    }
    scheduleRepaint();
}

void ChartWidget::leaveEvent(QEvent* event) {
    m_hasCursor = false;
    QWidget::leaveEvent(event);
    scheduleRepaint();
}

void ChartWidget::paintEvent(QPaintEvent* /*event*/) {
    QPainter p(this);
    p.fillRect(rect(), QColor(0x1e, 0x1e, 0x1e));

    const int plotLeft = kMarginLeft;
    const int plotRight = width() - kMarginRight;
    const int plotTop = kMarginTop;
    const int fullBottom = height() - kMarginBottom;   // bottom of the whole plot
    const int plotW = plotRight - plotLeft;

    // Bottom sub-panes, stacked: volume, then any enabled oscillators. Each takes
    // an equal slice of a bottom region capped so the price pane stays dominant.
    enum SubPaneKind { PaneVolume, PaneRSI, PaneMACD };
    QVector<int> bottomPanes;
    if (m_showVolume)                       bottomPanes.push_back(PaneVolume);
    if (indicatorOn(IndicatorType::RSI))    bottomPanes.push_back(PaneRSI);
    if (indicatorOn(IndicatorType::MACD))   bottomPanes.push_back(PaneMACD);
    const int paneCount = bottomPanes.size();

    int eachPaneH = 0;
    if (paneCount > 0) {
        const double totalFrac = std::min(0.55, kSubPaneFraction * paneCount);
        const int totalH = static_cast<int>((fullBottom - plotTop) * totalFrac);
        eachPaneH = std::max(24, (totalH - kSubPaneGap * paneCount) / paneCount);
    }
    const int bottomRegionH = paneCount > 0 ? (eachPaneH + kSubPaneGap) * paneCount : 0;
    const int priceBottom = fullBottom - bottomRegionH;
    const int plotBottom = priceBottom;                // price pane bottom
    const int plotH = plotBottom - plotTop;

    if (m_candles.isEmpty() || plotW <= 0 || plotH <= 0) {
        p.setPen(QColor(0xaa, 0xaa, 0xaa));
        p.drawText(rect(), Qt::AlignCenter,
                   "No chart data. Connect and pick a contract/expiry.");
        return;
    }

    const QVector<Candle>& series = drawSeries();
    const bool isLine = (m_chartType == ChartType::Line || m_chartType == ChartType::Area);

    const int n = m_candles.size();
    const int visibleCount = visibleCountForWidth();
    const double maxFirst = maxFirstVisible(visibleCount);

    // Anchor to the newest candle when following; always keep the view in range.
    if (m_follow)
        m_firstVisible = maxFirst;
    m_firstVisible = std::clamp(m_firstVisible, 0.0, maxFirst);

    const int firstIdx = std::clamp(static_cast<int>(std::floor(m_firstVisible)), 0, n - 1);
    const int lastIdx = std::clamp(firstIdx + visibleCount, 0, n - 1);

    // When fewer candles exist than fit the viewport, keep them anchored to the
    // right edge (blank space to the left) rather than bunched on the left.
    const double baseShift = (n < visibleCount)
                                 ? (plotW - n * m_candleWidth)
                                 : 0.0;
    m_baseShift = baseShift;   // cached so hoveredIndex() matches what we draw

    // Price range across the VISIBLE candles only (with a little padding). Line/
    // area use closes; the rest use the full high/low envelope.
    double minPrice, maxPrice;
    if (isLine) {
        minPrice = maxPrice = series[firstIdx].close;
        for (int i = firstIdx; i <= lastIdx; ++i) {
            minPrice = std::min(minPrice, series[i].close);
            maxPrice = std::max(maxPrice, series[i].close);
        }
    } else {
        minPrice = series[firstIdx].low;
        maxPrice = series[firstIdx].high;
        for (int i = firstIdx; i <= lastIdx; ++i) {
            minPrice = std::min(minPrice, series[i].low);
            maxPrice = std::max(maxPrice, series[i].high);
        }
    }
    if (maxPrice <= minPrice)
        maxPrice = minPrice + 1.0; // avoid divide-by-zero on a flat series
    const double pad = (maxPrice - minPrice) * 0.05;
    minPrice -= pad;
    maxPrice += pad;
    if (m_logScale && minPrice <= 0.0)
        minPrice = maxPrice * 1e-6;      // keep the domain positive for log10

    // Cache the scale so the mapping helpers (used here and in the mouse handlers)
    // agree with exactly what this paint drew. m_vMin/m_vMax are in the transformed
    // (log or linear) domain.
    m_priceTop = plotTop;
    m_priceBottom = plotBottom;
    m_vMin = m_logScale ? std::log10(minPrice) : minPrice;
    m_vMax = m_logScale ? std::log10(maxPrice) : maxPrice;

    auto yFor = [&](double price) { return static_cast<int>(yForPrice(price)); };
    auto xFor = [&](int idx) { return static_cast<int>(xForIdxF(idx)); };

    const int bodyW = std::max(1, static_cast<int>(m_candleWidth * 0.6));

    const QColor up(0x26, 0xa6, 0x9a);
    const QColor down(0xef, 0x53, 0x50);

    // --- Grid + price axis labels -------------------------------------------
    QFont axisFont = p.font();
    axisFont.setPointSize(8);
    p.setFont(axisFont);
    const int kGridLines = 5;
    for (int i = 0; i <= kGridLines; ++i) {
        const int y = plotTop + i * plotH / kGridLines;
        p.setPen(QColor(0x2c, 0x2c, 0x2c));
        p.drawLine(plotLeft, y, plotRight, y);
        const double price = priceForY(y);
        p.setPen(QColor(0x99, 0x99, 0x99));
        p.drawText(plotRight + 4, y + 4, QString::number(price, 'f', 2));
    }

    // --- Price series (visible slice only) ----------------------------------
    if (isLine) {
        QPolygonF poly;
        poly.reserve(lastIdx - firstIdx + 1);
        for (int i = firstIdx; i <= lastIdx; ++i)
            poly << QPointF(xFor(i), yFor(series[i].close));
        if (m_chartType == ChartType::Area && poly.size() >= 2) {
            QPolygonF fill = poly;
            fill << QPointF(poly.last().x(), plotBottom)
                 << QPointF(poly.first().x(), plotBottom);
            p.setPen(Qt::NoPen);
            p.setBrush(QColor(up.red(), up.green(), up.blue(), 40));
            p.drawPolygon(fill);
        }
        p.setBrush(Qt::NoBrush);
        p.setPen(QPen(up, 1.5));
        p.drawPolyline(poly);
    } else {
        for (int i = firstIdx; i <= lastIdx; ++i) {
            const Candle& c = series[i];
            const int cx = xFor(i);
            const bool bull = c.close >= c.open;
            const QColor col = bull ? up : down;
            p.setPen(col);

            if (m_chartType == ChartType::OhlcBars) {
                // High-low bar with open tick to the left, close tick to the right.
                p.drawLine(cx, yFor(c.high), cx, yFor(c.low));
                const int tick = std::max(1, bodyW / 2);
                p.drawLine(cx - tick, yFor(c.open), cx, yFor(c.open));
                p.drawLine(cx, yFor(c.close), cx + tick, yFor(c.close));
            } else {
                // Candles + Heikin-Ashi: wick then body.
                p.drawLine(cx, yFor(c.high), cx, yFor(c.low));
                const int yOpen = yFor(c.open);
                const int yClose = yFor(c.close);
                int top = std::min(yOpen, yClose);
                int h = std::abs(yClose - yOpen);
                if (h < 1) h = 1; // doji: keep a visible line
                p.fillRect(QRect(cx - bodyW / 2, top, bodyW, h), col);
            }
        }
    }

    // --- Indicator overlays (price pane, clipped) ---------------------------
    QVector<QPair<QString, QColor>> overlayLegend;
    {
        p.save();
        p.setClipRect(QRect(plotLeft, plotTop, plotW, plotH));
        p.setBrush(Qt::NoBrush);
        // Draw a series as a polyline, breaking across NaN gaps.
        auto drawLineSeries = [&](const QVector<double>& v, const QColor& col, qreal penW) {
            p.setPen(QPen(col, penW));
            QPolygonF poly;
            for (int i = firstIdx; i <= lastIdx; ++i) {
                if (std::isnan(v[i])) {
                    if (poly.size() >= 2) p.drawPolyline(poly);
                    poly.clear();
                    continue;
                }
                poly << QPointF(xFor(i), yFor(v[i]));
            }
            if (poly.size() >= 2) p.drawPolyline(poly);
        };

        if (indicatorOn(IndicatorType::Bollinger)) {
            QVector<double> mid, upper, lower;
            computeBollinger(20, 2.0, mid, upper, lower);
            QPolygonF band;   // faint fill between the bands
            for (int i = firstIdx; i <= lastIdx; ++i)
                if (!std::isnan(upper[i])) band << QPointF(xFor(i), yFor(upper[i]));
            for (int i = lastIdx; i >= firstIdx; --i)
                if (!std::isnan(lower[i])) band << QPointF(xFor(i), yFor(lower[i]));
            if (band.size() >= 3) {
                p.setPen(Qt::NoPen);
                p.setBrush(QColor(0x42, 0x85, 0xf4, 30));
                p.drawPolygon(band);
                p.setBrush(Qt::NoBrush);
            }
            const QColor bandCol(0x64, 0xb5, 0xf6);
            drawLineSeries(upper, bandCol, 1.0);
            drawLineSeries(lower, bandCol, 1.0);
            drawLineSeries(mid, QColor(0x90, 0xa4, 0xae), 1.0);
            overlayLegend.append({"BB(20,2)", bandCol});
        }
        if (indicatorOn(IndicatorType::SMA20)) {
            const QColor c(0xff, 0xd5, 0x4f);
            drawLineSeries(computeSMA(20), c, 1.3);
            overlayLegend.append({"SMA20", c});
        }
        if (indicatorOn(IndicatorType::SMA50)) {
            const QColor c(0xff, 0x8a, 0x65);
            drawLineSeries(computeSMA(50), c, 1.3);
            overlayLegend.append({"SMA50", c});
        }
        if (indicatorOn(IndicatorType::EMA20)) {
            const QColor c(0x4d, 0xd0, 0xe1);
            drawLineSeries(computeEMA(20), c, 1.3);
            overlayLegend.append({"EMA20", c});
        }
        if (indicatorOn(IndicatorType::VWAP)) {
            const QColor c(0xba, 0x68, 0xc8);
            drawLineSeries(computeVWAP(), c, 1.3);
            overlayLegend.append({"VWAP", c});
        }
        p.restore();
    }

    // --- Last-price line + right-axis tag -----------------------------------
    {
        const double lastPrice = series.last().close;
        if (lastPrice >= minPrice && lastPrice <= maxPrice) {
            const int y = yFor(lastPrice);
            const bool bull = series.last().close >= series.last().open;
            const QColor col = bull ? up : down;
            p.setPen(QPen(col, 1, Qt::DashLine));
            p.drawLine(plotLeft, y, plotRight, y);
            QRect tag(plotRight + 1, y - 8, kMarginRight - 2, 16);
            p.fillRect(tag, col);
            p.setPen(Qt::white);
            p.drawText(tag, Qt::AlignCenter, QString::number(lastPrice, 'f', 2));
        }
    }

    // --- Bottom sub-panes (volume / RSI / MACD, stacked) --------------------
    // Each pane self-scales to its own visible range, so no vertical clipping is
    // needed; right-margin labels are drawn past plotRight on purpose.
    for (int pi = 0; pi < paneCount; ++pi) {
        const int paneTop = priceBottom + kSubPaneGap + pi * (eachPaneH + kSubPaneGap);
        const int paneBottom = paneTop + eachPaneH;
        const int paneH = eachPaneH;
        p.setPen(QColor(0x2c, 0x2c, 0x2c));   // top separator
        p.drawLine(plotLeft, paneTop, plotRight, paneTop);

        if (bottomPanes[pi] == PaneVolume) {
            long maxVol = 0;
            for (int i = firstIdx; i <= lastIdx; ++i)
                maxVol = std::max(maxVol, m_candles[i].volume);
            if (maxVol > 0) {
                for (int i = firstIdx; i <= lastIdx; ++i) {
                    const Candle& c = m_candles[i];
                    const QColor col = (c.close >= c.open) ? up : down;
                    const int barH = static_cast<int>(static_cast<double>(c.volume) / maxVol * paneH);
                    p.fillRect(QRect(xFor(i) - bodyW / 2, paneBottom - barH, bodyW, barH),
                               QColor(col.red(), col.green(), col.blue(), 150));
                }
                p.setPen(QColor(0x99, 0x99, 0x99));
                p.drawText(plotLeft + 4, paneTop + 10, "Volume");
                p.drawText(plotRight + 4, paneTop + 10, QString::number(maxVol));
            }
        } else if (bottomPanes[pi] == PaneRSI) {
            const QVector<double> rsi = computeRSI(14);
            auto yR = [&](double v) {
                return paneBottom - static_cast<int>(std::clamp(v, 0.0, 100.0) / 100.0 * paneH);
            };
            p.setPen(QColor(0x2c, 0x2c, 0x2c));
            p.drawLine(plotLeft, yR(70), plotRight, yR(70));
            p.drawLine(plotLeft, yR(30), plotRight, yR(30));
            p.setPen(QPen(QColor(0xab, 0x47, 0xbc), 1.2));
            QPolygonF poly;
            for (int i = firstIdx; i <= lastIdx; ++i) {
                if (std::isnan(rsi[i])) {
                    if (poly.size() >= 2) p.drawPolyline(poly);
                    poly.clear();
                    continue;
                }
                poly << QPointF(xFor(i), yR(rsi[i]));
            }
            if (poly.size() >= 2) p.drawPolyline(poly);
            p.setPen(QColor(0x99, 0x99, 0x99));
            p.drawText(plotLeft + 4, paneTop + 10, "RSI 14");
            p.drawText(plotRight + 4, yR(70) + 4, "70");
            p.drawText(plotRight + 4, yR(30) + 4, "30");
        } else { // PaneMACD
            QVector<double> macd, sig, hist;
            computeMACD(12, 26, 9, macd, sig, hist);
            double lo = std::numeric_limits<double>::max();
            double hi = std::numeric_limits<double>::lowest();
            for (int i = firstIdx; i <= lastIdx; ++i)
                for (double v : {macd[i], sig[i], hist[i]})
                    if (!std::isnan(v)) { lo = std::min(lo, v); hi = std::max(hi, v); }
            if (hi > lo) {
                const double rng = hi - lo;
                auto yM = [&](double v) {
                    return paneBottom - static_cast<int>((v - lo) / rng * paneH);
                };
                const int yZero = yM(0.0);
                for (int i = firstIdx; i <= lastIdx; ++i) {
                    if (std::isnan(hist[i])) continue;
                    const QColor col = (hist[i] >= 0.0) ? up : down;
                    const int y = yM(hist[i]);
                    const int top = std::min(y, yZero);
                    int h = std::abs(y - yZero);
                    if (h < 1) h = 1;
                    p.fillRect(QRect(xFor(i) - bodyW / 2, top, bodyW, h),
                               QColor(col.red(), col.green(), col.blue(), 150));
                }
                p.setPen(QColor(0x2c, 0x2c, 0x2c));
                p.drawLine(plotLeft, yZero, plotRight, yZero);
                auto drawLn = [&](const QVector<double>& v, const QColor& col) {
                    p.setPen(QPen(col, 1.2));
                    QPolygonF poly;
                    for (int i = firstIdx; i <= lastIdx; ++i) {
                        if (std::isnan(v[i])) {
                            if (poly.size() >= 2) p.drawPolyline(poly);
                            poly.clear();
                            continue;
                        }
                        poly << QPointF(xFor(i), yM(v[i]));
                    }
                    if (poly.size() >= 2) p.drawPolyline(poly);
                };
                drawLn(macd, QColor(0x42, 0x85, 0xf4));
                drawLn(sig, QColor(0xff, 0x8a, 0x65));
                p.setPen(QColor(0x99, 0x99, 0x99));
                p.drawText(plotLeft + 4, paneTop + 10, "MACD 12,26,9");
            }
        }
    }

    // --- OHLC legend (hovered candle, else latest) --------------------------
    {
        const int hi = hoveredIndex();
        const int li = (hi >= 0) ? hi : n - 1;
        const Candle& c = m_candles[li];
        const bool bull = c.close >= c.open;
        const double changePct = (c.open != 0.0) ? (c.close - c.open) / c.open * 100.0 : 0.0;
        const QString text =
            QString("O %1  H %2  L %3  C %4  V %5   %6%7%")
                .arg(QString::number(c.open, 'f', 2),
                     QString::number(c.high, 'f', 2),
                     QString::number(c.low, 'f', 2),
                     QString::number(c.close, 'f', 2),
                     QString::number(c.volume),
                     (changePct >= 0 ? "+" : ""),
                     QString::number(changePct, 'f', 2));
        QFont legendFont = p.font();
        legendFont.setPointSize(9);
        p.setFont(legendFont);
        p.setPen(bull ? up : down);
        p.drawText(plotLeft + 4, plotTop + 12, text);
        p.setFont(axisFont);
    }

    // --- Overlay legend (indicator names, colored) --------------------------
    if (!overlayLegend.isEmpty()) {
        int lx = plotLeft + 4;
        const QFontMetrics fm(p.font());
        for (const auto& e : overlayLegend) {
            p.setPen(e.second);
            p.drawText(lx, plotTop + 26, e.first);
            lx += fm.horizontalAdvance(e.first) + 12;
        }
    }

    // --- User drawings (clipped to the price pane) --------------------------
    {
        p.save();
        p.setClipRect(QRect(plotLeft, plotTop, plotW, plotH));
        const QColor drawCol(0xff, 0xca, 0x28);
        auto paintDrawing = [&](const Drawing& d, bool preview) {
            p.setPen(QPen(drawCol, preview ? 1.0 : 1.4,
                          preview ? Qt::DashLine : Qt::SolidLine));
            if (d.kind == Drawing::Horizontal) {
                const int y = static_cast<int>(yForPrice(d.p1));
                p.drawLine(plotLeft, y, plotRight, y);
            } else {
                p.drawLine(QPointF(xForTime(d.t1), yForPrice(d.p1)),
                           QPointF(xForTime(d.t2), yForPrice(d.p2)));
            }
        };
        for (const Drawing& d : m_drawings)
            paintDrawing(d, false);
        if (m_drawing)
            paintDrawing(m_pending, true);
        p.restore();

        // Right-axis price tag for horizontal lines (outside the clip).
        p.setFont(axisFont);
        for (const Drawing& d : m_drawings) {
            if (d.kind != Drawing::Horizontal) continue;
            const int y = static_cast<int>(yForPrice(d.p1));
            if (y < plotTop || y > plotBottom) continue;
            QRect tag(plotRight + 1, y - 8, kMarginRight - 2, 16);
            p.fillRect(tag, drawCol);
            p.setPen(Qt::black);
            p.drawText(tag, Qt::AlignCenter, QString::number(d.p1, 'f', 2));
        }
    }

    // --- Measure overlay ----------------------------------------------------
    if (m_measuring) {
        const double x1 = xForTime(m_measT1), x2 = xForTime(m_measT2);
        const double y1 = yForPrice(m_measP1), y2 = yForPrice(m_measP2);
        const QRectF box = QRectF(QPointF(x1, y1), QPointF(x2, y2)).normalized();
        const bool up_ = m_measP2 >= m_measP1;
        const QColor mc = up_ ? QColor(0x26, 0xa6, 0x9a) : QColor(0xef, 0x53, 0x50);
        p.save();
        p.setClipRect(QRect(plotLeft, plotTop, plotW, plotH));
        p.fillRect(box, QColor(mc.red(), mc.green(), mc.blue(), 40));
        p.setPen(QPen(mc, 1, Qt::DashLine));
        p.drawLine(QPointF(x1, y1), QPointF(x2, y2));
        p.restore();

        const double dPrice = m_measP2 - m_measP1;
        const double dPct = (m_measP1 != 0.0) ? dPrice / m_measP1 * 100.0 : 0.0;
        const int bars = static_cast<int>(std::llround(idxFForTime(m_measT2) - idxFForTime(m_measT1)));
        const qint64 dMs = std::llabs(m_measT2 - m_measT1);
        const qint64 dMin = dMs / 60000;
        const QString dTime = (dMin >= 1440) ? QString("%1d").arg(dMin / 1440)
                            : (dMin >= 60)   ? QString("%1h%2m").arg(dMin / 60).arg(dMin % 60)
                                             : QString("%1m").arg(dMin);
        const QString label = QString("%1%2  (%3%4%)  %5 bars  %6")
            .arg(dPrice >= 0 ? "+" : "")
            .arg(QString::number(dPrice, 'f', 2))
            .arg(dPct >= 0 ? "+" : "")
            .arg(QString::number(dPct, 'f', 2))
            .arg(std::abs(bars))
            .arg(dTime);
        p.setFont(axisFont);
        QFontMetrics fm(p.font());
        const int tw = fm.horizontalAdvance(label) + 10;
        int lx = std::clamp(static_cast<int>((x1 + x2) / 2 - tw / 2.0), plotLeft, plotRight - tw);
        int ly = static_cast<int>(std::min(y1, y2)) - 20;
        if (ly < plotTop) ly = static_cast<int>(std::max(y1, y2)) + 6;
        QRect tag(lx, ly, tw, 16);
        p.fillRect(tag, QColor(0x33, 0x33, 0x33));
        p.setPen(Qt::white);
        p.drawText(tag, Qt::AlignCenter, label);
    }

    // --- Crosshair ----------------------------------------------------------
    if (m_hasCursor && m_cursor.x() >= plotLeft && m_cursor.x() <= plotRight &&
        m_cursor.y() >= plotTop && m_cursor.y() <= fullBottom) {
        p.setPen(QPen(QColor(0x88, 0x88, 0x88), 1, Qt::DashLine));
        p.drawLine(m_cursor.x(), plotTop, m_cursor.x(), fullBottom);
        if (m_cursor.y() <= plotBottom)
            p.drawLine(plotLeft, m_cursor.y(), plotRight, m_cursor.y());

        // Price tag on the right axis (only while over the price pane).
        if (m_cursor.y() <= plotBottom) {
            const double price = priceForY(m_cursor.y());
            QRect ptag(plotRight + 1, m_cursor.y() - 8, kMarginRight - 2, 16);
            p.fillRect(ptag, QColor(0x55, 0x55, 0x55));
            p.setPen(Qt::white);
            p.drawText(ptag, Qt::AlignCenter, QString::number(price, 'f', 2));
        }

        // Time tag on the bottom axis, centered under the cursor.
        const int hi = hoveredIndex();
        if (hi >= 0) {
            const QDateTime dt = QDateTime::fromMSecsSinceEpoch(m_candles[hi].timeMs);
            const QString ts = dt.toString(m_intervalMs >= 86'400'000 ? "yyyy-MM-dd" : "MM-dd HH:mm");
            QFontMetrics fm(p.font());
            const int tw = fm.horizontalAdvance(ts) + 8;
            const int tx = std::clamp(m_cursor.x() - tw / 2, plotLeft, plotRight - tw);
            QRect ttag(tx, fullBottom + 2, tw, 16);
            p.fillRect(ttag, QColor(0x55, 0x55, 0x55));
            p.setPen(Qt::white);
            p.drawText(ttag, Qt::AlignCenter, ts);
        }
    }

    // --- Bottom time axis (first / middle / last visible) -------------------
    p.setPen(QColor(0x99, 0x99, 0x99));
    const int midIdx = (firstIdx + lastIdx) / 2;
    auto drawTimeAt = [&](int idx, int alignX) {
        if (idx < 0 || idx >= n) return;
        const QDateTime dt = QDateTime::fromMSecsSinceEpoch(m_candles[idx].timeMs);
        const QString label = dt.toString(m_intervalMs >= 86'400'000 ? "MM-dd" : "HH:mm");
        p.drawText(alignX, fullBottom + 16, label);
    };
    drawTimeAt(firstIdx, plotLeft);
    drawTimeAt(midIdx, plotLeft + plotW / 2 - 16);
    drawTimeAt(lastIdx, plotRight - 32);
}
