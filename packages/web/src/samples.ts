// Sample Jenkinsfiles bundled from /fixtures (handwritten + real public ones).
const files = import.meta.glob('../../../fixtures/*/*.Jenkinsfile', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export const SAMPLES = Object.entries(files)
  .map(([path, text]) => ({ name: path.replace(/^.*fixtures\//, '').replace(/\.Jenkinsfile$/, ''), text }))
  .sort((a, b) => a.name.localeCompare(b.name));
