from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class ChunkBase(BaseModel):
    title: str
    transcript: str
    start_time: float
    end_time: float
    user_note: Optional[str] = None

class ChunkCreate(ChunkBase):
    pass

class Chunk(ChunkBase):
    id: int
    recording_id: int

    class Config:
        from_attributes = True

class RecordingBase(BaseModel):
    file_path: str

class RecordingCreate(RecordingBase):
    pass

class Recording(RecordingBase):
    id: int
    created_at: datetime
    chunks: List[Chunk] = []

    class Config:
        from_attributes = True
