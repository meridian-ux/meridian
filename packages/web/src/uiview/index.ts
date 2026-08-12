// The web-components renderer surface. The framework-neutral WebRenderer seam +
// transport contracts now live in @savvifi/meridian-schemas/uiview; consumers
// import those from there. This barrel exposes the reference impl + the renderer.
export * from './renderer.js';
export * from './view_renderer.js';
export * from './web_components_renderer.js';
