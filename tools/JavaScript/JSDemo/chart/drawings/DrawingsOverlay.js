/**
 * chart/drawings/DrawingsOverlay.js
 *
 * Canvas renderer + interaction engine for chart drawings. Lightweight Charts
 * v4.1 has no primitives API, so we paint a transparent <canvas> over the chart
 * container and own all rendering, hit-testing, and dragging ourselves.
 *
 * Coordinate model
 * ----------------
 * Anchors persist as { time (UTC sec), price } only. Each repaint we resolve
 * them to pixels. For on-domain times `timeScale().timeToCoordinate` is exact;
 * for times in the left/right whitespace (rays, vertical lines, off-screen
 * endpoints) it returns null, so we fall back to a per-frame linear reference
 * (Lref, Tref) on the LOGICAL index axis and extrapolate:
 *     logical(t) = Lref + (t - Tref) / intervalSec
 *     x          = logicalToCoordinate(logical)        // extrapolates past data
 * The reference is sampled near the visible range each frame, so positioning is
 * exact on-domain and graceful off-domain. (Calendar gaps compress in logical;
 * the small extrapolation error across weekends is accepted, as in TradingView.)
 *
 * Event model
 * -----------
 * The canvas is pointer-events:none; all pointer logic attaches to the chart
 * container in CAPTURE phase (mirrors chart/features/DragOrder.js). Events we
 * consume call stopPropagation so the chart never pans/zooms underneath; events
 * we don't consume (empty-space clicks when idle) fall through to the chart.
 */
(function (global) {
    'use strict';

    const G = global.ChartDrawingGeometry;
    const T = global.ChartDrawingTypes;

    const HANDLE_PX = 4;        // half-size of a square selection handle
    const HANDLE_HIT_PX = 7;    // grab tolerance for a handle
    const BODY_HIT_PX = 6;      // grab tolerance for a drawing body
    const SELECT_COLOR = '#ffffff';

    let _seq = 0;
    function nextId(type) { _seq++; return `${type}-${Date.now()}-${_seq}`; }

    class DrawingsOverlay {
        constructor({ chart, series, container, host, bus }) {
            this._chart = chart;
            this._series = series;
            this._container = container;
            this._host = host;
            this._bus = bus;

            this._canvas = null;
            this._ctx = null;
            this._dpr = 1;

            this._drawings = [];     // active-market drawings (live refs)
            this._selectedId = null;

            this._tool = null;       // armed tool type or null
            this._placing = null;    // { type, anchors:[{time,price}], preview }
            this._drag = null;       // { mode:'move'|'reshape', id, last, handleIdx }
            this._activePointerId = null;

            this._panSaved = null;   // saved {handleScroll,handleScale} while gating
            this._rafHandle = 0;
            this._dragRaf = 0;
            this._dirty = false;
            this._resizeObs = null;
            this._menu = null;

            // Host callbacks (set by Drawings.js feature).
            this.onAdd = null;       // (drawing) => void   — insert into model
            this.onRemove = null;    // (id) => void        — delete from model
            this.onChange = null;    // () => void          — persist
            this.onToolChange = null;// (toolOrNull) => void

            this._onPointerDown = this._onPointerDown.bind(this);
            this._onPointerMove = this._onPointerMove.bind(this);
            this._onPointerUp = this._onPointerUp.bind(this);
            this._onKeyDown = this._onKeyDown.bind(this);
            this._onContextMenu = this._onContextMenu.bind(this);
            this._onScaleChange = this._onScaleChange.bind(this);
            this._draw = this._draw.bind(this);
        }

        // ---------- lifecycle ---------------------------------------------
        mount() {
            const canvas = document.createElement('canvas');
            canvas.className = 'drawings-overlay';
            this._container.appendChild(canvas);
            this._canvas = canvas;
            this._ctx = canvas.getContext('2d');

            this._resize();
            if (typeof global.ResizeObserver === 'function') {
                this._resizeObs = new global.ResizeObserver(() => { this._resize(); this.scheduleRedraw(); });
                this._resizeObs.observe(this._container);
            }

            // Repaint on pan/zoom.
            const ts = this._chart.timeScale();
            ts.subscribeVisibleLogicalRangeChange(this._onScaleChange);
            ts.subscribeVisibleTimeRangeChange(this._onScaleChange);

            // Capture-phase pointer + key handlers on the container.
            this._container.addEventListener('pointerdown', this._onPointerDown, true);
            this._container.addEventListener('pointermove', this._onPointerMove, true);
            this._container.addEventListener('pointerup', this._onPointerUp, true);
            this._container.addEventListener('pointercancel', this._onPointerUp, true);
            this._container.addEventListener('contextmenu', this._onContextMenu, true);
            global.addEventListener('keydown', this._onKeyDown, true);

            this.scheduleRedraw();
        }

        destroy() {
            this.disarm();
            this._closeMenu();
            if (this._rafHandle) (global.cancelAnimationFrame || clearTimeout)(this._rafHandle);
            if (this._dragRaf) (global.cancelAnimationFrame || clearTimeout)(this._dragRaf);
            this._rafHandle = 0;
            this._dragRaf = 0;

            const ts = this._chart?.timeScale?.();
            if (ts) {
                try { ts.unsubscribeVisibleLogicalRangeChange(this._onScaleChange); } catch (_) {}
                try { ts.unsubscribeVisibleTimeRangeChange(this._onScaleChange); } catch (_) {}
            }
            if (this._container) {
                this._container.removeEventListener('pointerdown', this._onPointerDown, true);
                this._container.removeEventListener('pointermove', this._onPointerMove, true);
                this._container.removeEventListener('pointerup', this._onPointerUp, true);
                this._container.removeEventListener('pointercancel', this._onPointerUp, true);
                this._container.removeEventListener('contextmenu', this._onContextMenu, true);
            }
            global.removeEventListener('keydown', this._onKeyDown, true);

            if (this._resizeObs) { try { this._resizeObs.disconnect(); } catch (_) {} this._resizeObs = null; }
            if (this._canvas?.parentNode) this._canvas.parentNode.removeChild(this._canvas);
            this._canvas = null;
            this._ctx = null;
            this._restorePan();
        }

        // Swap the active-market drawing set (live references from the feature).
        setActive(list) {
            this._drawings = Array.isArray(list) ? list : [];
            this._selectedId = null;
            this.scheduleRedraw();
        }

        // ---------- tool arming -------------------------------------------
        armTool(type) {
            if (!T.get(type)) return;
            this._tool = type;
            this._placing = { type, anchors: [], preview: null };
            this._selectedId = null;
            this._disablePan();
            this._container.classList.add('drawing-armed');
            if (this.onToolChange) this.onToolChange(type);
            this.scheduleRedraw();
        }

        disarm() {
            const had = !!this._tool;
            this._tool = null;
            this._placing = null;
            this._container?.classList.remove('drawing-armed');
            if (!this._drag) this._restorePan();
            if (had && this.onToolChange) this.onToolChange(null);
            this.scheduleRedraw();
        }

        // True while a tool is armed OR a drawing is selected — used by the
        // feature's handleClick() to suppress chart quick-trade.
        isBusy() {
            return !!this._tool || !!this._selectedId || !!this._drag;
        }

        deleteSelected() {
            if (!this._selectedId) return;
            const id = this._selectedId;
            this._selectedId = null;
            if (this.onRemove) this.onRemove(id);
            if (this.onChange) this.onChange();
            this.scheduleRedraw();
        }

        // ---------- redraw loop -------------------------------------------
        scheduleRedraw() {
            if (this._rafHandle) { this._dirty = true; return; }
            this._dirty = true;
            const raf = global.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            this._rafHandle = raf(() => {
                this._rafHandle = 0;
                if (this._dirty) { this._dirty = false; this._draw(); }
            });
        }

        _onScaleChange() { this.scheduleRedraw(); }

        _resize() {
            if (!this._canvas || !this._container) return;
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            const dpr = global.devicePixelRatio || 1;
            this._dpr = dpr;
            this._canvas.style.width = `${w}px`;
            this._canvas.style.height = `${h}px`;
            this._canvas.width = Math.round(w * dpr);
            this._canvas.height = Math.round(h * dpr);
            if (this._ctx) this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }

        // ---------- coordinate plumbing -----------------------------------
        _intervalSec() {
            const ms = this._host?.intervalMs ?? 60000;
            return Math.max(1, ms / 1000);
        }

        // Per-frame linear time<->logical reference, sampled near the visible
        // range so on-domain anchors are exact and off-domain extrapolation is
        // locally accurate. Returns null if the scale isn't ready.
        _ref() {
            const ts = this._chart.timeScale();
            const range = ts.getVisibleLogicalRange && ts.getVisibleLogicalRange();
            if (!range) return null;
            // Sample a logical inside the range; walk inward until it maps to a
            // real bar time (so the reference is anchored to actual data).
            const from = Math.floor(range.from);
            const to = Math.ceil(range.to);
            const tryAt = (lg) => {
                const x = ts.logicalToCoordinate(lg);
                if (x == null) return null;
                const t = ts.coordinateToTime(x);
                return (t == null || !Number.isFinite(t)) ? null : { Lref: lg, Tref: t };
            };
            const mid = Math.round((from + to) / 2);
            let r = tryAt(mid);
            if (r) return r;
            for (let d = 1; d <= (to - from) + 2 && !r; d++) {
                r = tryAt(mid - d) || tryAt(mid + d);
            }
            return r;
        }

        _logicalForTime(ref, t) {
            return ref.Lref + (t - ref.Tref) / this._intervalSec();
        }
        _timeForLogical(ref, lg) {
            return Math.round(ref.Tref + (lg - ref.Lref) * this._intervalSec());
        }

        // Anchor { time, price } -> { x, y } pixels (null if unresolvable).
        _anchorToPixel(anchor, ref) {
            const y = this._series.priceToCoordinate(anchor.price);
            if (y == null || !Number.isFinite(y)) return null;
            let x = null;
            if (Number.isFinite(anchor.time)) {
                const tx = this._chart.timeScale().timeToCoordinate(anchor.time);
                if (tx != null && Number.isFinite(tx)) x = tx;
                else if (ref) x = this._chart.timeScale().logicalToCoordinate(this._logicalForTime(ref, anchor.time));
            }
            if (x == null || !Number.isFinite(x)) return null;
            return { x, y };
        }

        // Pixel (x,y) -> data { time, price }. snapPrice applies tick snap;
        // snapTime rounds to the nearest bar.
        _pixelToData(x, y, { snapPrice = true, snapTime = false } = {}) {
            const ref = this._ref();
            const ts = this._chart.timeScale();
            let price = this._series.coordinateToPrice(y);
            if (price == null || !Number.isFinite(price)) return null;
            if (snapPrice && typeof this._host._snapToTick === 'function') {
                price = this._host._snapToTick(price);
            }
            let time = ts.coordinateToTime(x);
            if (time == null || !Number.isFinite(time)) {
                if (!ref) return null;
                const lg = ts.coordinateToLogical(x);
                if (lg == null) return null;
                time = this._timeForLogical(ref, snapTime ? Math.round(lg) : lg);
            } else if (snapTime && ref) {
                const lg = ts.coordinateToLogical(x);
                if (lg != null) time = this._timeForLogical(ref, Math.round(lg));
            }
            return { time: Number(time), price: Number(price) };
        }

        // ---------- drawing ------------------------------------------------
        _styleFor(d) {
            const def = T.defaultStyle(d.type);
            return Object.assign(def, d.style || {});
        }

        _envFor(d, ref, pixOverride) {
            const pts = pixOverride || d.points.map((a) => this._anchorToPixel(a, ref));
            const env = {
                pts,
                style: this._styleFor(d),
                selected: d.id === this._selectedId,
                width: this._container.clientWidth,
                height: this._container.clientHeight,
                decimals: this._host?.knownDecimals ?? 2
            };
            const def = T.get(d.type);
            if (def?.needsStats && pts[0] && pts[1]) {
                env.stats = G.measureStats(this._chart, d.points[0], d.points[1]);
            }
            return env;
        }

        _draw() {
            if (!this._ctx || !this._canvas) return;
            const c = this._ctx;
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            c.clearRect(0, 0, w, h);

            const ref = this._ref();

            // Committed drawings (selected one last so its handles sit on top).
            const ordered = this._drawings.slice().sort((a, b) =>
                (a.id === this._selectedId ? 1 : 0) - (b.id === this._selectedId ? 1 : 0));
            for (const d of ordered) {
                const def = T.get(d.type);
                if (!def) continue;
                const env = this._envFor(d, ref);
                try { def.render(c, env); } catch (err) { console.error('[Drawings] render failed', err); }
                if (d.id === this._selectedId) this._drawHandles(c, def.handles(env));
            }

            // In-progress placement preview.
            if (this._placing && this._placing.anchors.length) {
                const def = T.get(this._placing.type);
                const anchors = this._placing.anchors.slice();
                if (this._placing.preview && anchors.length < def.anchors) anchors.push(this._placing.preview);
                if (anchors.length >= 1) {
                    const tmp = { id: '__preview', type: this._placing.type, points: anchors, style: null };
                    const env = this._envFor(tmp, ref);
                    try { def.render(c, env); } catch (_) {}
                }
            }
        }

        _drawHandles(c, pts) {
            if (!pts || !pts.length) return;
            c.save();
            c.fillStyle = SELECT_COLOR;
            c.strokeStyle = '#000000';
            c.lineWidth = 1;
            for (const p of pts) {
                if (!p) continue;
                c.beginPath();
                c.rect(p.x - HANDLE_PX, p.y - HANDLE_PX, HANDLE_PX * 2, HANDLE_PX * 2);
                c.fill();
                c.stroke();
            }
            c.restore();
        }

        // ---------- hit-testing -------------------------------------------
        _eventXY(e) {
            const rect = this._container.getBoundingClientRect();
            return { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }

        // Ignore the right price-axis and bottom time-axis bands so axis drag
        // /scale keeps working.
        _inAxisBand(x, y) {
            let axW = 0;
            let axH = 0;
            try { axW = this._series.priceScale().width() || 0; } catch (_) {}
            try { axH = this._chart.timeScale().height() || 0; } catch (_) {}
            const w = this._container.clientWidth;
            const h = this._container.clientHeight;
            return (x > w - axW) || (y > h - axH);
        }

        // Returns { id, kind:'handle'|'body', handleIdx } for the topmost hit,
        // or null. Checks the selected drawing's handles first (reshape wins).
        _hitTest(x, y) {
            const ref = this._ref();
            // Selected handles first.
            if (this._selectedId) {
                const d = this._drawings.find((dd) => dd.id === this._selectedId);
                if (d) {
                    const def = T.get(d.type);
                    const env = this._envFor(d, ref);
                    const handles = def.handles(env);
                    for (let i = 0; i < handles.length; i++) {
                        const hpt = handles[i];
                        if (hpt && Math.abs(x - hpt.x) <= HANDLE_HIT_PX && Math.abs(y - hpt.y) <= HANDLE_HIT_PX) {
                            return { id: d.id, kind: 'handle', handleIdx: i };
                        }
                    }
                }
            }
            // Bodies, topmost (last drawn) first.
            for (let i = this._drawings.length - 1; i >= 0; i--) {
                const d = this._drawings[i];
                const def = T.get(d.type);
                if (!def) continue;
                const env = this._envFor(d, ref);
                let dist;
                try { dist = def.hitTest(x, y, env); } catch (_) { dist = Infinity; }
                if (dist <= BODY_HIT_PX) return { id: d.id, kind: 'body', handleIdx: -1 };
            }
            return null;
        }

        // Fully claim an event: block the chart pan/zoom AND any other
        // capture-phase listener on the same container (e.g. DragOrder, which
        // is registered after this feature). stopPropagation alone wouldn't
        // stop same-element listeners.
        _consume(e) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }

        // ---------- pointer handlers --------------------------------------
        _onPointerDown(e) {
            if (e.button === 2) return; // contextmenu handles right-click
            if (e.button !== 0) return;
            const { x, y } = this._eventXY(e);

            // Placement mode.
            if (this._tool && this._placing) {
                if (this._inAxisBand(x, y)) return;
                const def = T.get(this._tool);
                const data = this._pixelToData(x, y, { snapPrice: true, snapTime: !!def.snapTime });
                if (!data) return;
                this._consume(e);
                this._placing.anchors.push(data);
                if (this._placing.anchors.length >= def.anchors) this._commitPlacement();
                else this.scheduleRedraw();
                return;
            }

            // Edit mode: only claim the event on a real hit (else let the chart pan).
            const hit = this._hitTest(x, y);
            if (!hit) {
                // Deselect on empty click (handled on pointerup to allow drag-pan).
                this._pendingDeselect = !!this._selectedId;
                return;
            }
            // Yield to order-line interaction when the click also lands on a line.
            const ol = this._host?._features?.get?.('order-lines');
            if (ol && typeof ol.hitTest === 'function' && hit.kind === 'body') {
                if (ol.hitTest(y, this._host._hitTestPx || 6)) return;
            }

            this._consume(e);
            this._selectedId = hit.id;
            this._pendingDeselect = false;
            this._activePointerId = e.pointerId;
            try { this._container.setPointerCapture(e.pointerId); } catch (_) {}
            this._disablePan();

            const grab = this._pixelToData(x, y, { snapPrice: false, snapTime: false });
            if (hit.kind === 'handle') {
                this._drag = { mode: 'reshape', id: hit.id, handleIdx: hit.handleIdx, last: grab };
            } else {
                this._drag = { mode: 'move', id: hit.id, handleIdx: -1, last: grab };
            }
            this._startDragLoop();
            this.scheduleRedraw();
        }

        _onPointerMove(e) {
            const { x, y } = this._eventXY(e);

            // Live placement preview.
            if (this._tool && this._placing && this._placing.anchors.length) {
                const def = T.get(this._tool);
                this._placing.preview = this._pixelToData(x, y, { snapPrice: true, snapTime: !!def.snapTime });
                this.scheduleRedraw();
                return;
            }

            // Active drag (move/reshape). Move drags freely (no price snap) so
            // it tracks the cursor smoothly; reshape snaps endpoints to tick
            // (and to a bar for time-snapped tools like vline).
            if (this._drag) {
                if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
                const dragType = this._findDrag()?.type;
                const reshape = this._drag.mode === 'reshape';
                const snapTime = reshape && !!(T.get(dragType)?.snapTime);
                const curr = this._pixelToData(x, y, { snapPrice: reshape, snapTime });
                if (!curr) return;
                if (reshape) this._applyReshape(curr);
                else this._applyMove(curr);
                this._drag.last = curr;
                return;
            }

            // Idle hover: cursor feedback.
            if (!this._tool) {
                const overDrawing = !this._inAxisBand(x, y) && !!this._hitTest(x, y);
                this._container.classList.toggle('drawing-hover', overDrawing);
            }
        }

        _onPointerUp(e) {
            if (this._drag) {
                if (this._activePointerId != null && e.pointerId !== this._activePointerId) return;
                try { this._container.releasePointerCapture(e.pointerId); } catch (_) {}
                this._drag = null;
                this._activePointerId = null;
                this._stopDragLoop();
                if (!this._tool) this._restorePan();
                if (this.onChange) this.onChange();
                this.scheduleRedraw();
                return;
            }
            // Empty-click deselect (only when it wasn't a pan-drag: pointerup at
            // ~same spot). We didn't capture, so just clear selection.
            if (this._pendingDeselect) {
                this._pendingDeselect = false;
                if (this._selectedId) { this._selectedId = null; this.scheduleRedraw(); }
            }
        }

        _onKeyDown(e) {
            if (e.key === 'Escape') {
                if (this._placing && this._placing.anchors.length) {
                    this._placing.anchors = [];
                    this._placing.preview = null;
                    this.disarm();
                    e.stopPropagation();
                } else if (this._tool) {
                    this.disarm();
                    e.stopPropagation();
                } else if (this._selectedId) {
                    this._selectedId = null;
                    this.scheduleRedraw();
                    e.stopPropagation();
                }
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && this._selectedId) {
                // Don't hijack Backspace while typing in an input.
                const tag = (e.target && e.target.tagName) || '';
                if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;
                e.preventDefault();
                e.stopPropagation();
                this.deleteSelected();
            }
        }

        _onContextMenu(e) {
            const { x, y } = this._eventXY(e);
            if (this._tool) { // armed: right-click cancels the tool
                this._consume(e);
                this.disarm();
                return;
            }
            const hit = this._hitTest(x, y);
            if (!hit) return; // let ContextMenu's trading menu open
            this._consume(e);
            this._selectedId = hit.id;
            this.scheduleRedraw();
            this._openMenu(e.clientX, e.clientY, hit.id);
        }

        // ---------- drag application --------------------------------------
        _findDrag() { return this._drawings.find((d) => d.id === this._drag?.id) || null; }

        _applyMove(curr) {
            const d = this._findDrag();
            if (!d || !this._drag.last) return;
            const dT = curr.time - this._drag.last.time;
            const dP = curr.price - this._drag.last.price;
            for (const a of d.points) { a.time += dT; a.price += dP; }
            this.scheduleRedraw();
        }

        _applyReshape(curr) {
            const d = this._findDrag();
            if (!d) return;
            const idx = this._drag.handleIdx;
            if (d.type === 'box') {
                // 4 corner handles map to the 2 stored opposite-corner anchors.
                const p0 = d.points[0];
                const p1 = d.points[1];
                if (idx === 0) { p0.time = curr.time; p0.price = curr.price; }
                else if (idx === 1) { p1.time = curr.time; p0.price = curr.price; }
                else if (idx === 2) { p1.time = curr.time; p1.price = curr.price; }
                else if (idx === 3) { p0.time = curr.time; p1.price = curr.price; }
            } else if (d.points[idx]) {
                d.points[idx].time = curr.time;
                d.points[idx].price = curr.price;
            }
            this.scheduleRedraw();
        }

        _startDragLoop() {
            if (this._dragRaf) return;
            const raf = global.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
            const tick = () => {
                this._dragRaf = 0;
                if (!this._drag) return;
                this._draw();
                this._dragRaf = raf(tick);
            };
            this._dragRaf = raf(tick);
        }
        _stopDragLoop() {
            if (!this._dragRaf) return;
            (global.cancelAnimationFrame || clearTimeout)(this._dragRaf);
            this._dragRaf = 0;
        }

        // ---------- placement commit --------------------------------------
        _commitPlacement() {
            const type = this._placing.type;
            const anchors = this._placing.anchors.map((a) => ({ time: a.time, price: a.price }));
            const drawing = { id: nextId(type), type, points: anchors, style: T.defaultStyle(type) };
            if (this.onAdd) this.onAdd(drawing);
            this._selectedId = drawing.id;
            this.disarm();              // one-shot tool, matches prior behavior
            if (this.onChange) this.onChange();
            this.scheduleRedraw();
        }

        // ---------- pan gating --------------------------------------------
        _disablePan() {
            if (this._panSaved || !this._chart) return;
            this._panSaved = { handleScroll: true, handleScale: true };
            try { this._chart.applyOptions({ handleScroll: false, handleScale: false }); } catch (_) {}
        }
        _restorePan() {
            if (!this._panSaved || !this._chart) { this._panSaved = null; return; }
            try {
                this._chart.applyOptions({
                    handleScroll: this._panSaved.handleScroll,
                    handleScale: this._panSaved.handleScale
                });
            } catch (_) {}
            this._panSaved = null;
        }

        // ---------- right-click menu --------------------------------------
        _openMenu(clientX, clientY, id) {
            this._closeMenu();
            const menu = document.createElement('div');
            menu.className = 'chart-context-menu';
            const mkItem = (label, cls, fn) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `ccm-item ${cls || ''}`.trim();
                b.textContent = label;
                b.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); fn(); });
                menu.appendChild(b);
            };
            const header = document.createElement('div');
            header.className = 'ccm-header';
            const d = this._drawings.find((dd) => dd.id === id);
            header.textContent = d ? d.type.charAt(0).toUpperCase() + d.type.slice(1) : 'Drawing';
            menu.appendChild(header);

            mkItem('Delete', 'ccm-sell', () => { this._closeMenu(); this._selectedId = id; this.deleteSelected(); });
            mkItem('Bring to front', '', () => {
                this._closeMenu();
                const i = this._drawings.findIndex((dd) => dd.id === id);
                if (i >= 0) { const [m] = this._drawings.splice(i, 1); this._drawings.push(m); if (this.onChange) this.onChange(); this.scheduleRedraw(); }
            });

            document.body.appendChild(menu);
            this._menu = menu;
            const vw = global.innerWidth;
            const vh = global.innerHeight;
            const w = menu.offsetWidth;
            const h = menu.offsetHeight;
            menu.style.left = `${clientX + w > vw ? Math.max(0, clientX - w) : clientX}px`;
            menu.style.top = `${clientY + h > vh ? Math.max(0, clientY - h) : clientY}px`;

            setTimeout(() => {
                this._onDocDown = (ev) => { if (this._menu && !this._menu.contains(ev.target)) this._closeMenu(); };
                document.addEventListener('pointerdown', this._onDocDown, true);
            }, 0);
        }

        _closeMenu() {
            if (this._menu) { this._menu.remove(); this._menu = null; }
            if (this._onDocDown) { document.removeEventListener('pointerdown', this._onDocDown, true); this._onDocDown = null; }
        }
    }

    global.ChartDrawingsOverlay = DrawingsOverlay;
})(window);
