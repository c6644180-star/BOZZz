"""BOZZ computer-operation agent (Milestone 1).

Import the engine lazily through ``app.api.agent.get_agent``; this package only
re-exports the stable entry points so the rest of the backend can stay
importable when Playwright is not installed.
"""

from app.agent.registry import CapabilityRegistry
from app.agent.service import (
    AgentApprovalError,
    AgentDisabled,
    AgentError,
    AgentNotFound,
    AgentService,
)

__all__ = [
    "AgentApprovalError",
    "AgentDisabled",
    "AgentError",
    "AgentNotFound",
    "AgentService",
    "CapabilityRegistry",
]
