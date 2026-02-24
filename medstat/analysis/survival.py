"""Kaplan-Meier survival analysis and log-rank test."""
from __future__ import annotations

import numpy as np
from scipy import stats
from typing import Optional


def run_kaplan_meier(
    time: list[float],
    event: list[int],
    groups: Optional[list] = None,
) -> dict:
    """Kaplan-Meier survival analysis with optional group comparison."""
    t = np.array(time, dtype=float)
    e = np.array(event, dtype=int)

    if groups is not None:
        g = np.array(groups)
        unique_groups = sorted(set(g.tolist()))
    else:
        g = None
        unique_groups = [None]

    curves = []
    for grp in unique_groups:
        if grp is not None:
            mask = g == grp
            ti, ei = t[mask], e[mask]
        else:
            ti, ei = t, e

        km = _km_estimate(ti, ei)
        curves.append({
            "label": str(grp) if grp is not None else "Overall",
            "n": int(len(ti)),
            **km,
        })

    logrank = None
    if len(unique_groups) == 2 and unique_groups[0] is not None:
        logrank = _logrank_test(t, e, g, unique_groups)

    return {"type": "survival", "curves": curves, "logrank": logrank}


def _km_estimate(time: np.ndarray, event: np.ndarray) -> dict:
    order = np.argsort(time)
    t = time[order]
    e = event[order]

    unique_event_times = np.unique(t[e == 1])

    step_times = [0.0]
    step_surv = [1.0]
    step_lo = [1.0]
    step_hi = [1.0]
    n_at_risk_list: list[int] = []
    n_events_list: list[int] = []

    s = 1.0
    greenwood_sum = 0.0

    for et in unique_event_times:
        n_risk = int(np.sum(t >= et))
        d = int(np.sum((t == et) & (e == 1)))

        if n_risk == 0:
            continue

        s *= (n_risk - d) / n_risk

        if n_risk > d:
            greenwood_sum += d / (n_risk * (n_risk - d))

        # 95% CI via Kalbfleisch-Prentice (log-log) transformation
        if 0 < s < 1 and greenwood_sum > 0:
            c = np.exp(1.96 * np.sqrt(greenwood_sum) / abs(np.log(s)))
            lo = float(s ** c)
            hi = float(s ** (1.0 / c))
        else:
            lo = hi = float(s)

        step_times.append(float(et))
        step_surv.append(float(np.clip(s, 0.0, 1.0)))
        step_lo.append(float(np.clip(lo, 0.0, 1.0)))
        step_hi.append(float(np.clip(hi, 0.0, 1.0)))
        n_at_risk_list.append(n_risk)
        n_events_list.append(d)

    # Median survival: first time survival ≤ 0.5
    median = None
    for i, sv in enumerate(step_surv):
        if sv <= 0.5:
            median = step_times[i]
            break

    return {
        "times": step_times,
        "survival": step_surv,
        "lower_ci": step_lo,
        "upper_ci": step_hi,
        "n_at_risk": n_at_risk_list,
        "n_events": n_events_list,
        "median_survival": median,
        "n_total_events": int(np.sum(event == 1)),
    }


def _logrank_test(
    time: np.ndarray,
    event: np.ndarray,
    group: np.ndarray,
    groups: list,
) -> dict:
    mask1 = group == groups[0]
    mask2 = group == groups[1]
    event_times = np.unique(time[event == 1])

    O1, E1, V = 0.0, 0.0, 0.0

    for et in event_times:
        n1 = int(np.sum(time[mask1] >= et))
        n2 = int(np.sum(time[mask2] >= et))
        d1 = int(np.sum((time[mask1] == et) & (event[mask1] == 1)))
        d2 = int(np.sum((time[mask2] == et) & (event[mask2] == 1)))
        n = n1 + n2
        d = d1 + d2

        if n == 0:
            continue

        O1 += d1
        E1 += n1 * d / n

        if n > 1:
            V += n1 * n2 * d * (n - d) / (n ** 2 * (n - 1))

    if V < 1e-10:
        return {"chi2": 0.0, "p_value": 1.0, "group1": str(groups[0]), "group2": str(groups[1])}

    chi2 = (O1 - E1) ** 2 / V
    p = float(1 - stats.chi2.cdf(chi2, df=1))

    return {
        "chi2": float(chi2),
        "p_value": p,
        "group1": str(groups[0]),
        "group2": str(groups[1]),
        "significant": p < 0.05,
        "interpretation": _interpret_p(p),
    }


def _interpret_p(p: float) -> str:
    if p < 0.001:
        return "p < 0.001 (highly significant)"
    elif p < 0.05:
        return f"p = {p:.4f} (significant)"
    else:
        return f"p = {p:.4f} (not significant)"
