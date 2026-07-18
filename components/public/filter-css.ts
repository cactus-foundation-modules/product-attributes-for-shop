import type { Breakpoints } from '@/modules/shop/lib/breakpoints'

// Filter panel stylesheet, emitted once by the grid surface alongside shop's own
// shopCardCss. Class prefix `pat-`. Colours are tokens only, so the panel tracks
// the site's light/dark theme with no second palette to keep in step. Media
// queries can't read CSS custom properties, so the site's own breakpoints are
// baked in at render time - same approach as the shop's grids.
export function attributeFilterCss({ tabletBp, mobileBp }: Breakpoints): string {
  return `
.pat-wrap{display:grid;gap:28px;margin-top:8px}
.pat-pos-left{grid-template-columns:minmax(180px,220px) 1fr;align-items:start}
.pat-pos-top{grid-template-columns:1fr}
.pat-filters{display:flex;flex-direction:column;gap:18px}
.pat-pos-top .pat-filters{flex-direction:row;flex-wrap:wrap;gap:24px;align-items:flex-start;padding-bottom:20px;border-bottom:1px solid var(--color-border)}
.pat-filters-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.pat-pos-top .pat-filters-head{flex:1 0 100%}
.pat-filters-title{font-family:var(--display-family,Georgia,serif);font-size:18px;font-weight:600;margin:0;color:var(--color-fg);line-height:1.2}
.pat-clear{border:0;background:none;padding:0;font-size:13px;font-weight:600;color:var(--color-primary);cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.pat-clear:hover{opacity:.8}
.pat-group{border:0;padding:0;margin:0;min-width:0}
.pat-legend{padding:0;margin:0 0 8px;font-size:13px;font-weight:600;color:var(--color-fg)}
.pat-ticks{display:flex;flex-direction:column;gap:7px}
.pat-pos-top .pat-ticks{flex-direction:row;flex-wrap:wrap;gap:14px}
.pat-tick{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--color-text);cursor:pointer;line-height:1.3}
.pat-tick input{accent-color:var(--color-primary);cursor:pointer;flex:none}
.pat-tick:hover{color:var(--color-fg)}
.pat-count{margin-left:auto;font-size:12px;color:var(--color-text-muted);font-variant-numeric:tabular-nums}
.pat-pos-top .pat-count{margin-left:0}
.pat-select{width:100%;padding:7px 10px;font-size:14px;color:var(--color-text);background:var(--color-surface);border:1px solid var(--color-border);border-radius:8px}
.pat-pos-top .pat-select{width:auto;min-width:10rem}
.pat-swatches{display:flex;flex-wrap:wrap;gap:8px}
.pat-swatch{display:inline-flex;align-items:center;gap:7px;padding:5px 10px 5px 6px;font-size:13px;color:var(--color-text);background:var(--color-surface);border:1px solid var(--color-border);border-radius:999px;cursor:pointer;line-height:1}
.pat-swatch:hover{border-color:var(--color-text-muted)}
.pat-swatch.is-on{border-color:var(--color-primary);box-shadow:0 0 0 1px var(--color-primary) inset;color:var(--color-fg);font-weight:600}
.pat-swatch-dot{width:14px;height:14px;border-radius:999px;border:1px solid var(--color-border);flex:none}
.pat-images{display:flex;flex-wrap:wrap;gap:10px}
.pat-image{display:flex;flex-direction:column;align-items:center;gap:5px;width:64px;padding:0;border:0;background:none;cursor:pointer;font:inherit;color:var(--color-text);line-height:1.2}
.pat-image-pic{width:56px;height:56px;object-fit:cover;display:block;border-radius:8px;border:1px solid var(--color-border);background:var(--color-bg-subtle)}
.pat-image-blank{border-style:dashed}
.pat-image:hover .pat-image-pic{border-color:var(--color-text-muted)}
.pat-image.is-on .pat-image-pic{border-color:var(--color-primary);box-shadow:0 0 0 2px var(--color-primary)}
.pat-image.is-on{color:var(--color-fg);font-weight:600}
.pat-image-label{font-size:12px;text-align:center;overflow-wrap:anywhere}
.pat-empty{margin:24px 0 0;font-size:14px;color:var(--color-text-muted)}
@media (max-width:${tabletBp}){
  .pat-pos-left{grid-template-columns:1fr}
  .pat-pos-left .pat-filters{flex-direction:row;flex-wrap:wrap;gap:20px;padding-bottom:18px;border-bottom:1px solid var(--color-border)}
  .pat-pos-left .pat-filters-head{flex:1 0 100%}
  .pat-pos-left .pat-ticks{flex-direction:row;flex-wrap:wrap;gap:14px}
  .pat-pos-left .pat-count{margin-left:0}
  .pat-pos-left .pat-select{width:auto;min-width:10rem}
}
@media (max-width:${mobileBp}){
  .pat-wrap{gap:20px}
  .pat-filters{gap:14px}
}
`
}
