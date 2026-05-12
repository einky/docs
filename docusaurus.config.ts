import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'einky',
  tagline: 'A portable e-ink console for visual novels and narrative games',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.einky.fr',
  baseUrl: '/',

  organizationName: 'einky',
  projectName: 'docs',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/einky/docs/tree/main/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/favicon.ico',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'einky',
      logo: {
        alt: 'einky Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/einky',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/prerequisites'},
            {label: 'Developer onboarding', to: '/docs/getting-started/developers'},
            {label: 'Architecture', to: '/docs/architecture/overview'},
          ],
        },
        {
          title: 'Organization',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/einky',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} einky. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
