from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import quotes, search

app = FastAPI(title="KANATA API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)

app.include_router(quotes.router, prefix="/api")
app.include_router(search.router, prefix="/api")

@app.get("/api/health")
def health():
    return {"status": "ok"}
