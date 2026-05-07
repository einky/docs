import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Inky',
  tagline: 'A portable e-ink console for visual novels and narrative games',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.inky.top',
  baseUrl: '/',

  organizationName: 'Crab-Ink-gaming',
  projectName: 'crab-ink',

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
          editUrl: 'https://github.com/Crab-Ink-gaming/crab-ink/tree/main/docs/',
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
      title: 'Inky',
      logo: {
        alt: 'Inky Logo',
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
          href: 'https://github.com/Crab-Ink-gaming',
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
            {label: 'Architecture', to: '/docs/architecture/overview'},
            {label: 'Roadmap', to: '/docs/roadmap'},
          ],
        },
        {
          title: 'Organization',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/Crab-Ink-gaming',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Crab-Ink-Gaming. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
