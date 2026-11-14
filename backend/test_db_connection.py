import asyncio
from sqlalchemy import text
from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine

async def main():
    engine = create_async_engine(settings.DATABASE_URL, connect_args={"timeout": 10})
    try:
        async with engine.connect() as conn:
            result = await conn.execute(text("""
                SELECT current_database(), current_user,
                       (SELECT COUNT(*) FROM information_schema.tables
                        WHERE table_schema = 'public'
                        AND table_type = 'BASE TABLE')
            """))
            row = result.fetchone()
            print("Database connection: SUCCESS")
            print("Database name:", row[0])
            print("Public tables:", row[2])
            print("Database username format:", row[1].split(".")[0])
    finally:
        await engine.dispose()

asyncio.run(main())
