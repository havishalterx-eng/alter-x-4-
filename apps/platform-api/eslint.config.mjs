import tseslint from "typescript-eslint";

export const noRawEngineHttpRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require Engine HTTP access to use the typed client in src/engine",
    },
    messages: {
      rawEngineHttp:
        "Raw Engine HTTP access forbidden. Use EngineClient from src/engine.",
    },
    schema: [],
  },
  create(context) {
    const filename = context.getFilename().replaceAll("\\", "/");
    if (
      filename.includes("/src/engine/") ||
      filename.includes("/src/identity/adapters/auth0/") ||
      filename.includes("/src/integrations/adapters/oauth/") ||
      filename.includes("/src/planner-facade/")
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "fetch"
        ) {
          context.report({ node, messageId: "rawEngineHttp" });
        }
      },
      ImportDeclaration(node) {
        if (
          ["axios", "node:http", "node:https", "http", "https"].includes(
            node.source.value,
          )
        ) {
          context.report({ node, messageId: "rawEngineHttp" });
        }
      },
      MemberExpression(node) {
        const source = context.sourceCode.getText(node);
        if (
          source === "process.env.ENGINE_BASE_URL" &&
          !(
            node.parent.type === "AssignmentExpression" &&
            node.parent.left === node
          )
        ) {
          context.report({ node, messageId: "rawEngineHttp" });
        }
      },
    };
  },
};

export default tseslint.config(
  {
    ignores: ["dist", "coverage", ".next"],
  },
  ...tseslint.configs.recommended,
  {
    plugins: {
      "alterx-boundaries": {
        rules: {
          "no-raw-engine-http": noRawEngineHttpRule,
        },
      },
    },
    rules: {
      "alterx-boundaries/no-raw-engine-http": "error",
    },
  },
);
