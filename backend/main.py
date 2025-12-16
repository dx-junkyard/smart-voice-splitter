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

app = FastAPI()

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

    try:
        # 3. Process audio
        chunks_data = audio_processor.process(file_path)

        # 4. Save to DB (Recording) linked to Profile
        recording = models.Recording(
            file_path=file_path,
            profile_id=new_profile.id
        )
        db.add(recording)
        db.commit()
        db.refresh(recording)

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

        db.commit()
        db.refresh(recording)
        return recording

    except Exception as e:
        # Clean up profile if processing fails?
        # For now, we keep the profile but maybe we should delete it.
        # But maybe the user wants to retry upload for same profile?
        # Given the API design "Upload creates Profile", failure suggests rollback.
        print(f"Error processing audio: {e}")
        # Rollback would be good but file is already saved.
        # We leave it as is for now or delete profile?
        # Deleting profile might be safer to avoid empty profiles.
        db.delete(new_profile)
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
def update_chunk_note(chunk_id: int, chunk_update: schemas.ChunkUpdate, db: Session = Depends(get_db)):
    chunk = db.query(models.Chunk).filter(models.Chunk.id == chunk_id).first()
    if not chunk:
        raise HTTPException(status_code=404, detail="Chunk not found")

    if chunk_update.user_note is not None:
        chunk.user_note = chunk_update.user_note

    db.commit()
    db.refresh(chunk)
    return chunk

# Mount static files to serve audio
app.mount("/static", StaticFiles(directory=UPLOAD_DIR), name="static")

@app.get("/")
def read_root():
    return {"message": "Smart Voice Splitter API is running"}
