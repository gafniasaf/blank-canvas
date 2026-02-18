import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());

const LOG_FILE = '/tmp/comm_rewrite.log';
const REWRITES_DIR = '/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/communicatie';
const PV_OUTPUT_DIR = '/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/communicatie';
const CANONICAL_JSON = '/Users/asafgafni/Desktop/InDesign/TestRun/new_pipeline/output/_canonical_jsons_all/MBO_COMMUNICATIE_9789083251387_03_2024__canonical_book_with_figures.json';

// Load book structure upfront
let bookStructure = null;
function loadBookStructure() {
  try {
    if (fs.existsSync(CANONICAL_JSON)) {
      const data = JSON.parse(fs.readFileSync(CANONICAL_JSON, 'utf8'));
      bookStructure = {
        title: data.meta?.title || 'Unknown Book',
        chapters: data.chapters.map(ch => ({
          number: parseInt(ch.number),
          title: ch.title || '',
          sectionCount: ch.sections?.length || 0,
          sections: (ch.sections || []).map(s => ({
            id: s.number || s.id,
            title: s.title
          }))
        }))
      };
      console.log(`📚 Loaded book structure: ${bookStructure.chapters.length} chapters`);
    }
  } catch (e) {
    console.error('Failed to load book structure:', e.message);
  }
}
loadBookStructure();

function parseTimeToDate(timeStr) {
  const [h, m, s] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m, s, 0);
  // If time is in the future, it was yesterday
  if (date > new Date()) {
    date.setDate(date.getDate() - 1);
  }
  return date;
}

function parseLog(content) {
  const lines = content.split('\n');
  const chapters = [];
  const errors = [];
  const warnings = [];
  let currentChapter = null;
  let currentSection = null;
  let firstChapterTime = null;
  let currentActivity = null;
  
  // Parse errors and warnings
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.includes('❌') || trimmed.includes('FAILED')) {
      errors.push({ text: trimmed, chapter: currentChapter?.number });
    }
    if (trimmed.includes('⚠️') || trimmed.includes('WARNING')) {
      warnings.push({ text: trimmed, chapter: currentChapter?.number });
    }
    // Track current activity
    if (trimmed.includes('Processing Section')) {
      currentActivity = trimmed;
    } else if (trimmed.includes('Unit ') && trimmed.includes('...')) {
      currentActivity = trimmed;
    } else if (trimmed.includes('Extracted skeleton')) {
      currentActivity = 'Extracting skeleton...';
    } else if (trimmed.includes('Validating Skeleton')) {
      currentActivity = 'Validating skeleton...';
    }
  }
  
  for (const line of lines) {
    // Chapter start
    const chapterMatch = line.match(/^========== CHAPTER (\d+) \((\d+:\d+:\d+)\)/);
    if (chapterMatch) {
      if (currentChapter) {
        // Calculate chapter totals before pushing
        currentChapter.totalUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.total, 0);
        currentChapter.completedUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.completed, 0);
        chapters.push(currentChapter);
      }
      const timeStr = chapterMatch[2];
      if (!firstChapterTime) firstChapterTime = timeStr;
      currentChapter = {
        number: parseInt(chapterMatch[1]),
        startTime: timeStr,
        startDate: parseTimeToDate(timeStr),
        sections: [],
        status: 'in_progress',
        totalUnits: 0,
        completedUnits: 0,
        durationMinutes: null
      };
      currentSection = null;
      continue;
    }
    
    // Section start - also detect chapter changes from section numbers
    const sectionMatch = line.match(/^Processing Section ([\d.]+): (.+)/);
    if (sectionMatch) {
      const sectionId = sectionMatch[1];
      const sectionChapter = parseInt(sectionId.split('.')[0]);
      
      // If we see a section for a different chapter, start a new chapter
      if (!currentChapter || currentChapter.number !== sectionChapter) {
        if (currentChapter) {
          currentChapter.totalUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.total, 0);
          currentChapter.completedUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.completed, 0);
          chapters.push(currentChapter);
        }
        const now = new Date();
        if (!firstChapterTime) firstChapterTime = now.toTimeString().slice(0, 8);
        currentChapter = {
          number: sectionChapter,
          startTime: now.toTimeString().slice(0, 8),
          startDate: now,
          sections: [],
          status: 'in_progress',
          totalUnits: 0,
          completedUnits: 0,
          durationMinutes: null
        };
      }
      
      currentSection = {
        id: sectionId,
        title: sectionMatch[2],
        subsections: [],
        units: { total: 0, completed: 0 }
      };
      currentChapter.sections.push(currentSection);
      continue;
    }
    
    // Subsection (handles formats like "1.1.root", "1.3.1", etc.)
    const subMatch = line.match(/Subsection ([\d.a-z]+): (\d+) units/i);
    if (subMatch && currentSection) {
      const unitCount = parseInt(subMatch[2]);
      currentSection.units.total += unitCount;
      continue;
    }
    
    // Unit completion
    const unitMatch = line.match(/Unit [a-f0-9-]+ \([^)]+\)\.\.\. Done/);
    if (unitMatch && currentSection) {
      currentSection.units.completed++;
      continue;
    }
  }
  
  // Push last chapter
  if (currentChapter) {
    currentChapter.totalUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.total, 0);
    currentChapter.completedUnits = currentChapter.sections.reduce((sum, s) => sum + s.units.completed, 0);
    chapters.push(currentChapter);
  }
  
  // Calculate chapter durations and mark completed
  const now = new Date();
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    if (i < chapters.length - 1) {
      // Completed chapter - duration is time to next chapter
      ch.status = 'completed';
      ch.durationMinutes = Math.round((chapters[i + 1].startDate - ch.startDate) / 1000 / 60);
    } else {
      // Current chapter - duration is time since start
      ch.durationMinutes = Math.round((now - ch.startDate) / 1000 / 60);
    }
    ch.progress = ch.totalUnits > 0 ? Math.round((ch.completedUnits / ch.totalUnits) * 100) : 0;
  }
  
  // Calculate totals
  const totalUnits = chapters.reduce((sum, ch) => sum + ch.totalUnits, 0);
  const completedUnits = chapters.reduce((sum, ch) => sum + ch.completedUnits, 0);
  
  // Average chapter time (from completed chapters only)
  const completedChapters = chapters.filter(ch => ch.status === 'completed');
  const avgChapterMinutes = completedChapters.length > 0
    ? Math.round(completedChapters.reduce((sum, ch) => sum + ch.durationMinutes, 0) / completedChapters.length)
    : null;
  
  // Book progress (chapters completed + current chapter partial)
  const TOTAL_CHAPTERS = 8;
  const fullChaptersComplete = completedChapters.length;
  const currentChapterProgress = chapters.length > 0 ? (chapters[chapters.length - 1].progress / 100) : 0;
  const bookProgress = Math.round(((fullChaptersComplete + currentChapterProgress) / TOTAL_CHAPTERS) * 100);
  
  // Calculate ETA
  let eta = null;
  let elapsedMinutes = 0;
  
  if (firstChapterTime && completedUnits > 10) {
    const startDate = parseTimeToDate(firstChapterTime);
    elapsedMinutes = Math.round((now - startDate) / 1000 / 60);
    
    if (elapsedMinutes > 0) {
      const unitsPerMinute = completedUnits / elapsedMinutes;
      
      // ETA based on remaining chapters
      const remainingChapters = TOTAL_CHAPTERS - fullChaptersComplete - currentChapterProgress;
      let remainingMinutes;
      
      if (avgChapterMinutes && completedChapters.length >= 1) {
        // Use average chapter time
        remainingMinutes = remainingChapters * avgChapterMinutes;
      } else {
        // Fallback to units-based estimate
        const remainingUnits = totalUnits - completedUnits;
        remainingMinutes = remainingUnits / unitsPerMinute;
      }
      
      if (remainingMinutes >= 0 && remainingMinutes < 60 * 24) {
        const etaDate = new Date(now.getTime() + remainingMinutes * 60 * 1000);
        eta = {
          time: etaDate.toLocaleTimeString(),
          remainingMinutes: Math.round(remainingMinutes),
          unitsPerMinute: unitsPerMinute.toFixed(2)
        };
      }
    }
  }
  
  // List of completed chapter numbers
  const completedChapterNumbers = completedChapters.map(ch => ch.number);
  
  return {
    chapters,
    completedChapterNumbers,
    totalUnits,
    completedUnits,
    bookProgress,
    avgChapterMinutes,
    lastLines: lines.slice(-30).filter(l => l.trim()),
    errors: errors.slice(-10),  // Last 10 errors
    warnings: warnings.slice(-10),  // Last 10 warnings
    currentActivity,
    eta,
    elapsedMinutes
  };
}

function getRewriteFiles() {
  try {
    const files = fs.readdirSync(REWRITES_DIR)
      .filter(f => f.match(/^rewrites_ch\d+\.json$/))
      .map(f => {
        const stats = fs.statSync(path.join(REWRITES_DIR, f));
        const match = f.match(/rewrites_ch(\d+)\.json/);
        return {
          chapter: match ? parseInt(match[1]) : 0,
          file: f,
          size: (stats.size / 1024).toFixed(1) + ' KB',
          modified: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => a.chapter - b.chapter);
    return files;
  } catch (e) {
    return [];
  }
}

function getPipelineStatus(completedChaptersFromLog = []) {
  const status = {
    pass1: { completed: [], inProgress: null },
    pass2: { completed: [], inProgress: null },
    assembled: { completed: false, file: null },
    pdf: { completed: false, file: null }
  };
  
  // Chapters completed in current log
  const validChapters = new Set(completedChaptersFromLog);
  
  // Also include Chapter 1 if its rewrite file was modified today
  // (Ch1 was completed before current log restart)
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const buildStartThreshold = today;
  
  try {
    const ch1File = path.join(REWRITES_DIR, 'rewrites_ch1.json');
    if (fs.existsSync(ch1File)) {
      const stats = fs.statSync(ch1File);
      if (stats.mtime >= today) {
        validChapters.add(1);
      }
    }
  } catch (e) {
    // Ignore
  }
  
  try {
    const files = fs.readdirSync(REWRITES_DIR);
    
    // Pass 1: rewrites_ch*.json (not pass2), only from completed chapters in current build
    const pass1Files = files.filter(f => f.match(/^rewrites_ch\d+\.json$/) && !f.includes('pass2'));
    for (const f of pass1Files) {
      const match = f.match(/rewrites_ch(\d+)\.json/);
      if (match) {
        const chapterNum = parseInt(match[1]);
        // Only count if this chapter is confirmed completed in current log
        if (validChapters.has(chapterNum)) {
          const stats = fs.statSync(path.join(REWRITES_DIR, f));
          status.pass1.completed.push({
            chapter: chapterNum,
            size: (stats.size / 1024).toFixed(1) + ' KB',
            modified: stats.mtime
          });
        }
      }
    }
    status.pass1.completed.sort((a, b) => a.chapter - b.chapter);
    
    // Pass 2: rewrites_ch*_pass2.json (only from completed chapters)
    const pass2Files = files.filter(f => f.match(/^rewrites_ch\d+_pass2\.json$/));
    for (const f of pass2Files) {
      const match = f.match(/rewrites_ch(\d+)_pass2\.json/);
      if (match) {
        const chapterNum = parseInt(match[1]);
        if (validChapters.has(chapterNum)) {
          const stats = fs.statSync(path.join(REWRITES_DIR, f));
          status.pass2.completed.push({
            chapter: chapterNum,
            size: (stats.size / 1024).toFixed(1) + ' KB',
            modified: stats.mtime
          });
        }
      }
    }
    status.pass2.completed.sort((a, b) => a.chapter - b.chapter);
    
    // Look for Pathologie-specific assembled/PDF files
    if (fs.existsSync(PV_OUTPUT_DIR)) {
      const pathFiles = fs.readdirSync(PV_OUTPUT_DIR);
      
      // Assembled JSON in pathologie folder
      const assembledFiles = pathFiles.filter(f => f.includes('assembled') && f.endsWith('.json'));
      if (assembledFiles.length > 0) {
        const latest = assembledFiles.sort().pop();
        const stats = fs.statSync(path.join(PV_OUTPUT_DIR, latest));
        if (stats.mtime > buildStartThreshold) {
          status.assembled = {
            completed: true,
            file: latest,
            size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
            modified: stats.mtime
          };
        }
      }
      
      // PDF files in pathologie folder
      const pdfFiles = pathFiles.filter(f => f.endsWith('.pdf'));
      if (pdfFiles.length > 0) {
        const latest = pdfFiles.sort().pop();
        const stats = fs.statSync(path.join(PV_OUTPUT_DIR, latest));
        if (stats.mtime > buildStartThreshold) {
          status.pdf = {
            completed: true,
            file: latest,
            size: (stats.size / 1024 / 1024).toFixed(2) + ' MB',
            modified: stats.mtime
          };
        }
      }
    }
    
  } catch (e) {
    console.error('Error getting pipeline status:', e.message);
  }
  
  return status;
}

app.get('/api/status', (req, res) => {
  try {
    const content = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8') : '';
    const parsed = parseLog(content);
    const rewriteFiles = getRewriteFiles();
    // Pass completed chapters from log to pipeline status
    const pipelineStatus = getPipelineStatus(parsed.completedChapterNumbers || []);
    
    // Add Chapter 1 to stats if it was completed today (before current log restart)
    let adjustedBookProgress = parsed.bookProgress;
    let chaptersCompleteCount = parsed.chapters.filter(c => c.status === 'completed').length;
    
    // Check if Chapter 1 is in pipeline status but not in current log
    const ch1InPipeline = pipelineStatus.pass1.completed.some(c => c.chapter === 1);
    const ch1InLog = parsed.chapters.some(c => c.number === 1);
    
    if (ch1InPipeline && !ch1InLog) {
      // Add Chapter 1 to the counts
      chaptersCompleteCount += 1;
      // Recalculate book progress: (completed chapters + current chapter partial) / 12
      const TOTAL_CHAPTERS = 8;
      const currentChapter = parsed.chapters.find(c => c.status === 'in_progress');
      const currentChapterProgress = currentChapter ? (currentChapter.progress / 100) : 0;
      adjustedBookProgress = Math.round(((chaptersCompleteCount + currentChapterProgress) / TOTAL_CHAPTERS) * 100);
    }
    
    res.json({
      ...parsed,
      bookProgress: adjustedBookProgress,
      chaptersCompleteCount,
      rewriteFiles,
      pipelineStatus,
      bookStructure,
      logFile: LOG_FILE,
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Pipeline Monitor API running at http://localhost:${PORT}`);
  console.log(`   Watching: ${LOG_FILE}`);
});
