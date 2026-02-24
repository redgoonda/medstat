"""Epidemiology statistics: 2x2 tables, OR/RR, logistic regression."""
from __future__ import annotations

import numpy as np
from scipy import stats
from typing import Optional


def run_two_by_two(
    a: int,
    b: int,
    c: int,
    d: int,
    exposure_name: str = "Exposure",
    outcome_name: str = "Outcome",
) -> dict:
    """
    Analyse a 2x2 contingency table.

             Outcome+  Outcome-
    Exposed     a         b
    Unexposed   c         d
    """
    af, bf, cf, df_ = float(a), float(b), float(c), float(d)
    n = af + bf + cf + df_

    # ── Risks ──────────────────────────────────────────────────────────────
    p1 = af / (af + bf) if (af + bf) > 0 else 0.0   # risk in exposed
    p0 = cf / (cf + df_) if (cf + df_) > 0 else 0.0  # risk in unexposed
    rd = p1 - p0
    rd_se = float(np.sqrt(p1*(1-p1)/(af+bf) + p0*(1-p0)/(cf+df_))) if (af+bf) > 0 and (cf+df_) > 0 else 0.0
    rd_ci = (rd - 1.96*rd_se, rd + 1.96*rd_se)

    # ── Odds Ratio (Woolf CI) ──────────────────────────────────────────────
    if bf > 0 and cf > 0:
        or_val = float(af * df_ / (bf * cf))
        log_or_se = float(np.sqrt(1/af + 1/bf + 1/cf + 1/df_))
        log_or = float(np.log(or_val))
        or_ci = (float(np.exp(log_or - 1.96*log_or_se)), float(np.exp(log_or + 1.96*log_or_se)))
    else:
        or_val, or_ci = None, (None, None)

    # ── Relative Risk (Katz log CI) ────────────────────────────────────────
    if p0 > 0 and p1 > 0:
        rr_val = float(p1 / p0)
        log_rr = float(np.log(rr_val))
        log_rr_se = float(np.sqrt(bf/(af*(af+bf)) + df_/(cf*(cf+df_))))
        rr_ci = (float(np.exp(log_rr - 1.96*log_rr_se)), float(np.exp(log_rr + 1.96*log_rr_se)))
    else:
        rr_val, rr_ci = None, (None, None)

    # ── Chi-square + Fisher's exact ────────────────────────────────────────
    from scipy.stats import chi2_contingency, fisher_exact
    table = np.array([[af, bf], [cf, df_]])
    chi2, p_chi2, dof, _ = chi2_contingency(table, correction=True)
    _, p_fisher = fisher_exact(table.astype(int))

    # ── NNT / NNH ─────────────────────────────────────────────────────────
    nnt_val = float(1.0 / abs(rd)) if abs(rd) > 1e-10 else None
    nnt_type = "NNT (benefit)" if rd < 0 else ("NNH (harm)" if rd > 0 else "N/A")

    # ── Attributable risk (exposed) ────────────────────────────────────────
    are = float((p1 - p0) / p1) if p1 > 0 else None

    return {
        "type": "two_by_two",
        "table": {"a": int(a), "b": int(b), "c": int(c), "d": int(d), "n": int(n)},
        "exposure_name": exposure_name,
        "outcome_name": outcome_name,
        "risks": {
            "risk_exposed": float(p1),
            "risk_unexposed": float(p0),
            "risk_difference": float(rd),
            "rd_ci_95": [float(rd_ci[0]), float(rd_ci[1])],
        },
        "odds_ratio": {
            "value": or_val,
            "ci_95": [or_ci[0], or_ci[1]],
        },
        "relative_risk": {
            "value": rr_val,
            "ci_95": [rr_ci[0], rr_ci[1]],
        },
        "chi_square": {
            "value": float(chi2),
            "df": int(dof),
            "p_value": float(p_chi2),
        },
        "fisher_exact_p": float(p_fisher),
        "nnt": {"value": nnt_val, "type": nnt_type},
        "attributable_risk_exposed": are,
        "significant": float(p_chi2) < 0.05,
    }


def run_logistic_regression(
    outcome: list[int],
    predictors: dict[str, list],
    predictor_types: Optional[dict[str, str]] = None,
) -> dict:
    """Multivariable logistic regression via statsmodels."""
    import pandas as pd
    import statsmodels.formula.api as smf

    df = pd.DataFrame(predictors)
    df["__outcome__"] = outcome

    parts = []
    for col in predictors:
        ptype = (predictor_types or {}).get(col, "continuous")
        parts.append(f"C({col})" if ptype == "categorical" else col)

    formula = "__outcome__ ~ " + " + ".join(parts)

    try:
        model = smf.logit(formula, data=df).fit(disp=False, maxiter=200)

        coefficients = []
        conf = model.conf_int()
        for name in model.params.index:
            coef = float(model.params[name])
            se = float(model.bse[name])
            z = float(model.tvalues[name])
            p = float(model.pvalues[name])
            ci_lo = float(conf.loc[name, 0])
            ci_hi = float(conf.loc[name, 1])
            is_intercept = name.lower() == "intercept"
            coefficients.append({
                "variable": name,
                "coef": coef,
                "se": se,
                "z": z,
                "p_value": p,
                "ci_95": [ci_lo, ci_hi],
                "odds_ratio": float(np.exp(coef)) if not is_intercept else None,
                "or_ci_95": [float(np.exp(ci_lo)), float(np.exp(ci_hi))] if not is_intercept else None,
                "significant": p < 0.05,
            })

        return {
            "type": "logistic_regression",
            "n": int(len(outcome)),
            "n_events": int(sum(outcome)),
            "log_likelihood": float(model.llf),
            "aic": float(model.aic),
            "bic": float(model.bic),
            "mcfadden_r2": float(model.prsquared),
            "coefficients": coefficients,
        }
    except Exception as e:
        return {"type": "logistic_regression", "error": str(e), "n": len(outcome)}


def run_incidence_rate(
    events: int,
    person_time: float,
    comparison_events: Optional[int] = None,
    comparison_person_time: Optional[float] = None,
    time_unit: str = "person-years",
) -> dict:
    """Incidence rate and rate ratio."""
    ir = float(events) / float(person_time)
    # Exact Poisson 95% CI (midP approximation)
    lo = float(stats.chi2.ppf(0.025, 2 * events) / 2 / person_time) if events > 0 else 0.0
    hi = float(stats.chi2.ppf(0.975, 2 * (events + 1)) / 2 / person_time)

    result: dict = {
        "type": "incidence_rate",
        "events": int(events),
        "person_time": float(person_time),
        "time_unit": time_unit,
        "incidence_rate": ir,
        "ir_per_1000": ir * 1000,
        "ci_95": [lo, hi],
        "ci_95_per_1000": [lo * 1000, hi * 1000],
    }

    if comparison_events is not None and comparison_person_time is not None:
        ir2 = float(comparison_events) / float(comparison_person_time)
        irr = ir / ir2 if ir2 > 0 else None
        if irr is not None:
            log_irr = float(np.log(irr))
            se_log_irr = float(np.sqrt(1.0/events + 1.0/comparison_events))
            irr_ci = (float(np.exp(log_irr - 1.96*se_log_irr)), float(np.exp(log_irr + 1.96*se_log_irr)))
            # Score test p-value
            z = float((events - person_time * ir2) / np.sqrt(person_time * ir2 * (1 + person_time/comparison_person_time)))
            p = float(2 * (1 - stats.norm.cdf(abs(z))))
        else:
            irr_ci = (None, None)
            p = None

        result["comparison"] = {
            "events": int(comparison_events),
            "person_time": float(comparison_person_time),
            "incidence_rate": ir2,
            "ir_per_1000": ir2 * 1000,
            "irr": irr,
            "irr_ci_95": list(irr_ci),
            "p_value": p,
            "significant": p < 0.05 if p is not None else None,
        }

    return result
