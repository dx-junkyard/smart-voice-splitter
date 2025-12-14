from fastapi import FastAPI, UploadFile, File, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import shutil
import os
import uuid
from database import engine, Base, get_db
import models, schemas
from services.audio_processor import AudioProcessor

# Create tables
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
def upload_audio(file: UploadFile = File(...), db: Session = Depends(get_db)):
    if not audio_processor:
        raise HTTPException(status_code=500, detail="Audio Processor not initialized. Check server logs.")

    # 1. Save file
    file_extension = os.path.splitext(file.filename)[1]
    filename = f"{uuid.uuid4()}{file_extension}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    try:
        # 2. Process audio
        chunks_data = audio_processor.process(file_path)

        # 3. Save to DB
        recording = models.Recording(file_path=file_path)
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
        print(f"Error processing audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/recordings", response_model=list[schemas.Recording])
def read_recordings(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    recordings = db.query(models.Recording).offset(skip).limit(limit).all()
    return recordings

@app.get("/")
def read_root():
    return {"message": "Smart Voice Splitter API is running"}
