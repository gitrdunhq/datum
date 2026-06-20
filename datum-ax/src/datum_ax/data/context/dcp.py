import uuid

from datum_ax.contracts.tokens import default_token_count as _count


class DynamicContextPruner:
    """Active context management (ADR-0021). Replaces large/stale content with placeholders.

    Implements the `contracts.context.ContextPruner` port; the original is kept in `ledger` for
    retrieval. Uses the single shared token counter (ADR-0030).
    """

    def __init__(self, soft_high_water: float = 0.65, soft_low_water: float = 0.40):
        self.high_water = soft_high_water
        self.low_water = soft_low_water
        self.ledger: dict[str, str] = {}

    def prune_suffix(self, suffix: tuple[str, ...], budget_max: int, current_total_tokens: int) -> tuple[str, ...]:
        """Prunes items in the suffix if the high watermark is exceeded."""
        high_water_limit = int(budget_max * self.high_water)
        low_water_limit = int(budget_max * self.low_water)

        if current_total_tokens <= high_water_limit:
            return suffix

        pruned = list(suffix)
        tokens = current_total_tokens

        # Try replacing the largest items in the suffix with placeholders until below low_water
        items_with_idx = sorted(
            [(i, _count(t), t) for i, t in enumerate(pruned)],
            key=lambda x: x[1],
            reverse=True,
        )

        for i, token_count, text in items_with_idx:
            if tokens <= low_water_limit:
                break
            
            # Don't prune small things
            if token_count < 20:
                continue

            # Create placeholder
            key = f"placeholder_{uuid.uuid4().hex[:8]}"
            self.ledger[key] = text
            placeholder = f"[{key}: Content pruned. {token_count} tokens omitted.]"
            
            pruned[i] = placeholder
            tokens = tokens - token_count + _count(placeholder)

        return tuple(pruned)
