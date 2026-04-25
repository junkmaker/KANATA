from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db.init_db import init_db
from .routes import quotes, search, watchlists


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="KANATA API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_origin_regex=r"file://.*",
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.include_router(quotes.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(watchlists.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
