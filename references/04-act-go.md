# ACT Phase — Go Overrides

Apply when language is `go`. Supplements `references/04-act.md`.

## Test Framework

**Default:** Go's built-in `testing` package with `t.Run`, `t.Error`, `t.Fatal`.

Run tests: `go test ./... -v -json` (for structured output).

## RED agent — Go specifics

Stub commit:
```go
// Stub: introduced by task-001 for downstream RED agents
package recording

type RecordingHandle struct{}

type Session interface {
    StartRecording(ctx context.Context) (*RecordingHandle, error)
}

type sessionImpl struct {
    permissionGranted bool
}

func NewSession(permissionGranted bool) Session {
    return &sessionImpl{permissionGranted: permissionGranted}
}

func (s *sessionImpl) StartRecording(ctx context.Context) (*RecordingHandle, error) {
    panic("not implemented")
}
```

Test file:
```go
package recording_test

import (
    "context"
    "testing"
    "github.com/yourorg/yourrepo/recording"
)

// SAFE-001: Never starts without permission
func TestSession_SAFE001_StartRecording_PermissionDenied(t *testing.T) {
    s := recording.NewSession(false)
    _, err := s.StartRecording(context.Background())
    if err == nil {
        t.Fatal("expected PermissionDenied error, got nil")
    }
    // The error must specifically be ErrPermissionDenied
    if !errors.Is(err, recording.ErrPermissionDenied) {
        t.Fatalf("expected ErrPermissionDenied, got: %v", err)
    }
}
```

## GREEN agent — Go specifics

Implementation in package files (never touch `_test.go` files).

The redacted signal gives error message and missing type names. Implement only what's needed:
```go
var ErrPermissionDenied = errors.New("camera permission required")

func (s *sessionImpl) StartRecording(ctx context.Context) (*RecordingHandle, error) {
    if !s.permissionGranted {
        return nil, ErrPermissionDenied
    }
    return &RecordingHandle{}, nil
}
```

## REFACTOR agent — Go specifics

- Use `slog` (stdlib, Go 1.21+) for structured logging
- Interfaces belong in the package that uses them, not defines them
- Error wrapping: `fmt.Errorf("startRecording: %w", ErrPermissionDenied)`
- Run: `go vet ./...` and `staticcheck ./...` after REFACTOR

## test_signal.py

Go test JSON output (`go test -json`) is a v1 gap. Workaround: pipe through a converter that produces Vitest-compatible JSON, then pass `--framework vitest`. Or extend test_signal.py with a `go_test` parser.
