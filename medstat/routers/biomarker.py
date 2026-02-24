"""Biomarker analysis API router."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..analysis.biomarker import run_roc_analysis

router = APIRouter()


class ROCRequest(BaseModel):
    marker: list[float]
    outcome: list[int]
    marker_name: str = "Marker"
    threshold: Optional[float] = None
    positive_direction: Literal["high", "low"] = "high"


@router.post("/roc")
async def roc(req: ROCRequest) -> dict:
    if len(req.marker) != len(req.outcome):
        raise HTTPException(400, "marker and outcome must have the same length.")
    if len(req.marker) < 5:
        raise HTTPException(400, "At least 5 observations are required.")
    if any(v not in (0, 1) for v in req.outcome):
        raise HTTPException(400, "outcome must be binary (0/1).")
    n_pos = sum(req.outcome)
    if n_pos == 0 or n_pos == len(req.outcome):
        raise HTTPException(400, "outcome must have both positive and negative cases.")
    try:
        return run_roc_analysis(
            req.marker, req.outcome,
            req.marker_name, req.threshold, req.positive_direction,
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
