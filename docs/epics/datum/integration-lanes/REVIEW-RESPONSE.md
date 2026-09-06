# Review Response

- ACCEPT d3246c28 (ARCH-003 datum/gate.py:19): Module-level imports of integration_invariants in gate.py are the same pattern as every other gate helper import in that file; the coupling is real and intended, and a lazy import would only hide an ImportError until the plan gate runs.
- ACCEPT cad4e34f (CORR-001 datum/lane_plan_digest.py:56): SPEC AC4.1 conflicts with its own Backward-compatibility row (pre-slice plans must digest byte-identically) and with the shipped test test_ac1_properties_path_none_is_byte_identical_to_pre_slice_output; every consumer already treats an absent kind as task (AC4.3, AC9.2), so no default is synthesised.
