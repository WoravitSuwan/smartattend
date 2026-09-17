import { createContext, useContext, useState, ReactNode } from 'react';

type ViewMode = 'mobile' | 'desktop';

interface ViewModeContextType {
  viewMode: ViewMode;
  toggleViewMode: () => void;
  isMobileView: boolean;
}

const ViewModeContext = createContext<ViewModeContextType>({
  viewMode: 'mobile',
  toggleViewMode: () => {},
  isMobileView: true,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem('view-mode');
    return (saved === 'desktop' ? 'desktop' : 'mobile') as ViewMode;
  });

  const toggleViewMode = () => {
    setViewMode(prev => {
      const next = prev === 'mobile' ? 'desktop' : 'mobile';
      localStorage.setItem('view-mode', next);
      return next;
    });
  };

  return (
    <ViewModeContext.Provider value={{ viewMode, toggleViewMode, isMobileView: viewMode === 'mobile' }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export const useViewMode = () => useContext(ViewModeContext);
