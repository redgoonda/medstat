"""Survival analysis API router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..analysis.survival import run_kaplan_meier

router = APIRouter()


class SurvivalRequest(BaseModel):
    time: list[float]
    event: list[int]
    groups: Optional[list] = None


@router.post("/analyze")
async def analyze(req: SurvivalRequest) -> dict:
    if len(req.time) != len(req.event):
        raise HTTPException(400, "time and event must have the same length.")
    if req.groups and len(req.groups) != len(req.time):
        raise HTTPException(400, "groups must have the same length as time.")
    if any(v < 0 for v in req.time):
        raise HTTPException(400, "All time values must be non-negative.")
    if any(v not in (0, 1) for v in req.event):
        raise HTTPException(400, "event must be binary (0 = censored, 1 = event).")

    try:
        return run_kaplan_meier(req.time, req.event, req.groups)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
