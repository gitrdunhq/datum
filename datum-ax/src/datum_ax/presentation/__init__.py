"""datum-ax PRESENTATION tier — entry points + composition root (CLI, agent, skills).

IMPORT RULE (ADR-0026): the only tier that may import ``data``; it constructs concrete data
adapters and injects them into ``core`` via ``contracts``. Nothing imports this tier. Empty until E10.
"""
