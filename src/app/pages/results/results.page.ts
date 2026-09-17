import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';
import { QuestionService } from '../../services/question.service';
import { HexagonLayoutService } from '../../services/hexagon-layout.service';
import { ScoreLegendComponent } from '../../services/score-legend.component';
import jsPDF from 'jspdf';
import { HttpClient } from '@angular/common/http';
import { ToastController } from '@ionic/angular';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';

interface EventCount {
  event: string;
  count: number;
  display: string;
}

// ✅ NEW INTERFACE FOR HEXAGON UI DATA
interface HexagonUI {
  questionIndex: number;
  path: string;
  centerX: number;
  centerY: number;
  color: string;
  score: number;
  label: string;
}

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './results.page.html',
  styleUrls: ['./results.page.scss'],
})
export class ResultsPage implements OnInit {
  loading = true;
  error = false;
  errorMsg = '';
  result: any = null;
  animatedScore = 0;
  Math = Math;
  
  // Grouped events for clean display
  groupedEvents: EventCount[] = [];

  // ✅ NEW HEXAGON STATE
  hexagons: HexagonUI[] = [];
  rawHexagons: HexagonUI[] = []; // ✅ Unscaled hexagons for PDF (full-size)
  selectedHexIndex: number | null = null;
  svgViewBox = "0 0 840 600"; // Matches A4 width logic in service
  hexBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

  // ✅ NEW: Aggregate metrics cache (C1/C2/C3 overall percentages)
  // Populated once after generateHexGrid() in ngOnInit — used by template (cached)
  // and by printReport() (calls getAggregateMetrics() directly for fresh data).
  aggregateMetrics: any[] = [];

  // constructor(
  //   private qService: QuestionService,
  //   public navCtrl: NavController,
  //   private hexService: HexagonLayoutService // ✅ NEW INJECTION
  // ) {}

  constructor(
    private qService: QuestionService,
    public navCtrl: NavController,
    private hexService: HexagonLayoutService,
    private http: HttpClient,
    private toastCtrl: ToastController
  ) {}

  async ngOnInit() {
    const username = sessionStorage.getItem('username');
    if (!username) {
      this.showError('No session found. Please log in first.');
      return;
    }
    try {
      const response = await this.qService.getResults(username);
      this.result = response;
      if (this.result && Array.isArray(this.result.questions)) {
        const seen = new Set<string>();
        this.result.questions = this.result.questions.filter((q: any, idx: number) => {
          const key = q?.id != null ? `id_${q.id}` : (q?.question ? `text_${q.question.trim().toLowerCase()}` : `idx_${idx}`);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      this.loading = false;

      this.groupEvents();
      this.generateHexGrid(); // ✅ GENERATE HEXAGONS
      this.aggregateMetrics = this.getAggregateMetrics(); // ✅ COMPUTE AGGREGATE METRICS (C1/C2/C3)
      setTimeout(() => this.animateScore(), 100);
    } catch (err: any) {
      console.error(err);
      this.showError(err.error?.detail || 'Results not found. Complete your interview first.');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: HEXAGONAL GRID LOGIC
  // ═══════════════════════════════════════════════════════════════
  
  generateHexGrid() {
    const questions = this.result?.questions || [];
    if (!questions.length) return;

    const numberOfHex = questions.length;
    const numberOfHives = 1; // Single interview attempt
    
    // 1. Get row distribution (e.g., 10 questions -> [3, 4, 3])
    const rowDistribution = this.hexService.getRowDistribution(numberOfHex);
    if (!rowDistribution) return;

    // 2. Calculate dimensions (Uses A4 width 840 internally)
    const dims = this.hexService.calcDimensions(numberOfHex, numberOfHives, rowDistribution);

    // 3. Initialize structure (Coordinates for all vertices)
    const hexStructure = this.hexService.initHexStructure(
      rowDistribution, 
      dims.marginX, 
      dims.marginY, 
      dims.hexWidth, 
      dims.hexRadius
    );

    // 4. Map questions to Hexagon UI objects
    // Store raw (unscaled) data for PDF, we'll scale down for UI display
    const uiScale = 0.35; // ✅ Scale down hexagons — smaller on screen
    const rawHexagons: HexagonUI[] = []; // Keep full-size for PDF
    this.hexagons = [];
    let testCount = 0;
    
    for (let row = 1; row <= rowDistribution.length; row++) {
      const hexagonsInRow = rowDistribution[row - 1];
      for (let hex = 1; hex <= hexagonsInRow; hex++) {
        testCount++;
        if (testCount > numberOfHex) break; 

        const q = questions[testCount - 1];
        const score = q.average_score || 0;
        
        // attempt = 0 because we only have 1 hive
        const path = this.hexService.getHexPath(hexStructure, testCount, row, 0, dims);
        const centerX = this.hexService.getHexCenterX(hexStructure, 0, row, testCount, dims);
        const centerY = this.hexService.getHexCenterY(hexStructure, 0, row, testCount, dims);
        
        // Service expects 0-100 scale, our score is 0-10
        const color = this.hexService.getHexColor(score * 10); 

        // Save full-size version for PDF
        rawHexagons.push({
          questionIndex: testCount - 1,
          path,
          centerX,
          centerY,
          color,
          score,
          label: `Q${testCount}`
        });

        // ✅ Scale down path coordinates for UI
        const scaledPath = path.replace(/[\d\.]+/g, (match) => {
          return (parseFloat(match) * uiScale).toFixed(2);
        });

        this.hexagons.push({
          questionIndex: testCount - 1,
          path: scaledPath,
          centerX: centerX * uiScale,
          centerY: centerY * uiScale,
          color,
          score,
          label: `Q${testCount}`
        });
      }
    }

    // ✅ FIX 1a: Calculate dynamic viewBox from actual hexagon bounding box (scaled)
    if (this.hexagons.length > 0) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const hex of this.hexagons) {
        const nums = hex.path.match(/[\d\.]+/g)?.map(Number) || [];
        for (let i = 0; i < nums.length; i += 2) {
          minX = Math.min(minX, nums[i]);
          minY = Math.min(minY, nums[i + 1]);
          maxX = Math.max(maxX, nums[i]);
          maxY = Math.max(maxY, nums[i + 1]);
        }
      }
      const padding = 10;
      this.svgViewBox = `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`;

      // ✅ hexBounds stores RAW (unscaled) coordinates for PDF use
      let rawMinX = Infinity, rawMinY = Infinity, rawMaxX = -Infinity, rawMaxY = -Infinity;
      for (const hex of rawHexagons) {
        const nums = hex.path.match(/[\d\.]+/g)?.map(Number) || [];
        for (let i = 0; i < nums.length; i += 2) {
          rawMinX = Math.min(rawMinX, nums[i]);
          rawMinY = Math.min(rawMinY, nums[i + 1]);
          rawMaxX = Math.max(rawMaxX, nums[i]);
          rawMaxY = Math.max(rawMaxY, nums[i + 1]);
        }
      }
      this.hexBounds = { minX: rawMinX, minY: rawMinY, maxX: rawMaxX, maxY: rawMaxY };

      // ✅ Store raw hexagons for PDF drawing (unscaled paths)
      this.rawHexagons = rawHexagons;
    }
  }

  selectHexagon(index: number | null) {
    this.selectedHexIndex = (this.selectedHexIndex === index) ? null : index;
    
    // Optional: Scroll to the corresponding question card in UI
    if (index !== null) {
      setTimeout(() => {
        const el = document.getElementById(`q-card-${index}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: METRIC HEXAGON HELPERS (for per-question scores)
  // ═══════════════════════════════════════════════════════════════

  /**
   * Generates an SVG path string for a small pointy-top hexagon.
   * Vertex order matches HexagonLayoutService: A(upper-left) → B(top) → C(upper-right) → D(lower-right) → E(bottom) → F(lower-left)
   */
  getSmallHexPath(cx: number, cy: number, r: number): string {
    const w = r * Math.sqrt(3) / 2;
    const points = [
      { x: cx - w, y: cy - r / 2 },  // A: upper-left
      { x: cx,     y: cy - r },       // B: top
      { x: cx + w, y: cy - r / 2 },   // C: upper-right
      { x: cx + w, y: cy + r / 2 },   // D: lower-right
      { x: cx,     y: cy + r },       // E: bottom
      { x: cx - w, y: cy + r / 2 },   // F: lower-left
    ];
    return `M ${points.map(p => `${p.x} ${p.y}`).join(' L ')} Z`;
  }

  /**
   * Returns metric hexagon data for a single question (Correctness, Completeness, Clarity).
   * Each metric is rendered as a small hexagon with score and label.
   */
  getMetricHexagons(q: any): any[] {
    const metrics = [
      { key: 'correctness', label: 'Correctness', shortLabel: 'C1' },
      { key: 'completeness', label: 'Completeness', shortLabel: 'C2' },
      { key: 'clarity', label: 'Clarity', shortLabel: 'C3' }
    ];
    const r = 24;
    const w = r * Math.sqrt(3) / 2;
    const padding = 2; // Tight padding — text is inside hex, no need for extra space
    const svgW = Math.ceil(w * 2 + padding * 2);
    const svgH = Math.ceil(r * 2 + padding * 2); // No extra +14 — labels are inside now

    return metrics.map(m => {
      const cx = svgW / 2;
      const cy = svgH / 2;
      const score = q.scores?.[m.key] || 0;
      const scoreScaled = score * 10;
      return {
        path: this.getSmallHexPath(cx, cy, r),
        centerX: cx,
        centerY: cy,
        color: this.hexService.getHexColor(scoreScaled),
        textColor: this.getHexTextColor(scoreScaled),
        score,
        label: m.label,
        shortLabel: m.shortLabel,
        labelY: cy + r + 12,
        svgWidth: svgW,
        svgHeight: svgH
      };
    });
  }

  /**
   * Determines text color for hexagon score based on fill color contrast.
   * Light backgrounds (yellow, light green, orange) get dark text; dark backgrounds (green, red) get white text.
   */
  getHexTextColor(score: number): string {
    // score is on 0-100 scale
    if (score >= 39.5 && score < 90.5) return '#1a1a1a'; // Dark text for orange, yellow, light green
    return '#ffffff'; // White text for green and red
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: AGGREGATE METRICS (C1/C2/C3 overall percentages)
  // Computes overall Correctness / Completeness / Clarity percentages
  // across ALL questions, rendered as 3 hexagons in the SAME 2+1
  // honeycomb structure as per-question metric hexagons — same r,
  // same padding, same SVG dimensions — so they look identical.
  // Reuses getSmallHexPath() + getHexTextColor() + hexService.getHexColor()
  // for DRY consistency with per-question metric hexagons.
  // ═══════════════════════════════════════════════════════════════
  getAggregateMetrics(): any[] {
    const questions = this.result?.questions || [];
    if (!questions.length) return [];

    const metrics = [
      { key: 'correctness',   label: 'Correctness',   shortLabel: 'C1' },
      { key: 'completeness',  label: 'Completeness',  shortLabel: 'C2' },
      { key: 'clarity',       label: 'Clarity',       shortLabel: 'C3' }
    ];

    // ✅ SAME sizing as per-question metric hexagons (r=24, padding=2)
    // so the honeycomb cluster nestles together identically and matches
    // the visual style of the per-question C1/C2/C3 hexagons.
    const r = 24;
    const w = r * Math.sqrt(3) / 2;
    const padding = 2;
    const svgW = Math.ceil(w * 2 + padding * 2);
    const svgH = Math.ceil(r * 2 + padding * 2);

    const numQ = questions.length;
    return metrics.map(m => {
      // ✅ Formula: (Σ q.scores[m]) / (numQuestions × 10) × 100
      const sum = questions.reduce((acc: number, q: any) => acc + (q.scores?.[m.key] || 0), 0);
      const pct = numQ > 0 ? (sum / (numQ * 10)) * 100 : 0;

      const cx = svgW / 2;
      const cy = svgH / 2;

      // ✅ Reuse existing 5-tier color logic (green ≥90.5 / light-green ≥80.5 / yellow ≥60.5 / orange ≥39.5 / red <39.5)
      return {
        path: this.getSmallHexPath(cx, cy, r),
        centerX: cx,
        centerY: cy,
        color: this.hexService.getHexColor(pct),
        textColor: this.getHexTextColor(pct),
        percentage: Math.round(pct),
        label: m.label,
        shortLabel: m.shortLabel,
        svgWidth: svgW,
        svgHeight: svgH
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // EXISTING: EVENT & UI HELPERS
  // ═══════════════════════════════════════════════════════════════

  groupEvents() {
    const v: Record<string, number> = this.result?.behavior_analysis?.violations || {};
    this.groupedEvents = Object.entries(v)
      .map(([display, count]) => ({ event: display, count, display }))
      .sort((a, b) => b.count - a.count);
  }

  showError(msg: string) {
    this.error = true;
    this.errorMsg = msg;
    this.loading = false;
  }

  animateScore() {
    const target = this.result?.final_result?.adjusted_score || 0;
    const duration = 1000;
    const step = target / 60;
    let current = 0;
    const interval = setInterval(() => {
      current = Math.min(current + step, target);
      this.animatedScore = Math.round(current);
      if (current >= target) clearInterval(interval);
    }, 16);
  }

  getScoreColor(score: number): string {
    if (score >= 80) return 'var(--green)';
    if (score >= 60) return 'var(--accent)';
    if (score >= 40) return 'var(--yellow)';
    return 'var(--red)';
  }

  getDecisionClass(decision: string): string {
    if (decision === 'Selected') return 'badge-selected';
    if (decision === 'Borderline') return 'badge-borderline';
    return 'badge-rejected';
  }

  getDecisionEmoji(decision: string): string {
    if (decision === 'Selected') return '✅';
    if (decision === 'Borderline') return '⚠️';
    return '❌';
  }

  getBehaviorClass(classification: string): string {
    const cls = (classification || 'fair').toLowerCase();
    if (cls === 'fair') return 'class-fair';
    if (cls === 'suspicious') return 'class-suspicious';
    return 'class-cheating';
  }

  getBehaviorEmoji(classification: string): string {
    const cls = (classification || 'fair').toLowerCase();
    if (cls === 'fair') return '✅';
    if (cls === 'suspicious') return '⚠️';
    return '🚨';
  }

  formatEvent(event: string): string {
    return event.replace(/_/g, ' ');
  }

  toggleAnswerExpand(index: number) {
    const el = document.getElementById(`answer-${index}`);
    if (el) {
      const expanded = el.classList.toggle('expanded');
      const btn = document.getElementById(`expand-btn-${index}`);
      if (btn) btn.textContent = expanded ? 'Show less ↑' : 'Show more ↓';
    }
  }

  logout() {
    sessionStorage.clear();
    this.navCtrl.navigateRoot('/login');
  }

  // ═══════════════════════════════════════════════════════════════
  // Loads an image from a URL/path and returns it as a base64 data URL.
  // ═══════════════════════════════════════════════════════════════
  async loadImageAsBase64(path: string): Promise<string | null> {
    try {
      const response = await fetch(path);
      if (!response.ok) return null;
      const blob = await response.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn('Image load failed:', path, e);
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ UPDATED: PDF GENERATION (WITH HEXAGONAL HEATMAP)
  // - Header banner with eklakshya.png logo on the LEFT
  // - Watermark (eklakshya.png) BEHIND content, CENTERED, opacity 0.08
  // - Tightened single-row layout: [Hex Grid][Aggregate C1/C2/C3][Legend]
  // - Vertical fallback (no skipping) when too many questions
  // - All C1/C2/C3 size tune points marked with ⚙️ TUNE HERE
  // ═══════════════════════════════════════════════════════════════

  async printReport() {
    if (!this.result) return;
    
    // Safety check: Ensure hexagons are generated before printing
    if (!this.rawHexagons || this.rawHexagons.length === 0) {
      this.generateHexGrid(); 
    }

    // ✅ Load the legend.png image (will be placed beside the hexagon grid)
    const legendImageData = await this.loadImageAsBase64('assets/legend.png');

    // ✅ NEW: Load eklakshya.png logo — used in header banner + as watermark on all pages
    const logoData = await this.loadImageAsBase64('assets/eklakshya.png');

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const M = 15;
    let y = 20;

    const fr = this.result?.final_result || {};
    const ba = this.result?.behavior_analysis || {};
    const questions: any[] = this.result?.questions || [];
    const decision = fr.decision ?? 'N/A';

    // ── Helpers ────────────────────────────────────────────────────────

    // ✅ NEW: Watermark — truly CENTERED on A4 (210×297mm), drawn BEHIND content
    const wmW = 150;
    const wmH = 130;
    const wmX = (W - wmW) / 2;        // (210-80)/2 = 65mm — centered horizontally
    const wmY = (297 - wmH) / 2;      // (297-80)/2 = 108.5mm — centered vertically

    // ✅ Helper: draws watermark logo at 0.08 opacity (behind content)
    const drawWatermark = () => {
      if (logoData) {
        try {
          // ✅ Cast to any — jsPDF typings don't expose GState constructor
          doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
          doc.addImage(logoData, 'PNG', wmX, wmY, wmW, wmH);
          doc.setGState(new (doc as any).GState({ opacity: 1.0 }));
        } catch (e) {
          console.warn('Watermark skipped (GState unsupported):', e);
        }
      }
    };

    // ✅ Draw watermark on PAGE 1 BEFORE any content (so it sits behind)
    drawWatermark();

    const checkPage = (need = 25) => {
      if (y + need > 282) {
        doc.addPage();
        y = 18;
        // ✅ Draw watermark on new page IMMEDIATELY (before content continues)
        drawWatermark();
      }
    };

    const text = (str: string, x: number, size = 10, style: 'normal' | 'bold' | 'italic' = 'normal', hex = '#111111') => {
      doc.setFontSize(size); doc.setFont('helvetica', style);
      doc.setTextColor(hex); doc.text(str, x, y);
    };

    const wrapped = (str: string, x: number, maxW: number, size = 9.5, hex = '#333333') => {
      doc.setFontSize(size); doc.setFont('helvetica', 'normal');
      doc.setTextColor(hex);
      const lines = doc.splitTextToSize(str || '—', maxW);
      doc.text(lines, x, y);
      y += lines.length * 5.5;
    };

    const sectionBanner = (title: string) => {
      checkPage(14); y += 3;
      doc.setFillColor('#d3d3d3');
      doc.roundedRect(M, y - 5, W - M * 2, 9, 2, 2, 'F');
      doc.setFontSize(11); doc.setFont('helvetica', 'bold');
      doc.setTextColor('#252424'); doc.text(title, M + 3, y + 1);
      y += 9;
    };

    const divider = () => {
      doc.setDrawColor('#e9d5ff'); doc.line(M, y, W - M, y); y += 4;
    };

    const scoreBar = (label: string, val: number, xStart: number, barY: number) => {
      const bW = 40;
      const filled = Math.min(10, Math.max(0, val));
      const barColor = filled >= 7 ? '#16a34a' : filled >= 5 ? '#d97706' : '#dc2626';
      doc.setFontSize(8.5); doc.setFont('helvetica', 'normal');
      doc.setTextColor('#374151'); doc.text(label, xStart, barY);
      doc.setFillColor('#e5e7eb');
      doc.roundedRect(xStart, barY + 2, bW, 4, 1, 1, 'F');
      doc.setFillColor(barColor);
      if (filled > 0) doc.roundedRect(xStart, barY + 2, (filled / 10) * bW, 4, 1, 1, 'F');
      doc.setFontSize(8); doc.setTextColor(barColor);
      doc.text(`${filled}/10`, xStart + bW + 2, barY + 5.5); 
    };

    // ── HEADER BANNER WITH LOGO ────────────────────────────────────────
    doc.setFillColor('#888c92');
    doc.rect(0, 0, W, 16, 'F');

    // ✅ NEW: Place eklakshya.png logo at the LEFT of the purple banner
    if (logoData) {
      const logoW = 18;   // mm — ⚙️ TUNE: increase if logo looks too small
      const logoH = 14;   // mm — ⚙️ TUNE: adjust if logo isn't square (preserve aspect ratio)
      const logoX = 8;    // mm from left edge
      const logoY = 2;    // mm from top (banner is 16mm tall, logo is 10mm → 3mm top margin)
      try {
        doc.addImage(logoData, 'PNG', logoX, logoY, logoW, logoH);
      } catch (e) {
        console.warn('Header logo placement failed:', e);
      }
    }

    // Title text — shifted right (x=18) to make room for the 10mm logo
    // Naya code (Manual Superscript R):
    doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.setTextColor('#ffffff');

    const startX = 70;
    doc.text('Dipstick', startX, 11);

    // Superscript 'R' (chota size aur thoda upar)
    const originalSize = doc.getFontSize();
    doc.setFontSize(originalSize * 0.55); 
    doc.text('®', startX + 28, 8); // X aur Y adjust kar lena agar thoda idhar-udhar ho

    // Wapas original size aur baaki text
    doc.setFontSize(originalSize);
    doc.text(' Interview Report', startX + 30, 11);

    // ── STUDENT INFO ────────────────────────────────────────────────────────
    const evDate = this.result.evaluated_at ? new Date(this.result.evaluated_at).toLocaleString() : '—';
    
    // Left side: Student Name
    text(`Name : ${this.result.student_name || ''}`, M, 11, 'bold'); 
    
    // Right side: Evaluated Date (on the same line, right-aligned)
    doc.setFontSize(10); 
    doc.setFont('helvetica', 'normal'); 
    doc.setTextColor('#111111'); 
    doc.text(`Evaluated On: ${evDate}`, W - M, y, { align: 'right' }); 
    
    // Right side: This is an AI generated interview evaluation report
    y += 5;
    doc.setFontSize(8); 
    doc.setFont('helvetica', 'italic');
    doc.setTextColor('#6b7280'); 
    doc.text(`This is an AI generated interview evaluation report`, W - M, y, { align: 'right' });
    
    y += 6;
    divider();

    // ══════════════════════════════════════════════════════════════════════
    // ✅ Overall Performance (HEXAGONAL GRID) IN PDF
    // Tightened single-row layout: [Hex Grid][Aggregate C1/C2/C3][Legend]
    // Falls back to vertical stack (no skipping) when too many questions.
    // ══════════════════════════════════════════════════════════════════════
    if (this.rawHexagons && this.rawHexagons.length > 0) {
      sectionBanner('Overall Performance');
      
      // ✅ Scale and dimensions (UNCHANGED — do not modify hexagon shape or spacing)
      const scale = 0.21;
      const gridWidthMM = (this.hexBounds.maxX - this.hexBounds.minX) * scale;
      const gridHeightMM = (this.hexBounds.maxY - this.hexBounds.minY) * scale;

      // ═══════════════════════════════════════════════════════════════
      // ✅ TIGHTENED LAYOUT CONSTANTS — tune these if needed
      // ═══════════════════════════════════════════════════════════════
      const TIGHT_LEGEND_W = 30;     // legend image width (mm) — was 30
      const TIGHT_GAP      = 5;      // gap between elements (mm) — was 8
      const TIGHT_AGG_PAD  = 5;      // aggregate cluster inner padding (mm) — was 12

      // 1. Pre-compute AGGREGATE cluster dimensions
      const aggMetrics = this.getAggregateMetrics();
      let aggClusterW = 0, aggClusterH = 0;
      let aggHexR = 0, aggHexW = 0, aggHexRowSpacing = 0, aggHexHGap = 0;
      if (aggMetrics.length === 3) {
        aggHexR = 8;
        aggHexW = aggHexR * Math.sqrt(3) / 2;
        aggHexRowSpacing = aggHexR * 1.5 + 0.5;
        aggHexHGap = 0.8;
        aggClusterW = (aggHexW * 2 * 2) + aggHexHGap + (TIGHT_AGG_PAD * 2);
        aggClusterH = 14 + (aggHexR * 2) + aggHexRowSpacing;  // title + hexagons + legend row
      }

      // 2. Pre-compute LEGEND image height (with tightened width)
      const legendImgH = TIGHT_LEGEND_W * (478 / 421);

      // 3. Check if all 3 fit on one row (target: ≤10 questions on one row)
      const totalLayoutW = gridWidthMM
        + (aggClusterW > 0 ? aggClusterW + TIGHT_GAP : 0)
        + (legendImgH > 0 ? TIGHT_LEGEND_W + TIGHT_GAP : 0);
      const fitsOnOneRow = totalLayoutW <= (W - 2 * M);

      // 4. Compute hex grid position — LEFT if fits, CENTERED if fallback
      let hexGridLeftX: number;
      if (fitsOnOneRow) {
        // hexGridLeftX = M + 4;
        const combinedW = gridWidthMM + TIGHT_GAP + aggClusterW;
        hexGridLeftX = (W - combinedW - TIGHT_LEGEND_W - TIGHT_GAP) / 2 + 4;
      } else {
        hexGridLeftX = (W - gridWidthMM) / 2;
      }

      doc.setFontSize(9); doc.setFont('helvetica', 'bold');
      doc.setTextColor('#0a0a0a');
      doc.text('Question-wise Report', hexGridLeftX, y + 2);
      y += 4; // Push hexagons down slightly to make room for the title

      const offsetX = hexGridLeftX - this.hexBounds.minX * scale;
      const offsetY = y - this.hexBounds.minY * scale;
      const hexGridTopY = y;

      // 5. drawHexagon helper (UNCHANGED — for per-question grid)
      const drawHexagon = (pathStr: string, fillColor: string, label: string, score: number) => {
        const nums = pathStr.match(/[\d\.]+/g)?.map(Number) || [];
        if (nums.length < 12) return;

        const pts = [];
        for(let i=0; i<12; i+=2) pts.push({x: nums[i], y: nums[i+1]});

        const scaledPts = pts.map(p => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }));

        doc.setFillColor(fillColor);
        doc.setDrawColor('#ffffff');
        doc.setLineWidth(0.5);

        const linesArr = scaledPts.map((p, i) => i === 0 ? [0,0] : [p.x - scaledPts[i-1].x, p.y - scaledPts[i-1].y]);
        doc.lines(linesArr, scaledPts[0].x, scaledPts[0].y, [1,1], 'FD', true);

        const cx = scaledPts[0].x + (scaledPts[2].x - scaledPts[0].x) / 2;
        const cy = scaledPts[0].y + (scaledPts[4].y - scaledPts[0].y) / 2;

        const txtColor = this.getHexTextColor(score * 10);

        // ⚙️ TUNE HERE — Per-question grid LABEL (Q1, Q2...) size IN OVERALL PERFORMANCE
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
        doc.text(label, cx, cy - 3, { align: 'center' });
        
        // ⚙️ TUNE HERE — Per-question grid SCORE size
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(txtColor);
        doc.text(`${score * 10}%`, cx, cy + 1.5, { align: 'center' });
      };

      // 6. Draw all hexagons (UNCHANGED — uses rawHexagons for full-size PDF paths)
      for (const hex of this.rawHexagons) {
        drawHexagon(hex.path, hex.color, hex.label, hex.score);
      }

      let maxRowH = gridHeightMM;

      // ═══════════════════════════════════════════════════════════════
      // CASE A: SINGLE ROW LAYOUT (≤10 questions typically fits here)
      //   [Hex Grid LEFT]  [Aggregate MIDDLE]  [Legend Image RIGHT]
      //   No background card on aggregate — saves space, matches hex grid style.
      // ═══════════════════════════════════════════════════════════════
      if (fitsOnOneRow) {

        // A1. Draw AGGREGATE cluster in MIDDLE (no background card)
        if (aggMetrics.length === 3) {
          const aggStartX = hexGridLeftX + gridWidthMM + TIGHT_GAP;
          const aggStartY = y;

          // Title (small, above hexagons)
          doc.setFontSize(9); doc.setFont('helvetica', 'bold');
          doc.setTextColor('#0a0a0a');
          doc.text('Evaluation Report', aggStartX + aggClusterW / 2, aggStartY, { align: 'center' });

          // 2+1 honeycomb positions
          const hexCenterX = aggStartX + aggClusterW / 2;
          const hexStartY  = aggStartY + 4 + aggHexR;
          const aggPositions = [
            { cx: hexCenterX - aggHexW - aggHexHGap / 2, cy: hexStartY,                   m: aggMetrics[0] },
            { cx: hexCenterX + aggHexW + aggHexHGap / 2, cy: hexStartY,                   m: aggMetrics[1] },
            { cx: hexCenterX,                            cy: hexStartY + aggHexRowSpacing, m: aggMetrics[2] }
          ];

          aggPositions.forEach(pos => {
            const cx = pos.cx, cy = pos.cy, m = pos.m;
            const fillColor = m.color;
            const txtColor  = m.textColor === '#1a1a1a' ? '#1a1a1a' : '#ffffff';
            const pts = [
              { x: cx - aggHexW, y: cy - aggHexR / 2 },
              { x: cx,           y: cy - aggHexR     },
              { x: cx + aggHexW, y: cy - aggHexR / 2 },
              { x: cx + aggHexW, y: cy + aggHexR / 2 },
              { x: cx,           y: cy + aggHexR     },
              { x: cx - aggHexW, y: cy + aggHexR / 2 },
            ];
            doc.setFillColor(fillColor);
            doc.setDrawColor('#ffffff');
            doc.setLineWidth(0.4);
            const linesArr = pts.map((p, i) => i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]);
            doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

            // ⚙️ TUNE HERE (1 of 4) — Aggregate cluster C1/C2/C3 LABEL size (single-row)
            doc.setFontSize(9); doc.setFont('helvetica', 'bold');
            doc.setTextColor(txtColor);
            doc.text(m.shortLabel, cx, cy - 1.75, { align: 'center' });

            // ⚙️ TUNE HERE (2 of 4) — Aggregate cluster PERCENTAGE size (single-row)
            doc.setFontSize(9); doc.setFont('helvetica', 'bold');
            doc.setTextColor(txtColor);
            doc.text(`${m.percentage}%`, cx, cy + 2.5, { align: 'center' });
          });

          // Legend row below hexagons
          const aggLegendY = hexStartY + aggHexRowSpacing + aggHexR + 4;
          doc.setFontSize(7); doc.setFont('helvetica', 'bold');  // to increase the size of C1: Correctnes, C2: ..... in the overall performance section
          doc.setTextColor('#374151');
                // Line 1
      doc.text('C1: Correctness | C2: Completeness', hexCenterX, aggLegendY, { align: 'center' });
      // Line 2 (Shifted down by 3mm)
      doc.text('C3: Clarity', hexCenterX, aggLegendY + 3, { align: 'center' });

          maxRowH = Math.max(maxRowH, aggClusterH);
        }

        // A2. Draw LEGEND image on RIGHT (tightened width)
        if (legendImageData) {
          const imgX = W - M - TIGHT_LEGEND_W;
          const imgY = y;
          checkPage(legendImgH + 5);
          doc.addImage(legendImageData, 'PNG', imgX, imgY, TIGHT_LEGEND_W, legendImgH);
          maxRowH = Math.max(maxRowH, legendImgH);
        } else {
          // Fallback: trapezoid legend if image fails to load
          checkPage(35);
          const legendStartX = W - M - 40;
          const legendEndY = ScoreLegendComponent.drawInPdf(doc, legendStartX, hexGridTopY);
          maxRowH = Math.max(maxRowH, legendEndY - hexGridTopY);
        }

        y += maxRowH + 8;
      }

      // ═══════════════════════════════════════════════════════════════
      // CASE B: VERTICAL STACK FALLBACK (11+ questions — hex grid too wide)
      //   Row 1: Hex grid centered (already drawn above)
      //   Row 2: Aggregate cluster centered (WITH background card)
      //   Row 3: Legend image centered
      //   Nothing is skipped — all 3 elements always render.
      // ═══════════════════════════════════════════════════════════════
      else {

        // B1. Advance y past hex grid
        y += gridHeightMM + 6;

        // B2. Draw AGGREGATE cluster centered (with background card for separation)
        if (aggMetrics.length === 3) {
          const fbClusterH = aggClusterH + 14;  // extra height for card padding + subtitle
          checkPage(fbClusterH + 6);
          const boxX = (W - aggClusterW) / 2;
          const boxY = y;

          // Background card (only in fallback mode for visual separation)
          doc.setFillColor('#f5f3ff');
          doc.setDrawColor('#ddd6fe');
          doc.setLineWidth(0.3);
          doc.roundedRect(boxX, boxY, aggClusterW, fbClusterH, 2, 2, 'FD');

          // Title
          doc.setFontSize(8); doc.setFont('helvetica', 'bold');
          doc.setTextColor('#5b21b6');
          doc.text('Evaluation Report', W / 2, boxY + 5, { align: 'center' });

          // 2+1 honeycomb positions
          const hexCenterX = W / 2;
          const hexStartY  = boxY + 5 + aggHexR + 2;
          const aggPositions = [
            { cx: hexCenterX - aggHexW - aggHexHGap / 2, cy: hexStartY,                   m: aggMetrics[0] },
            { cx: hexCenterX + aggHexW + aggHexHGap / 2, cy: hexStartY,                   m: aggMetrics[1] },
            { cx: hexCenterX,                            cy: hexStartY + aggHexRowSpacing, m: aggMetrics[2] }
          ];

          aggPositions.forEach(pos => {
            const cx = pos.cx, cy = pos.cy, m = pos.m;
            const fillColor = m.color;
            const txtColor  = m.textColor === '#1a1a1a' ? '#1a1a1a' : '#ffffff';
            const pts = [
              { x: cx - aggHexW, y: cy - aggHexR / 2 },
              { x: cx,           y: cy - aggHexR     },
              { x: cx + aggHexW, y: cy - aggHexR / 2 },
              { x: cx + aggHexW, y: cy + aggHexR / 2 },
              { x: cx,           y: cy + aggHexR     },
              { x: cx - aggHexW, y: cy + aggHexR / 2 },
            ];
            doc.setFillColor(fillColor);
            doc.setDrawColor('#ffffff');
            doc.setLineWidth(0.4);
            const linesArr = pts.map((p, i) => i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]);
            doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

            // ⚙️ TUNE HERE (3 of 4) — Aggregate cluster C1/C2/C3 LABEL size (fallback)
            doc.setFontSize(8); doc.setFont('helvetica', 'bold');
            doc.setTextColor(txtColor);
            doc.text(m.shortLabel, cx, cy - 0.5, { align: 'center' });

            // ⚙️ TUNE HERE (4 of 4) — Aggregate cluster PERCENTAGE size (fallback)
            doc.setFontSize(6); doc.setFont('helvetica', 'bold');
            doc.setTextColor(txtColor);
            doc.text(`${m.percentage}%`, cx, cy + 3.5, { align: 'center' });
          });

          // Legend row
          const aggLegendY = hexStartY + aggHexRowSpacing + aggHexR + 4;
          doc.setFontSize(7); doc.setFont('helvetica', 'bold');   // to increase the size of C1: Correctnes, C2: .....
          doc.setTextColor('#374151');
          // Line 1
          doc.text('C1: Correctness | C2: Completeness', W / 2, aggLegendY, { align: 'center' });
          // Line 2 (Shifted down by 3mm)
          doc.text('C3: Clarity', W / 2, aggLegendY + 3, { align: 'center' });

          // Subtitle
          doc.setFontSize(8); doc.setFont('helvetica', 'italic');
          doc.setTextColor('#6b7280');
          doc.text('Overall Average Performance across all questions', W / 2, boxY + fbClusterH - 3, { align: 'center' });

          y = boxY + fbClusterH + 6;
        }

        // B3. Draw LEGEND image centered
        if (legendImageData) {
          checkPage(legendImgH + 5);
          const imgX = (W - TIGHT_LEGEND_W) / 2;
          const imgY = y;
          doc.addImage(legendImageData, 'PNG', imgX, imgY, TIGHT_LEGEND_W, legendImgH);
          y += legendImgH + 8;
        } else {
          checkPage(35);
          const legendStartX = (W - 40) / 2;
          const legendEndY = ScoreLegendComponent.drawInPdf(doc, legendStartX, y);
          y += (legendEndY - y) + 8;
        }
      }

      divider();
    }

    // ── FINAL SCORE ────────────────────────────────────────────────────
    sectionBanner('Final Score & Decision');
    const rawScore = fr.raw_score ?? 0;
    const adjScore2 = fr.adjusted_score ?? 0;
    const scoreColor = adjScore2 >= 65 ? '#16a34a' : '#dc2626';
    const decColor = decision === 'Selected' ? '#16a34a' : '#dc2626';

    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor('#6b7280');
    doc.text('Raw Score', M, y); doc.text('Adjusted Score', M + 55, y); y += 5;

    doc.setFontSize(26); doc.setFont('helvetica', 'bold'); doc.setTextColor('#374151');
    doc.text(`${rawScore}`, M, y + 8);
    doc.setFontSize(12); doc.setTextColor('#6b7280'); doc.text('/ 100', M + 20, y + 8);

    doc.setFontSize(26); doc.setFont('helvetica', 'bold'); doc.setTextColor(scoreColor);
    doc.text(`${Math.floor(adjScore2)}`, M + 55, y + 8);
    doc.setFontSize(12); doc.setTextColor('#6b7280'); doc.text('/ 100', M + 75, y + 8);

    doc.setFontSize(13); doc.setFont('helvetica', 'bold'); doc.setTextColor(decColor);
    doc.text(`${decision} . ${fr.grade ?? ''}`, M + 110, y + 8);
    y += 20;
    wrapped(fr.summary ?? '', M, W - M * 2); y += 2;
    divider();

    // ── BEHAVIOR ANALYSIS ──────────────────────────────────────────────
    sectionBanner('Behavior Analysis');
    text(`Classification: ${(ba.classification ?? 'fair').toUpperCase()}`, M, 10, 'bold'); y += 6;
    text(`Total Events: ${ba.events_count ?? 0}`, M, 10); y += 7;
    wrapped(ba.reasoning ?? 'No suspicious behavior detected.', M, W - M * 2);

    // ✅ Violations now arrive pre-grouped from the backend as { displayName: count }
    //    No more client-side regex stripping of "(WebSocket)", no more "_"-to-space
    //    conversion, no more title-casing — backend is the single source of truth.
    const violations: Record<string, number> = ba.violations || {};
    const violationEntries = Object.entries(violations)
      .map(([display, count]) => ({ display, count: Number(count) || 0 }))
      .sort((a, b) => b.count - a.count);

    if (violationEntries.length) {
      y += 4;
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor('#1f2937');
      doc.text('Proctor Violation Summary', M, y); y += 7;

      // ✅ Single-column layout:
      //   [Event Display Name]               -     [Count]
      //   |_________ left (M+3) _________|    |__ right-aligned (W-M-2) __|
      //                                          ^ dash at fixed column (W-M-25)
      const dashX       = W - M - 25;   // fixed column for the "-" separator
      const countRightX = W - M - 2;    // right edge for the count value

      for (const v of violationEntries) {
        checkPage(7);
        const countColor = v.count >= 10 ? '#dc2626'
                         : v.count >= 5  ? '#d97706'
                         :                 '#374151';
        const countStr   = `${v.count}`;   // ❌ no "time(s)" suffix

        // Event name (left-aligned)
        doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor('#374151');
        doc.text(v.display, M + 3, y);

        // Dash separator (fixed column, muted grey)
        doc.setFont('helvetica', 'normal'); doc.setTextColor('#9ca3af');
        doc.text('-', dashX, y);

        // Count (right-aligned, bold, color-coded by severity)
        doc.setFont('helvetica', 'bold'); doc.setTextColor(countColor);
        doc.text(countStr, countRightX, y, { align: 'right' });

        y += 6;
      }
    } else {
      y += 4;
      doc.setFontSize(9.5); doc.setFont('helvetica', 'italic'); doc.setTextColor('#10b981');
      doc.text('No suspicious events detected.', M, y); y += 6;
    }
    y += 2; divider();

    // ── QUESTION BREAKDOWN ─────────────────────────────────────────────
    // Force "Question-wise Breakdown" to start on Page 2.
    // Agar abhi bhi Page 1 par hain, toh naya page add karo.
    // Agar data overflow hoke Page 2 (ya uske baad) par aa chuka hai, toh directly wahi print hoga.
    if (doc.getNumberOfPages() === 1) {
        doc.addPage();
        y = 18; // Naye page par Y-coordinate reset
        drawWatermark(); // Naye page par watermark draw karna zaroori hai
    }

    sectionBanner('Question-wise Breakdown');
    questions.forEach((q: any, i: number) => {
      checkPage(45);
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor('#1f2937');
      const qLines = doc.splitTextToSize(`Q${i + 1}: ${q.question || ''}`, W - M * 2);
      doc.text(qLines, M, y); y += qLines.length * 6;

      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor('#4b5563');
      const hexColWidth = 38; 
      const ansMaxW = W - M * 2 - hexColWidth;
      const aLines = doc.splitTextToSize(`Ans: ${q.answer || '(no answer)'}`, ansMaxW);

      const ansBlockH = aLines.length * 5.5;
      const answerStartY = y;
      doc.text(aLines, M, y); 
      y += ansBlockH + 3;

      // ⚠️ IMPORTANT: checkPage yahan call ho raha hai. 
      // Agar space nahi hai, toh ye naya page add karega aur y = 18 kar dega.
      checkPage(22); 

      const hexR = 6; 
      const hexW = hexR * Math.sqrt(3) / 2; 
      const hexRowSpacing = hexR * 1.5 + 0.5; 
      const hexHGap = 0.8; 
      const hexColCenterX = W - M - 14; 

      // ═══════════════════════════════════════════════════════════════
      // ✅ BUG FIX: Prevent Stranded Hexagons & Extra Blank Pages
      // ═══════════════════════════════════════════════════════════════
      // Agar answer lamba tha aur checkPage() ne naya page add kar diya, 
      // toh answerStartY purane page ka hai. Hexagons ko naye page par top par laana hoga.
      let hexStartY = answerStartY + hexR + 1;
      if (y < answerStartY) {
          // Iska matlab page break ho chuka hai. 'y' ab naye page par 18 hai.
          hexStartY = y + hexR + 1; 
      }
      // ═══════════════════════════════════════════════════════════════

      const pdfMetrics = [
        { key: 'correctness', label: 'C1' },
        { key: 'completeness', label: 'C2' },
        { key : 'clarity', label: 'C3' }
      ];

      const hexPositions = [
        { cx: hexColCenterX - hexW - hexHGap / 2,  cy: hexStartY },              
        { cx: hexColCenterX + hexW + hexHGap / 2, cy: hexStartY },              
        { cx: hexColCenterX,                    cy:  hexStartY + hexRowSpacing },  
      ];

      hexPositions.forEach((pos, mi) => {
        const cx = pos.cx;
        const cy = pos.cy;
        const m = pdfMetrics[mi];
        const scoreVal = q.scores?.[m.key] ?? 0;
        const fillColor = this.hexService.getHexColor(scoreVal * 10);
        const darkText = this.getHexTextColor(scoreVal * 10) === '#1a1a1a';
        const txtColor = darkText ? '#1a1a1a' : '#ffffff';

        // Build 6 vertices of a pointy-top hexagon
        const pts = [
          { x: cx - hexW, y: cy - hexR / 2 },
          { x: cx,       y: cy - hexR },
          { x: cx + hexW, y: cy - hexR / 2 },
          { x: cx + hexW, y: cy + hexR / 2 },
          { x: cx,       y: cy + hexR },
          { x: cx - hexW, y: cy + hexR / 2 },
        ];

        doc.setFillColor(fillColor);
        doc.setDrawColor('#ffffff');
        doc.setLineWidth(0.3);

        const linesArr = pts.map((p, i) => i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]);
        doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

        // ⚙️ TUNE HERE — Per-question C1/C2/C3 LABEL size  
        doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.setTextColor(txtColor);
        doc.text(m.label, cx, cy - 1, { align: 'center' });

        // ⚙️ TUNE HERE — Per-question C1/C2/C3 SCORE size
        doc.setFontSize(9); doc.setFont('helvetica', 'bold');
        doc.setTextColor(txtColor);
        doc.text(`${scoreVal}`, cx, cy + 2.5, { align: 'center' });
      });

      // ✅ Legend row: C1=Correctness, C2=Completeness, C3=Clarity (dark text)
      const legendY = hexStartY + hexRowSpacing + hexR + 4;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold');   // to increase the size of C1: Correctnes, C2: ..... in every question
      doc.setTextColor('#374151'); // Dark color matching question text
      // doc.text('C1: Correctness | C2: Completeness | C3: Clarity', hexColCenterX - 12, legendY, { align: 'center' });

      doc.text('C1: Correctness | C2: Completeness', hexColCenterX - 12, legendY, { align: 'center' });
      // Line 2 (Shifted down for Clarity)
      doc.text('C3: Clarity', hexColCenterX - 12, legendY + 3, { align: 'center' });

      // ✅ Y cursor: move past hexagons + legend row so feedback doesn't overlap
      const hexBlockBottom = legendY + 5; // 3mm below legend text
      y = Math.max(y, hexBlockBottom) + 2;

      if (q.feedback) {
        checkPage(10);
        doc.setFontSize(8.5); doc.setFont('helvetica', 'italic'); doc.setTextColor('#6b7280');
        const fbLines = doc.splitTextToSize(`Feedback: ${q.feedback}`, W - M * 2);
        doc.text(fbLines, M, y); y += fbLines.length * 5 + 2;
      }
      doc.setDrawColor('#f3f4f6'); doc.line(M, y, W - M, y); y += 5;
    });

    // ── FOOTER (watermark already drawn BEHIND content on each page) ──
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor('#9ca3af');
      doc.text(`Page ${p} of ${totalPages}`, M, 291);
      doc.text(` © 2026 Dipstick ® Platform. All rights reserved.`, 120, 291);
      // doc.text(`Generated: ${new Date().toLocaleString()}`, W - M - 58, 291);
    }

    // ... existing footer code (page numbers, watermark etc) ...    
    const safeName = (this.result.student_name || 'Student').replace(/\s+/g, '_');
    const fileName = `Report_${safeName}.pdf`;

    // 1. PDF locally download karo (Taki download wala feature as it is kaam kare)
    doc.save(fileName);

    // 2. PDF ka blob banakar backend par send karo
    try {
      const pdfBlob = doc.output('blob');
      const formData = new FormData();
      const username = sessionStorage.getItem('username') || '';
      
      formData.append('username', username);
      formData.append('pdf_report', pdfBlob, fileName);

      // Toast dikhao processing ka
      const toast = await this.toastCtrl.create({
        message: 'Downloading and sending report to your email...',
        duration: 2000,
        color: 'primary'
      });
      await toast.present();

      // Backend par API call
      await lastValueFrom(this.http.post(`${environment.apiUrl}/student/send-report`, formData));

      const successToast = await this.toastCtrl.create({
        message: '✅ Report successfully sent to your registered email!',
        duration: 3000,
        color: 'success'
      });
      await successToast.present();

    } catch (error) {
      console.error('Failed to email report:', error);
      const errorToast = await this.toastCtrl.create({
        message: 'Report downloaded, but failed to send to email.',
        duration: 3000,
        color: 'danger'
      });
      await errorToast.present();
    }
  } // <-- End of printReport function
}