import nextConfig from "eslint-config-next";

const eslintConfig = [
  ...nextConfig,
  {
    rules: {
      // v7 recommended rules: reject many legitimate patterns (reset state when a
      // dialog closes, placement effects, ref mirrors for event handlers).
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];

export default eslintConfig;
