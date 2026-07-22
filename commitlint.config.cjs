module.exports = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-empty": [2, "never"],
    "scope-enum": [2, "always", ["frontend", "docs", "deps", "config", "ci", "release"]],
    "subject-max-length": [2, "always", 71],
    "subject-case": [0, "always", "sentence-case"],
  },
};
