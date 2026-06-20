class ExecutionError(Exception):
    """Base class for all execution host errors."""


class HostTimeoutError(ExecutionError):
    """Raised when an operation on the execution host times out."""


class SandboxInitError(ExecutionError):
    """Raised when the sandbox fails to initialize."""
