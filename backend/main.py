from fastapi import FastAPI

app = FastAPI(
    title="Crucible API",
    version="0.1.0",
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/papers/search")
async def search_papers(q: str, limit: int = 20):
    """Search for papers. Placeholder for now."""
    return {"query": q, "limit": limit, "papers": []}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=5001, reload=True)
