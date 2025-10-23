"""

This service exposes a minimal API to ingest recorded browser events into
MongoDB and in the local directory <project-root>/intermediate/<ISO-timestamp>.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status, UploadFile, File, Form
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
DB_AVAILABLE: bool = False
DB_LAST_ERROR: Optional[str] = None

app = FastAPI(title="Atlas Data API Replacement", version="1.0.0")


def require_configuration() -> None:
    """Fail fast when required environment variables are missing."""
    if not ATLAS_URI:
        raise RuntimeError("ATLAS_URI environment variable is required")
    if not ALLOWED_DB:
        raise RuntimeError("ALLOWED_DB environment variable is required")
    if not ALLOWED_COLLECTIONS:
        raise RuntimeError("ALLOWED_COLLECTIONS environment variable is required")


def to_serializable(value: Any) -> Any:
    """Recursively convert Mongo/Datetime types into JSON-friendly values."""
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
    """Return a guarded MongoDB collection from the allow-listed db/collection."""
    if database != ALLOWED_DB:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blocked database")
    if collection not in ALLOWED_COLLECTIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="blocked collection")
    if client is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Mongo client not configured")
    return client[database][collection]


async def verify_api_key(x_api_key: Optional[str] = Header(default=None)) -> None:
    """Optional API key check controlled by the API_KEY env var."""
    if API_KEY and x_api_key != API_KEY:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="unauthorized")


@app.on_event("startup")
async def startup_event() -> None:
    """Verify configuration and attempt Mongo connectivity on startup.

    If Mongo is unreachable (e.g., corporate SSL interception, offline, bad certs),
    continue to start in local-only mode and persist payloads under `intermediate/`.
    """
    global DB_AVAILABLE, DB_LAST_ERROR
    require_configuration()
    if client is None:
        DB_AVAILABLE = False
        DB_LAST_ERROR = "Mongo client not initialized"
        print(f"[startup] Warning: {DB_LAST_ERROR}. Running in local-only mode.")
        return
    try:
        client.admin.command("ping")
        DB_AVAILABLE = True
        DB_LAST_ERROR = None
        print("[startup] MongoDB connectivity OK")
    except Exception as exc:  # broad to catch SSL/TLS issues
        DB_AVAILABLE = False
        DB_LAST_ERROR = str(exc)
        print(f"[startup] Warning: MongoDB unavailable ({DB_LAST_ERROR}). Running in local-only mode.")


class EventPayload(BaseModel):
    """Schema for event ingestion payload from the extension."""
    task: str
    duration: int = Field(..., ge=0)
    events_recorded: int = Field(..., ge=0)
    start_url: Optional[str] = None
    end_url: Optional[str] = None
    data: List[Dict[str, Any]] = Field(default_factory=list)
    video_local_path: Optional[str] = None
    video_server_path: Optional[str] = None


@app.post("/api/events", dependencies=[Depends(verify_api_key)])
async def ingest_events(payload: EventPayload) -> Dict[str, Any]:
    """Insert the payload into Mongo and mirror it to intermediate/<timestamp>."""
    try:
        events_count = len(payload.data)
        document = {
            "task": payload.task,
            "duration": payload.duration,
            "events_recorded": events_count if events_count != payload.events_recorded else payload.events_recorded,
            "start_url": payload.start_url,
            "end_url": payload.end_url,
            "data": payload.data,
            "video_local_path": payload.video_local_path,
            "video_server_path": payload.video_server_path,
            "timestamp": datetime.utcnow(),
        }

        inserted_id: Optional[ObjectId] = None
        mongo_ok = False
        mongo_error: Optional[str] = None
        if client is not None and DB_AVAILABLE:
            try:
                collection = get_collection(ALLOWED_DB, EVENT_COLLECTION)
                result = collection.insert_one(document)
                inserted_id = result.inserted_id
                mongo_ok = True
            except PyMongoError as exc:
                mongo_error = str(exc)
        else:
            mongo_error = DB_LAST_ERROR or "database not available"

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
                "video_local_path": document.get("video_local_path"),
                "video_server_path": document.get("video_server_path"),
            }
            metadata_json = {
                "savedAt": datetime.utcnow().isoformat(),
                "mongo": {"insertedId": str(inserted_id) if inserted_id else None, "ok": mongo_ok, "error": mongo_error},
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

        return {"success": True, "documentId": str(inserted_id) if inserted_id else None, "folderIso": iso, "mongo": {"ok": mongo_ok, "error": mongo_error}}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.post("/api/events/video", dependencies=[Depends(verify_api_key)])
async def upload_video(
    folderIso: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """Upload a recorded video and save it alongside payload/metadata.

    The client must provide the ISO folder identifier returned by /api/events.
    """
    try:
        project_root = Path(__file__).resolve().parent.parent
        # Basic validation to avoid path traversal
        if "/" in folderIso or ".." in folderIso or folderIso.strip() == "":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid folderIso")

        folder = (project_root / "intermediate" / folderIso).resolve()
        intermediate_root = (project_root / "intermediate").resolve()
        if not str(folder).startswith(str(intermediate_root)):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid path")
        if not folder.exists():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="folder not found")

        video_path = folder / "video.webm"
        content = await file.read()
        video_path.write_bytes(content)

        return {"success": True, "path": str(video_path)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class FindOneBody(BaseModel):
    """Request body for a restricted findOne call."""
    database: str
    collection: str
    filter: Dict[str, Any] = Field(default_factory=dict)
    projection: Optional[Dict[str, int]] = None


@app.post("/v1/findOne", dependencies=[Depends(verify_api_key)])
async def find_one(body: FindOneBody) -> Dict[str, Any]:
    """Find a single document in an allowed collection."""
    try:
        doc = get_collection(body.database, body.collection).find_one(body.filter, body.projection)
        return {"document": to_serializable(doc)}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class FindBody(BaseModel):
    """Request body for a restricted find (with sort/skip/limit)."""
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
    """Find documents in an allowed collection with optional sort/pagination."""
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
    """Request body for a restricted insertOne call."""
    database: str
    collection: str
    document: Dict[str, Any]


@app.post("/v1/insertOne", dependencies=[Depends(verify_api_key)])
async def insert_one(body: InsertOneBody) -> Dict[str, Any]:
    """Insert a document into an allowed collection."""
    try:
        result = get_collection(body.database, body.collection).insert_one(body.document)
        return {"insertedId": str(result.inserted_id)}
    except PyMongoError as exc:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


class UpdateOneBody(BaseModel):
    """Request body for a restricted updateOne call."""
    database: str
    collection: str
    filter: Dict[str, Any]
    update: Dict[str, Any]
    upsert: bool = False


@app.post("/v1/updateOne", dependencies=[Depends(verify_api_key)])
async def update_one(body: UpdateOneBody) -> Dict[str, Any]:
    """Update a single document in an allowed collection."""
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
    """Attach basic security headers to all responses."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response
