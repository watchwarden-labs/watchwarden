/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'getting-started',
    'comparison',
    'architecture',
    {
      type: 'category',
      label: 'Configuration',
      items: [
        'configuration/agent-env',
        'configuration/controller-env',
        'configuration/labels',
      ],
    },
  ],
};

module.exports = sidebars;
