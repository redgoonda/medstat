"""Clinical trials statistics: t-tests, ANOVA, chi-square, power/sample size."""
from __future__ import annotations

import itertools
import numpy as np
from scipy import stats
from typing import Literal, Optional


def run_ttest(
    group1: list[float],
    group2: list[float],
    paired: bool = False,
    equal_var: bool = False,
) -> dict:
    a = np.array(group1, dtype=float)
    b = np.array(group2, dtype=float)

    if paired:
        if len(a) != len(b):
            raise ValueError("Paired t-test requires equal group sizes.")
        diffs = a - b
        t_stat, p_value = stats.ttest_rel(a, b)
        df = len(a) - 1
        diff = float(np.mean(diffs))
        ci = stats.t.interval(0.95, df, diff, stats.sem(diffs))
        cohens_d = diff / float(np.std(diffs, ddof=1))
    else:
        t_stat, p_value = stats.ttest_ind(a, b, equal_var=equal_var)
        df_val = getattr(t_stat, "df", len(a) + len(b) - 2)
        # Welch's df
        s1, s2 = np.var(a, ddof=1), np.var(b, ddof=1)
        n1, n2 = len(a), len(b)
        df = float((s1/n1 + s2/n2)**2 / ((s1/n1)**2/(n1-1) + (s2/n2)**2/(n2-1))) \
            if not equal_var else float(n1 + n2 - 2)
        diff = float(np.mean(a) - np.mean(b))
        se_diff = float(np.sqrt(s1/n1 + s2/n2)) if not equal_var else \
            float(np.sqrt(((n1-1)*s1 + (n2-1)*s2)/(n1+n2-2) * (1/n1 + 1/n2)))
        ci = stats.t.interval(0.95, df, diff, se_diff)
        pooled_sd = float(np.sqrt(((n1-1)*s1 + (n2-1)*s2) / (n1+n2-2)))
        cohens_d = (float(np.mean(a)) - float(np.mean(b))) / pooled_sd if pooled_sd > 0 else 0.0

    return {
        "type": "ttest",
        "paired": paired,
        "n1": int(len(a)),
        "n2": int(len(b)),
        "mean1": float(np.mean(a)),
        "mean2": float(np.mean(b)),
        "sd1": float(np.std(a, ddof=1)),
        "sd2": float(np.std(b, ddof=1)),
        "mean_diff": float(diff),
        "ci_95": [float(ci[0]), float(ci[1])],
        "t_stat": float(t_stat),
        "df": float(df),
        "p_value": float(p_value),
        "cohens_d": float(cohens_d),
        "effect_size_label": _interpret_cohens_d(abs(cohens_d)),
        "significant": float(p_value) < 0.05,
    }


def run_anova(
    groups: list[list[float]],
    group_names: Optional[list[str]] = None,
) -> dict:
    arrays = [np.array(g, dtype=float) for g in groups]
    k = len(arrays)
    n_total = sum(len(a) for a in arrays)

    if group_names is None:
        group_names = [f"Group {i+1}" for i in range(k)]

    f_stat, p_value = stats.f_oneway(*arrays)
    grand_mean = float(np.mean(np.concatenate(arrays)))

    ss_between = float(sum(len(a) * (float(np.mean(a)) - grand_mean)**2 for a in arrays))
    ss_within = float(sum(float(np.sum((a - float(np.mean(a)))**2)) for a in arrays))
    df_between = k - 1
    df_within = n_total - k
    ms_between = ss_between / df_between
    ms_within = ss_within / df_within if df_within > 0 else 0.0
    eta2 = float(ss_between / (ss_between + ss_within)) if (ss_between + ss_within) > 0 else 0.0

    group_stats = []
    for name, arr in zip(group_names, arrays):
        se = float(stats.sem(arr))
        ci = stats.t.interval(0.95, len(arr) - 1, float(np.mean(arr)), se) if len(arr) > 1 else (float(np.mean(arr)), float(np.mean(arr)))
        group_stats.append({
            "name": name,
            "n": int(len(arr)),
            "mean": float(np.mean(arr)),
            "sd": float(np.std(arr, ddof=1)),
            "se": se,
            "ci_95": [float(ci[0]), float(ci[1])],
        })

    posthoc = []
    if float(p_value) < 0.05 and k > 2:
        posthoc = _tukey_hsd(arrays, group_names, ms_within, df_within)

    return {
        "type": "anova",
        "k": k,
        "n_total": n_total,
        "group_stats": group_stats,
        "anova_table": {
            "ss_between": ss_between,
            "ss_within": ss_within,
            "df_between": df_between,
            "df_within": df_within,
            "ms_between": float(ms_between),
            "ms_within": float(ms_within),
            "f_stat": float(f_stat),
            "p_value": float(p_value),
        },
        "eta_squared": eta2,
        "significant": float(p_value) < 0.05,
        "posthoc_tukey": posthoc,
    }


def _tukey_hsd(arrays, names, ms_within, df_within) -> list:
    results = []
    for (i, a), (j, b) in itertools.combinations(enumerate(arrays), 2):
        diff = float(np.mean(a) - np.mean(b))
        q_se = float(np.sqrt(ms_within / 2 * (1/len(a) + 1/len(b))))
        q_stat = abs(diff) / q_se if q_se > 0 else 0.0
        try:
            from scipy.stats import studentized_range
            p = float(1 - studentized_range.cdf(q_stat * np.sqrt(2), len(arrays), df_within))
        except Exception:
            k = len(arrays)
            _, p_raw = stats.ttest_ind(a, b)
            p = float(min(1.0, float(p_raw) * k * (k - 1) / 2))

        results.append({
            "group1": names[i],
            "group2": names[j],
            "mean_diff": diff,
            "p_adjusted": float(p),
            "significant": p < 0.05,
        })
    return results


def run_chi_square(
    observed: list[list[int]],
    row_names: Optional[list[str]] = None,
    col_names: Optional[list[str]] = None,
    yates_correction: bool = True,
) -> dict:
    from scipy.stats import chi2_contingency, fisher_exact

    obs = np.array(observed, dtype=float)
    is_2x2 = obs.shape == (2, 2)

    chi2, p_chi2, dof, expected = chi2_contingency(obs, correction=yates_correction and is_2x2)

    fisher_result = None
    if is_2x2:
        or_val, p_fisher = fisher_exact(obs.astype(int))
        fisher_result = {"odds_ratio": float(or_val), "p_value": float(p_fisher)}

    n = float(np.sum(obs))
    cramers_v = float(np.sqrt(chi2 / (n * (min(obs.shape) - 1)))) if min(obs.shape) > 1 and n > 0 else 0.0

    if row_names is None:
        row_names = [f"Row {i+1}" for i in range(obs.shape[0])]
    if col_names is None:
        col_names = [f"Col {j+1}" for j in range(obs.shape[1])]

    return {
        "type": "chi_square",
        "observed": obs.tolist(),
        "expected": [[round(v, 2) for v in row] for row in expected.tolist()],
        "row_names": row_names,
        "col_names": col_names,
        "chi2": float(chi2),
        "df": int(dof),
        "p_value": float(p_chi2),
        "cramers_v": float(cramers_v),
        "fisher_exact": fisher_result,
        "significant": float(p_chi2) < 0.05,
    }


def run_sample_size(
    test: Literal["ttest_2samp", "proportion_2samp"] = "ttest_2samp",
    alpha: float = 0.05,
    power: float = 0.80,
    effect_size: Optional[float] = None,
    mean1: Optional[float] = None,
    mean2: Optional[float] = None,
    sd: Optional[float] = None,
    p1: Optional[float] = None,
    p2: Optional[float] = None,
    ratio: float = 1.0,
) -> dict:
    z_alpha = float(stats.norm.ppf(1 - alpha / 2))
    z_beta = float(stats.norm.ppf(power))

    if test == "ttest_2samp":
        if effect_size is None:
            if mean1 is None or mean2 is None or sd is None or sd == 0:
                raise ValueError("Provide effect_size or (mean1, mean2, sd).")
            effect_size = abs(float(mean2) - float(mean1)) / float(sd)
        n1 = int(np.ceil((z_alpha + z_beta) ** 2 * (1 + 1.0 / ratio) / effect_size ** 2))
        n2 = int(np.ceil(n1 * ratio))

    elif test == "proportion_2samp":
        if p1 is None or p2 is None:
            raise ValueError("Provide p1 and p2.")
        p1, p2 = float(p1), float(p2)
        p_bar = (p1 + ratio * p2) / (1 + ratio)
        num = (z_alpha * np.sqrt((1 + 1.0/ratio) * p_bar * (1 - p_bar))
               + z_beta * np.sqrt(p1*(1-p1) + p2*(1-p2)/ratio)) ** 2
        denom = (p1 - p2) ** 2
        n1 = int(np.ceil(num / denom))
        n2 = int(np.ceil(n1 * ratio))
        effect_size = float(abs(p1 - p2) / np.sqrt(p_bar * (1 - p_bar)))
    else:
        raise ValueError(f"Unknown test: {test}")

    return {
        "type": "sample_size",
        "test": test,
        "alpha": alpha,
        "power": power,
        "effect_size": float(effect_size) if effect_size is not None else None,
        "n1": n1,
        "n2": n2,
        "n_total": n1 + n2,
        "ratio": ratio,
    }


def _interpret_cohens_d(d: float) -> str:
    if d < 0.2:
        return "negligible"
    elif d < 0.5:
        return "small"
    elif d < 0.8:
        return "medium"
    else:
        return "large"
