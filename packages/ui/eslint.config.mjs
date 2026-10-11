import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

// A component library, not an app: there is no pages/ directory to check links against.
export default defineConfig([...nextVitals, ...nextTs, { rules: { '@next/next/no-html-link-for-pages': 'off' } }, globalIgnores(['node_modules/**'])]);
