from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# Chunk Schemas
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

# Recording Schemas
class RecordingBase(BaseModel):
    file_path: str

class RecordingCreate(RecordingBase):
    pass

class Recording(RecordingBase):
    id: int
    profile_id: int
    created_at: datetime
    chunks: List[Chunk] = []

    class Config:
        from_attributes = True

# Profile Schemas
class ProfileBase(BaseModel):
    title: str
    recorded_at: datetime
    summary: Optional[str] = None

class ProfileCreate(ProfileBase):
    pass

class Profile(ProfileBase):
    id: int
    created_at: datetime
    recordings: List[Recording] = []

    class Config:
        from_attributes = True

class ChunkUpdate(BaseModel):
    user_note: Optional[str] = None
