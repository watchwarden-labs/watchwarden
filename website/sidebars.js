/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docs: [
    'getting-started',
    'comparison',
    'architecture',
    'examples',
    {
      type: 'category',
      label: 'Configuration',
      items: ['configuration/agent-env', 'configuration/controller-env', 'configuration/labels'],
    },
    {
      type: 'category',
      label: 'Operations',
      items: ['operations/security', 'operations/metrics'],
    },
    {
      type: 'category',
      label: 'Integrations',
      items: ['integrations/sdk', 'integrations/api', 'integrations/home-assistant'],
    },
    'design-decisions',
  ],
};

module.exports = sidebars;
