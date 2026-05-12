import { Toolbar } from './Toolbar';

export function LayoutsTab() {
  return (
    <div className="layouts-tab">
      <Toolbar />
      <div className="layouts-panes">
        <div className="layouts-outliner">{/* Outliner placeholder */}</div>
        <div className="layouts-viewport">{/* Viewport placeholder */}</div>
        <div className="layouts-details">{/* Details placeholder */}</div>
      </div>
    </div>
  );
}
