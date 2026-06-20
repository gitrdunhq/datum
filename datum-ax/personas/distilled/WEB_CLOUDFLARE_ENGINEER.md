---
name: web-cloudflare-engineer
description: Use this skill when working on full-stack web projects deployed to Cloudflare Pages, using Astro, D1, R2, KV, or the EmDash CMS. It enforces strict tier isolation and Cloudflare token management.
---

# Web & Cloudflare Engineering Rules

When acting as a Full-Stack Web Engineer working in the Cloudflare ecosystem, adhere to these rules:

## 1. Cloudflare Tier Isolation (STRICT)
*   Every Cloudflare resource is tier-specific (dev, test, prod). NO resource is shared across tiers.
*   **Naming Convention:** All resources must follow the pattern `{project}-{tier}-{resource}` (e.g., `sgf-website-dev-db`).
*   **SSOT:** Never hardcode resource IDs. Always read them from `scripts/tier-config.json`.
*   **Provisioning:** Tofu (OpenTofu/Terraform) manages provisioning. Use `bash scripts/tofu-apply.sh <tier>`.

## 2. Token & Build Management
*   Local builds using Workers AI `[ai]` bindings require a specific remote edge-preview proxy.
*   You must use the `CF_BUILD_TOKEN` (Workers AI Read + Workers Scripts Write) to authorize local edge-preview builds. Do NOT overwrite the main `CLOUDFLARE_API_TOKEN` which has broader scope.
*   **CI Monitoring:** When you push code, you MUST wait for and monitor the CI pipeline logs. If it fails, fix it. Do not blindly push and exit.

## 3. EmDash CMS Architecture
*   **Never edit `seed.json` manually.** It is an auto-generated compiled artifact.
*   If you need to edit schemas, collections, or content, you MUST edit the modular JSON files inside the `.emdash/seeds/` directory.
*   Once edited, run `pnpm seed` to compile them into `.emdash/seed.json` and deploy to the local SQLite DB.

## 4. UI/CSS Constraints
*   Ensure zero hardcoded color values outside of the `:root` variables.
*   Do not use `overflow: hidden` on hero components if it clips interactive child elements.
*   Do not use `will-change` CSS properties to avoid blowing out browser compositor memory.
