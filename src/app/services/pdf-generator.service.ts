import { Injectable } from '@angular/core';
import jsPDF from 'jspdf';
import { HttpClient } from '@angular/common/http';
import { ToastController } from '@ionic/angular';
import { lastValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';
import { HexagonLayoutService } from './hexagon-layout.service';
import { ScoreLegendComponent } from './score-legend.component';

// ✅ INTERFACE FOR HEXAGON UI DATA
export interface HexagonUI {
  questionIndex: number;
  path: string;
  centerX: number;
  centerY: number;
  color: string;
  score: number;
  label: string;
}

@Injectable({
  providedIn: 'root'
})
export class PdfGeneratorService {

  constructor(
    private hexService: HexagonLayoutService,
    private http: HttpClient,
    private toastCtrl: ToastController
  ) {}

  // Loads an image from a URL/path and returns it as a base64 data URL.
  private async loadImageAsBase64(path: string): Promise<string | null> {
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

  private getHexTextColor(score: number): string {
    if (score >= 39.5 && score < 90.5) return '#1a1a1a'; 
    return '#ffffff'; 
  }

  /**
   * Main function to generate and download the PDF.
   * Admin and Student components should both call this.
   * 
   * @param result The full result object from backend
   * @param rawHexagons Array of raw hexagon paths (generated from hex layout service)
   * @param hexBounds Bounding box of the hexagons
   * @param aggregateMetrics Calculated aggregate metrics (C1/C2/C3)
   * @param groupedEvents The pre-grouped events from UI (optional, for cross-checking)
   */
  async generateAndDownloadPDF(
    result: any, 
    rawHexagons: HexagonUI[], 
    hexBounds: any, 
    aggregateMetrics: any[],
    groupedEvents: any[] = [],
    filenameSuffix: string = '' // 🔥 YEH 6TH ARGUMENT ADD KAREIN
  ) {
    if (!result) return;

    // ✅ Load images
    const legendImageData = await this.loadImageAsBase64('assets/legend.png');
    const logoData = await this.loadImageAsBase64('assets/eklakshya.png');

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;
    const M = 15;
    let y = 20;

    const fr = result?.final_result || {};
    const ba = result?.behavior_analysis || {};
    const rawQuestions: any[] = result?.questions || [];
    const seenQ = new Set<string>();
    const questions: any[] = rawQuestions.filter((q: any, idx: number) => {
      const key = q?.id != null ? `id_${q.id}` : (q?.question ? `text_${String(q.question).trim().toLowerCase()}` : `idx_${idx}`);
      if (seenQ.has(key)) return false;
      seenQ.add(key);
      return true;
    });
    const decision = fr.decision ?? 'N/A';

    // ── Helpers ────────────────────────────────────────────────────────
    const wmW = 150;
    const wmH = 130;
    const wmX = (W - wmW) / 2;        
    const wmY = (297 - wmH) / 2;      

    const drawWatermark = () => {
      if (logoData) {
        try {
          doc.setGState(new (doc as any).GState({ opacity: 0.08 }));
          doc.addImage(logoData, 'PNG', wmX, wmY, wmW, wmH);
          doc.setGState(new (doc as any).GState({ opacity: 1.0 }));
        } catch (e) {
          console.warn('Watermark skipped:', e);
        }
      }
    };

    drawWatermark();

    const checkPage = (need = 25) => {
      if (y + need > 282) {
        doc.addPage();
        y = 18;
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

    // ── HEADER BANNER WITH LOGO ────────────────────────────────────────
    doc.setFillColor('#888c92');
    doc.rect(0, 0, W, 16, 'F');

    if (logoData) {
      const logoW = 18;   
      const logoH = 14;   
      const logoX = 8;    
      const logoY = 2;    
      try {
        doc.addImage(logoData, 'PNG', logoX, logoY, logoW, logoH);
      } catch (e) {
        console.warn('Header logo placement failed:', e);
      }
    }

    doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.setTextColor('#ffffff');
    const startX = 70;
    doc.text('Dipstick', startX, 11);
    const originalSize = doc.getFontSize();
    doc.setFontSize(originalSize * 0.55); 
    doc.text('®', startX + 28, 8); 
    doc.setFontSize(originalSize);
    doc.text(' Interview Report', startX + 30, 11);

    // ── STUDENT INFO ────────────────────────────────────────────────────────
    const evDate = result.evaluated_at ? new Date(result.evaluated_at).toLocaleString() : '—';
    text(`Name : ${result.student_name || ''}`, M, 11, 'bold'); 
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor('#111111'); 
    doc.text(`Evaluated On: ${evDate}`, W - M, y, { align: 'right' }); 

    y += 5;
    doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor('#6b7280'); 
    doc.text(`This is an AI generated interview evaluation report`, W - M, y, { align: 'right' });
    y += 6;
    divider();

    // ── Overall Performance (HEXAGONAL GRID) ──────────────────────────
    if (rawHexagons && rawHexagons.length > 0) {
      sectionBanner('Overall Performance');
      
      const scale = 0.21;
      const gridWidthMM = (hexBounds.maxX - hexBounds.minX) * scale;
      const gridHeightMM = (hexBounds.maxY - hexBounds.minY) * scale;

      const TIGHT_LEGEND_W = 30;     
      const TIGHT_GAP      = 5;      
      const TIGHT_AGG_PAD  = 5;      

      let aggClusterW = 0, aggClusterH = 0;
      let aggHexR = 0, aggHexW = 0, aggHexRowSpacing = 0, aggHexHGap = 0;
      if (aggregateMetrics.length === 3) {
        aggHexR = 8;
        aggHexW = aggHexR * Math.sqrt(3) / 2;
        aggHexRowSpacing = aggHexR * 1.5 + 0.5;
        aggHexHGap = 0.8;
        aggClusterW = (aggHexW * 2 * 2) + aggHexHGap + (TIGHT_AGG_PAD * 2);
        aggClusterH = 14 + (aggHexR * 2) + aggHexRowSpacing;  
      }

      const legendImgH = TIGHT_LEGEND_W * (478 / 421);
      const totalLayoutW = gridWidthMM + (aggClusterW > 0 ? aggClusterW + TIGHT_GAP : 0) + (legendImgH > 0 ? TIGHT_LEGEND_W + TIGHT_GAP : 0);
      const fitsOnOneRow = totalLayoutW <= (W - 2 * M);

      let hexGridLeftX: number;
      if (fitsOnOneRow) {
        const combinedW = gridWidthMM + TIGHT_GAP + aggClusterW;
        hexGridLeftX = (W - combinedW - TIGHT_LEGEND_W - TIGHT_GAP) / 2 + 4;
      } else {
        hexGridLeftX = (W - gridWidthMM) / 2;
      }

      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor('#0a0a0a');
      doc.text('Question-wise Report', hexGridLeftX, y + 2);
      y += 4; 

      const offsetX = hexGridLeftX - hexBounds.minX * scale;
      const offsetY = y - hexBounds.minY * scale;
      const hexGridTopY = y;

      const drawHexagon = (pathStr: string, fillColor: string, label: string, score: number) => {
        const nums = pathStr.match(/[\d\.]+/g)?.map(Number) || [];
        if (nums.length < 12) return;
        const pts = [];
        for(let i=0; i<12; i+=2) pts.push({x: nums[i], y: nums[i+1]});
        const scaledPts = pts.map(p => ({ x: p.x * scale + offsetX, y: p.y * scale + offsetY }));

        doc.setFillColor(fillColor); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.5);
        const linesArr = scaledPts.map((p, i) => i === 0 ? [0,0] : [p.x - scaledPts[i-1].x, p.y - scaledPts[i-1].y]);
        doc.lines(linesArr, scaledPts[0].x, scaledPts[0].y, [1,1], 'FD', true);

        const cx = scaledPts[0].x + (scaledPts[2].x - scaledPts[0].x) / 2;
        const cy = scaledPts[0].y + (scaledPts[4].y - scaledPts[0].y) / 2;
        const txtColor = this.getHexTextColor(score * 10);

        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
        doc.text(label, cx, cy - 3, { align: 'center' });
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(txtColor);
        doc.text(`${score * 10}%`, cx, cy + 1.5, { align: 'center' });
      };

      for (const hex of rawHexagons) {
        drawHexagon(hex.path, hex.color, hex.label, hex.score);
      }

      let maxRowH = gridHeightMM;

      // CASE A: SINGLE ROW
      if (fitsOnOneRow) {
        if (aggregateMetrics.length === 3) {
          const aggStartX = hexGridLeftX + gridWidthMM + TIGHT_GAP;
          const aggStartY = y;
          doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor('#0a0a0a');
          doc.text('Evaluation Report', aggStartX + aggClusterW / 2, aggStartY, { align: 'center' });

          const hexCenterX = aggStartX + aggClusterW / 2;
          const hexStartY  = aggStartY + 4 + aggHexR;
          const aggPositions = [
            { cx: hexCenterX - aggHexW - aggHexHGap / 2, cy: hexStartY,                   m: aggregateMetrics[0] },
            { cx: hexCenterX + aggHexW + aggHexHGap / 2, cy: hexStartY,                   m: aggregateMetrics[1] },
            { cx: hexCenterX,                            cy: hexStartY + aggHexRowSpacing, m: aggregateMetrics[2] }
          ];

          aggPositions.forEach(pos => {
            const cx = pos.cx, cy = pos.cy, m = pos.m;
            const fillColor = m.color;
            const txtColor  = m.textColor === '#1a1a1a' ? '#1a1a1a' : '#ffffff';
            const pts = [
              { x: cx - aggHexW, y: cy - aggHexR / 2 }, { x: cx, y: cy - aggHexR },
              { x: cx + aggHexW, y: cy - aggHexR / 2 }, { x: cx + aggHexW, y: cy + aggHexR / 2 },
              { x: cx, y: cy + aggHexR }, { x: cx - aggHexW, y: cy + aggHexR / 2 },
            ];
            doc.setFillColor(fillColor); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.4);
            const linesArr = pts.map((p, i) => i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]);
            doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

            doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
            doc.text(m.shortLabel, cx, cy - 1.75, { align: 'center' });
            doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
            doc.text(`${m.percentage}%`, cx, cy + 2.5, { align: 'center' });
          });

          const aggLegendY = hexStartY + aggHexRowSpacing + aggHexR + 4;
          doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor('#374151');
          doc.text('C1: Correctness | C2: Completeness', hexCenterX, aggLegendY, { align: 'center' });
          doc.text('C3: Clarity', hexCenterX, aggLegendY + 3, { align: 'center' });
          maxRowH = Math.max(maxRowH, aggClusterH);
        }

        if (legendImageData) {
          const imgX = W - M - TIGHT_LEGEND_W;
          checkPage(legendImgH + 5);
          doc.addImage(legendImageData, 'PNG', imgX, y, TIGHT_LEGEND_W, legendImgH);
          maxRowH = Math.max(maxRowH, legendImgH);
        } else {
          checkPage(35);
          const legendStartX = W - M - 40;
          const legendEndY = ScoreLegendComponent.drawInPdf(doc, legendStartX, hexGridTopY);
          maxRowH = Math.max(maxRowH, legendEndY - hexGridTopY);
        }
        y += maxRowH + 8;
      }
      // CASE B: VERTICAL STACK
      else {
        y += gridHeightMM + 6;
        if (aggregateMetrics.length === 3) {
          const fbClusterH = aggClusterH + 14; 
          checkPage(fbClusterH + 6);
          const boxX = (W - aggClusterW) / 2;
          const boxY = y;
          doc.setFillColor('#f5f3ff'); doc.setDrawColor('#ddd6fe'); doc.setLineWidth(0.3);
          doc.roundedRect(boxX, boxY, aggClusterW, fbClusterH, 2, 2, 'FD');

          doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor('#5b21b6');
          doc.text('Evaluation Report', W / 2, boxY + 5, { align: 'center' });

          const hexCenterX = W / 2; const hexStartY  = boxY + 5 + aggHexR + 2;
          const aggPositions = [
            { cx: hexCenterX - aggHexW - aggHexHGap / 2, cy: hexStartY,                   m: aggregateMetrics[0] },
            { cx: hexCenterX + aggHexW + aggHexHGap / 2, cy: hexStartY,                   m: aggregateMetrics[1] },
            { cx: hexCenterX,                            cy: hexStartY + aggHexRowSpacing, m: aggregateMetrics[2] }
          ];

          aggPositions.forEach(pos => {
            const cx = pos.cx, cy = pos.cy, m = pos.m;
            const fillColor = m.color; const txtColor  = m.textColor === '#1a1a1a' ? '#1a1a1a' : '#ffffff';
            const pts = [
              { x: cx - aggHexW, y: cy - aggHexR / 2 }, { x: cx, y: cy - aggHexR },
              { x: cx + aggHexW, y: cy - aggHexR / 2 }, { x: cx + aggHexW, y: cy + aggHexR / 2 },
              { x: cx, y: cy + aggHexR }, { x: cx - aggHexW, y: cy + aggHexR / 2 },
            ];
            doc.setFillColor(fillColor); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.4);
            const linesArr = pts.map((p, i) => i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]);
            doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

            doc.setFontSize(8); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
            doc.text(m.shortLabel, cx, cy - 0.5, { align: 'center' });
            doc.setFontSize(6); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
            doc.text(`${m.percentage}%`, cx, cy + 3.5, { align: 'center' });
          });

          const aggLegendY = hexStartY + aggHexRowSpacing + aggHexR + 4;
          doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor('#374151');
          doc.text('C1: Correctness | C2: Completeness', W / 2, aggLegendY, { align: 'center' });
          doc.text('C3: Clarity', W / 2, aggLegendY + 3, { align: 'center' });

          doc.setFontSize(8); doc.setFont('helvetica', 'italic'); doc.setTextColor('#6b7280');
          doc.text('Overall Average Performance across all questions', W / 2, boxY + fbClusterH - 3, { align: 'center' });
          y = boxY + fbClusterH + 6;
        }

        if (legendImageData) {
          checkPage(legendImgH + 5);
          const imgX = (W - TIGHT_LEGEND_W) / 2;
          doc.addImage(legendImageData, 'PNG', imgX, y, TIGHT_LEGEND_W, legendImgH);
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
    doc.text(`${fr.grade ?? ''} . ${decision}`, M + 110, y + 8);
    y += 20;
    wrapped(fr.summary ?? '', M, W - M * 2); y += 2;
    divider();

    // ── BEHAVIOR ANALYSIS (FINAL ROBUST FIX) ──────────────────────────────
    sectionBanner('Behavior Analysis');
    text(`Classification: ${(ba.classification ?? 'fair').toUpperCase()}`, M, 10, 'bold'); y += 6;
    text(`Total Events: ${ba.events_count ?? 0}`, M, 10); y += 7;
    wrapped(ba.reasoning ?? 'No suspicious behavior detected.', M, W - M * 2);

    let tempViolations: Record<string, number> = {};

    const eventDisplayMap: Record<string, string> = {
      'multiple_faces_detected': 'Multiple Faces detected',
      'multiple_speakers_detected': 'Multiple voice detected',
      'no_face_detected': 'Face Missing from Screen',  
      'eye_contact_violation': 'Eye Contact Violation detected',
      'tab_switch': 'Tab Switch detected',
      'fullscreen_exit': 'Full-screen Exit detected',
      'devtools_attempt': 'DevTools Attempt detected',
      'split_screen_detected': 'Split Screen detected',
      'app_switcher_detected': 'App Switch detected',
      'copy_attempt': 'Copy Attempt detected',
      'cut_attempt': 'Cut Attempt detected',
      'paste_detected': 'Paste Attempt detected',
      'right_click': 'Right Click attempt detected'
    };

    const processRawEvents = (eventsArray: any[]) => {
      for (const ev of eventsArray) {
        let rawName = typeof ev === 'string' ? ev : (ev.event || '');
        rawName = rawName.replace(/\s*\(WebSocket\)\s*/gi, '').trim().toLowerCase();
        
        // 🔥 HIDE VOICE MISMATCH
        if (rawName === 'voice_mismatch') continue;

        let display = eventDisplayMap[rawName];
        if (!display) {
           display = rawName.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
        }
        
        if (display) {
           tempViolations[display] = (tempViolations[display] || 0) + 1;
        }
      }
    };

    if (groupedEvents && groupedEvents.length > 0) {
      groupedEvents.forEach((ev: any) => {
         if (!ev.display?.toLowerCase().includes('voice mismatch')) {
            tempViolations[ev.display || ev.event] = ev.count;
         }
      });
    }
    else if (ba.violations && Object.keys(ba.violations).length > 0) {
      Object.entries(ba.violations).forEach(([k, v]) => {
         if (!k.toLowerCase().includes('voice mismatch')) {
             tempViolations[k] = Number(v) || 0;
         }
      });
    } 
    else if (ba.critical_events && Array.isArray(ba.critical_events)) {
      processRawEvents(ba.critical_events);
    }
    else if (result?.proctoring_logs && Array.isArray(result.proctoring_logs)) {
      processRawEvents(result.proctoring_logs);
    }

    // Pura Object.entries() block is code se replace karein
    const violationEntries = Object.entries(tempViolations)
      .map(([display, count]) => ({ display, count: Number(count) || 0 })) // 🔥 YE MAP() MISSING THA!
      .sort((a, b) => b.count - a.count);

    if (violationEntries.length) {
      y += 4;
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor('#1f2937');
      doc.text('Proctor Violation Summary', M, y); y += 7;

      const dashX       = W - M - 25;
      const countRightX = W - M - 2;

      for (const v of violationEntries) {
        checkPage(7);
        const countColor = v.count >= 10 ? '#dc2626' : v.count >= 5  ? '#d97706' : '#374151';
        
        doc.setFontSize(9.5); doc.setFont('helvetica', 'normal'); doc.setTextColor('#374151');
        doc.text(v.display, M + 3, y);
        doc.setFont('helvetica', 'normal'); doc.setTextColor('#9ca3af');
        doc.text('-', dashX, y);
        doc.setFont('helvetica', 'bold'); doc.setTextColor(countColor);
        doc.text(`${v.count}`, countRightX, y, { align: 'right' }); 
        y += 6;
      }
    } else {
      y += 4;
      doc.setFontSize(9.5); doc.setFont('helvetica', 'italic'); doc.setTextColor('#10b981');
      doc.text('No suspicious events detected.', M, y); y += 6;
    }
    y += 2; divider();

    // ── QUESTION BREAKDOWN ─────────────────────────────────────────────
    if (doc.getNumberOfPages() === 1) {
        doc.addPage();
        y = 18; 
        drawWatermark(); 
    }

    sectionBanner('Question-wise Breakdown');

    const hexR = 6;
    const hexW = hexR * Math.sqrt(3) / 2;
    const hexRowSpacing = hexR * 1.5 + 0.5;
    const hexHGap = 0.8;
    
    // Right side column width (Hexagons ke liye)
    const hexColWidth = 45; 
    const hexColCenterX = W - M - 20; // Center of right column

    // Hexagon + Legend ki fixed height
    const HEX_BLOCK_H = (hexR * 2) + hexRowSpacing + 12; 

    const pdfMetrics = [
      { key: 'correctness', label: 'C1' },
      { key: 'completeness', label: 'C2' },
      { key: 'clarity', label: 'C3' }
    ];

    questions.forEach((q: any, i: number) => {
      // ── 1. Measure Question (Full Width) ──
      doc.setFontSize(10); doc.setFont('helvetica', 'bold');
      const qLines = doc.splitTextToSize(`Q${i + 1}: ${q.question || ''}`, W - M * 2);
      const qBlockH = qLines.length * 5.5;

      // ── 2. Measure Answer (Left Column) ──
      doc.setFontSize(9); doc.setFont('helvetica', 'normal');
      const ansMaxW = W - M * 2 - hexColWidth - 5; // Answer sirf left area cover karega
      const aLines = doc.splitTextToSize(`Ans: ${q.answer || '(no answer)'}`, ansMaxW);
      const ansBlockH = aLines.length * 5.5;

      // ── 3. Measure Feedback (Full Width) ──
      let fbLines: string[] = [];
      let fbBlockH = 0;
      if (q.feedback) {
        doc.setFontSize(8.5); doc.setFont('helvetica', 'italic');
        fbLines = doc.splitTextToSize(`Feedback: ${q.feedback}`, W - M * 2);
        fbBlockH = fbLines.length * 5;
      }

      // Taller column dono me se kaunsa hai? (Answer text ya Hexagons)
      const rowH = Math.max(ansBlockH, HEX_BLOCK_H); 
      const totalBlockH = qBlockH + rowH + fbBlockH + 12;

      // Check for page break
      checkPage(Math.min(totalBlockH, 270));

      // ═════ DRAW QUESTION (Full Width) ═════
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor('#1f2937');
      doc.text(qLines, M, y);
      y += qBlockH - 1;

      const rowStartY = y; // Yahan se columns start hongi

      // ═════ DRAW ANSWER (Left/Middle - Plain Text) ═════
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor('#4b5563');
      doc.text(aLines, M, rowStartY + 1); // Box nahi hai, toh direct M (margin) par print karein

      // ═════ DRAW HEXAGONS & LEGEND (Right) ═════
      // Hexagons ko theek answer ki shuruaati line ke level par rakha hai
      const hexStartY = rowStartY + 5;

      const hexPositions = [
        { cx: hexColCenterX - hexW - hexHGap / 2, cy: hexStartY },
        { cx: hexColCenterX + hexW + hexHGap / 2, cy: hexStartY },
        { cx: hexColCenterX, cy: hexStartY + hexRowSpacing },
      ];

      hexPositions.forEach((pos, mi) => {
        const cx = pos.cx; const cy = pos.cy; const m = pdfMetrics[mi]; const scoreVal = q.scores?.[m.key] ?? 0;
        const fillColor = this.hexService.getHexColor(scoreVal * 10);
        const txtColor = this.getHexTextColor(scoreVal * 10) === '#1a1a1a' ? '#1a1a1a' : '#ffffff';

        const pts = [
          { x: cx - hexW, y: cy - hexR / 2 }, { x: cx, y: cy - hexR },
          { x: cx + hexW, y: cy - hexR / 2 }, { x: cx + hexW, y: cy + hexR / 2 },
          { x: cx, y: cy + hexR }, { x: cx - hexW, y: cy + hexR / 2 },
        ];

        doc.setFillColor(fillColor); doc.setDrawColor('#ffffff'); doc.setLineWidth(0.3);
        const linesArr = pts.map((p, idx) => idx === 0 ? [0, 0] : [p.x - pts[idx - 1].x, p.y - pts[idx - 1].y]);
        doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(txtColor);
        doc.text(m.label, cx, cy - 1, { align: 'center' });
        doc.text(`${scoreVal}`, cx, cy + 2.5, { align: 'center' });
      });

      // Legend hamesha Hexagons ke theek neeche rahega
      const legendY = hexStartY + hexRowSpacing + hexR + 5;
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor('#374151');
      doc.text('C1: Correctness | C2: Completeness', hexColCenterX, legendY, { align: 'center' });
      doc.text('C3: Clarity', hexColCenterX, legendY + 3, { align: 'center' });

      // ═════ ADVANCE Y BELOW BOTH COLUMNS ═════
      // 🔥 NAYA FIX: Answer bottom aur 'C3: Clarity' line me se jo lowest hai, bas uske theek 3-4mm neeche y set karein
      const legendBottomY = legendY + 3; 
      const answerBottomY = rowStartY + ansBlockH;
      
      // +3 kar diya hai (aap isko +2 ya +4 karke gap kam/zyada kar sakte hain)
      y = Math.max(answerBottomY, legendBottomY) + 3;

      // ═════ DRAW FEEDBACK (Full Width) ═════
      if (q.feedback) {
        doc.setFontSize(8.5); doc.setFont('helvetica', 'italic'); doc.setTextColor('#6b7280');
        doc.text(fbLines, M, y);
        y += fbBlockH + 2;
      }

      // Divider line
      doc.setDrawColor('#e9d5ff'); doc.line(M, y, W - M, y); y += 6;
    });

    // ── FOOTER ──
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(8); doc.setTextColor('#9ca3af');
      doc.text(`Page ${p} of ${totalPages}`, M, 291);
      doc.text(` © 2026 Dipstick ® Platform. All rights reserved.`, 120, 291);
    }

    const safeName = (result.student_name || 'Student').replace(/\s+/g, '_');
    const fileName = `Report_${safeName}${filenameSuffix}.pdf`;

    // 1. Download
    doc.save(fileName);

    // 2. Send via email API
    try {
      const pdfBlob = doc.output('blob');
      const formData = new FormData();
      const username = sessionStorage.getItem('username') || '';
      formData.append('username', username);
      formData.append('pdf_report', pdfBlob, fileName);

      const toast = await this.toastCtrl.create({
        message: 'Downloading and sending report to your email...',
        duration: 2000,
        color: 'primary'
      });
      await toast.present();

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
  }
}