/**
 * Interpolate simple {{variable}} placeholders in a template string.
 */
export function interpolateTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/**
 * Parse an image reference into components for link template rendering.
 * "nginx:latest" -> { registry: "docker.io", repository: "library/nginx", tag: "latest", owner: "library", name: "nginx" }
 * "ghcr.io/owner/repo:v1" -> { registry: "ghcr.io", repository: "owner/repo", tag: "v1", owner: "owner", name: "repo" }
 */
export function parseImageComponents(image: string): Record<string, string> {
  let registry = 'docker.io';
  let remainder = image;

  // Strip digest
  const atIdx = remainder.indexOf('@');
  if (atIdx > 0) remainder = remainder.substring(0, atIdx);

  // Extract tag
  let tag = 'latest';
  const colonIdx = remainder.lastIndexOf(':');
  if (colonIdx > 0 && !remainder.substring(colonIdx).includes('/')) {
    tag = remainder.substring(colonIdx + 1);
    remainder = remainder.substring(0, colonIdx);
  }

  // Extract registry (contains a dot or colon)
  const firstSlash = remainder.indexOf('/');
  if (firstSlash > 0) {
    const prefix = remainder.substring(0, firstSlash);
    if (prefix.includes('.') || prefix.includes(':')) {
      registry = prefix;
      remainder = remainder.substring(firstSlash + 1);
    }
  }

  // Docker Hub official images: "nginx" -> "library/nginx"
  const repository = remainder.includes('/') ? remainder : `library/${remainder}`;
  const parts = repository.split('/');
  const owner = parts[0] ?? '';
  const name = parts.slice(1).join('/') || (parts[0] ?? '');

  return { registry, repository, tag, owner, name, image };
}

/** Built-in link templates by registry */
const BUILT_IN_LINK_TEMPLATES: Record<string, string> = {
  'docker.io': 'https://hub.docker.com/r/{{repository}}/tags?name={{tag}}',
  'ghcr.io': 'https://github.com/{{owner}}/{{name}}/pkgs/container/{{name}}',
  'quay.io': 'https://quay.io/repository/{{repository}}?tab=tags',
};

/**
 * Render a link for a container image using the configured link template.
 * Returns the URL string, or empty string if no template matches.
 */
export function renderImageLink(image: string, linkTemplate: string | null): string {
  if (!linkTemplate) return '';
  const components = parseImageComponents(image);

  if (linkTemplate === 'auto') {
    const registry = components.registry ?? '';
    const builtin = BUILT_IN_LINK_TEMPLATES[registry];
    if (!builtin) return '';
    return interpolateTemplate(builtin, components);
  }

  return interpolateTemplate(linkTemplate, components);
}
