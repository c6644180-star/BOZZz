from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agent.mock_site import router as agent_test_site_router
from app.api.agent import get_agent
from app.api.agent import router as agent_router
from app.api.bci import get_bci_service
from app.api.bci import router as bci_router
from app.api.chat import router as chat_router
from app.api.desktop import get_desktop
from app.api.desktop import router as desktop_router
from app.api.files import router as files_router
from app.api.intents import get_engine, router as intents_router
from app.api.modules import get_module_service, router as modules_router
from app.api.tts import get_tts
from app.api.tts import router as tts_router
from app.core.config import get_settings
from app.core.logging import configure_logging

settings = get_settings()
logger = configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    get_engine()
    module_service = get_module_service()
    desktop = get_desktop()
    agent = get_agent()
    logger.info(
        "BOZZ backend ready | database=%s | workspace=%s | provider=ollama | tts_configured=%s | desktop_available=%s",
        settings.database_path,
        settings.workspace_dir,
        get_tts().configured,
        desktop.status()["available"],
    )
    logger.info(
        "computer agent ready | enabled=%s | emergency_stopped=%s | playwright_available=%s",
        agent.settings_view()["enabled"],
        agent.settings_view()["emergency_stopped"],
        agent.status()["adapters"]["browser"]["installed"],
    )
    logger.info("module registry ready | modules=%d", len(module_service.modules()))
    try:
        cleanup = get_bci_service().cleanup_expired()
        logger.info("bci retention cleanup | deleted=%d", cleanup["deleted"])
    except Exception:
        logger.exception("bci retention cleanup failed; conversations were not touched")
    yield
    desktop.release_drag()
    logger.info("BOZZ backend stopped")


app = FastAPI(
    title="BOZZ API",
    description="BOZZ local-first AI assistant backend",
    version="0.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type"],
)

app.include_router(chat_router)
app.include_router(intents_router)
app.include_router(modules_router)
app.include_router(files_router)
app.include_router(bci_router)
app.include_router(tts_router)
app.include_router(desktop_router)
app.include_router(agent_router)
app.include_router(agent_test_site_router)


@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected local error occurred. Check the backend log."},
    )


@app.get("/")
def home():
    return {
        "name": "BOZZ",
        "status": "online",
        "version": "0.2.0",
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "bozz-backend",
        "database": "ready",
        "workspace": "ready",
    }
