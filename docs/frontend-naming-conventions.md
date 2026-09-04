# Frontend naming conventions

Use domain-plus-responsibility names for frontend modules and symbols. Put the
domain first so repository search can narrow quickly, then name the responsibility
the module owns.

## Rules

- Hooks use `use<Domain><Responsibility>`.
- Managers and services use `<Domain><Responsibility>`.
- Use `Vfo` and `Viewport` for state or geometry ownership.
- Use `Interaction` for input orchestration across pointer, wheel, keyboard, or
  gesture paths.
- Use `Renderer` only for drawing or render-resource ownership.
- Name files after their dominant responsibility, not one input event that
  happens to trigger it.
- Keep public re-export names aligned with their canonical implementation names.

## Prioritized backlog

1. Spectrum interaction/VFO/viewport modules: audit names that describe only a
   gesture while coordinating rendering, selection, retuning, or lifecycle.
2. Renderer boundaries: distinguish drawing hooks from overlay/resource
   lifecycle hooks and align filenames with their dominant exported symbol.
3. Public entrypoints and test helpers: remove duplicate old names and ensure
   mocks import the same canonical module path as production code.
4. Other frontend features: apply the convention when touching a module or when
   a name materially impedes search; avoid unrelated rename churn.

The first migration is the legacy frequency-drag hook to
`useSpectrumInteraction`, including
its options type and test/helper references.
