import { useEffect } from 'react';
import { useStore } from '@/store/useStore';

/** Owns the dark/light DOM class effect and the theme keyboard shortcut. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Cmd/Ctrl+Shift+D toggles theme. Only a modifier combo is used (no bare
  // key) so the shortcut can never fire while the user is typing normal text;
  // the typing-target guard below is a defense-in-depth backstop.
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      const target = e.target;
      const isTypingTarget =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isTypingTarget) return;
      const isThemeCombo =
        (e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'd';
      if (!isThemeCombo) return;
      e.preventDefault();
      toggleTheme();
    }
    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [toggleTheme]);

  return <>{children}</>;
}
