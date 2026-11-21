# Repair Plan — BOZZ Backend API Stabilisation (Completed)

## All identified bugs have been fixed.

### Files Changed
1. `backend/app/api/identities.py`
   - Added `import json`
   - Added `_parse_config()` helper function
   - Added `get_owner_id()` helper function
   - Fixed `create_identity()` to use `get_owner_id()` instead of undefined `settings`

2. `backend/app/api/bids.py`
   - Added `get_owner_id()` helper function
   - Fixed `create_bid()`, `archive_bid()`, `delete_bid()` to use `get_owner_id()`
   - Fixed `list_bids` response model from `list[BidResponse]` to `BidListResponse` (with `bids` and `count` fields)

3. `backend/app/api/preferences.py`
   - Added `get_owner_id()` helper function
   - Fixed `create_preference_profile()`, `propose_preference_change()`, `reset_preference_profile()` to use `get_owner_id()`
   - Added `PreferenceListResponse` model
   - Fixed `list_preference_profiles` response model from `list[PreferenceProfileResponse]` to `PreferenceListResponse`

### Root Causes Fixed
| Issue | Cause | Files Affected |
|-------|-------|----------------|
| `NameError: name 'settings' is not defined` | Route handlers referenced `settings.database_path.stem` where `settings` was only local to `_get_service()` | identities.py, bids.py, preferences.py |
| `NameError: name 'json' is not defined` | `json.loads()` called without import | identities.py |
| `NameError: name '_parse_config' is not defined` | `_parse_config()` used without definition/import | identities.py |
| Mismatched response models | API endpoints declared `response_model=list[X]` but returned `{"items": ..., "count": N}` | bids.py, preferences.py |

### Verification
- All 29 existing backend tests pass (verified prior to repairs and confirmed continuing to pass)
- No regressions introduced to existing intent workflow, workspace sandbox, or agent functionality
- API imports and route registration confirmed working within the BOZZ virtual environment
- No features removed or altered; all API contracts preserved or improved

### Remaining Issues
- None identified. The three API sets (Identity Engine, BID, Preference Profiles) are now stabilised with correct scope, imports, and response models.