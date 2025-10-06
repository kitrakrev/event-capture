"""FastAPI service providing a secure MongoDB API facade and event ingestion."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from pydantic import BaseModel, Field, validator
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from bson import ObjectId

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover - optional dependency
    load_dotenv = None


if load_dotenv:
    load_dotenv()


def _load_allowed_collections(raw: str) -> List[str]:
    """Parse a JSON array or comma-separated list into a collection list."""
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return [str(item) for item in parsed]
    except json.JSONDecodeError:
        pass
    return [col.strip() for col in raw.split(",") if col.strip()]


ATLAS_URI = os.getenv("ATLAS_URI")
ALLOWED_DB = os.getenv("ALLOWED_DB")
ALLOWED_COLLECTIONS = set(_load_allowed_collections(os.getenv("ALLOWED_COLLECTIONS", "")))
EVENT_COLLECTION = os.getenv("EVENT_COLLECTION", "events")
API_KEY = os.getenv("API_KEY")

if EVENT_COLLECTION:
    ALLOWED_COLLECTIONS.add(EVENT_COLLECTION)

client: Optional[MongoClient] = MongoClient(ATLAS_URI, serverSelectionTimeoutMS=5000) if ATLAS_URI else None

app = FastAPI(title="Atlas Data API Replacement", version="1.0.0")


def require_configuration() -> None:
    if not ATLAS_URI:
        raise RuntimeError("ATLAS_URI environment variable is required")
    if not ALLOWED_DB:
        raise RuntimeError("ALLOWED_DB environment variable is required")
    if not ALLOWED_COLLECTIONS:
        raise RuntimeError("ALLOWED_COLLECTIONS environment variable is required")
def to_serializable(value: Any) -> Any:
    """Recursively convert Mongo types (e.g. ObjectId) into JSON-friendly data."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, list):
        return [to_serializable(item) for item in value]
    if isinstance(value, dict):
        return {key: to_serializable(val) for key, val in value.items()}
    return value


def get_collection(database: str, collection: str):
    if database != ALLOWED_DB:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blocked database")
    if collection not in ALLOWED_COLLECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blocked collection")
    if client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mongo client not configured")
    return client[database][collection]


async def verify_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


@app.on_event("startup")
async def startup_event() -> None:
    require_configuration()
    if client is None:
        raise RuntimeError("Mongo client not initialized")
    client.admin.command("ping")


class EventPayload(BaseModel):
    task: str
    duration: int = Field(..., ge=0)
    events_recorded: int = Field(..., ge=0)
    start_url: Optional[str] = None
    end_url: Optional[str] = None
    data: List[Dict[str, Any]] = Field(default_factory=list)


@app.post("/api/events", dependencies=[Depends(verify_api_key)])
async def ingest_events(payload: EventPayload) -> Dict[str, Any]:
    try:
        collection = get_collection(ALLOWED_DB, EVENT_COLLECTION)
        events_count = len(payload.data)
        document = {
            "task": payload.task,
            "duration": payload.duration,
            "events_recorded": events_count if events_count != payload.events_recorded else payload.events_recorded,
            "start_url": payload.start_url,
            "end_url": payload.end_url,
            "data": payload.data,
            "timestamp": datetime.utcnow(),
        }
        result = collection.insert_one(document)

        # Also write payload and metadata to root-level intermediate/<timestamp>
        try:
            project_root = Path(__file__).resolve().parent.parent
            iso = datetime.utcnow().isoformat().replace(":", "-").replace(".", "-")
            folder = project_root / "intermediate" / iso
            folder.mkdir(parents=True, exist_ok=True)

            payload_json = {
                "task": document["task"],
                "duration": document["duration"],
                "events_recorded": document["events_recorded"],
                "start_url": document.get("start_url"),
                "end_url": document.get("end_url"),
                "data": document["data"],
            }
            metadata_json = {
                "savedAt": datetime.utcnow().isoformat(),
                "mongo": {"insertedId": str(result.inserted_id)},
                "counts": {"events": len(document["data"])},
                "paths": {
                    "payload": str((folder / "payload.json").resolve()),
                    "metadata": str((folder / "metadata.json").resolve()),
                },
            }

            (folder / "payload.json").write_text(json.dumps(payload_json, indent=2), encoding="utf-8")
            (folder / "metadata.json").write_text(json.dumps(metadata_json, indent=2), encoding="utf-8")
        except Exception as file_err:
            # Non-fatal: log and continue
            print(f"Failed writing intermediate files: {file_err}")

        return {"success": True, "documentId": str(result.inserted_id)}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class FindOneBody(BaseModel):
    database: str
    collection: str
    filter: Dict[str, Any] = Field(default_factory=dict)
    projection: Optional[Dict[str, int]] = None


@app.post("/v1/findOne", dependencies=[Depends(verify_api_key)])
async def find_one(body: FindOneBody) -> Dict[str, Any]:
    try:
        doc = get_collection(body.database, body.collection).find_one(body.filter, body.projection)
        return {"document": to_serializable(doc)}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class FindBody(BaseModel):
    database: str
    collection: str
    filter: Dict[str, Any] = Field(default_factory=dict)
    projection: Optional[Dict[str, int]] = None
    sort: Optional[Dict[str, int]] = None
    limit: int = 50
    skip: int = 0

    @validator("limit", pre=True, always=True)
    def clamp_limit(cls, value: Any) -> int:
        value = int(value) if value is not None else 50
        return max(0, min(value, 200))

    @validator("skip", pre=True, always=True)
    def clamp_skip(cls, value: Any) -> int:
        value = int(value) if value is not None else 0
        return max(0, value)


@app.post("/v1/find", dependencies=[Depends(verify_api_key)])
async def find(body: FindBody) -> Dict[str, Any]:
    try:
        cursor = get_collection(body.database, body.collection).find(body.filter, body.projection)
        if body.sort:
            sort_pairs = [(field, int(direction)) for field, direction in body.sort.items()]
            cursor = cursor.sort(sort_pairs)
        cursor = cursor.skip(body.skip).limit(body.limit)
        documents = [to_serializable(doc) for doc in cursor]
        return {"documents": documents}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class InsertOneBody(BaseModel):
    database: str
    collection: str
    document: Dict[str, Any]


@app.post("/v1/insertOne", dependencies=[Depends(verify_api_key)])
async def insert_one(body: InsertOneBody) -> Dict[str, Any]:
    try:
        result = get_collection(body.database, body.collection).insert_one(body.document)
        return {"insertedId": str(result.inserted_id)}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class UpdateOneBody(BaseModel):
    database: str
    collection: str
    filter: Dict[str, Any]
    update: Dict[str, Any]
    upsert: bool = False


@app.post("/v1/updateOne", dependencies=[Depends(verify_api_key)])
async def update_one(body: UpdateOneBody) -> Dict[str, Any]:
    try:
        result = get_collection(body.database, body.collection).update_one(
            body.filter, body.update, upsert=body.upsert
        )
        response: Dict[str, Any] = {
            "matchedCount": result.matched_count,
            "modifiedCount": result.modified_count,
        }
        if result.upserted_id is not None:
            response["upsertedId"] = str(result.upserted_id)
        return response
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
