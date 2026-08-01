import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      // Mã sinh tự động không bao giờ lint — nó sinh ra từ schema của Proxmox,
      // sửa theo ý lint là mất ngay ở lần sinh lại kế tiếp.
      'packages/pve-api/src/generated/**',
      'packages/pve-schema/generated/**',
      // Bản tải về nguyên trạng từ Proxmox: 4.2 MB, phần lớn là mã ExtJS của
      // trang API viewer. Không phải mã của dự án này.
      'packages/pve-schema/raw/**',
      'apps/mock-server/tls/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },

  // Renderer: React, chạy trong trình duyệt sandbox.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Renderer không có Node. Chặn ngay ở tầng lint thay vì đợi lỗi lúc chạy.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process', 'electron'],
              message:
                'Renderer chạy sandbox, không có Node. Hãy thêm việc cần làm vào main rồi gọi qua window.pve.',
            },
          ],
        },
      ],
    },
  },

  // Main và preload: Node.
  {
    files: ['apps/desktop/src/main/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
