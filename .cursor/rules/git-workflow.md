# Git Branching Rule

## Objective
To protect the production environment, the AI agent must NEVER make code edits or run tasks while the workspace is sitting directly on the `main` branch.

## Enforcement Steps for the Agent
1. **Check Current Branch:** Before executing any file edits, generating code, or running terminal commands, look at the active Git branch.
2. **Branch Restriction:** If the active branch is `main`, STOP immediately. Do not modify any files.
3. **Automated Fix:** - Ask the user for a feature name, or automatically generate a clean branch name based on the task (e.g., `feat/add-login-button`).
   - Run `git checkout -b <branch-name>` via the terminal tool to move off `main`.
4. **Resuming Work:** Only proceed with editing files once you are safely verified on a separate feature branch.