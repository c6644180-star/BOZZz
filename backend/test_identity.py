"""Test script for Phase 1 AI Identity Engine."""
import sys
sys.path.insert(0, r'C:\Users\Marimuthu S\Documents\GitHub\BOZZz\backend')

from app.db.store import IntentStore
from app.db.database import Database
from pathlib import Path as _Path

# Initialize database
db_path = _Path(r'C:\Users\Marimuthu S\Documents\GitHub\BOZZz\data\bozz.sqlite3')
db = Database(db_path)
db.initialize()

# Create identity store
store = IntentStore(db)

# Create service using the store
service = IdentityService(store)

# Create an identity
record = service.create_identity(
    owner_id='local_user',
    name='Athena',
    description='My first BOZZ identity',
    personality_config={'traits': ['helpful', 'creative'], 'style': 'conversational'},
    role='assistant',
    greeting='Hello! I am Athena.',
    voice_configuration={'preferred_gender': 'neutral', 'speed': 1.0},
    appearance_configuration={'theme': 'dark', 'style': 'minimalist'},
    behaviour_configuration={'response_length': 'medium', 'format': 'markdown'},
)
print(f'Created identity: {record.name} (id={record.id})')
print(f'Role: {record.role}')
print(f'Greeting: {record.greeting}')

# List identities
identities = service.list_identities(owner_id='local_user')
print(f'\nTotal identities: {len(identities)}')
for idata in identities:
    print(f'  - {idata["name"]} (status: {idata["status"]})')

# Get identity by ID
gotten = service.get_identity(record.id)
print(f'\nGotten identity: {gotten["name"]}')

# Edit identity
edited = service.edit_identity(
    record.id,
    description='Updated description',
    personality_config={'traits': ['helpful', 'creative', 'analytical'], 'style': 'conversational'},
)
print(f'\nEdited identity: {edited.name}')
print(f'Updated description: {edited.description}')
print(f'Updated personality config: {edited.personality_config}')

# Rename identity
renamed = service.rename_identity(record.id, 'Athena Prime')
print(f'\nRenamed identity: {renamed.name}')

# Switch identity
switched = service.switch_identity(renamed.id, 'local_user')
print(f'\nSwitched to: {switched["name"]}')
print(f'Memory boundary report: {switched.get("memory_boundary_report", {})}')

# Archive identity
archived = service.archive_identity(renamed.id, 'local_user')
print(f'\nArchived identity: {archived.name} (status: {archived.status})')

# List identities after archive
identities_after = service.list_identities(owner_id='local_user')
print(f'\nTotal identities after archive: {len(identities_after)}')
for idata in identities_after:
    print(f'  - {idata["name"]} (status: {idata["status"]})')

# Try to delete the last active identity (should fail)
try:
    service.delete_identity(archived.id, 'local_user')
    print('\nERROR: Delete should have failed for archived identity')
except ValueError as e:
    print(f'\nCorrectly prevented deletion: {e}')

print('\nAll identity operations completed successfully!')