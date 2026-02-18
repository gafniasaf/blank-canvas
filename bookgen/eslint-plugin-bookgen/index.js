/**
 * eslint-plugin-bookgen
 *
 * Architectural ESLint rules for BookGen Ignite Zero mode.
 *
 * Rules:
 * - no-direct-supabase-ui: Frontend must go through MCP, not raw Supabase calls
 * - no-silent-env-fallback: Reject process.env.X || default patterns
 * - no-forbidden-terms: Reject student-facing text containing banned terms
 */

const noDirectSupabaseUi = {
  meta: {
    type: "problem",
    docs: { description: "Disallow direct Supabase client usage in UI components" },
    messages: {
      noDirectSupabase: "Do not import Supabase client directly in UI components. Use MCP handlers or hooks instead.",
    },
  },
  create(context) {
    const filename = context.getFilename();
    // Only enforce in UI component files (pages, components)
    const isUiFile = /src\/(pages|components)\//.test(filename);
    if (!isUiFile) return {};

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (
          source === "@supabase/supabase-js" ||
          source.includes("supabase-client") ||
          source.includes("/supabase")
        ) {
          context.report({ node, messageId: "noDirectSupabase" });
        }
      },
    };
  },
};

const noSilentEnvFallback = {
  meta: {
    type: "problem",
    docs: { description: "Disallow silent env var fallbacks (no-fallback policy)" },
    messages: {
      noFallback: "Do not use process.env.X || default. Use requireEnv() or fail loudly. See no-fallback policy.",
    },
  },
  create(context) {
    return {
      LogicalExpression(node) {
        if (node.operator !== "||" && node.operator !== "??") return;
        const left = node.left;
        // Check if left side is process.env.SOMETHING
        if (
          left.type === "MemberExpression" &&
          left.object?.type === "MemberExpression" &&
          left.object?.object?.name === "process" &&
          left.object?.property?.name === "env"
        ) {
          const envVar = left.property?.name || "";
          // Allow documented feature flags
          const allowed = ["VITE_USE_MOCK", "VITE_ALLOW_MOCK_FALLBACK", "VITE_ENABLE_DEV", "NODE_ENV"];
          if (allowed.includes(envVar)) return;
          // Allow process.env.X || process.env.Y (alternative env vars)
          if (
            node.right.type === "MemberExpression" &&
            node.right.object?.type === "MemberExpression" &&
            node.right.object?.object?.name === "process" &&
            node.right.object?.property?.name === "env"
          ) {
            return;
          }
          context.report({ node, messageId: "noFallback" });
        }
      },
    };
  },
};

const noForbiddenTerms = {
  meta: {
    type: "problem",
    docs: { description: "Reject forbidden terminology in student-facing text" },
    messages: {
      forbiddenTerm: "Forbidden term '{{term}}' detected. Use '{{replacement}}' instead.",
    },
  },
  create(context) {
    const TERMS = {
      "cliënt": "zorgvrager",
      "client": "zorgvrager",
      "patiënt": "zorgvrager",
      "patient": "zorgvrager",
      "verpleegkundige": "zorgprofessional",
    };

    return {
      Literal(node) {
        if (typeof node.value !== "string") return;
        const lower = node.value.toLowerCase();
        for (const [term, replacement] of Object.entries(TERMS)) {
          if (lower.includes(term)) {
            context.report({
              node,
              messageId: "forbiddenTerm",
              data: { term, replacement },
            });
          }
        }
      },
      TemplateLiteral(node) {
        for (const quasi of node.quasis) {
          const lower = quasi.value.raw.toLowerCase();
          for (const [term, replacement] of Object.entries(TERMS)) {
            if (lower.includes(term)) {
              context.report({
                node: quasi,
                messageId: "forbiddenTerm",
                data: { term, replacement },
              });
            }
          }
        }
      },
    };
  },
};

module.exports = {
  rules: {
    "no-direct-supabase-ui": noDirectSupabaseUi,
    "no-silent-env-fallback": noSilentEnvFallback,
    "no-forbidden-terms": noForbiddenTerms,
  },
};

