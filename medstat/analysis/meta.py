"""Meta-analysis: fixed/random effects, forest plot, funnel plot."""
from __future__ import annotations

import numpy as np
from scipy import stats
from typing import Literal


EffectMeasure = Literal["OR", "RR", "MD", "SMD"]


def run_meta_analysis(
    studies: list[dict],
    measure: EffectMeasure = "OR",
    model: Literal["fixed", "random"] = "random",
) -> dict:
    """
    Run a meta-analysis.

    Each study dict should contain one of:
    - {"name", "yi", "sei"}  — pre-computed log-scale effect + SE
    - {"name", "effect", "lower_ci", "upper_ci"}  — effect with 95% CI
    - {"name", "events_1", "n_1", "events_2", "n_2"}  — 2x2 table (OR/RR)
    """
    data = _prepare_data(studies, measure)
    if len(data) < 2:
        raise ValueError("At least 2 studies are required for meta-analysis.")

    yi = np.array([d["yi"] for d in data])
    sei = np.array([d["sei"] for d in data])
    wi_fe = 1.0 / sei ** 2

    # ── Fixed-effects pooled estimate ──────────────────────────────────────
    fe_est = float(np.sum(wi_fe * yi) / np.sum(wi_fe))
    fe_se = float(np.sqrt(1.0 / np.sum(wi_fe)))
    fe_z = fe_est / fe_se
    fe_p = float(2 * (1 - stats.norm.cdf(abs(fe_z))))
    fe_ci = (fe_est - 1.96 * fe_se, fe_est + 1.96 * fe_se)

    # ── Heterogeneity (Cochran's Q, I², tau²) ──────────────────────────────
    Q = float(np.sum(wi_fe * (yi - fe_est) ** 2))
    df_q = len(yi) - 1
    Q_p = float(1 - stats.chi2.cdf(Q, df=df_q))
    I2 = float(max(0.0, (Q - df_q) / Q * 100)) if Q > df_q else 0.0
    C = float(np.sum(wi_fe) - np.sum(wi_fe ** 2) / np.sum(wi_fe))
    tau2 = float(max(0.0, (Q - df_q) / C)) if C > 0 else 0.0

    # ── DerSimonian-Laird random-effects ────────────────────────────────────
    wi_re = 1.0 / (sei ** 2 + tau2)
    re_est = float(np.sum(wi_re * yi) / np.sum(wi_re))
    re_se = float(np.sqrt(1.0 / np.sum(wi_re)))
    re_z = re_est / re_se
    re_p = float(2 * (1 - stats.norm.cdf(abs(re_z))))
    re_ci = (re_est - 1.96 * re_se, re_est + 1.96 * re_se)

    # ── Select model weights ────────────────────────────────────────────────
    weights = wi_re if model == "random" else wi_fe
    weights_pct = (weights / weights.sum() * 100).tolist()
    pooled = {"estimate": re_est, "se": re_se, "z": re_z, "p": re_p, "ci": re_ci} \
        if model == "random" \
        else {"estimate": fe_est, "se": fe_se, "z": fe_z, "p": fe_p, "ci": fe_ci}

    on_log = measure in ("OR", "RR")

    def _display(v):
        return float(np.exp(v)) if on_log else float(v)

    def _ci_display(lo, hi):
        return [_display(lo), _display(hi)]

    # ── Forest-plot study data ──────────────────────────────────────────────
    forest_studies = []
    for i, d in enumerate(data):
        ci_lo = d["yi"] - 1.96 * d["sei"]
        ci_hi = d["yi"] + 1.96 * d["sei"]
        forest_studies.append({
            "name": d["name"],
            "yi": float(d["yi"]),
            "sei": float(d["sei"]),
            "ci_lo": float(ci_lo),
            "ci_hi": float(ci_hi),
            "weight": float(weights_pct[i]),
            "effect_display": _display(d["yi"]),
            "ci_lo_display": _display(ci_lo),
            "ci_hi_display": _display(ci_hi),
        })

    return {
        "type": "meta",
        "measure": measure,
        "model": model,
        "n_studies": len(data),
        "heterogeneity": {
            "Q": Q,
            "df": df_q,
            "Q_p": Q_p,
            "I2": I2,
            "tau2": tau2,
            "interpretation": _interpret_i2(I2),
        },
        "fixed_effects": {
            "estimate": fe_est,
            "se": fe_se,
            "z": fe_z,
            "p": fe_p,
            "ci": [float(fe_ci[0]), float(fe_ci[1])],
            "display": _display(fe_est),
            "ci_display": _ci_display(*fe_ci),
        },
        "random_effects": {
            "estimate": re_est,
            "se": re_se,
            "z": re_z,
            "p": re_p,
            "ci": [float(re_ci[0]), float(re_ci[1])],
            "display": _display(re_est),
            "ci_display": _ci_display(*re_ci),
        },
        "pooled": {
            "estimate": float(pooled["estimate"]),
            "se": float(pooled["se"]),
            "z": float(pooled["z"]),
            "p": float(pooled["p"]),
            "ci": [float(pooled["ci"][0]), float(pooled["ci"][1])],
            "display": _display(pooled["estimate"]),
            "ci_display": _ci_display(*pooled["ci"]),
            "significant": float(pooled["p"]) < 0.05,
        },
        "forest_studies": forest_studies,
        "funnel_data": {
            "yi": [float(d["yi"]) for d in data],
            "sei": [float(d["sei"]) for d in data],
            "names": [d["name"] for d in data],
            "pooled_est": float(pooled["estimate"]),
        },
        "label": "log(OR)" if measure == "OR" else ("log(RR)" if measure == "RR" else measure),
        "null_value": 0.0,
        "null_display": 1.0 if on_log else 0.0,
    }


def _prepare_data(studies: list[dict], measure: str) -> list[dict]:
    result = []
    for s in studies:
        name = str(s.get("name", f"Study {len(result)+1}"))

        if "yi" in s and "sei" in s:
            result.append({"name": name, "yi": float(s["yi"]), "sei": float(s["sei"])})

        elif "effect" in s and "lower_ci" in s and "upper_ci" in s:
            eff = float(s["effect"])
            lo = float(s["lower_ci"])
            hi = float(s["upper_ci"])
            if measure in ("OR", "RR"):
                yi = float(np.log(eff))
                sei = float((np.log(hi) - np.log(lo)) / (2 * 1.96))
            else:
                yi = eff
                sei = float((hi - lo) / (2 * 1.96))
            result.append({"name": name, "yi": yi, "sei": sei})

        elif "events_1" in s and "n_1" in s and "events_2" in s and "n_2" in s:
            e1, n1 = int(s["events_1"]), int(s["n_1"])
            e2, n2 = int(s["events_2"]), int(s["n_2"])
            # Continuity correction
            a = e1 + 0.5 if (e1 == 0 or e1 == n1 or e2 == 0 or e2 == n2) else e1
            b_val = n1 - e1 + (0.5 if a != e1 else 0)
            c = e2 + 0.5 if (e1 == 0 or e1 == n1 or e2 == 0 or e2 == n2) else e2
            d = n2 - e2 + (0.5 if c != e2 else 0)
            if measure == "OR":
                yi = float(np.log(a * d / (b_val * c)))
                sei = float(np.sqrt(1/a + 1/b_val + 1/c + 1/d))
            elif measure == "RR":
                p1 = a / (a + b_val)
                p2 = c / (c + d)
                yi = float(np.log(p1 / p2))
                sei = float(np.sqrt((b_val / (a * (a + b_val))) + (d / (c * (c + d)))))
            else:
                raise ValueError(f"Unsupported measure '{measure}' for 2x2 table input")
            result.append({"name": name, "yi": yi, "sei": sei})

    return result


def _interpret_i2(i2: float) -> str:
    if i2 < 25:
        return "Low heterogeneity"
    elif i2 < 50:
        return "Moderate heterogeneity"
    elif i2 < 75:
        return "Substantial heterogeneity"
    else:
        return "Considerable heterogeneity"
