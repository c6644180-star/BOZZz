"""Identity management package for BOZZ AI.

Provides the identity service for creating, managing, and switching
between user-owned AI identities with strict memory ownership boundaries.
"""

from __future__ import annotations

from .service import IdentityService  # type: ignore[no-redef]

__all__ = ["IdentityService"]