import sys
sys.path.insert(0, r"C:\Users\Marimuthu S\Documents\GitHub\BOZZz\backend")
from app.api.identities import router as identities_router
from app.api.bids import router as bids_router
from app.api.preferences import router as preferences_router
print("All three API routers imported successfully")
print(f"Identities routes: {len(identities_router.routes)}")
print(f"Bids routes: {len(bids_router.routes)}")
print(f"Preferences routes: {len(preferences_router.routes)}")