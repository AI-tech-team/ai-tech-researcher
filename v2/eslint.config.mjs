import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 一回限りのデータ投入/移行スクリプト（アプリ本体ではない）
    "insert_300_seeds.ts",
    "insert_precise_seeds.ts",
    "insert_user_keywords.ts",
    "update_latest_seeds.ts",
    "refresh_all.ts",
    "migrate_data.ts",
    "test_models.ts",
  ]),
  {
    rules: {
      // catch節・JSON解析・AI SDKメタデータ等で意図的にanyを多用しているため無効化
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);

export default eslintConfig;
