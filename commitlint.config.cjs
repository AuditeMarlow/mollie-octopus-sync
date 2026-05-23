// Conventional Commits, enforced by Husky's commit-msg hook locally
// and by the PR-title check in CI. Knope reads these commits to decide
// semver bumps and generate CHANGELOG entries.
module.exports = {
  extends: ["@commitlint/config-conventional"],
};
