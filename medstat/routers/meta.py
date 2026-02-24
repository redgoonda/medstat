"""Meta-analysis API router."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..analysis.meta import run_meta_analysis

router = APIRouter()


class MetaRequest(BaseModel):
    studies: list[dict]
    measure: Literal["OR", "RR", "MD", "SMD"] = "OR"
    model: Literal["fixed", "random"] = "random"


@router.post("/analyze")
async def analyze(req: MetaRequest) -> dict:
    if len(req.studies) < 2:
        raise HTTPException(400, "At least 2 studies are required.")
    try:
        return run_meta_analysis(req.studies, req.measure, req.model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc
