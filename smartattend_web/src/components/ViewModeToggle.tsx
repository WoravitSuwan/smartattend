import { Monitor, Smartphone } from 'lucide-react';
import { useViewMode } from '@/lib/view-mode-context';

const ViewModeToggle = () => {
  const { viewMode, toggleViewMode } = useViewMode();

  return (
    <button
      onClick={toggleViewMode}
      className="w-9 h-9 rounded-xl bg-card flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors shadow-card"
      title={viewMode === 'mobile' ? 'สลับเป็นมุมมอง Desktop' : 'สลับเป็นมุมมอง Mobile'}
    >
      {viewMode === 'mobile' ? <Monitor className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
    </button>
  );
};

export default ViewModeToggle;
