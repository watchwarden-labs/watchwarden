import React, { useState, useEffect, useRef } from 'react';
import styles from './TerminalShowcase.module.css';

const LINES = [
  { text: '$ watchwarden --check-updates', type: 'prompt' },
  { text: '[14:02:01] INFO: Scanning 12 containers...', type: 'info' },
  { text: '[14:02:03] INFO: Found update for: nginx:latest', type: 'info' },
  { text: '[14:02:04] ACTION: Performing Blue-Green update...', type: 'action' },
  { text: '[14:02:08] HEALTH: New container is READY.', type: 'health' },
  { text: '[14:02:10] DONE: Traffic switched. Zero downtime.', type: 'done' },
];

const CHAR_DELAY = 35;
const LINE_PAUSE = 600;
const RESTART_PAUSE = 3000;

export default function TerminalShowcase() {
  const [displayedLines, setDisplayedLines] = useState([]);
  const [currentLine, setCurrentLine] = useState('');
  const [lineIndex, setLineIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const timeoutRef = useRef(null);

  useEffect(() => {
    // Full sequence done — pause then restart
    if (lineIndex >= LINES.length) {
      timeoutRef.current = setTimeout(() => {
        setDisplayedLines([]);
        setCurrentLine('');
        setLineIndex(0);
        setCharIndex(0);
      }, RESTART_PAUSE);
      return;
    }

    const line = LINES[lineIndex].text;

    // Still typing current line
    if (charIndex < line.length) {
      timeoutRef.current = setTimeout(() => {
        setCurrentLine(line.slice(0, charIndex + 1));
        setCharIndex((c) => c + 1);
      }, CHAR_DELAY);
      return;
    }

    // Line complete — push to displayed, advance
    timeoutRef.current = setTimeout(() => {
      setDisplayedLines((prev) => [...prev, line]);
      setCurrentLine('');
      setLineIndex((l) => l + 1);
      setCharIndex(0);
    }, LINE_PAUSE);

    return () => clearTimeout(timeoutRef.current);
  }, [lineIndex, charIndex]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearTimeout(timeoutRef.current);
  }, []);

  return (
    <div className={styles.terminal} aria-live="polite">
      <div className={styles.terminalHeader}>
        <span className={`${styles.dot} ${styles.dotRed}`} />
        <span className={`${styles.dot} ${styles.dotYellow}`} />
        <span className={`${styles.dot} ${styles.dotGreen}`} />
      </div>
      <div className={styles.terminalBody}>
        {displayedLines.map((line, i) => (
          <div key={i} className={styles.line}>
            <span className={styles[LINES[i].type]}>{line}</span>
          </div>
        ))}
        {lineIndex < LINES.length && (
          <div className={styles.line}>
            <span className={styles[LINES[lineIndex].type]}>{currentLine}</span>
            <span className={styles.cursor} />
          </div>
        )}
      </div>
    </div>
  );
}
