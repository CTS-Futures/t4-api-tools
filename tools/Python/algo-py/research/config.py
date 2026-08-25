"""
research/config.py

Single place to adjust everything the study depends on: the war window, the
~1-year calibration span, the instruments, indicator/regime parameters, and the
ES cost model. No logic here — just the knobs.

The dates encode the June 2025 "12-Day War": Israel struck Iran ~Jun 13 2025,
the US struck nuclear sites ~Jun 21-22, ceasefire ~Jun 24. We CALIBRATE on the
~year before the event and only EVALUATE on the event window (never fit on it).
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import List, Tuple


# --- Dates -------------------------------------------------------------------
# Event (the war) — evaluated, never fit.
EVENT_START = "2025-06-13"
EVENT_END = "2025-06-25"

# Calibration: the ~1 year BEFORE the event. Indicator lookbacks & regime
# thresholds are derived from this span only.
CALIB_START = "2024-06-01"
CALIB_END = "2025-06-12"

# Full fetch span (calibration + event + a little tail for context).
FETCH_START = "2024-06-01"
FETCH_END = "2025-06-30"


# --- Instruments -------------------------------------------------------------
# T4 identifies a market by (exchange_id, contract_id) and an optional market_id
# (a specific contract month). Exchange-id spellings vary (the repo's tests use
# "CME_E"/"YM"), so each symbol lists CANDIDATE exchange ids — probe_data.py
# tries them in order and reports which one actually returns data.
@dataclass(frozen=True)
class Symbol:
    key: str                      # short label used in DataFrame columns: es/cl/gc
    name: str
    contract_id: str
    exchange_candidates: List[str]
    # continuationType gives a continuous (volume-rolled) series so we don't have
    # to hand-roll futures roll across the multi-month window. "Volume" is the
    # ONLY value the T4 barchart endpoint accepts (the docs + the conversion
    # repo's working integration test confirm it; "Continuous" returns HTTP 400).
    continuation_type: str = "Volume"
    # Yahoo Finance ticker for the free `--source yahoo` path. If unset, falls
    # back to the contract_id (ETFs trade under their plain symbol) or, for
    # futures (point_value >= 5), the contract_id + "=F" continuous front-month.
    yahoo: str = ""

    @property
    def yahoo_ticker(self) -> str:
        if self.yahoo:
            return self.yahoo
        # Futures vs share: POINT_VALUES is defined below; default to >=5 = future.
        if POINT_VALUES.get(self.key, 1.0) >= 5.0:
            return f"{self.contract_id}=F"
        return self.contract_id


# Equity-index futures lead with "CME_Eq" — the spelling JSDemo's working config
# uses for ES — then fall back to "CME_E"/"CME" (fetch_symbol tries each in turn).
ES = Symbol("es", "E-mini S&P 500", "ES", ["CME_Eq", "CME_E", "CME"])
CL = Symbol("cl", "Crude Oil (WTI)", "CL", ["NYMEX", "CME_NYMEX", "CME"])
GC = Symbol("gc", "Gold", "GC", ["COMEX", "CME_COMEX", "CME"])

SYMBOLS = [ES, CL, GC]


# --- Portfolio basket (the slow-rebuild rotation study) ----------------------
# The rotation study trades a BASKET of equity-index "stock trackers". Two
# parallel definitions of the same exposures:
#
#   * ETFs  — for the CSV/Yahoo research path (the default, no token needed).
#             Drop spy.csv / qqq.csv / dia.csv / iwm.csv into research/data_csv/.
#             ETFs trade as shares, so point_value = 1.
#   * Futures — for the live T4 path (volume-continuation bars). Same index
#             exposures, but exchange point values differ (see POINT_VALUES).
#
# The `key` is what names the CSV file and the DataFrame column prefix, so keep
# ETF keys (spy/qqq/...) and futures keys (es/nq/...) distinct.
SPY = Symbol("spy", "SPDR S&P 500 ETF", "SPY", ["ARCA", "NYSE"])
QQQ = Symbol("qqq", "Invesco QQQ (Nasdaq-100)", "QQQ", ["NASDAQ"])
DIA = Symbol("dia", "SPDR Dow Jones ETF", "DIA", ["ARCA", "NYSE"])
IWM = Symbol("iwm", "iShares Russell 2000 ETF", "IWM", ["ARCA", "NYSE"])
EQUITY_INDEX_ETFS = [SPY, QQQ, DIA, IWM]

NQ = Symbol("nq", "E-mini Nasdaq-100", "NQ", ["CME_Eq", "CME_E", "CME"])
YM = Symbol("ym", "E-mini Dow", "YM", ["CBOT", "CME_CBOT", "CME"])
RTY = Symbol("rty", "E-mini Russell 2000", "RTY", ["CME_Eq", "CME_E", "CME"])
EQUITY_INDEX_FUTURES = [ES, NQ, YM, RTY]

# The basket the rotation study trades. Default to ETFs (CSV is the default,
# token-free source). Swap to EQUITY_INDEX_FUTURES for the live T4 path.
BASKET = EQUITY_INDEX_ETFS

# Dollar value of a 1.0 price move for one unit (share/contract). ETFs = $1.
POINT_VALUES = {
    "spy": 1.0, "qqq": 1.0, "dia": 1.0, "iwm": 1.0,   # ETF shares
    "es": 50.0, "nq": 20.0, "ym": 5.0, "rty": 50.0,   # equity-index futures
    "cl": 1000.0, "gc": 100.0,                          # diversifiers (war study)
}


# --- Pairs-trading universe (market-neutral cross-sector study) ---------------
# A deliberately MIXED universe — single names across unrelated sectors plus a
# few sector ETFs — so the pair-finder can discover cross-sector spreads that
# co-move under macro shifts (the user's "fast food + tech + commerce" idea).
# All trade as shares, so point_value = 1. yahoo ticker defaults to contract_id.
_PAIRS_SPEC = [
    # key,  name,                       ticker
    ("mcd",  "McDonald's",              "MCD"),
    ("sbux", "Starbucks",               "SBUX"),
    ("cmg",  "Chipotle",                "CMG"),
    ("yum",  "Yum! Brands",             "YUM"),
    ("aapl", "Apple",                   "AAPL"),
    ("msft", "Microsoft",               "MSFT"),
    ("nvda", "NVIDIA",                  "NVDA"),
    ("googl","Alphabet",                "GOOGL"),
    ("amzn", "Amazon",                  "AMZN"),
    ("wmt",  "Walmart",                 "WMT"),
    ("cost", "Costco",                  "COST"),
    ("hd",   "Home Depot",              "HD"),
    ("jpm",  "JPMorgan",                "JPM"),
    ("v",    "Visa",                    "V"),
    ("ma",   "Mastercard",              "MA"),
    ("xom",  "Exxon Mobil",             "XOM"),
    ("jnj",  "Johnson & Johnson",       "JNJ"),
    ("unh",  "UnitedHealth",            "UNH"),
    ("xlk",  "Tech Select Sector ETF",  "XLK"),
    ("xly",  "Cons. Discr. Sector ETF", "XLY"),
    ("xlp",  "Cons. Staples Sector ETF","XLP"),
    ("xlf",  "Financials Sector ETF",   "XLF"),
    ("xle",  "Energy Sector ETF",       "XLE"),
    ("xrt",  "Retail ETF",              "XRT"),
]
PAIRS_UNIVERSE = [Symbol(k, n, t, ["ARCA", "NASDAQ", "NYSE"], yahoo=t) for k, n, t in _PAIRS_SPEC]
POINT_VALUES.update({s.key: 1.0 for s in PAIRS_UNIVERSE})  # all trade as shares

# Large universe (~80 liquid large caps + sector ETFs) for the scaled pairs study:
# more names ⇒ the cointegration filter yields MANY tethered pairs, and holding a
# diversified basket of independent spreads smooths the week-to-week P&L (any one
# pair's edge is tiny; the consistency only shows up at scale). Tickers only —
# key = lowercase ticker, all trade as shares.
_LARGE_TICKERS = [
    # Tech / semis / software
    "AAPL", "MSFT", "NVDA", "GOOGL", "META", "ADBE", "CRM", "ORCL", "CSCO",
    "INTC", "AMD", "QCOM", "TXN", "AVGO", "IBM", "ACN", "AMAT", "MU",
    # Communications / media
    "NFLX", "DIS", "CMCSA", "T", "VZ",
    # Consumer discretionary / retail
    "AMZN", "HD", "LOW", "NKE", "SBUX", "MCD", "CMG", "YUM", "TGT", "COST",
    "WMT", "TJX",
    # Staples
    "PG", "KO", "PEP", "CL", "MDLZ", "KMB",
    # Financials
    "JPM", "BAC", "WFC", "C", "GS", "MS", "V", "MA", "AXP", "BLK", "SPGI",
    # Health care
    "JNJ", "UNH", "PFE", "MRK", "ABBV", "TMO", "ABT", "LLY", "BMY", "AMGN",
    # Industrials
    "BA", "CAT", "GE", "HON", "UPS", "RTX", "DE", "MMM",
    # Energy
    "XOM", "CVX", "COP", "SLB",
    # Sector / industry ETFs
    "XLK", "XLY", "XLP", "XLF", "XLE", "XLV", "XLI", "XRT", "SMH",
]
LARGE_UNIVERSE = [
    Symbol(t.lower(), t, t, ["ARCA", "NASDAQ", "NYSE"], yahoo=t) for t in _LARGE_TICKERS
]
POINT_VALUES.update({s.key: 1.0 for s in LARGE_UNIVERSE})

# SPY is the market-neutrality reference (weekly-return correlation ≈ 0 target).
SPY_REF = SPY


# --- Bar resolution ----------------------------------------------------------
# Daily is the right granularity for a ~1yr mean-reversion lookback. The probe
# also tries intraday; if intraday is retained for the window we can rerun the
# event-zoom at finer resolution.
BAR_INTERVAL = "Day"   # "Day" | "Minute"
BAR_PERIOD = 1


# --- Indicator parameters ----------------------------------------------------
@dataclass(frozen=True)
class IndicatorParams:
    roc_period: int = 10
    rsi_period: int = 14
    macd_fast: int = 12
    macd_slow: int = 26
    macd_signal: int = 9
    ma_period: int = 50
    ma_slope_period: int = 10
    # "about a year" of trading days; adjustable per the user's request.
    zscore_lookback: int = 252
    vol_window: int = 20


# --- Regime / combo parameters (rules-based; calibrated on CALIB span) -------
@dataclass(frozen=True)
class ModelParams:
    # Oil/gold "risk-off" trigger: both instruments' momentum z-scores above this
    # (computed over the calibration span) => geopolitical-stress regime.
    regime_z_trigger: float = 1.0
    regime_lookback: int = 60          # window for oil/gold momentum/vol
    # Weights in the calm regime.
    w_momentum_calm: float = 0.6
    w_meanrev_calm: float = 0.4
    # Weights in the risk-off regime (lean on mean-reversion: war spikes tend to
    # over-extend then revert).
    w_momentum_risk: float = 0.3
    w_meanrev_risk: float = 0.7
    # Defensive dampener: scale ES exposure down by up to this fraction at full
    # risk-off intensity.
    risk_off_dampen: float = 0.5
    zscore_lookback: int = 252         # mean-reversion lookback (kept in sync)


# --- ES cost model (mirrors the JS Backtester knobs) -------------------------
@dataclass(frozen=True)
class CostModel:
    point_value: float = 50.0   # ES = $50 per index point
    commission: float = 2.5     # $ per contract per side
    slippage_pts: float = 0.25  # index points per fill
    max_contracts: int = 3      # |target| of 1.0 maps to this many contracts
    starting_cash: float = 100_000.0


# --- Portfolio cost model ----------------------------------------------------
# Base cost model for the basket (ETF/share defaults). Per-symbol point values
# come from POINT_VALUES via cost_for(); futures get heavier costs/sizing.
PORTFOLIO_BASE_COST = CostModel(
    point_value=1.0, commission=0.0, slippage_pts=0.01,
    max_contracts=20, starting_cash=100_000.0,
)


def cost_for(key: str, base: CostModel = PORTFOLIO_BASE_COST) -> CostModel:
    """Per-symbol CostModel: set point_value from POINT_VALUES and pick
    futures-vs-ETF commission/slippage/sizing. ETFs trade as cheap shares;
    futures carry real per-contract commission, slippage in points, and smaller
    max sizing (a |target|=1.0 maps to fewer contracts)."""
    pv = POINT_VALUES.get(key, 1.0)
    if pv >= 5.0:  # a futures contract
        return replace(base, point_value=pv, commission=2.5,
                       slippage_pts=0.25, max_contracts=2)
    return replace(base, point_value=pv)  # ETF / share


# --- Signal parameters (per-asset composite score) ---------------------------
@dataclass(frozen=True)
class SignalParams:
    # Skip-recent momentum: return over `mom_lookback` bars EXCLUDING the most
    # recent `mom_skip` bars (the classic 12-1 anti-bubble construction).
    mom_lookback: int = 126        # ~6 months of trading days
    mom_skip: int = 21             # skip the last ~month (don't chase the spike)
    # Value / mean-reversion: price vs its own ~1yr mean (negative z = cheap).
    value_lookback: int = 252
    # Composite blend weights (momentum vs value), renormalised internally.
    w_momentum: float = 0.7
    w_value: float = 0.3
    # Overextension guard: down-weight names whose |z-score| exceeds this.
    overext_z: float = 2.0
    # Long-term trend gate: require close > SMA(trend_lookback) to allow a long.
    trend_lookback: int = 200


# --- Portfolio construction parameters ---------------------------------------
@dataclass(frozen=True)
class PortfolioParams:
    top_n: int = 2                 # how many names to hold each rebalance
    weighting: str = "equal"       # "equal" | "score"
    allow_short: bool = False      # long/flat by default
    gross_target: float = 1.0      # sum of |target| spread across held names
    # Throttling: cap position changes per rebalance and ignore tiny tweaks.
    max_trades_per_week: int = 2
    no_trade_band: float = 0.1     # skip target changes smaller than this


# --- Walk-forward ("rebuild") parameters -------------------------------------
@dataclass(frozen=True)
class WalkForwardParams:
    warmup: int = 252              # min history before the first live decision
    trailing_window: int = 252     # bars each re-tune scores params over
    rebalance_days: int = 5        # hold positions ~1 week between changes
    retune_days: int = 10          # re-tune cadence (~biweekly "rebuild")
    objective: str = "sharpe"      # trailing-window score to maximise
    turnover_penalty: float = 0.10  # robustness: penalise high-turnover param sets
    hysteresis: float = 0.10       # adopt new params only if they beat the
                                   # incumbent by this (relative) → slow rebuild
    # Coarse grid searched at each re-tune (small ⇒ fast & robust, not overfit).
    # 18 combos keeps the walk-forward responsive enough to drive from the UI;
    # the hysteresis already favours stability over chasing a finer grid.
    grid_mom_lookback: Tuple[int, ...] = (63, 126, 252)
    grid_mom_skip: Tuple[int, ...] = (0, 21)
    grid_value_lookback: Tuple[int, ...] = (252,)
    grid_top_n: Tuple[int, ...] = (1, 2, 3)


# --- Pairs / statistical-arbitrage parameters --------------------------------
@dataclass(frozen=True)
class PairsParams:
    # Pair SELECTION is done on calibration data only (in-sample); the spread is
    # traded out-of-sample after calib_end.
    calib_end: str = "2021-12-31"
    # Correlation is only a weak SANITY floor: the whole idea is cross-sector pairs
    # that look UNrelated on the surface (low corr) yet co-move (cointegrated), so
    # cointegration is the real gate, not correlation.
    min_corr: float = 0.3          # weak floor — avoid spurious/uncorrelated noise only
    max_pvalue: float = 0.05       # Engle-Granger cointegration p-value ceiling (the real gate)
    top_pairs: int = 6             # how many disjoint pairs to trade
    # Spread signal (rolling, computed out-of-sample with no look-ahead).
    z_lookback: int = 60           # rolling window for the spread z-score
    entry_z: float = 2.0           # |z| beyond this opens the spread
    exit_z: float = 0.5            # |z| inside this flattens the spread (reverted)
    # Divergence stop: if |z| blows past this the spread is de-cohering (a leg
    # re-rated / had a fundamental shock), so bail out instead of doubling down,
    # and stay out until it comes back inside the exit band. Caps the fat tail.
    stop_z: float = 3.5
    dollar_per_leg: float = 10_000.0  # target $ exposure per leg (≈ dollar-neutral)


@dataclass(frozen=True)
class StudyConfig:
    indicators: IndicatorParams = field(default_factory=IndicatorParams)
    model: ModelParams = field(default_factory=ModelParams)
    costs: CostModel = field(default_factory=CostModel)
    signals: SignalParams = field(default_factory=SignalParams)
    portfolio: PortfolioParams = field(default_factory=PortfolioParams)
    walk: WalkForwardParams = field(default_factory=WalkForwardParams)
    pairs: PairsParams = field(default_factory=PairsParams)


DEFAULT = StudyConfig()
