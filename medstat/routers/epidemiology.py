"""Epidemiology API router."""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..analysis.epidemiology import run_incidence_rate, run_logistic_regression, run_two_by_two

router = APIRouter()


class TwoByTwoRequest(BaseModel):
    a: int
    b: int
    c: int
    d: int
    exposure_name: str = "Exposure"
    outcome_name: str = "Outcome"


class LogisticRequest(BaseModel):
    outcome: list[int]
    predictors: dict[str, list]
    predictor_types: Optional[dict[str, str]] = None


class IncidenceRequest(BaseModel):
    events: int
    person_time: float
    comparison_events: Optional[int] = None
    comparison_person_time: Optional[float] = None
    time_unit: str = "person-years"


@router.post("/two_by_two")
async def two_by_two(req: TwoByTwoRequest) -> dict:
    if any(v < 0 for v in (req.a, req.b, req.c, req.d)):
        raise HTTPException(400, "All cell counts must be non-negative.")
    if req.a + req.b + req.c + req.d == 0:
        raise HTTPException(400, "Table cannot be all zeros.")
    try:
        return run_two_by_two(req.a, req.b, req.c, req.d, req.exposure_name, req.outcome_name)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.post("/logistic")
async def logistic(req: LogisticRequest) -> dict:
    if len(req.outcome) < 10:
        raise HTTPException(400, "At least 10 observations are recommended for logistic regression.")
    if not req.predictors:
        raise HTTPException(400, "At least one predictor is required.")
    try:
        return run_logistic_regression(req.outcome, req.predictors, req.predictor_types)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.post("/incidence_rate")
async def incidence_rate(req: IncidenceRequest) -> dict:
    if req.events < 0 or req.person_time <= 0:
        raise HTTPException(400, "events must be ≥ 0 and person_time must be > 0.")
    try:
        return run_incidence_rate(
            req.events, req.person_time,
            req.comparison_events, req.comparison_person_time,
            req.time_unit,
        )
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
