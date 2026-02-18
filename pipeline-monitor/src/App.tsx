import { useState, useEffect } from 'react'
import './App.css'

interface Section {
  id: string;
  title: string;
  units: { total: number; completed: number };
}

interface Chapter {
  number: number;
  sections: Section[];
  status: 'in_progress' | 'completed';
  totalUnits: number;
  completedUnits: number;
  durationMinutes: number | null;
  progress: number;
}

interface ETA {
  time: string;
  remainingMinutes: number;
  unitsPerMinute: string;
}

interface BookChapter {
  number: number;
  sectionCount: number;
}

interface BookStructure {
  title: string;
  chapters: BookChapter[];
}

interface PassFile {
  chapter: number;
  size: string;
}

interface PipelineStatus {
  pass1: { completed: PassFile[]; };
  pass2: { completed: PassFile[]; };
  assembled: { completed: boolean; size?: string };
  pdf: { completed: boolean; size?: string };
}

interface LogError {
  text: string;
  chapter?: number;
}

interface Status {
  chapters: Chapter[];
  bookProgress: number;
  chaptersCompleteCount: number;
  lastLines: string[];
  errors: LogError[];
  warnings: LogError[];
  currentActivity: string | null;
  pipelineStatus: PipelineStatus;
  bookStructure: BookStructure | null;
  timestamp: string;
  eta: ETA | null;
  elapsedMinutes: number;
}

function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('http://localhost:3001/api/status');
        const data = await res.json();
        setStatus(data);
        setError(null);
      } catch {
        setError('Connection failed');
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="app-error">
        <h1>⚠️ {error}</h1>
        <p>Run: <code>node server.js</code></p>
      </div>
    );
  }

  if (!status) {
    return <div className="app-loading">⏳ Loading...</div>;
  }

  const current = status.chapters.find(c => c.status === 'in_progress');
  const section = current?.sections[current.sections.length - 1];
  const done = status.chaptersCompleteCount ?? status.chapters.filter(c => c.status === 'completed').length;
  const totalChapters = status.bookStructure?.chapters?.length || 32;
  
  // Progress circle calculations
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (status.bookProgress / 100) * circumference;

  const formatTime = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${h}:${String(m).padStart(2, '0')}`;
  };

  return (
    <div className="dashboard">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-icon">📚</div>
            <span>{status.bookStructure?.title || 'Book Generation'}</span>
          </div>
          <div className="status-badge">
            <div className="status-dot"></div>
            Building
          </div>
        </div>
        <div className="header-right">
          <div className="time">{new Date(status.timestamp).toLocaleTimeString()}</div>
        </div>
      </header>

      {/* Main Content */}
      <main className="main">
        {/* Left Panel - Progress */}
        <div className="progress-panel">
          <div className="card">
            <div className="card-header">Overall Progress</div>
            <div className="card-body">
              <div className="progress-circle-container">
                <div className="progress-circle">
                  <svg viewBox="0 0 140 140">
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#6366f1"/>
                        <stop offset="100%" stopColor="#8b5cf6"/>
                      </linearGradient>
                    </defs>
                    <circle className="progress-bg" cx="70" cy="70" r={radius}/>
                    <circle 
                      className="progress-fg" 
                      cx="70" cy="70" r={radius}
                      strokeDasharray={circumference}
                      strokeDashoffset={progressOffset}
                    />
                  </svg>
                  <div className="progress-value">
                    <div className="progress-pct">{status.bookProgress}%</div>
                    <div className="progress-label">Complete</div>
                  </div>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-box">
                  <div className="stat-value purple">{formatTime(status.elapsedMinutes)}</div>
                  <div className="stat-label">Elapsed</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value green">
                    {status.eta ? formatTime(status.eta.remainingMinutes) : '--:--'}
                  </div>
                  <div className="stat-label">Remaining</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value">{done}/{totalChapters}</div>
                  <div className="stat-label">Chapters</div>
                </div>
                <div className="stat-box">
                  <div className="stat-value blue">{status.eta?.unitsPerMinute || '--'}</div>
                  <div className="stat-label">Units/min</div>
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: 1 }}>
            <div className="card-header">Pipeline Phases</div>
            <div className="card-body">
              <div className="phases-container">
                <div className={`phase-card ${status.pipelineStatus.pass1.completed.length > 0 ? 'active' : ''}`}>
                  <div className="phase-icon">1️⃣</div>
                  <div className="phase-info">
                    <div className="phase-name">Skeleton Rewrite</div>
                    <div className="phase-status">{status.pipelineStatus.pass1.completed.length} of {totalChapters} chapters</div>
                    <div className="phase-bar">
                      <div className="phase-bar-fill" style={{ width: `${(status.pipelineStatus.pass1.completed.length / totalChapters) * 100}%` }}/>
                    </div>
                  </div>
                </div>
                <div className={`phase-card ${status.pipelineStatus.pass2.completed.length > 0 ? 'active' : ''}`}>
                  <div className="phase-icon">2️⃣</div>
                  <div className="phase-info">
                    <div className="phase-name">Verdieping & Microheadings</div>
                    <div className="phase-status">{status.pipelineStatus.pass2.completed.length} of {totalChapters} chapters</div>
                    <div className="phase-bar">
                      <div className="phase-bar-fill" style={{ width: `${(status.pipelineStatus.pass2.completed.length / totalChapters) * 100}%` }}/>
                    </div>
                  </div>
                </div>
                <div className={`phase-card ${status.pipelineStatus.assembled.completed ? 'complete' : ''}`}>
                  <div className="phase-icon">📦</div>
                  <div className="phase-info">
                    <div className="phase-name">Assembly</div>
                    <div className="phase-status">
                      {status.pipelineStatus.assembled.completed ? `✅ ${status.pipelineStatus.assembled.size}` : 'Waiting...'}
                    </div>
                  </div>
                </div>
                <div className={`phase-card ${status.pipelineStatus.pdf.completed ? 'complete' : ''}`}>
                  <div className="phase-icon">📄</div>
                  <div className="phase-info">
                    <div className="phase-name">PDF Generation</div>
                    <div className="phase-status">
                      {status.pipelineStatus.pdf.completed ? `✅ ${status.pipelineStatus.pdf.size}` : 'Waiting...'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel */}
        <div className="center-panel">
          {/* Current Activity */}
          <div className="card current-activity">
            <div className="card-body">
              {current && section ? (
                <div className="activity-content">
                  <div className="chapter-badge">CH {current.number}</div>
                  <div className="activity-info">
                    <div className="activity-section">{section.id}: {section.title}</div>
                    <div className="activity-unit">
                      <span>{status.currentActivity || 'Processing...'}</span>
                    </div>
                  </div>
                  <div className="activity-progress">
                    <div className="mini-progress">
                      <div className="mini-progress-fill" style={{ width: `${current.progress}%` }}/>
                    </div>
                    <span className="progress-text">{section.units.completed}/{section.units.total}</span>
                  </div>
                </div>
              ) : (
                <div className="activity-content">
                  <div className="chapter-badge" style={{ opacity: 0.5 }}>--</div>
                  <div className="activity-info">
                    <div className="activity-section">Waiting for next chapter...</div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Chapters */}
          <div className="card">
            <div className="card-header">Chapters</div>
            <div className="card-body">
              <div className="chapters-grid">
                {(status.bookStructure?.chapters || []).map(ch => ch.number).map(num => {
                  const chapter = status.chapters.find(c => c.number === num);
                  const bookCh = status.bookStructure?.chapters.find(c => c.number === num);
                  const isDone = chapter?.status === 'completed';
                  const isActive = chapter?.status === 'in_progress';
                  
                  return (
                    <div 
                      key={num} 
                      className={`chapter-box ${isDone ? 'done' : isActive ? 'active' : 'pending'}`}
                      title={`Chapter ${num}: ${bookCh?.sectionCount || '?'} sections`}
                    >
                      {num}
                      <span className="ch-label">
                        {isDone ? '✓' : isActive ? `${chapter?.progress}%` : `${bookCh?.sectionCount || '?'}s`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="card log-panel">
            <div className="card-header">Activity Log</div>
            <div className="log-content">
              {status.lastLines.map((line, i) => {
                let className = 'log-line';
                if (line.includes('Done')) className += ' success';
                else if (line.includes('Processing') || line.includes('Subsection')) className += ' info';
                else if (line.includes('Unit')) className += ' processing';
                else if (line.includes('ERROR')) className += ' error';
                
                return (
                  <div key={i} className={className}>
                    {line.includes('Done') ? '✓ ' : line.includes('Unit') ? '→ ' : ''}{line}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Panel - Issues */}
        <div className="issues-panel">
          <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="card-header">Build Issues</div>
            <div className="card-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div className="issues-summary">
                <div className="summary-item">
                  <span className="summary-count error">{status.errors.length}</span>
                  <span style={{ color: 'var(--text-dim)' }}>Errors</span>
                </div>
                <div className="summary-item">
                  <span className="summary-count warning">{status.warnings.length}</span>
                  <span style={{ color: 'var(--text-dim)' }}>Warnings</span>
                </div>
              </div>

              <div className="issues-list" style={{ marginTop: 12 }}>
                {status.errors.map((err, i) => (
                  <div key={`e${i}`} className="issue-card error">
                    <span className="issue-icon">✕</span>
                    <div className="issue-text">
                      {err.chapter && <span className="issue-chapter">Ch {err.chapter}</span>}{' '}
                      {err.text.slice(0, 60)}
                    </div>
                  </div>
                ))}
                {status.warnings.map((warn, i) => (
                  <div key={`w${i}`} className="issue-card warning">
                    <span className="issue-icon">⚠</span>
                    <div className="issue-text">
                      {warn.chapter && <span className="issue-chapter">Ch {warn.chapter}</span>}{' '}
                      {warn.text.slice(0, 60)}
                    </div>
                  </div>
                ))}
                {status.errors.length === 0 && status.warnings.length === 0 && (
                  <div style={{ color: 'var(--success)', padding: 16, textAlign: 'center' }}>
                    ✅ No issues detected
                  </div>
                )}
              </div>

              <div className="issues-note">
                <strong>ℹ️ Note:</strong> These issues are non-blocking. Layout issues are fixed in post-processing.
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App
