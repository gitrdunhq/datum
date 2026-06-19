"""datum-ax DATA tier — persistence + external calls (Valkey, libSQL, oMLX, ExecutionHost,
Serena/Context7/Headroom/GitNexus, eedom, GitHub).

IMPORT RULE (ADR-0026): may import ONLY ``datum_ax.contracts`` and ``datum_ax.schemas``; it
*implements* the contract Protocols. NEVER ``core`` or ``presentation``. Empty until E2+.
"""
