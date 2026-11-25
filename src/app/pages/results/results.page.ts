import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, NavController } from '@ionic/angular';
import { ActivatedRoute } from '@angular/router';
import { environment } from '../../../environments/environment';
import { QuestionService } from '../../services/question.service';
import { HexagonLayoutService } from '../../services/hexagon-layout.service';
import { ScoreLegendComponent } from '../../services/score-legend.component';
import { PdfGeneratorService } from '../../services/pdf-generator.service';

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
    private pdfGenerator: PdfGeneratorService,
    private route: ActivatedRoute
  ) {}

  async ngOnInit() {
    const username = sessionStorage.getItem('username');
    if (!username) {
      this.navCtrl.navigateRoot('/login');
      return;
    }

    // Read session_id from URL query param (?session_id=...) or active/last session storage
    const querySessionId = this.route.snapshot.queryParamMap.get('session_id');
    const storedSessionId = sessionStorage.getItem('active_exam_session_id') || sessionStorage.getItem('last_exam_session_id');
    const sessionId = (querySessionId || storedSessionId || '').trim();

    try {
      const response = await this.qService.getResults(username, sessionId || undefined);
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
    const merged: Record<string, number> = {};
    for (const [key, count] of Object.entries(v)) {
      const normalizedKey = key === 'fullscreen_exit_attempt' ? 'fullscreen_exit' : key;
      merged[normalizedKey] = (merged[normalizedKey] || 0) + count;
    }

    const eventNameMap: Record<string, string> = {
      'fullscreen_exit': 'Full-screen Exit detected',
      'fullscreen_exit_attempt': 'Full-screen Exit detected',
      'tab_switch': 'Tab Switch detected',
      'multiple_faces_detected': 'Multiple Faces detected',
      'multiple_speakers_detected': 'Multiple voice detected',
      'no_face_detected': 'Face Missing from Screen',
      'eye_contact_violation': 'Eye Contact Violation detected',
      'devtools_attempt': 'DevTools Attempt detected',
      'split_screen_detected': 'Split Screen detected',
      'app_switcher_detected': 'App Switch detected',
      'copy_attempt': 'Copy Attempt detected',
      'cut_attempt': 'Cut Attempt detected',
      'paste_detected': 'Paste Attempt detected',
      'right_click': 'Right Click attempt detected'
    };

    this.groupedEvents = Object.entries(merged)
      .map(([rawKey, count]) => {
        const display = eventNameMap[rawKey] || rawKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return { event: rawKey, count, display };
      })
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

  async printReport() {
    if (!this.result) return;

    // Safety check: Ensure hexagons are generated before printing
    if (!this.rawHexagons || this.rawHexagons.length === 0) {
      this.generateHexGrid();
    }

    const aggMetrics = this.aggregateMetrics?.length
      ? this.aggregateMetrics
      : this.getAggregateMetrics();

    // Call unified PDF Generator Service (single point of truth)
    await this.pdfGenerator.generateAndDownloadPDF(
      this.result,
      this.rawHexagons,
      this.hexBounds,
      aggMetrics,
      this.groupedEvents,
      ''
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ NEW: Question Image Display (result page)
  // ═══════════════════════════════════════════════════════════════

  previewImageUrl: string | null = null;

  getQuestionImageUrl(filename: string | null | undefined): string {
    if (!filename) return '';
    return `${environment.apiUrl}/uploads/questions/${filename}`;
  }

  openImagePreview(filename: string | null | undefined): void {
    if (filename) {
      this.previewImageUrl = this.getQuestionImageUrl(filename);
    }
  }

  closeImagePreview(): void {
    this.previewImageUrl = null;
  }

  @HostListener('document:keydown.escape')
  onEscKey(): void {
    if (this.previewImageUrl) {
      this.closeImagePreview();
    }
  }
}
