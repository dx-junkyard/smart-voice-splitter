import os
import sys
from datetime import datetime
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Add current directory to path to allow imports
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from database import Base, SQLALCHEMY_DATABASE_URL
# Import models to ensure they are registered with Base
# Note: This might fail if we try to use them before schema update, but we need them for metadata creation
from models import Profile, Recording

def migrate():
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    try:
        print("Starting migration...")

        # 1. Create 'profiles' table if it doesn't exist
        # We use Base.metadata.create_all, but we only want to create new tables.
        # It won't touch existing tables (like recordings).
        print("Creating new tables...")
        Base.metadata.create_all(bind=engine)

        # 2. Add 'profile_id' column to 'recordings' table if it doesn't exist
        # SQLite doesn't support IF NOT EXISTS in ALTER TABLE ADD COLUMN usually,
        # so we check if column exists first or catch error.
        print("Checking/Updating 'recordings' table schema...")
        with engine.connect() as conn:
            # Check if column exists
            # Using pragma table_info for SQLite
            result = conn.execute(text("PRAGMA table_info(recordings)"))
            columns = [row[1] for row in result.fetchall()]

            if "profile_id" not in columns:
                print("Adding 'profile_id' column to 'recordings' table...")
                # Add nullable column first, or with default?
                # SQLite has limitations on adding non-null columns without default.
                # But here we will fill it immediately. So we can add it as nullable first, or with a default value?
                # We cannot add a NOT NULL column without a default value in SQLite.
                # So we add it as NULLable, fill it, then technically we can't easily change it to NOT NULL in SQLite
                # without recreating the table.
                # However, for application level, SQLAlchemy model enforces it.
                # For this migration, we will add it as Integer.
                conn.execute(text("ALTER TABLE recordings ADD COLUMN profile_id INTEGER"))
                conn.commit()
                print("Column added.")
            else:
                print("'profile_id' column already exists.")

        # 3. Create Default Profile
        print("Creating default profile...")
        default_profile = db.query(Profile).filter(Profile.title == "Imported Legacy Data").first()
        if not default_profile:
            default_profile = Profile(
                title="Imported Legacy Data",
                recorded_at=datetime.utcnow(),
                summary="Automatically migrated data from previous version."
            )
            db.add(default_profile)
            db.commit()
            db.refresh(default_profile)
            print(f"Created default profile with ID: {default_profile.id}")
        else:
            print(f"Default profile already exists with ID: {default_profile.id}")

        # 4. Update existing recordings
        print("Updating existing recordings...")
        # Get all recordings with null profile_id
        # Note: Since we added the column, existing rows have NULL in profile_id
        # We can use raw SQL or ORM.
        # Since we modified the model to say nullable=False, querying might be tricky if we mapped it that way
        # but the data is NULL.
        # However, we can use update() statement.

        # Check if there are recordings to update
        # We use text query to avoid ORM validation issues if any
        with engine.connect() as conn:
             result = conn.execute(text("UPDATE recordings SET profile_id = :p_id WHERE profile_id IS NULL"), {"p_id": default_profile.id})
             conn.commit()
             print(f"Updated {result.rowcount} recordings.")

        print("Migration completed successfully.")

    except Exception as e:
        print(f"Migration failed: {e}")
        import traceback
        traceback.print_exc()
    finally:
        db.close()

if __name__ == "__main__":
    migrate()
