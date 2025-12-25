from sqlalchemy import Column, Integer, String, Float, ForeignKey, DateTime, Text, Table
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base

# Association Table for Chunk and Tag
chunk_tags = Table(
    "chunk_tags",
    Base.metadata,
    Column("chunk_id", Integer, ForeignKey("chunks.id"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id"), primary_key=True)
)

class Tag(Base):
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    color = Column(String, nullable=True)

    chunks = relationship("Chunk", secondary=chunk_tags, back_populates="tags")

class Profile(Base):
    __tablename__ = "profiles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    recorded_at = Column(DateTime, nullable=False)
    summary = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    recordings = relationship("Recording", back_populates="profile", cascade="all, delete-orphan")

class Recording(Base):
    __tablename__ = "recordings"

    id = Column(Integer, primary_key=True, index=True)
    profile_id = Column(Integer, ForeignKey("profiles.id"), nullable=False)
    file_path = Column(String, nullable=False)
    # Status: pending, processing, completed, failed
    status = Column(String, default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    profile = relationship("Profile", back_populates="recordings")
    chunks = relationship("Chunk", back_populates="recording", cascade="all, delete-orphan")

class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(Integer, primary_key=True, index=True)
    recording_id = Column(Integer, ForeignKey("recordings.id"), nullable=False)
    title = Column(String, nullable=False)
    transcript = Column(Text, nullable=False)
    start_time = Column(Float, nullable=False)
    end_time = Column(Float, nullable=False)
    user_note = Column(Text, nullable=True)
    file_path = Column(String, nullable=True)
    is_bookmarked = Column(Integer, default=False) # storing boolean as 0/1 or boolean type if supported, SQLAlchemy Boolean maps to appropriate type

    recording = relationship("Recording", back_populates="chunks")
    tags = relationship("Tag", secondary=chunk_tags, back_populates="chunks")
