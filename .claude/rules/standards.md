# Coding Standards

Purpose: Living document of project-specific coding constraints discovered during development.

> This file captures rules that emerge from real development — corrections the user makes, patterns that work, conventions that should be followed. It starts mostly empty and grows as the project evolves.

---

## Constraint Format

Each rule follows this structure:

- **Rule:** Clear, actionable statement.
- **Rationale:** Why this rule exists (what went wrong without it).
- **Reference Implementation:** File and line number showing the correct pattern.
- **Verification:** How to check compliance.

---

## Candidate Rules

Rules discovered during development that are pending confirmation. Move to Confirmed Rules once validated across 3+ instances.

_Example: Always use parameterized queries — saw raw string interpolation cause issues in PR #12. Promote after adding semgrep rule._

---

## Confirmed Rules

### Naming Conventions

_Example: All API route files use kebab-case (e.g., `user-profiles.ts` not `userProfiles.ts`)._

### Architecture Patterns

_Example: All database queries go through the service layer — routes never call the DB directly._

### Error Handling

_Example: All API endpoints return structured error responses: `{ error: string, code: string, details?: object }`._

### Performance

_Example: All list endpoints support pagination with a default limit of 50 and a max of 200._

### Testing

_Example: All new API endpoints have at least one integration test covering the happy path._

### Frontend

_Example: Components handle loading, empty, and error states — no bare conditional renders._

### Data Layer

_Example: Migrations are reversible — every `up` has a `down`. Verify with migrate up then down._

---

## Reference Implementations

Files that exemplify the project's conventions:

| Pattern | Reference File | Notes |
|---------|---------------|-------|
| _Service with access check_ | _`services/projects.py:45`_ | _Shows access verification -> data operation -> commit pattern_ |
| _Add your canonical examples here_ | | |

---

## Verification Checklist

Before submitting code, verify:

- [ ] All confirmed rules above are followed
- [ ] No candidate rules are violated without discussion
- [ ] New patterns are documented as candidate rules
- [ ] Reference implementations are updated if patterns change
