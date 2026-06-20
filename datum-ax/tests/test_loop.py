from datum_ax.core.verifier.loop import VerificationLoop


def test_verification_loop_fail_fast():
    # A mock host that always fails
    class AlwaysFailHost:
        def apply_diff(self, diff: str) -> None:
            pass

        def run_tests(self) -> dict:
            return {"pass": False}

    loop = VerificationLoop(host=AlwaysFailHost())

    # Should exhaust 3 attempts and return fail
    result = loop.execute_lane({"id": "l1"})
    assert result["success"] is False
    assert result["attempts"] == 3


def test_verification_loop_success():
    # A mock host that succeeds
    class SuccessHost:
        def apply_diff(self, diff: str) -> None:
            pass

        def run_tests(self) -> dict:
            return {"pass": True}

    loop = VerificationLoop(host=SuccessHost())

    result = loop.execute_lane({"id": "l2"})
    assert result["success"] is True
    assert result["attempts"] == 1
