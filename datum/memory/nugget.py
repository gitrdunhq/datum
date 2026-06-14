"""Nugget — single holographic memory unit.

Faithful port of NeoVertex1/nuggets memory.ts to Python/NumPy.
Uses HRR (Holographic Reduced Representations) for bounded semantic recall.

Vectors are NEVER serialized — they are rebuilt deterministically from facts
and a seeded PRNG (Mulberry32) keyed on the nugget name.
"""

from __future__ import annotations

import math
import os
import re
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timezone
from difflib import SequenceMatcher
from typing import Any

import numpy as np

from datum.memory.hrr import (
    bind,
    make_role_keys,
    make_vocab_keys,
    mulberry32,
    orthogonalize,
    seed_from_name,
    stack_and_unit_norm,
    unbind,
    unbind_batch,
)
from datum.shared.file_io import load_json, save_json
from datum.shared.logging import get_logger

logger = get_logger(__name__)


DEFAULT_SAVE_DIR = os.path.expanduser("~/.datum/memory")
SAVE_VERSION = 3

MAX_D = 131072
MIN_D = 64
MAX_BANKS = 32

_VOCAB_CHARS = [chr(c) for c in range(32, 127)]
_SPECIAL_TOKENS = ["<PAD>", "<UNK>", "<START>", "<END>"]
VOCAB = _SPECIAL_TOKENS + _VOCAB_CHARS
VOCAB_SIZE = len(VOCAB)

_CHAR2IDX: dict[str, int] = {ch: i for i, ch in enumerate(VOCAB)}
_PAD_IDX = _CHAR2IDX["<PAD>"]
_UNK_IDX = _CHAR2IDX["<UNK>"]
_START_IDX = _CHAR2IDX["<START>"]
_END_IDX = _CHAR2IDX["<END>"]

_VALID_NAME_RE = re.compile(r"^[\w][\w.-]{0,99}$")

_MAX_FACT_KEY_LEN = 256
_MAX_FACT_VALUE_LEN = 4096


def sequence_match_ratio(a: str, b: str) -> float:
    """Fuzzy string similarity via Python's SequenceMatcher (0..1)."""
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()


def _now_iso() -> str:
    """Current UTC time as ISO-8601 string."""
    return datetime.now(UTC).isoformat()


def _validate_name(name: str) -> None:
    """Validate nugget name: no path separators, no traversal."""
    if not _VALID_NAME_RE.match(name) or ".." in name:
        raise ValueError(
            f"Invalid nugget name {name!r}: must be 1-100 chars, "
            f"alphanumeric/underscore/hyphen/dot, no path separators or '..'"
        )


def _effective_fact_limit(*, capacity: int, max_facts: int) -> int:
    """Return the maximum number of facts that may be materialized in memory."""
    if max_facts > 0:
        return min(capacity, max_facts)
    return capacity


@dataclass
class Fact:
    """A single key-value fact stored in a Nugget."""

    key: str
    value: str
    hits: int = 0
    last_hit_session: str = ""
    last_recalled: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(d: dict[str, Any]) -> Fact:
        raw_key = str(d["key"])
        raw_value = str(d["value"])
        key = raw_key[:_MAX_FACT_KEY_LEN]
        value = raw_value[:_MAX_FACT_VALUE_LEN]
        if key != raw_key or value != raw_value:
            logger.warning(
                "Fact.from_dict: truncating oversized serialized fact key_len=%d value_len=%d",
                len(raw_key),
                len(raw_value),
            )
        return Fact(
            key=key,
            value=value,
            hits=d.get("hits", 0),
            last_hit_session=d.get("last_hit_session", ""),
            last_recalled=d.get("last_recalled", ""),
        )


@dataclass(frozen=True)
class RecallResult:
    """Typed result from a recall operation."""

    answer: str
    confidence: float
    margin: float
    found: bool
    key: str
    nugget_name: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class Nugget:
    """A holographic memory unit that stores key-value facts as superposed
    complex-valued vectors using HRR mathematics.

    Capacity: ``banks * sqrt(D)`` facts (approx 512 at D=16384, banks=4).
    """

    def __init__(
        self,
        name: str,
        D: int = 16384,
        banks: int = 4,
        ensembles: int = 1,
        auto_save: bool = True,
        save_dir: str | None = None,
        max_facts: int = 0,
    ) -> None:
        _validate_name(name)
        if not (MIN_D <= D <= MAX_D):
            raise ValueError(f"Invalid D={D} (must be {MIN_D}-{MAX_D})")
        if not (1 <= banks <= MAX_BANKS):
            raise ValueError(f"Invalid banks={banks} (must be 1-{MAX_BANKS})")
        self.name = name
        self.D = D
        self.banks = banks
        self.ensembles = ensembles
        self.auto_save = auto_save
        self.save_dir = save_dir or DEFAULT_SAVE_DIR
        self.max_facts = max_facts

        self._facts: dict[str, Fact] = {}

        self._capacity = int(banks * math.sqrt(D))

        self._memory_banks: list[np.ndarray] = []
        self._sent_keys: list[np.ndarray] = []
        self._role_keys: list[np.ndarray] = []
        self._vocab_keys: list[np.ndarray] = []
        self._vocab_matrix: np.ndarray | None = None
        self._fact_index: dict[str, int] = {}
        self._dirty = True
        self._pending_saves = 0
        self._save_interval = 10
        self._vocab_keys_cache: np.ndarray | None = None
        self._vocab_matrix_cache: np.ndarray | None = None

    def remember(self, key: str, value: str) -> bool:
        """Store or update a key-value fact.

        Returns True if stored, False if at capacity (fact silently dropped).
        """
        if key in self._facts:
            self._facts[key].value = value
        else:
            if self.max_facts > 0 and len(self._facts) >= self.max_facts:
                logger.debug("Nugget %r: at max_facts limit, dropping %r", self.name, key)
                return False
            if len(self._facts) >= self._capacity:
                logger.debug("Nugget %r: at HRR capacity, dropping %r", self.name, key)
                return False
            self._facts[key] = Fact(key=key, value=value)
        self._dirty = True
        if self.auto_save:
            self._pending_saves += 1
            try:
                if self._pending_saves >= self._save_interval:
                    self.save()
            except OSError:
                self._pending_saves = 0
                logger.warning("Nugget %r: auto_save failed after remember(%r)", self.name, key)
        return True

    def recall(self, query: str, session_id: str = "") -> RecallResult:
        """Recall a fact by query. Returns RecallResult with answer, confidence, margin, found, key."""
        if not self._facts:
            return RecallResult(answer="", confidence=0.0, margin=0.0, found=False, key="")

        self._ensure_built()

        tag = self._resolve_tag(query)
        if not tag:
            return RecallResult(answer="", confidence=0.0, margin=0.0, found=False, key="")

        answer = self._decode(tag)
        if answer is None:
            return RecallResult(answer="", confidence=0.0, margin=0.0, found=False, key=tag)

        decoded_value, confidence, margin = answer

        fact = self._facts.get(tag)
        if fact:
            fact.hits += 1
            fact.last_recalled = _now_iso()
            if session_id:
                fact.last_hit_session = session_id
            self._pending_saves += 1
            if self.auto_save and self._pending_saves >= self._save_interval:
                self.save()
                self._pending_saves = 0

        return RecallResult(
            answer=decoded_value,
            confidence=confidence,
            margin=margin,
            found=True,
            key=tag,
        )

    def forget(self, key: str) -> bool:
        """Remove a fact by key. Returns True if it existed."""
        if key not in self._facts:
            return False
        del self._facts[key]
        self._dirty = True
        self._rebuild()
        if self.auto_save:
            self.save()
        return True

    def facts(self) -> list[dict[str, Any]]:
        """Return list of all stored facts as dicts."""
        return [f.to_dict() for f in self._facts.values()]

    def clear(self) -> None:
        """Remove all facts."""
        self._facts.clear()
        self._dirty = True
        self._memory_banks = []
        if self.auto_save:
            self.save()

    def status(self) -> dict[str, Any]:
        """Return capacity information."""
        used = len(self._facts)
        return {
            "name": self.name,
            "D": self.D,
            "banks": self.banks,
            "capacity": self._capacity,
            "used": used,
            "available": self._capacity - used,
            "fill_pct": round(100 * used / self._capacity, 1) if self._capacity else 0,
        }

    def save(self, path: str | None = None) -> str:
        """Atomic write nugget to JSON. Uses unique temp file to avoid collisions."""
        if path is None:
            os.makedirs(self.save_dir, exist_ok=True)
            path = os.path.join(self.save_dir, f"{self.name}.nugget.json")

        payload = {
            "version": SAVE_VERSION,
            "name": self.name,
            "D": self.D,
            "banks": self.banks,
            "ensembles": self.ensembles,
            "max_facts": self.max_facts,
            "facts": [f.to_dict() for f in self._facts.values()],
            "config": {
                "auto_save": self.auto_save,
                "save_dir": self.save_dir,
            },
        }

        target_dir = os.path.dirname(path) or "."
        fd = None
        tmp_path = None
        try:
            fd, tmp_path = tempfile.mkstemp(suffix=".tmp", prefix=".nugget_", dir=target_dir)
            os.close(fd)
            fd = None
            save_json(tmp_path, payload, ensure_parent=False)
            os.replace(tmp_path, path)
            tmp_path = None
            self._pending_saves = 0
        finally:
            if fd is not None:
                os.close(fd)
            if tmp_path is not None and os.path.exists(tmp_path):
                os.unlink(tmp_path)
        return path

    def flush(self) -> None:
        """Flush any pending saves to disk."""
        if self._pending_saves > 0:
            self.save()
            self._pending_saves = 0

    @classmethod
    def load(cls, path: str, auto_save: bool = True, save_dir: str | None = None) -> Nugget:
        """Load a Nugget from a JSON file. Validates parameters.

        Args:
            path: Path to the ``.nugget.json`` file.
            auto_save: Enable auto-save after mutations.
            save_dir: Override save directory. JSON ``config.save_dir`` is
                ignored for security (untrusted input).

        Raises:
            ValueError: On invalid/corrupt JSON, missing fields, or out-of-range parameters.
        """
        try:
            data = load_json(path)
        except Exception as exc:
            raise ValueError(f"Cannot load nugget from {path}: {exc}") from exc

        loaded_version = int(data.get("version", 1))
        if loaded_version != SAVE_VERSION:
            raise ValueError(
                f"Unsupported nugget version {loaded_version} in {path}; "
                f"expected {SAVE_VERSION}. Migration required."
            )

        loaded_d = data.get("D", 16384)
        loaded_banks = data.get("banks", 4)
        if not (MIN_D <= loaded_d <= MAX_D):
            raise ValueError(f"Invalid D={loaded_d} in {path} (must be {MIN_D}-{MAX_D})")
        if not (1 <= loaded_banks <= MAX_BANKS):
            raise ValueError(f"Invalid banks={loaded_banks} in {path} (must be 1-{MAX_BANKS})")

        name = data.get("name")
        if not name:
            raise ValueError(f"Missing 'name' field in {path}")
        _validate_name(name)

        resolved_save_dir = save_dir or DEFAULT_SAVE_DIR

        nugget = cls(
            name=name,
            D=loaded_d,
            banks=loaded_banks,
            ensembles=data.get("ensembles", 1),
            auto_save=auto_save,
            save_dir=resolved_save_dir,
            max_facts=data.get("max_facts", 0),
        )

        raw_facts = data.get("facts", [])
        fact_limit = _effective_fact_limit(capacity=nugget._capacity, max_facts=nugget.max_facts)
        if len(raw_facts) > fact_limit:
            logger.warning(
                "Nugget %r: truncating %d serialized facts to %d during load",
                nugget.name,
                len(raw_facts),
                fact_limit,
            )

        for fd in raw_facts[:fact_limit]:
            nugget._facts[fd["key"]] = Fact.from_dict(fd)

        nugget._dirty = True
        return nugget

    def expire_stale(self, days: int = 30) -> list[str]:
        """Remove facts not recalled within *days* days.

        Returns list of expired keys.
        Facts with empty or unparseable timestamps are skipped (not expired).
        """
        cutoff = datetime.now(UTC).timestamp() - days * 86400
        expired: list[str] = []

        for key, fact in list(self._facts.items()):
            if not fact.last_recalled:
                continue
            try:
                recalled_ts = datetime.fromisoformat(fact.last_recalled).timestamp()
            except (ValueError, TypeError):
                logger.warning(
                    "Nugget %r: unparseable last_recalled for key %r, skipping",
                    self.name,
                    key,
                )
                continue

            if recalled_ts < cutoff:
                expired.append(key)
                del self._facts[key]

        if expired:
            self._dirty = True
            self._rebuild()
            if self.auto_save:
                self.save()

        return expired

    def _ensure_built(self) -> None:
        """Rebuild vectors if dirty."""
        if self._dirty:
            self._rebuild()

    def _rebuild(self) -> None:
        """Reconstruct all vectors deterministically from facts + seed.

        Vectors are NEVER serialized — this is the sole source of truth for
        the vector state.
        """
        if not self._facts:
            self._memory_banks = []
            self._sent_keys = []
            self._role_keys = []
            self._vocab_keys = []
            self._vocab_matrix = None
            self._fact_index = {}
            self._dirty = False
            return

        seed = seed_from_name(self.name)

        if self._vocab_keys_cache is None:
            rng_vocab = mulberry32(seed)
            # Note: vocab keys are NOT orthogonalized — random unit-phase vectors
            self._vocab_keys_cache = make_vocab_keys(VOCAB_SIZE, self.D, rng_vocab)
            self._vocab_matrix_cache = stack_and_unit_norm(self._vocab_keys_cache)
        self._vocab_keys = self._vocab_keys_cache
        self._vocab_matrix = self._vocab_matrix_cache

        rng = mulberry32(seed + VOCAB_SIZE)

        max_len = max((len(f.value) for f in self._facts.values()), default=1)
        seq_len = max_len + 2

        self._role_keys = make_role_keys(self.D, seq_len)

        num_facts = len(self._facts)
        sent_keys_arr = make_vocab_keys(num_facts, self.D, rng)
        self._sent_keys = orthogonalize(sent_keys_arr, iters=1, step=0.4)

        self._fact_index = {key: i for i, key in enumerate(self._facts.keys())}

        self._memory_banks = [np.zeros(self.D, dtype=np.complex128) for _ in range(self.banks)]

        for i, fact in enumerate(self._facts.values()):
            bank_idx = i % self.banks
            sent_key = self._sent_keys[i]

            tokens = self._tokenize(fact.value)
            for pos, tok_idx in enumerate(tokens):
                vocab_vec = self._vocab_keys[tok_idx]
                role_vec = self._role_keys[pos]
                bound = bind(bind(vocab_vec, role_vec), sent_key)
                self._memory_banks[bank_idx] = self._memory_banks[bank_idx] + bound

        self._dirty = False

    def _tokenize(self, text: str) -> list[int]:
        """Convert text to token index sequence with START/END markers."""
        tokens = [_START_IDX]
        for ch in text:
            tokens.append(_CHAR2IDX.get(ch, _UNK_IDX))
        tokens.append(_END_IDX)
        return tokens

    def _decode(self, tag: str) -> tuple[str, float, float] | None:
        """Unbind and decode a fact value by its key tag.

        Returns (decoded_value, avg_confidence, min_margin) or None.
        """
        if not self._memory_banks or not self._sent_keys:
            return None

        self._ensure_built()

        if tag not in self._fact_index:
            return None
        fact_idx = self._fact_index[tag]
        bank_idx = fact_idx % self.banks

        fact = self._facts[tag]
        sent_key = self._sent_keys[fact_idx]
        memory = self._memory_banks[bank_idx]

        tokens = self._tokenize(fact.value)
        decoded_chars: list[str] = []
        confidences: list[float] = []
        margins: list[float] = []

        content_positions = list(range(1, len(tokens) - 1))
        if not content_positions:
            return None

        role_keys_stack = np.array([self._role_keys[p] for p in content_positions])
        unbound_sent = unbind(memory, sent_key)
        unbound_all = unbind_batch(unbound_sent, role_keys_stack)
        candidates = stack_and_unit_norm(unbound_all)
        sims_all = candidates @ self._vocab_matrix.T

        for i in range(sims_all.shape[0]):
            sims = sims_all[i]
            if len(sims) >= 2:
                top2 = np.argpartition(sims, -2)[-2:]
                top2_sorted = top2[np.argsort(sims[top2])[::-1]]
                best_idx = top2_sorted[0]
                second_idx = top2_sorted[1]
            else:
                best_idx = np.argmax(sims)
                second_idx = 0

            confidence = float(sims[best_idx])
            margin = float(sims[best_idx] - sims[second_idx])

            token = VOCAB[best_idx]
            if token not in _SPECIAL_TOKENS:
                decoded_chars.append(token)
            confidences.append(confidence)
            margins.append(margin)

        decoded_value = "".join(decoded_chars)
        avg_confidence = float(np.mean(confidences)) if confidences else 0.0
        min_margin = float(np.min(margins)) if margins else 0.0

        return decoded_value, avg_confidence, min_margin

    def _resolve_tag(self, query: str) -> str:
        """3-tier tag resolution: exact -> substring -> fuzzy.

        Returns the best matching fact key, or empty string if no match.
        """
        keys = list(self._facts.keys())
        if not keys:
            return ""

        if query in self._facts:
            return query

        query_lower = query.lower()
        for k in keys:
            if k.lower() == query_lower:
                return k

        if len(query_lower) >= 2:
            matches = [k for k in keys if query_lower in k.lower()]
            if matches:
                return min(matches, key=len)

        best_key = ""
        best_ratio = 0.0
        for k in keys:
            ratio = sequence_match_ratio(query, k)
            if ratio > best_ratio:
                best_ratio = ratio
                best_key = k

        if best_ratio >= 0.5:
            return best_key

        return ""

    def __repr__(self) -> str:
        s = self.status()
        return f"Nugget({self.name!r}, D={self.D}, {s['used']}/{s['capacity']} facts)"
