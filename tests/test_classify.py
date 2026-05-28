import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from datum.classify import parse_classification_metadata, classify

PATCH_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 20
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
"""

FEATURE_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 8
estimated_loc: 200
clusters_touched: 3
new_public_api: false
dependency_additions: []
```
"""

SYSTEM_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 15
estimated_loc: 800
clusters_touched: 6
new_public_api: true
dependency_additions: [pydantic]
```
"""

BOUNDARY_49_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 49
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
"""

BOUNDARY_50_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 2
estimated_loc: 50
clusters_touched: 1
new_public_api: false
dependency_additions: []
```
"""

BOUNDARY_5_CLUSTERS = """
## 9. Classification Metadata

```yaml
estimated_files: 10
estimated_loc: 300
clusters_touched: 5
new_public_api: false
dependency_additions: []
```
"""

BOUNDARY_6_CLUSTERS = """
## 9. Classification Metadata

```yaml
estimated_files: 10
estimated_loc: 300
clusters_touched: 6
new_public_api: false
dependency_additions: []
```
"""

MISSING_FIELDS_SPEC = """
## 9. Classification Metadata

```yaml
estimated_files: 5
```
"""


class TestParseClassificationMetadata(unittest.TestCase):
    def test_parses_all_fields(self):
        """INV-004: output has all fields"""
        meta = parse_classification_metadata(FEATURE_SPEC)
        self.assertEqual(meta["estimated_files"], 8)
        self.assertEqual(meta["estimated_loc"], 200)
        self.assertEqual(meta["clusters_touched"], 3)
        self.assertFalse(meta["new_public_api"])
        self.assertEqual(meta["dependency_additions"], [])

    def test_missing_fields_return_none(self):
        """BOUND-004: missing fields → None"""
        meta = parse_classification_metadata(MISSING_FIELDS_SPEC)
        self.assertEqual(meta["estimated_files"], 5)
        self.assertIsNone(meta["estimated_loc"])
        self.assertIsNone(meta["clusters_touched"])

    def test_no_metadata_section_returns_all_none(self):
        meta = parse_classification_metadata("# Spec with no metadata")
        self.assertIsNone(meta["estimated_files"])


class TestClassify(unittest.TestCase):
    def test_patch_tier(self):
        """BOUND-001: 49 LOC + 1 cluster → patch"""
        meta = parse_classification_metadata(BOUNDARY_49_SPEC)
        result = classify(meta)
        self.assertEqual(result["tier"], "patch")
        self.assertEqual(result["pipeline_shape"], "express")

    def test_boundary_50_is_feature(self):
        """BOUND-002: 50 LOC → feature (not patch)"""
        meta = parse_classification_metadata(BOUNDARY_50_SPEC)
        result = classify(meta)
        self.assertEqual(result["tier"], "feature")
        self.assertEqual(result["pipeline_shape"], "standard")

    def test_feature_tier(self):
        meta = parse_classification_metadata(FEATURE_SPEC)
        result = classify(meta)
        self.assertEqual(result["tier"], "feature")
        self.assertEqual(result["pipeline_shape"], "standard")

    def test_system_tier(self):
        """SAFE-002: System never routes to Express"""
        meta = parse_classification_metadata(SYSTEM_SPEC)
        result = classify(meta)
        self.assertEqual(result["tier"], "system")
        self.assertEqual(result["pipeline_shape"], "extended")

    def test_5_clusters_is_feature(self):
        """BOUND-003: 5 clusters → feature"""
        meta = parse_classification_metadata(BOUNDARY_5_CLUSTERS)
        result = classify(meta)
        self.assertEqual(result["tier"], "feature")

    def test_6_clusters_is_system(self):
        """BOUND-003: 6 clusters → system"""
        meta = parse_classification_metadata(BOUNDARY_6_CLUSTERS)
        result = classify(meta)
        self.assertEqual(result["tier"], "system")

    def test_output_has_signals(self):
        """OBS-002: signals in output"""
        meta = parse_classification_metadata(FEATURE_SPEC)
        result = classify(meta)
        self.assertIn("signals", result)
        self.assertIn("estimated_loc", result["signals"])

    def test_output_has_exactly_three_keys(self):
        """INV-004: exactly three fields"""
        meta = parse_classification_metadata(FEATURE_SPEC)
        result = classify(meta)
        self.assertEqual(set(result.keys()), {"tier", "signals", "pipeline_shape"})


if __name__ == "__main__":
    unittest.main()
