# Git and GitHub settings

## Observed bootstrap state

- Canonical repository: `alexdubaev/OurMemoriesDevBot`
- Fetch/push origin: `https://github.com/alexdubaev/OurMemoriesDevBot.git`
- Default branch: `main`
- First push: `f2731e02547fb1118e233c99c47b4ec7c5fc8ba6` was pushed to an empty remote without force.
- Template comparison remote: `vibe-template` fetches `https://github.com/di-sukharev/vibe.git`; its push URL is disabled.

## GitHub verification

At bootstrap, the remote was readable and empty. Push permission was confirmed by the first normal push. Branch protections, Actions permissions, and repository-plan limits have not been read back from GitHub and must not be represented as enabled.

The `verify-required` status may be made required on `main` only after the pull-request workflow has produced that exact successful status at least once. The owner or assigned integrator must then confirm the resulting protection settings in GitHub.

No production deploy, automatic merge, webhook registration, or cloud resource creation is configured by this block.
