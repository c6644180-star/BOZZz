from fastapi import FastAPI

app = FastAPI(
    title="BOZZ API",
    description="BOZZ local-first AI assistant backend",
    version="0.1.0",
)


@app.get("/")
def home():
    return {
        "name": "BOZZ",
        "status": "online",
        "version": "0.1.0",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "bozz-backend",
    }