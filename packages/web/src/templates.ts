const templateCache = new Map<string, Promise<HTMLTemplateElement>>();

export async function loadHtmlFragment(url: string): Promise<DocumentFragment> {
  if (!templateCache.has(url)) {
    const promise = fetch(url)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Template request failed: ${response.status} ${response.statusText}`);
        }
        return response.text();
      })
      .then((html) => {
        const template = document.createElement('template');
        template.innerHTML = html;
        return template;
      });
    templateCache.set(url, promise);
  }

  const template = await templateCache.get(url);
  if (!template) {
    throw new Error(`Template was not cached for URL: ${url}`);
  }
  return template.content.cloneNode(true) as DocumentFragment;
}
