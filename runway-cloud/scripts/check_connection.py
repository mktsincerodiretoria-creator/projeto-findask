"""Read-only authentication and balance check; never prints secrets."""
import os
import sys
from runway_video import api
key = os.environ.get("RUNWAYML_API_SECRET", "").strip()
if not key:
    sys.exit("Configure RUNWAYML_API_SECRET no gerenciador de segredos.")
try:
    result = api(key, "GET", "/organization")
    print({"authenticated": True, "creditBalance": result.get("creditBalance")})
except ValueError as error:
    sys.exit(str(error))
