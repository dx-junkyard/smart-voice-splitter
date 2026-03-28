from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

# Chunk Schemas
class ChunkBase(BaseModel):
    title: str
    transcript: str
    start_time: float
    end_time: float
    file_path: Optional[str] = None
    user_note: Optional[str] = None
    content_type: str = "speech"

class ChunkCreate(ChunkBase):
    pass

class Chunk(ChunkBase):
    id: int
    recording_id: int
    file_path: Optional[str]
    is_bookmarked: bool
    content_type: str

    class Config:
        from_attributes = True

# Recording Schemas
class RecordingBase(BaseModel):
    file_path: str

class RecordingCreate(RecordingBase):
    pass

class Recording(RecordingBase):
    profile_id: int
    file_path: str
    status: str
    created_at: datetime
    chunks: list[Chunk] = []

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
    content_type: str = "speech"
    is_bookmarked: Optional[bool] = None
