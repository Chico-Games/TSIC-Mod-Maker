import { Toolbar } from './Toolbar';
import { Outliner } from './Outliner/Outliner';
import { DetailsPanel } from './Details/DetailsPanel';
import { Viewport } from './Viewport/Viewport';

export function LayoutsTab() {
  return (
    <div className="layouts-tab">
      <Toolbar />
      <div className="layouts-panes">
        <div className="layouts-outliner"><Outliner /></div>
        <div className="layouts-viewport"><Viewport /></div>
        <div className="layouts-details"><DetailsPanel /></div>
      </div>
    </div>
  );
}
