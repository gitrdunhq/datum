import pytest
from datum_ax.core.reviewer.adversarial import AdversarialReviewer

def test_adversarial_reviewer_low_risk():
    reviewer = AdversarialReviewer()
    
    # Safe diff
    diff = "--- a/docs/README.md\n+++ b/docs/README.md\n+Fixed typo"
    result = reviewer.evaluate_diff(diff)
    
    assert result["status"] == "DONE"
    assert "review_markdown" in result

def test_adversarial_reviewer_high_risk():
    reviewer = AdversarialReviewer()
    
    # High risk diff (e.g. dropping a table without migration logic)
    diff = "--- a/src/db.py\n+++ b/src/db.py\n- db.execute('DROP TABLE users')"
    result = reviewer.evaluate_diff(diff)
    
    # Assuming the stub flags "DROP TABLE" as high risk
    assert result["status"] == "BLOCKED"
    assert "regression" in result["review_markdown"].lower()
