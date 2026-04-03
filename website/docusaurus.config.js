// @ts-check

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'WatchWarden',
  tagline: 'Zero-Downtime Docker Updates. Automated. Safe. Visual.',
  favicon: 'img/favicon.ico',

  url: 'https://watchwarden-labs.github.io',
  baseUrl: '/watchwarden/',

  organizationName: 'watchwarden-labs',
  projectName: 'watchwarden',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/watchwarden-labs/watchwarden/tree/main/website/',
        },
        blog: {
          showReadingTime: true,
          onInlineAuthors: 'ignore',
          editUrl: 'https://github.com/watchwarden-labs/watchwarden/tree/main/website/',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: true,
      },

      navbar: {
        title: 'WatchWarden',
        logo: {
          alt: 'WatchWarden Logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docs',
            position: 'left',
            label: 'Docs',
          },
          { to: '/blog', label: 'Blog', position: 'left' },
          {
            href: 'https://github.com/watchwarden-labs/watchwarden',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },

      footer: {
        style: 'dark',
        links: [
          {
            title: 'Documentation',
            items: [
              { label: 'Getting Started', to: '/docs/getting-started' },
              { label: 'Configuration', to: '/docs/configuration/agent-env' },
              { label: 'Architecture', to: '/docs/architecture' },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'GitHub Issues',
                href: 'https://github.com/watchwarden-labs/watchwarden/issues',
              },
              {
                label: 'GitHub Discussions',
                href: 'https://github.com/watchwarden-labs/watchwarden/discussions',
              },
            ],
          },
          {
            title: 'More',
            items: [
              { label: 'Blog', to: '/blog' },
              {
                label: 'GitHub Packages',
                href: 'https://github.com/orgs/watchwarden-labs/packages',
              },
            ],
          },
        ],
        copyright: `Copyright ${new Date().getFullYear()} WatchWarden. Built with Docusaurus.`,
      },

      prism: {
        theme: require('prism-react-renderer').themes.github,
        darkTheme: require('prism-react-renderer').themes.dracula,
        additionalLanguages: ['bash', 'yaml', 'go', 'json'],
      },
    }),
};

module.exports = config;
