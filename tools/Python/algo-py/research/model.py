"""
research/model.py

The rules-based combo model. It turns the aligned ES/CL/GC frame into an ES
target position in [-1, +1] (fraction of max size), combining:

  * a MOMENTUM score (trend-following on ES), and
  * a MEAN-REVERSION score (fade ES extremes vs a ~1yr z-score),

with weights and a defensive dampener CONDITIONED on an oil/gold regime. The
regime is the "non-linear combo": oil and gold both spiking together (the war
signature) flips the blend toward mean-reversion and trims gross ES exposure.

Nothing here is fitted to the event window. Thresholds are intended to be
calibrated on the prior-year span (see `calibrate`) — and even that is just
standardising the regime trigger, not optimising returns.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import config, indicators as ind


@dataclass
class ModelOutput:
    frame: pd.DataFrame   # all intermediate series (mom, mr, regime, weights, target)

    @property
    def target(self) -> pd.Series:
        return self.frame["target"]


def _tanh_clip(x: pd.Series, scale: float) -> pd.Series:
    """Map an unbounded score to [-1, 1] smoothly."""
    return np.tanh(x / scale)


def momentum_score(close: pd.Series, p: config.IndicatorParams) -> pd.Series:
    """Composite ES trend score in [-1, 1]: average of ROC sign-strength, MACD
    histogram sign, and price-vs-MA — each mapped to [-1, 1]."""
    roc = ind.roc(close, p.roc_period)
    _, _, hist = ind.macd(close, p.macd_fast, p.macd_slow, p.macd_signal)
    ma = ind.sma(close, p.ma_period)

    roc_score = _tanh_clip(roc, scale=0.02)              # ~2% ROC ≈ ±0.76
    hist_score = np.sign(hist).fillna(0.0)               # MACD above/below signal
    ma_score = _tanh_clip((close - ma) / ma, scale=0.02)  # distance from MA

    score = (roc_score + hist_score + ma_score) / 3.0
    return score.clip(-1.0, 1.0)


def mean_reversion_score(close: pd.Series, lookback: int) -> pd.Series:
    """Fade extremes: positive (buy) when price is BELOW its ~1yr mean, negative
    (sell) when ABOVE. In [-1, 1]."""
    z = ind.zscore(close, lookback)
    return (-_tanh_clip(z, scale=1.5)).clip(-1.0, 1.0)


def oilgold_riskoff(cl_close: pd.Series, gc_close: pd.Series, m: config.ModelParams) -> pd.Series:
    """Risk-off intensity in [0, 1] from joint oil+gold momentum.

    Both oil and gold rallying hard together is the classic geopolitical-stress
    tell. We z-score each instrument's momentum, take the MIN (so BOTH must be
    elevated, not just one), shift by the calibrated trigger, and squash to
    [0, 1]. 0 = calm, 1 = full risk-off.
    """
    cl_mz = ind.momentum_zscore(cl_close, m.regime_lookback)
    gc_mz = ind.momentum_zscore(gc_close, m.regime_lookback)
    joint = pd.concat([cl_mz, gc_mz], axis=1).min(axis=1)  # both must be high
    intensity = _tanh_clip((joint - m.regime_z_trigger).clip(lower=0.0), scale=1.0)
    return intensity.clip(0.0, 1.0).fillna(0.0)


def combine(wide: pd.DataFrame, cfg: config.StudyConfig = config.DEFAULT) -> ModelOutput:
    """Produce the ES target-position series from the aligned ES/CL/GC frame."""
    p, m = cfg.indicators, cfg.model
    es = wide["es_close"]
    cl = wide["cl_close"]
    gc = wide["gc_close"]

    mom = momentum_score(es, p)
    mr = mean_reversion_score(es, m.zscore_lookback)
    risk = oilgold_riskoff(cl, gc, m)

    # Conditional weights: linearly blend calm→risk-off weights by intensity.
    w_mom = (1 - risk) * m.w_momentum_calm + risk * m.w_momentum_risk
    w_mr = (1 - risk) * m.w_meanrev_calm + risk * m.w_meanrev_risk

    raw = (w_mom * mom + w_mr * mr).clip(-1.0, 1.0)
    # Defensive dampener: trim gross ES exposure as risk-off rises.
    dampen = 1.0 - m.risk_off_dampen * risk
    target = (raw * dampen).clip(-1.0, 1.0)

    frame = pd.DataFrame({
        "es_close": es,
        "cl_close": cl,
        "gc_close": gc,
        "momentum": mom,
        "mean_reversion": mr,
        "risk_off": risk,
        "w_mom": w_mom,
        "w_mr": w_mr,
        "raw": raw,
        "target": target.fillna(0.0),
    })
    return ModelOutput(frame=frame)


def calibrate(wide: pd.DataFrame, cfg: config.StudyConfig = config.DEFAULT) -> dict:
    """Report (not optimise) the regime trigger's behaviour over the calibration
    span: what fraction of days were flagged risk-off, and the joint-momentum
    distribution. Used to sanity-check the threshold before evaluating the event.
    """
    m = cfg.model
    calib = wide.loc[config.CALIB_START:config.CALIB_END]
    risk = oilgold_riskoff(calib["cl_close"], calib["gc_close"], m)
    return {
        "calib_days": int(len(calib)),
        "risk_off_days": int((risk > 0).sum()),
        "risk_off_frac": float((risk > 0).mean()),
        "risk_off_mean_intensity": float(risk.mean()),
    }
