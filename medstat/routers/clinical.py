"""Clinical trials API router."""
from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..analysis.clinical import run_anova, run_chi_square, run_sample_size, run_ttest

router = APIRouter()


class TtestRequest(BaseModel):
    group1: list[float]
    group2: list[float]
    paired: bool = False
    equal_var: bool = False


class AnovaRequest(BaseModel):
    groups: list[list[float]]
    group_names: Optional[list[str]] = None


class ChiSquareRequest(BaseModel):
    observed: list[list[int]]
    row_names: Optional[list[str]] = None
    col_names: Optional[list[str]] = None
    yates_correction: bool = True


class SampleSizeRequest(BaseModel):
    test: Literal["ttest_2samp", "proportion_2samp"] = "ttest_2samp"
    alpha: float = 0.05
    power: float = 0.80
    effect_size: Optional[float] = None
    mean1: Optional[float] = None
    mean2: Optional[float] = None
    sd: Optional[float] = None
    p1: Optional[float] = None
    p2: Optional[float] = None
    ratio: float = 1.0


@router.post("/ttest")
async def ttest(req: TtestRequest) -> dict:
    if len(req.group1) < 2 or len(req.group2) < 2:
        raise HTTPException(400, "Each group must have at least 2 observations.")
    try:
        return run_ttest(req.group1, req.group2, req.paired, req.equal_var)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.post("/anova")
async def anova(req: AnovaRequest) -> dict:
    if len(req.groups) < 2:
        raise HTTPException(400, "At least 2 groups are required.")
    if any(len(g) < 2 for g in req.groups):
        raise HTTPException(400, "Each group must have at least 2 observations.")
    try:
        return run_anova(req.groups, req.group_names)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.post("/chi_square")
async def chi_square(req: ChiSquareRequest) -> dict:
    if len(req.observed) < 2 or any(len(r) < 2 for r in req.observed):
        raise HTTPException(400, "Table must be at least 2x2.")
    try:
        return run_chi_square(req.observed, req.row_names, req.col_names, req.yates_correction)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc


@router.post("/sample_size")
async def sample_size(req: SampleSizeRequest) -> dict:
    try:
        return run_sample_size(
            req.test, req.alpha, req.power, req.effect_size,
            req.mean1, req.mean2, req.sd, req.p1, req.p2, req.ratio,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
