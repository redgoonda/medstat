"""Biomarker analysis: ROC curves, AUC, sensitivity/specificity."""
from __future__ import annotations

import numpy as np
from scipy import stats
from typing import Optional


def run_roc_analysis(
    marker: list[float],
    outcome: list[int],
    marker_name: str = "Marker",
    threshold: Optional[float] = None,
    positive_direction: str = "high",
) -> dict:
    """
    ROC analysis with AUC, optimal threshold (Youden's J), and DeLong CI.

    positive_direction: "high" if higher marker → positive outcome,
                        "low"  if lower marker → positive outcome.
    """
    from sklearn.metrics import roc_curve, auc as sklearn_auc

    m = np.array(marker, dtype=float)
    y = np.array(outcome, dtype=int)

    m_eval = -m if positive_direction == "low" else m

    fpr, tpr, thresholds_sk = roc_curve(y, m_eval)
    roc_auc = float(sklearn_auc(fpr, tpr))

    auc_se = _hanley_mcneil_se(y, m_eval, roc_auc)
    z_val = float((roc_auc - 0.5) / auc_se) if auc_se > 0 else 0.0
    auc_p = float(2 * (1 - stats.norm.cdf(abs(z_val))))
    auc_ci = (float(max(0.0, roc_auc - 1.96*auc_se)), float(min(1.0, roc_auc + 1.96*auc_se)))

    # Youden's index for optimal threshold
    j_scores = tpr - fpr
    opt_idx = int(np.argmax(j_scores))
    opt_thresh_eval = float(thresholds_sk[opt_idx])
    opt_thresh = -opt_thresh_eval if positive_direction == "low" else opt_thresh_eval

    opt_perf = _threshold_performance(y, m, opt_thresh, positive_direction)

    # User-supplied threshold performance
    sel_perf = None
    if threshold is not None:
        sel_perf = _threshold_performance(y, m, threshold, positive_direction)

    # Downsample ROC curve for response (max 300 points)
    n_pts = min(300, len(fpr))
    idx = np.round(np.linspace(0, len(fpr) - 1, n_pts)).astype(int)

    # Sensitivity/specificity table at decile thresholds
    sens_spec_table = _build_sens_spec_table(y, m, m_eval, positive_direction)

    return {
        "type": "roc",
        "marker_name": marker_name,
        "n": int(len(y)),
        "n_positive": int(np.sum(y == 1)),
        "n_negative": int(np.sum(y == 0)),
        "prevalence": float(np.mean(y)),
        "auc": roc_auc,
        "auc_se": float(auc_se),
        "auc_ci_95": list(auc_ci),
        "auc_z": z_val,
        "auc_p": auc_p,
        "auc_interpretation": _interpret_auc(roc_auc),
        "roc_curve": {
            "fpr": fpr[idx].tolist(),
            "tpr": tpr[idx].tolist(),
        },
        "optimal_threshold": {
            "value": opt_thresh,
            "youden_index": float(j_scores[opt_idx]),
            **opt_perf,
        },
        "selected_threshold": sel_perf,
        "sens_spec_table": sens_spec_table,
    }


def _hanley_mcneil_se(y: np.ndarray, scores: np.ndarray, auc: float) -> float:
    """Hanley-McNeil (1982) SE approximation for AUC."""
    n1 = int(np.sum(y == 1))
    n0 = int(np.sum(y == 0))
    if n1 == 0 or n0 == 0:
        return 0.0
    q1 = auc / (2 - auc)
    q2 = 2 * auc ** 2 / (1 + auc)
    var = (auc*(1-auc) + (n1-1)*(q1-auc**2) + (n0-1)*(q2-auc**2)) / (n1 * n0)
    return float(np.sqrt(max(var, 0.0)))


def _threshold_performance(
    y: np.ndarray,
    marker: np.ndarray,
    threshold: float,
    direction: str,
) -> dict:
    pred = (marker >= threshold).astype(int) if direction == "high" \
        else (marker <= threshold).astype(int)

    tp = int(np.sum((pred == 1) & (y == 1)))
    fp = int(np.sum((pred == 1) & (y == 0)))
    tn = int(np.sum((pred == 0) & (y == 0)))
    fn = int(np.sum((pred == 0) & (y == 1)))

    sens = tp / (tp + fn) if (tp + fn) > 0 else 0.0
    spec = tn / (tn + fp) if (tn + fp) > 0 else 0.0
    ppv = tp / (tp + fp) if (tp + fp) > 0 else 0.0
    npv = tn / (tn + fn) if (tn + fn) > 0 else 0.0
    acc = (tp + tn) / len(y) if len(y) > 0 else 0.0
    plr = sens / (1 - spec) if spec < 1 else None
    nlr = (1 - sens) / spec if spec > 0 else None

    return {
        "threshold": float(threshold),
        "tp": tp, "fp": fp, "tn": tn, "fn": fn,
        "sensitivity": float(sens),
        "specificity": float(spec),
        "ppv": float(ppv),
        "npv": float(npv),
        "accuracy": float(acc),
        "positive_lr": float(plr) if plr is not None else None,
        "negative_lr": float(nlr) if nlr is not None else None,
    }


def _build_sens_spec_table(
    y: np.ndarray,
    marker: np.ndarray,
    marker_eval: np.ndarray,
    direction: str,
    n_points: int = 10,
) -> list[dict]:
    percentiles = np.linspace(10, 90, n_points)
    thresholds_eval = np.percentile(marker_eval, percentiles)
    rows = []
    for t_eval in thresholds_eval:
        t_orig = -t_eval if direction == "low" else t_eval
        rows.append(_threshold_performance(y, marker, t_orig, direction))
    return rows


def _interpret_auc(auc: float) -> str:
    if auc >= 0.90:
        return "Excellent (AUC ≥ 0.90)"
    elif auc >= 0.80:
        return "Good (AUC 0.80–0.89)"
    elif auc >= 0.70:
        return "Fair (AUC 0.70–0.79)"
    elif auc >= 0.60:
        return "Poor (AUC 0.60–0.69)"
    else:
        return "Fail (AUC < 0.60)"
