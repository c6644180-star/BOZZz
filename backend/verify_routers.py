#!/usrusr/bin/env python
"""Verify that all three API routers can be imported and registered."""
import sys
import os
sys.path.insert(0, r'C:\Users\Marimuthu S\Documents\GitHub\BOZZz\backend')

from fastapi import FastAPI
from app.api.identities import router as identities_router
from app.api.bids import router as bids_router
from app.api.preferences import router as preferences_router

app = FastAPI()
app.include_router(identities_router)
app.include_router(bids_router)
app.include_router(preferences_router)

print('All routers imported and registered successfully')
print(f'Total routes: {len(app.routes)}')
for route in app.routes:
    if hasattr(route, 'methods') and hasattr(route, 'path'):
        print(f'  {route.methods} {route.path}')

# Also verify the individual endpoint functions can be called
from app.api.identities import create_identity, list_identities, get_identity
from app.api.bids import create_bid, list_bids, get_bid
from app.api.preferences import create_preference_profile, list_preference_profiles, get_preference_profile

print('\nAll API endpoint functions imported successfully')

# Verify the response models exist
from app.api.identities import IdentityListResponse, IdentityResponse
from app.api.bids import BidResponse, BidListResponse
from app.api.preferences import PreferenceProfileResponse, PreferenceListResponse

print('All response models imported successfully')
print('\nVerification complete!')