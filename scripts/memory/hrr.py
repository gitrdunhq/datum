"""HRR (Holographic Reduced Representations) math primitives.

Faithful port of NeoVertex1/nuggets core.ts to Python/NumPy.
All vectors are complex128 numpy arrays (unit-magnitude phases).
"""

from __future__ import annotations

from typing import Callable

import numpy as np

ComplexVector = np.ndarray


def seed_from_name(name: str) -> int:
    """Convert a name string to a deterministic 32-bit seed.

    Encodes *name* to UTF-8, pads to 8 bytes, then combines the first 4 bytes
    as a little-endian uint32.
    """
    raw = name.encode("utf-8")
    padded = (raw + b"\x00" * 8)[:8]
    seed = int.from_bytes(padded[:4], byteorder="little", signed=False)
    return seed


def _to_int32(x: int) -> int:
    """Emulate JavaScript ``(x) | 0`` -- truncate to signed 32-bit integer."""
    x = x & 0xFFFFFFFF
    if x >= 0x80000000:
        return x - 0x100000000
    return x


def _to_uint32(x: int) -> int:
    """Truncate to unsigned 32-bit integer."""
    return x & 0xFFFFFFFF


def _math_imul(a: int, b: int) -> int:
    """Emulate JavaScript ``Math.imul(a, b)`` -- C-like 32-bit multiply."""
    a = a & 0xFFFFFFFF
    b = b & 0xFFFFFFFF
    result = (a * b) & 0xFFFFFFFF
    if result >= 0x80000000:
        return result - 0x100000000
    return result


def mulberry32(seed: int) -> Callable[[], float]:
    """Return a Mulberry32 PRNG closure producing floats in [0, 1).

    Implements the standard Mulberry32 algorithm, matching the TypeScript::

        function mulberry32(seed) {
            let s = seed | 0;
            return () => {
                s = (s + 0x6d2b79f5) | 0;
                let t = Math.imul(s ^ (s >>> 15), 1 | s);
                t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
                return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
            };
        }

    The returned callable also exposes a ``.batch(count)`` method that
    generates *count* values using vectorised numpy uint32 arithmetic —
    identical output to calling the closure *count* times sequentially, but
    orders of magnitude faster for large counts.
    """
    state = [_to_int32(seed)]

    def _next() -> float:
        s = _to_int32(state[0] + 0x6D2B79F5)
        state[0] = s

        s_u = _to_uint32(s)

        t = _math_imul(s ^ (s_u >> 15), _to_int32(1 | s_u))

        t_u = _to_uint32(t)
        imul_val = _math_imul(t ^ (t_u >> 7), _to_int32(61 | t_u))
        t = _to_int32(t + imul_val) ^ t

        t_u = _to_uint32(t)
        return _to_uint32(t ^ (t_u >> 14)) / 0x100000000

    def _batch(count: int) -> np.ndarray:
        """Generate *count* values via vectorised numpy uint32 arithmetic.

        Since state_i = state_0 + i * DELTA (mod 2**32), all intermediate
        states form an arithmetic sequence and can be computed at once.
        The mixing function is then applied element-wise.  The closure state
        is advanced by *count* steps so sequential calls remain consistent.
        """
        DELTA = np.uint64(0x6D2B79F5)
        MASK = np.uint64(0xFFFFFFFF)

        cur = np.uint64(_to_uint32(state[0]))
        indices = np.arange(1, count + 1, dtype=np.uint64)
        s_arr = ((cur + indices * DELTA) & MASK).astype(np.uint32)
        state[0] = _to_int32(int((cur + np.uint64(count) * DELTA) & MASK))

        s_u64 = s_arr.astype(np.uint64)
        t = (
            (s_arr ^ (s_arr >> np.uint32(15))).astype(np.uint64) * (np.uint64(1) | s_u64) & MASK
        ).astype(np.uint32)
        t_u64 = t.astype(np.uint64)
        inner = (t ^ (t >> np.uint32(7))).astype(np.uint64) * (np.uint64(61) | t_u64) & MASK
        t = ((t_u64 + inner) & MASK).astype(np.uint32) ^ t
        return (t ^ (t >> np.uint32(14))).astype(np.float64) / 4294967296.0

    _next.batch = _batch  # type: ignore[attr-defined]
    return _next


def make_vocab_keys(V: int, D: int, rng: Callable[[], float]) -> np.ndarray:
    """Generate *V* random unit-magnitude complex vectors of dimension *D*.

    Each element has magnitude 1 and a random phase drawn from ``rng``.
    Uses ``.batch()`` when available (mulberry32 closures) for a vectorised
    numpy path that is orders of magnitude faster than calling rng() V*D times.
    """
    count = V * D
    if hasattr(rng, "batch"):
        raw = rng.batch(count)  # type: ignore[attr-defined]
    else:
        raw = np.fromiter((rng() for _ in range(count)), dtype=np.float64, count=count)
    vecs = np.exp(1j * (raw * (2.0 * np.pi)).reshape(V, D)).astype(np.complex128)
    return vecs


def make_role_keys(D: int, L: int) -> np.ndarray:
    """Generate *L* deterministic role keys from angular progression.

    Role key *k* has phase ``2 * pi * k * d / D`` at dimension index *d*.
    Returns an (L, D) complex128 ndarray.
    """
    d_idx = np.arange(D, dtype=np.float64)
    k_idx = np.arange(L, dtype=np.float64)
    phases = 2.0 * np.pi * k_idx[:, np.newaxis] * d_idx[np.newaxis, :] / D
    return np.exp(1j * phases).astype(np.complex128)


def orthogonalize(
    keys: list[np.ndarray] | np.ndarray,
    iters: int = 1,
    step: float = 0.4,
) -> list[np.ndarray]:
    """Gram-Schmidt-like decorrelation projected back to unit phase.

    For small key sets (n <= 32) uses the original sequential pairwise loop.
    For larger sets uses a vectorised matrix approximation: compute the full
    Gram matrix, zero the diagonal, and subtract ``step * G @ K`` in one
    shot.  This is semantically equivalent to one Jacobi sweep when vectors
    are already nearly orthogonal (the typical HRR case), and is orders of
    magnitude faster for n > ~50.
    """
    if isinstance(keys, np.ndarray):
        keys = list(keys)
    n = len(keys)
    if n == 0:
        return []

    D = len(keys[0])

    if n <= 32:
        ks = [k.copy() for k in keys]
        for _ in range(iters):
            for i in range(n):
                for j in range(i + 1, n):
                    dot = np.vdot(ks[j], ks[i]) / D
                    ks[i] = ks[i] - step * dot * ks[j]
                    dot2 = np.vdot(ks[i], ks[j]) / D
                    ks[j] = ks[j] - step * dot2 * ks[i]
            for i in range(n):
                mag = np.abs(ks[i])
                ks[i] = (ks[i] / np.maximum(mag, 1e-30)).astype(np.complex128)
        return ks

    K = np.array(keys, dtype=np.complex128)
    for _ in range(iters):
        G = (K @ K.conj().T) / D
        np.fill_diagonal(G, 0.0)
        K = K - step * (G @ K)
        mag = np.abs(K)
        K = (K / np.maximum(mag, 1e-30)).astype(np.complex128)
    return list(K)


def sharpen(z: np.ndarray, p: float = 1.0, eps: float = 1e-12) -> np.ndarray:
    """Magnitude-sharpening nonlinearity: ``z_out = z * (|z| + eps)^(p-1)``.

    Preserves phase while scaling magnitude by ``|z|^(p-1)``, making large
    components relatively larger and small components relatively smaller.
    """
    mag = np.abs(z)
    scale = np.power(mag + eps, p - 1.0)
    return (z * scale).astype(np.complex128)


def corvacs_lite(z: np.ndarray, a: float = 0.0) -> np.ndarray:
    """Gentle magnitude limiter: ``z_out = z * tanh(a * |z|) / |z|``.

    When ``a == 0``, returns a copy of the input (passthrough). Preserves phase
    while soft-clipping magnitudes to prevent any single component from dominating.
    """
    if a == 0.0:
        return z.copy()
    mag = np.abs(z)
    safe_mag = np.where(mag < 1e-12, 1.0, mag)
    scale = np.tanh(a * mag) / safe_mag
    return (z * scale).astype(np.complex128)


def softmax_temp(sims: np.ndarray, T: float = 1.0) -> np.ndarray:
    """Temperature-scaled softmax over a real-valued similarity vector.

    Lower *T* sharpens the distribution; higher *T* flattens it.

    Raises:
        ValueError: If T <= 0 (would produce NaN from division by zero).
    """
    if T <= 0:
        raise ValueError(f"Temperature must be positive, got {T}")
    sims_real = np.real(sims).astype(np.float64)
    scaled = sims_real / T
    shifted = scaled - np.max(scaled)
    exps = np.exp(shifted)
    return exps / np.sum(exps)


def stack_and_unit_norm(keys) -> np.ndarray:
    """Convert complex keys to (N, 2D) real array with unit row norms.

    Accepts an (N, D) complex128 ndarray or a list of 1D complex arrays.
    Returns an (N, 2D) float64 ndarray where each row is unit-normalized.
    """
    if isinstance(keys, list):
        K = np.array(keys, dtype=np.complex128)
    else:
        K = np.asarray(keys, dtype=np.complex128)
    if K.ndim == 1:
        K = K[np.newaxis, :]
    real_imag = np.column_stack([K.real, K.imag])
    norms = np.linalg.norm(real_imag, axis=1, keepdims=True)
    norms = np.maximum(norms, 1e-12)
    return real_imag / norms


def bind(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Bind two complex vectors via element-wise multiplication."""
    return (a * b).astype(np.complex128)


def unbind(m: np.ndarray, key: np.ndarray) -> np.ndarray:
    """Unbind a key from a memory trace: ``m * conj(key)``."""
    return (m * np.conj(key)).astype(np.complex128)


def unbind_batch(m: np.ndarray, keys: np.ndarray) -> np.ndarray:
    """Unbind multiple keys from a memory trace at once.

    Args:
        m: (D,) complex128 memory trace
        keys: (L, D) complex128 key matrix

    Returns:
        (L, D) complex128 unbound vectors
    """
    return (m[np.newaxis, :] * np.conj(keys)).astype(np.complex128)
