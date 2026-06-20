from datetime import datetime, timezone

from datum_ax.contracts.status import (
    BudgetStatus,
    InferenceStatus,
    LiveStatus,
    Phase,
    WindowStatus,
)


class StatusProvider:
    """Assembles the LiveStatus object (ADR-0029)."""

    def get_status(self) -> LiveStatus:
        # In a real implementation, this would aggregate data from the orchestrator,
        # Valkey Checkpointer, and libSQL Ledger. For now, it returns a safe baseline.
        return LiveStatus(
            captured_at=datetime.now(timezone.utc),
            phase=Phase.IDLE,
            inference=InferenceStatus(active_calls=0, max_connections=2),
            window=WindowStatus(tokens_in_window=0, window_target=64000),
            budget=BudgetStatus(
                tokens_spent=0,
                token_ceiling=1000000,
                wall_clock_s=0.0,
                wall_clock_ceiling_s=300.0,
            ),
        )
