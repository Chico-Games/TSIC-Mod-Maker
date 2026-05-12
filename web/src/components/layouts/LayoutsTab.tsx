import { Toolbar } from './Toolbar';
import { Outliner } from './Outliner/Outliner';
import { DetailsPanel } from './Details/DetailsPanel';

export function LayoutsTab() {
  return (
    <div className="layouts-tab">
      <Toolbar />
      <div className="layouts-panes">
        <div className="layouts-outliner"><Outliner /></div>
        <div className="layouts-viewport">{/* Viewport placeholder */}</div>
        <div className="layouts-details"><DetailsPanel /></div>
      </div>
    </div>
  );
}
