/**
 * chart/drawings/DrawingTypes.js
 *
 * Per-type registry for chart drawings. Each entry declares:
 *   - anchors:      number of data points the user places.
 *   - snapTime:     snap the placed time to the nearest bar (false = free).
 *   - defaultStyle: { color, width, lineStyle } applied when a drawing has none.
 *   - render(c, env):   draw the shape on the 2D context (pixel space).
 *   - hitTest(x, y, env): distance in px from (x,y) to the shape (Infinity = miss).
 *   - handles(env):     array of { x, y } draggable anchor positions (pixel space).
 *
 * `env` is built by DrawingsOverlay each repaint:
 *   { pts: [{x,y}|null,...], style, selected, width, height, decimals }
 * where `pts` are the anchors already resolved to pixels (null if a coordinate
 * can't be resolved this frame). Full-extent tools (hline/vline) and open-ended
 * tools (ray/extended) use width/height and the geometry helpers for clipping.
 *
 * Adding a new tool later = one entry here + a toolbar button. Nothing else.
 */
(function (global) {
    'use strict';

    const G = global.ChartDrawingGeometry;

    const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const FIB_COLORS = {
        0: '#888888',
        0.236: '#42a5f5',
        0.382: '#26a69a',
        0.5: '#fbc02d',
        0.618: '#ab47bc',
        0.786: '#ef5350',
        1: '#888888'
    };

    const BLUE = '#42a5f5';
    const UP = '#26a69a';
    const DOWN = '#ef5350';

    // ---- canvas helpers ----------------------------------------------------

    function applyDash(c, lineStyle) {
        if (lineStyle === 'dashed') c.setLineDash([6, 4]);
        else if (lineStyle === 'dotted') c.setLineDash([2, 4]);
        else c.setLineDash([]);
    }

    function strokeWidth(style, selected) {
        const w = style?.width || 2;
        return selected ? w + 1 : w;
    }

    function drawLine(c, x1, y1, x2, y2, color, width, lineStyle) {
        c.save();
        applyDash(c, lineStyle);
        c.strokeStyle = color;
        c.lineWidth = width;
        c.beginPath();
        c.moveTo(x1, y1);
        c.lineTo(x2, y2);
        c.stroke();
        c.restore();
    }

    function fillPoly(c, pts, color) {
        if (!pts.length) return;
        c.save();
        c.fillStyle = color;
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.closePath();
        c.fill();
        c.restore();
    }

    function labelBox(c, x, y, text, bg, fg) {
        c.save();
        c.font = '11px -apple-system, system-ui, sans-serif';
        const padX = 6;
        const padY = 4;
        const lines = Array.isArray(text) ? text : [text];
        let wMax = 0;
        for (const ln of lines) wMax = Math.max(wMax, c.measureText(ln).width);
        const lineH = 14;
        const boxW = wMax + padX * 2;
        const boxH = lineH * lines.length + padY * 2 - 2;
        c.fillStyle = bg;
        const r = 3;
        // rounded rect
        c.beginPath();
        c.moveTo(x + r, y);
        c.arcTo(x + boxW, y, x + boxW, y + boxH, r);
        c.arcTo(x + boxW, y + boxH, x, y + boxH, r);
        c.arcTo(x, y + boxH, x, y, r);
        c.arcTo(x, y, x + boxW, y, r);
        c.closePath();
        c.fill();
        c.fillStyle = fg;
        c.textBaseline = 'top';
        for (let i = 0; i < lines.length; i++) {
            c.fillText(lines[i], x + padX, y + padY + i * lineH);
        }
        c.restore();
        return { w: boxW, h: boxH };
    }

    // ---- shared hit helpers ------------------------------------------------

    function bothPts(env) {
        const a = env.pts[0];
        const b = env.pts[1];
        return (a && b) ? [a, b] : null;
    }

    // ---- type registry -----------------------------------------------------

    const TYPES = {
        trendline: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 2, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                drawLine(c, ab[0].x, ab[0].y, ab[1].x, ab[1].y,
                    env.style.color, strokeWidth(env.style, env.selected), env.style.lineStyle);
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                return G.distanceToSegment(x, y, ab[0].x, ab[0].y, ab[1].x, ab[1].y);
            },
            handles(env) { return env.pts.filter(Boolean); }
        },

        ray: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 2, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const clip = G.clipRayToRect(ab[0].x, ab[0].y, ab[1].x, ab[1].y, env.width, env.height);
                if (!clip) return;
                drawLine(c, clip[0].x, clip[0].y, clip[1].x, clip[1].y,
                    env.style.color, strokeWidth(env.style, env.selected), env.style.lineStyle);
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                return G.distanceToRay(x, y, ab[0].x, ab[0].y, ab[1].x, ab[1].y);
            },
            handles(env) { return env.pts.filter(Boolean); }
        },

        extended: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 2, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const clip = G.clipInfiniteLineToRect(ab[0].x, ab[0].y, ab[1].x, ab[1].y, env.width, env.height);
                if (!clip) return;
                drawLine(c, clip[0].x, clip[0].y, clip[1].x, clip[1].y,
                    env.style.color, strokeWidth(env.style, env.selected), env.style.lineStyle);
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                return G.distanceToInfiniteLine(x, y, ab[0].x, ab[0].y, ab[1].x, ab[1].y);
            },
            handles(env) { return env.pts.filter(Boolean); }
        },

        hline: {
            anchors: 1,
            snapTime: false,
            defaultStyle: { color: '#f0b90b', width: 1, lineStyle: 'solid' },
            render(c, env) {
                const p = env.pts[0];
                if (!p) return;
                drawLine(c, 0, p.y, env.width, p.y,
                    env.style.color, strokeWidth(env.style, env.selected), env.style.lineStyle);
            },
            hitTest(x, y, env) {
                const p = env.pts[0];
                if (!p) return Infinity;
                return Math.abs(y - p.y);
            },
            // Handle sits at the anchor x when resolvable, else mid-canvas.
            handles(env) {
                const p = env.pts[0];
                if (!p) return [];
                const hx = Number.isFinite(p.x) ? p.x : env.width / 2;
                return [{ x: hx, y: p.y }];
            }
        },

        vline: {
            anchors: 1,
            snapTime: true,
            defaultStyle: { color: '#888888', width: 1, lineStyle: 'dashed' },
            render(c, env) {
                const p = env.pts[0];
                if (!p) return;
                drawLine(c, p.x, 0, p.x, env.height,
                    env.style.color, strokeWidth(env.style, env.selected), env.style.lineStyle);
            },
            hitTest(x, y, env) {
                const p = env.pts[0];
                if (!p) return Infinity;
                return Math.abs(x - p.x);
            },
            handles(env) {
                const p = env.pts[0];
                if (!p) return [];
                const hy = Number.isFinite(p.y) ? p.y : env.height / 2;
                return [{ x: p.x, y: hy }];
            }
        },

        arrow: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 2, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const w = strokeWidth(env.style, env.selected);
                drawLine(c, ab[0].x, ab[0].y, ab[1].x, ab[1].y, env.style.color, w, env.style.lineStyle);
                const head = G.arrowHead(ab[0].x, ab[0].y, ab[1].x, ab[1].y, 12 + w * 2);
                fillPoly(c, head, env.style.color);
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                return G.distanceToSegment(x, y, ab[0].x, ab[0].y, ab[1].x, ab[1].y);
            },
            handles(env) { return env.pts.filter(Boolean); }
        },

        box: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 1, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const x = Math.min(ab[0].x, ab[1].x);
                const y = Math.min(ab[0].y, ab[1].y);
                const w = Math.abs(ab[1].x - ab[0].x);
                const h = Math.abs(ab[1].y - ab[0].y);
                c.save();
                c.fillStyle = 'rgba(66, 165, 245, 0.12)';
                c.fillRect(x, y, w, h);
                applyDash(c, env.style.lineStyle);
                c.strokeStyle = env.style.color;
                c.lineWidth = strokeWidth(env.style, env.selected);
                c.strokeRect(x, y, w, h);
                c.restore();
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                const x0 = Math.min(ab[0].x, ab[1].x);
                const y0 = Math.min(ab[0].y, ab[1].y);
                const x1 = Math.max(ab[0].x, ab[1].x);
                const y1 = Math.max(ab[0].y, ab[1].y);
                // Inside = grab to move; else distance to the nearest edge.
                if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return 0;
                const dTop = G.distanceToSegment(x, y, x0, y0, x1, y0);
                const dBot = G.distanceToSegment(x, y, x0, y1, x1, y1);
                const dL = G.distanceToSegment(x, y, x0, y0, x0, y1);
                const dR = G.distanceToSegment(x, y, x1, y0, x1, y1);
                return Math.min(dTop, dBot, dL, dR);
            },
            // 4 corner handles for reshaping. Anchors are 2 opposite corners;
            // the other two are derived so all four are draggable.
            handles(env) {
                const ab = bothPts(env);
                if (!ab) return [];
                return [
                    { x: ab[0].x, y: ab[0].y },
                    { x: ab[1].x, y: ab[0].y },
                    { x: ab[1].x, y: ab[1].y },
                    { x: ab[0].x, y: ab[1].y }
                ];
            }
        },

        fib: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: BLUE, width: 1, lineStyle: 'solid' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const hiY = Math.min(ab[0].y, ab[1].y);
                const loY = Math.max(ab[0].y, ab[1].y);
                const span = loY - hiY;
                const xL = Math.min(ab[0].x, ab[1].x);
                const xR = Math.max(ab[0].x, ab[1].x);
                c.save();
                c.font = '10px -apple-system, system-ui, sans-serif';
                c.textBaseline = 'middle';
                for (const lv of FIB_LEVELS) {
                    const yy = hiY + span * lv;
                    const col = FIB_COLORS[lv] || '#888';
                    drawLine(c, xL, yy, xR, yy, col, env.selected ? 2 : 1, 'dotted');
                    c.fillStyle = col;
                    c.fillText(`${(lv * 100).toFixed(1)}%`, xR + 4, yy);
                }
                c.restore();
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                const hiY = Math.min(ab[0].y, ab[1].y);
                const loY = Math.max(ab[0].y, ab[1].y);
                const span = loY - hiY;
                const xL = Math.min(ab[0].x, ab[1].x);
                const xR = Math.max(ab[0].x, ab[1].x);
                let best = Infinity;
                for (const lv of FIB_LEVELS) {
                    const yy = hiY + span * lv;
                    best = Math.min(best, G.distanceToSegment(x, y, xL, yy, xR, yy));
                }
                return best;
            },
            handles(env) { return env.pts.filter(Boolean); }
        },

        measure: {
            anchors: 2,
            snapTime: false,
            defaultStyle: { color: '#9598a1', width: 1, lineStyle: 'dashed' },
            render(c, env) {
                const ab = bothPts(env);
                if (!ab) return;
                const up = ab[1].y <= ab[0].y; // price went up = lower y
                const tint = up ? UP : DOWN;
                // Shaded rectangle from anchor A to B, like TradingView measure.
                const x = Math.min(ab[0].x, ab[1].x);
                const y = Math.min(ab[0].y, ab[1].y);
                const w = Math.abs(ab[1].x - ab[0].x);
                const h = Math.abs(ab[1].y - ab[0].y);
                c.save();
                c.fillStyle = up ? 'rgba(38, 166, 154, 0.12)' : 'rgba(239, 83, 80, 0.12)';
                c.fillRect(x, y, w, h);
                drawLine(c, ab[0].x, ab[0].y, ab[1].x, ab[1].y, tint, env.selected ? 2 : 1, 'dashed');
                c.restore();

                const st = env.stats || {};
                const d = env.decimals ?? 2;
                const sign = (st.dPrice ?? 0) >= 0 ? '+' : '';
                const lines = [
                    `${sign}${Number(st.dPrice ?? 0).toFixed(d)} (${sign}${Number(st.pct ?? 0).toFixed(2)}%)`,
                    `${Number.isFinite(st.bars) ? st.bars : '—'} bars`
                ];
                const lx = (ab[0].x + ab[1].x) / 2 - 40;
                const ly = ab[1].y + (up ? -36 : 8);
                labelBox(c, lx, ly, lines, tint, '#ffffff');
            },
            hitTest(x, y, env) {
                const ab = bothPts(env);
                if (!ab) return Infinity;
                return G.distanceToSegment(x, y, ab[0].x, ab[0].y, ab[1].x, ab[1].y);
            },
            handles(env) { return env.pts.filter(Boolean); },
            needsStats: true
        }
    };

    global.ChartDrawingTypes = {
        TYPES,
        FIB_LEVELS,
        FIB_COLORS,
        list: () => Object.keys(TYPES),
        get: (t) => TYPES[t] || null,
        anchorsFor: (t) => (TYPES[t] ? TYPES[t].anchors : 0),
        defaultStyle: (t) => {
            const d = TYPES[t]?.defaultStyle;
            return d ? { ...d } : { color: BLUE, width: 2, lineStyle: 'solid' };
        }
    };
})(window);
