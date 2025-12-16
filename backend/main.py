from fastapi.staticfiles import StaticFiles
from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import shutil
import os
import uuid
from datetime import datetime
from database import engine, Base, get_db
import models, schemas
from services.audio_processor import AudioProcessor

# Create tables
# Note: create_all only creates tables that don't exist.
# It does NOT handle schema migrations (like adding columns).
Base.metadata.create_all(bind=engine)
from database import SessionLocal

app = FastAPI()

@app.on_event("startup")
def startup_event():
    """
    On startup, check for recordings that are stuck in 'processing' state
    (e.g. from a previous crash) and mark them as 'failed' so they can be resumed.
    """
    print("Startup: Checking for stale processing records...")
    db = SessionLocal()
    try:
        stale_recordings = db.query(models.Recording).filter(models.Recording.status == "processing").all()
        if stale_recordings:
            print(f"Startup: Found {len(stale_recordings)} stale recordings. Marking them as 'failed'.")
            for rec in stale_recordings:
                rec.status = "failed"
            db.commit()
        else:
            print("Startup: No stale recordings found.")
    except Exception as e:
        print(f"Startup: Error cleaning up stale records: {e}")
    finally:
        db.close()

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Audio processor instance
# Ensure OPENAI_API_KEY is set in environment
try:
    audio_processor = AudioProcessor()
except Exception as e:
    print(f"Warning: AudioProcessor could not be initialized (missing API key?): {e}")
    audio_processor = None

@app.post("/upload", response_model=schemas.Recording)
def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(...),
    recorded_at: datetime = Form(...),
    summary: str = Form(None),
    db: Session = Depends(get_db)
):
    """
    Uploads an audio file and creates a Profile for it.
    """
    if not audio_processor:
        raise HTTPException(status_code=500, detail="Audio Processor not initialized. Check server logs.")

    # 1. Create Profile
    new_profile = models.Profile(
        title=title,
        recorded_at=recorded_at,
        summary=summary
    )
    db.add(new_profile)
    db.commit()
    db.refresh(new_profile)

    # 2. Save file
    file_extension = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # 3. Create Recording entry (Status: pending)
    recording = models.Recording(
        file_path=file_path,
        profile_id=new_profile.id,
        status="processing"
    )
    db.add(recording)
    db.commit()
    db.refresh(recording)

    try:
        # 4. Process audio
        chunks_data = audio_processor.process(file_path)

        # 5. Save Chunks
        for chunk_data in chunks_data:
            chunk = models.Chunk(
                recording_id=recording.id,
                title=chunk_data.get("title", "Untitled"),
                transcript=chunk_data.get("transcript", ""),
                start_time=chunk_data.get("start_time", 0.0),
                end_time=chunk_data.get("end_time", 0.0),
                user_note=chunk_data.get("user_note", None)
            )
            db.add(chunk)

        recording.status = "completed"
        db.commit()
        db.refresh(recording)
        return recording

    except Exception as e:
        print(f"Error processing audio: {e}")
        recording.status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/profiles", response_model=list[schemas.Profile])
def read_profiles(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    profiles = db.query(models.Profile).offset(skip).limit(limit).all()
    return profiles

@app.get("/recordings", response_model=list[schemas.Recording])
def read_recordings(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    recordings = db.query(models.Recording).offset(skip).limit(limit).all()
    return recordings

@app.get("/profiles/{profile_id}", response_model=schemas.Profile)
def read_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.query(models.Profile).filter(models.Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    return profile

@app.patch("/chunks/{chunk_id}", response_model=schemas.Chunk)
def update_chunk(chunk_id: int, chunk_update: schemas.ChunkUpdate, db: Session = Depends(get_db)):
    chunk = db.query(models.Chunk).filter(models.Chunk.id == chunk_id).first()
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")

    if chunk_update.user_note is not None:
        chunk.user_note = chunk_update.user_note
    
    if chunk_update.is_bookmarked is not None:
        chunk.is_bookmarked = chunk_update.is_bookmarked

    db.commit()
    db.refresh(chunk)
    return chunk

@app.delete("/profiles/{profile_id}")
def delete_profile(profile_id: int, db: Session = Depends(get_db)):
    profile = db.query(models.Profile).filter(models.Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    db.delete(profile)
    db.commit()
    return {"message": "Profile deleted successfully"}

@app.post("/profiles/{profile_id}/retry", response_model=schemas.Recording)
def retry_processing(profile_id: int, db: Session = Depends(get_db)):
    """
    Retry processing for a profile's recording if it failed or is incomplete.
    """
    print(f"Received retry request for profile {profile_id}", flush=True)

    if not audio_processor:
        raise HTTPException(status_code=500, detail="Audio Processor not initialized.")

    # Find profile
    profile = db.query(models.Profile).filter(models.Profile.id == profile_id).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")

    # Find associated recording
    recording = db.query(models.Recording).filter(models.Recording.profile_id == profile_id).first()
    if not recording:
         # If no recording exists, we can't retry as we don't know the file.
         # Unless we search for orphaned files but that's risky.
        raise HTTPException(status_code=404, detail="No recording found for this profile. Please re-upload.")

    if recording.status == "completed":
        # Check if chunks really exist
        chunk_count = db.query(models.Chunk).filter(models.Chunk.recording_id == recording.id).count()
        if chunk_count > 0:
             raise HTTPException(status_code=400, detail="Processing already completed.")

    # Reset status
    recording.status = "processing"
    db.commit()

    try:
        # Check if file exists
        if not os.path.exists(recording.file_path):
             recording.status = "failed"
             db.commit()
             raise HTTPException(status_code=404, detail="Audio file not found on server.")

        # Process
        chunks_data = audio_processor.process(recording.file_path)

        # Clear existing chunks if any (partial)
        db.query(models.Chunk).filter(models.Chunk.recording_id == recording.id).delete()

        # Save new chunks
        for chunk_data in chunks_data:
            chunk = models.Chunk(
                recording_id=recording.id,
                title=chunk_data.get("title", "Untitled"),
                transcript=chunk_data.get("transcript", ""),
                start_time=chunk_data.get("start_time", 0.0),
                end_time=chunk_data.get("end_time", 0.0),
                user_note=chunk_data.get("user_note", None)
            )
            db.add(chunk)

        recording.status = "completed"
        db.commit()
        db.refresh(recording)
        return recording

    except Exception as e:
        print(f"Error re-processing audio: {e}")
        recording.status = "failed"
        db.commit()
        raise HTTPException(status_code=500, detail=str(e))

# Mount static files to serve audio
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")

@app.get("/")
def read_root():
    return {"message": "Smart Voice Splitter API is running"}
