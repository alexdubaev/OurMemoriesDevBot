---
name: teamlead-development
description: Use when implementing, changing, debugging, refactoring, or reviewing software in an existing codebase.
---

# Teamlead Development

The primary model is the lead engineer. It owns architecture, decomposition, rulings, acceptance, and final verification. It delegates discovery, implementation, and independent review.

## Repository policy takes precedence

Follow the user's task instructions and the repository's applicable `AGENTS.md` before applying this workflow. In this repository, `AGENTS.md` controls which delegation waves are allowed and bounds the review/fix/recheck cycle. The names `scout`, `worker`, and `reviewer` describe behavioral contracts; map them to available agent types only when local policy authorizes delegation. Do not assume those named agents are installed. If no authorized agent or tool can perform a role, follow repository policy or escalate rather than bypassing it. Do not repeat review loops beyond the repository's limit.

## 1. Discover

Before broad manual research, use an authorized read-only discovery agent/tool for existing-code changes unless the exact code surface is already explicitly known. A `scout` is a behavioral contract, not a requirement to spawn an unavailable role.

Read `references/scout-contract.md`.

After the scout returns, inspect only the reported relevant files first. Treat scout conclusions as leads, not truth.

## 2. Plan

Write a concrete implementation plan before edits. Divide work by independently testable outcomes, not by arbitrary files.

Each task needs:
- scope and acceptance criteria;
- relevant files/symbols;
- interfaces/dependencies;
- verification commands;
- STOP conditions.

Prefer a few meaningful tasks. Batch same-shape mechanical edits.

## 3. Implement

Prefer delegating bounded production implementation to an authorized `worker` when repository policy and available agents permit it. This skill does not authorize delegation that local policy forbids; follow the repository's implementation rules when delegation is unavailable or not allowed.

For each task:
1. record BASE SHA;
2. dispatch a fresh `worker`;
3. give only the task brief, relevant paths, worktree/branch, interfaces, constraints, and tests;
4. inspect the actual diff and verification evidence;
5. resolve integration issues before dependent tasks.

Use one worker at a time in a shared worktree. Parallelize only isolated independent work.

Read `references/worker-contract.md`.

## 4. Verify and review

After all tasks, the lead runs relevant deterministic checks and inspects `git diff`/`git status`.

When the task policy calls for independent review, use one fresh, read-only reviewer with the original spec, BASE/HEAD, active diff, and review focus. Do not give implementation reasoning. Map `reviewer` to an available authorized agent; do not assume a named custom agent is installed.

The reviewer reports findings and does not edit files or add coverage. The lead adjudicates findings and may fix bounded safe findings when allowed by repository policy.

After a permitted fix pass, perform one narrow recheck of the findings. Do not start another full review/fix loop unless the user or repository policy explicitly requires it. Escalate findings that need an architectural, security, data-model, migration, production-data, or complex concurrency decision.

P3/style-only findings do not restart the loop.

Read `references/reviewer-contract.md`.

## 5. Final gate

The lead personally verifies:
- requirements covered;
- actual diff understood;
- no unrelated scope;
- relevant checks pass;
- no unresolved P0/P1/P2;
- git status understood.

Never claim completion from a subagent report alone.
