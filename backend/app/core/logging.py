from __future__ import annotations

import logging
import sys

_configured = False


def configure_logging(level: str = "INFO") -> logging.Logger:
    """Configure one stderr handler for BOZZ logs. Safe to call repeatedly."""
    global _configured
    logger = logging.getLogger("bozz")
    if _configured:
        return logger

    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )
    logger.addHandler(handler)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False
    _configured = True
    return logger
