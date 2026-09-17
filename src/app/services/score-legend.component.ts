import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-score-legend',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="score-legend-vertical">
      <div class="legend-row" *ngFor="let item of legendItems">
        <!-- ✅ Wrapper centers each trapezoid so they form a funnel -->
        <div class="trapezoid-wrap">
          <div class="trapezoid"
               [style.background]="item.color"
               [style.width.px]="item.width"></div>
        </div>
        <span class="trap-range">{{ item.range }}</span>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }

    .score-legend-vertical {
      display: flex;
      flex-direction: column;
      gap: 0px;
    }

    .legend-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* ✅ Fixed-width wrapper — must match the LARGEST trapezoid width */
    /* All trapezoids center inside this wrapper, forming the funnel shape */
    .trapezoid-wrap {
      width: 110px;             /* ← match the largest width in legendItems (100px) + small buffer */
      display: flex;
      justify-content: center;
      flex-shrink: 0;
    }

    /* ✅ Width now comes from [style.width.px] binding per row */
    .trapezoid {
      height: 25px;
      clip-path: polygon(10% 0%, 90% 0%, 75% 100%, 25% 100%);
    }

    .trap-range {
      font-size: 11px;
      font-weight: 700;
      font-family: 'Syne', sans-serif;
      color: #e2eaf4;
      letter-spacing: 0.04em;
      white-space: nowrap;
    }
  `]
})
export class ScoreLegendComponent {

  // ✅ Each tier has progressively larger width — smallest at bottom (0-3.9), largest at top (9-10)
  legendItems = [
    { color: '#00b050', range: '9.0 - 10',  width: 100 },  // ← LARGEST (top)
    { color: '#92d050', range: '8.0 - 8.9', width: 90  },
    { color: '#fffd87', range: '6.0 - 7.9', width: 80  },
    { color: '#ffc000', range: '4.0 - 5.9', width: 70  },
    { color: '#ff0000', range: '0.0 - 3.9', width: 60  }   // ← SMALLEST (bottom)
  ];

  /**
   * Static method to draw the same legend in jsPDF.
   * Each trapezoid is progressively smaller from top to bottom, centered as a funnel.
   * Returns the final Y position after drawing.
   */
  static drawInPdf(doc: any, startX: number, startY: number): number {
    let y = startY;

    // ✅ Each tier has progressively smaller width (in mm) — smallest at bottom
    const items = [
      { color: '#00b050', range: '9.0 - 10',  width: 26 },  // ← LARGEST (top)
      { color: '#92d050', range: '8.0 - 8.9', width: 23 },
      { color: '#fffd87', range: '6.0 - 7.9', width: 20 },
      { color: '#ffc000', range: '4.0 - 5.9', width: 17 },
      { color: '#ff0000', range: '0.0 - 3.9', width: 14 }   // ← SMALLEST (bottom)
    ];

    const trapH = 6;
    const rowGap = 0.8;
    // Trapezoid clip ratios (matching CSS clip-path)
    const tl = 0.10, tr = 0.90, br = 0.75, bl = 0.25;

    // ✅ All trapezoids center around this X — forms the funnel shape
    const maxTrapW = 26;
    const centerX = startX + maxTrapW / 2;
    // ✅ Range text always at the same X (right of the widest trapezoid)
    const textX = startX + maxTrapW + 2.5;

    for (const item of items) {
      const trapW = item.width;
      // ✅ Center this trapezoid around centerX
      const x = centerX - trapW / 2;

      // Draw trapezoid as a closed polygon using doc.lines()
      const p1 = { x: x + trapW * tl, y: y };           // top-left
      const p2 = { x: x + trapW * tr, y: y };           // top-right
      const p3 = { x: x + trapW * br, y: y + trapH };   // bottom-right
      const p4 = { x: x + trapW * bl, y: y + trapH };   // bottom-left

      const pts = [p1, p2, p3, p4];
      const linesArr = pts.map((p, i) =>
        i === 0 ? [0, 0] : [p.x - pts[i - 1].x, p.y - pts[i - 1].y]
      );

      doc.setFillColor(item.color);
      doc.setDrawColor(item.color);
      doc.setLineWidth(0.2);
      doc.lines(linesArr, pts[0].x, pts[0].y, [1, 1], 'FD', true);

      // Draw range number beside the trapezoid (always at textX)
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor('#1f2937');
      const cy = y + trapH * 0.7;
      doc.text(item.range, textX, cy);

      y += trapH + rowGap;
    }

    return y;
  }
}