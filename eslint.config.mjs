import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const configuracion = [
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      'react/no-danger': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Prohibido: riesgo de XSS (diseño §7.2).',
        },
      ],
    },
  },
  {
    ignores: [
      '.next/**',
      'drizzle/**',
      'playwright-report/**',
      'test-results/**',
      'docs/**',
      'next-env.d.ts',
    ],
  },
];

export default configuracion;
