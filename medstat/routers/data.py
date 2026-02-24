"""Data ingestion: CSV/Excel upload and REDCap connector."""
from __future__ import annotations

import io

import pandas as pd
from fastapi import APIRouter, File, HTTPException, UploadFile
from pydantic import BaseModel

router = APIRouter()


def _describe_df(df: pd.DataFrame) -> dict:
    columns = []
    for col in df.columns:
        series = df[col]
        n_missing = int(series.isna().sum())
        n_unique = int(series.nunique(dropna=True))
        sample = series.dropna().head(5).tolist()

        # Auto-detect column type
        try:
            pd.to_numeric(series.dropna())
            col_type = "numeric"
        except (ValueError, TypeError):
            col_type = "categorical" if n_unique <= 30 else "text"

        columns.append({
            "name": col,
            "dtype": str(series.dtype),
            "col_type": col_type,
            "n_missing": n_missing,
            "n_unique": n_unique,
            "sample_values": [str(v) for v in sample],
        })

    return {
        "n_rows": len(df),
        "n_cols": len(df.columns),
        "columns": columns,
        "preview": df.head(8).fillna("").astype(str).to_dict(orient="records"),
        "data": df.fillna("").astype(str).to_dict(orient="records"),
    }


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)) -> dict:
    """Upload a CSV or Excel file; returns column metadata and full data."""
    content = await file.read()
    name = file.filename or ""

    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file type. Use CSV or Excel (.xlsx/.xls).")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {exc}") from exc

    return _describe_df(df)


class REDCapRequest(BaseModel):
    url: str
    token: str
    raw_or_label: str = "label"


@router.post("/redcap")
async def fetch_redcap(body: REDCapRequest) -> dict:
    """Fetch records from a REDCap project via its API."""
    import httpx

    payload = {
        "token": body.token,
        "content": "record",
        "format": "json",
        "type": "flat",
        "rawOrLabel": body.raw_or_label,
        "returnFormat": "json",
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(body.url, data=payload)
        resp.raise_for_status()
        records = resp.json()
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=400, detail=f"REDCap API error {exc.response.status_code}: {exc.response.text}") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"REDCap fetch failed: {exc}") from exc

    if not records:
        raise HTTPException(status_code=400, detail="No records returned from REDCap.")

    df = pd.DataFrame(records)
    # Attempt numeric coercion column-by-column
    for col in df.columns:
        df[col] = pd.to_numeric(df[col], errors="ignore")

    return _describe_df(df)
