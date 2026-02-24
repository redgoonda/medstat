"""MedStat FastAPI application entry point."""
from __future__ import annotations

from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from .routers import biomarker, clinical, data, epidemiology, meta, survival

app = FastAPI(
    title="MedStat",
    version="0.1.0",
    description="Statistical analysis tool for medical research",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

app.include_router(survival.router, prefix="/api/survival", tags=["Survival Analysis"])
app.include_router(meta.router, prefix="/api/meta", tags=["Meta-Analysis"])
app.include_router(clinical.router, prefix="/api/clinical", tags=["Clinical Trials"])
app.include_router(epidemiology.router, prefix="/api/epi", tags=["Epidemiology"])
app.include_router(biomarker.router, prefix="/api/biomarker", tags=["Biomarker Analysis"])
app.include_router(data.router, prefix="/api/data", tags=["Data"])

_STATIC = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(_STATIC)), name="static")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def root() -> HTMLResponse:
    return HTMLResponse((_STATIC / "index.html").read_text())


def cli() -> None:
    import os
    port = int(os.environ.get("PORT", 8100))
    uvicorn.run("medstat.main:app", host="0.0.0.0", port=port)
