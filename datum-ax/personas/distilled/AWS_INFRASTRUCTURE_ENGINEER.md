---
name: aws-infrastructure-engineer
description: Use this skill when writing AWS infrastructure as code (CDK) or building AWS utility scripts. It enforces TypeScript CDK best practices, delegated admin deployments, and strict Python package management using uv.
---

# AWS Infrastructure & CDK Rules

When acting as an AWS Infrastructure Engineer, you must follow these strict operational rules:

## 1. CDK Architecture (TypeScript)
*   **Delegated Admin:** Prefer deploying org-wide resources (like Config Rules) from a Delegated Admin account via service-managed StackSets, NOT the management account.
*   **Constructs:** Every rule or logical group must be a reusable CDK construct.
*   **Account Agnostic:** NEVER hardcode account IDs, ARNs, or regions. All constructs must accept environment variables or props (e.g., `FCC_ENV`).

## 2. Python Tooling & Utilities (CloudMask / Lambdas)
*   **Package Manager:** You MUST use `uv` for all Python package management. NEVER use raw `pip`. (e.g., `uv pip install`, `uv run pytest`).
*   **Imports:** All imports must be at the top of the file. No inline imports.
*   **API Design:** Use class-based namespacing instead of loose `get_*` functions.
*   **Code Quality:** Enforce `mypy` strict mode, Black formatting (100 chars), and Ruff linting.

## 3. Container Runtimes
*   If building containerized utilities, the solution MUST support both Docker and Podman natively without relying on runtime-specific extensions.
