import { Injectable } from '@angular/core';
import Tesseract from 'tesseract.js';
import { CardCodeReading, CardPriceRequest, CardPriceResult, IdentifiedCard } from '../interfaces/identified-card';

interface CatalogCard extends IdentifiedCard {
  normalizedCode: string;
  normalizedName: string;
}

interface CardRectification {
  image: HTMLCanvasElement;
  detected: boolean;
  bounds: CardFrameBounds | null;
}

export interface CardFrameBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  corners: { x: number; y: number }[];
}

export interface CardShapeDetection {
  cardImage: HTMLCanvasElement;
  bounds: CardFrameBounds;
}

interface OpenCvMat {
  rows: number;
  cols: number;
  data32S: Int32Array;
  delete(): void;
}

interface OpenCvApi {
  Mat: new (...args: unknown[]) => OpenCvMat;
  MatVector: new () => { size(): number; get(index: number): OpenCvMat; delete(): void };
  Size: new (width: number, height: number) => unknown;
  Point: new (x: number, y: number) => unknown;
  Scalar: new (...values: number[]) => unknown;
  matFromArray(rows: number, cols: number, type: number, values: number[]): OpenCvMat;
  imread(image: HTMLCanvasElement): OpenCvMat;
  imshow(canvas: HTMLCanvasElement, image: OpenCvMat): void;
  cvtColor(src: OpenCvMat, dst: OpenCvMat, code: number): void;
  GaussianBlur(src: OpenCvMat, dst: OpenCvMat, size: unknown, sigma: number): void;
  Canny(src: OpenCvMat, dst: OpenCvMat, low: number, high: number): void;
  dilate(src: OpenCvMat, dst: OpenCvMat, kernel: OpenCvMat): void;
  getStructuringElement(shape: number, size: unknown): OpenCvMat;
  findContours(src: OpenCvMat, contours: { size(): number; get(index: number): OpenCvMat; delete(): void }, hierarchy: OpenCvMat, mode: number, method: number): void;
  arcLength(contour: OpenCvMat, closed: boolean): number;
  approxPolyDP(contour: OpenCvMat, approx: OpenCvMat, epsilon: number, closed: boolean): void;
  isContourConvex(contour: OpenCvMat): boolean;
  contourArea(contour: OpenCvMat): number;
  getPerspectiveTransform(source: OpenCvMat, destination: OpenCvMat): OpenCvMat;
  warpPerspective(src: OpenCvMat, dst: OpenCvMat, transform: OpenCvMat, size: unknown, interpolation: number, borderMode: number, border: unknown): void;
  COLOR_RGBA2GRAY: number;
  RETR_LIST: number;
  MORPH_RECT: number;
  CHAIN_APPROX_SIMPLE: number;
  CV_8UC1: number;
  CV_32FC2: number;
  INTER_CUBIC: number;
  BORDER_REPLICATE: number;
}

interface WindowWithCv extends Window {
  cv?: OpenCvApi | Promise<OpenCvApi> | (() => Promise<OpenCvApi>);
}

type OcrCandidate = { text: string; confidence: number };

@Injectable({ providedIn: 'root' })
export class CardRecognitionService {
  private worker?: Promise<Tesseract.Worker>;
  private cv?: Promise<OpenCvApi>;
  private catalog?: Promise<CatalogCard[]>;
  private cachedUsdToEur?: { rate: number; savedAt: number };
  private readonly catalogDbName = 'grand-line-card-catalog';
  private readonly catalogStoreName = 'catalog';
  private readonly catalogCacheKey = 'all-cards-v4';
  private trackedCorners: { x: number; y: number }[] | null = null;
  private trackingMisses = 0;
  private lastShapeDetectionAt = 0;

  resetCardTracking(): void {
    this.trackedCorners = null;
    this.trackingMisses = 0;
    this.lastShapeDetectionAt = 0;
  }

  async detectCardShape(frame: HTMLCanvasElement): Promise<CardShapeDetection | null> {
    const rectified = await this.rectifyCard(frame);
    if (!rectified.detected || !rectified.bounds) return null;
    return { cardImage: rectified.image, bounds: rectified.bounds };
  }

  async readCardCode(frame: HTMLCanvasElement, focusedCode = false): Promise<CardCodeReading> {
    const rectified = focusedCode ? { image: frame, detected: true, bounds: null } : await this.rectifyCard(frame);
    if (!rectified.detected) {
      return { code: null, name: '', rarity: null, alternateArt: false, cardDetected: false, rawText: '' };
    }

    const worker = await this.getWorker();
    const codeCandidates: OcrCandidate[] = [];
    const codeRegions = focusedCode ? [
      // The guide contains the full portrait card. OCR only the printed code
      // band near the bottom, with wider crops for alternate print layouts.
      { x: 0.025, y: 0.87, width: 0.78, height: 0.11, mode: Tesseract.PSM.SINGLE_LINE, treatment: 'raw' as const },
      { x: 0.025, y: 0.87, width: 0.78, height: 0.11, mode: Tesseract.PSM.SINGLE_LINE, treatment: 'binary' as const },
      { x: 0.025, y: 0.84, width: 0.95, height: 0.14, mode: Tesseract.PSM.SINGLE_LINE, treatment: 'contrast' as const },
    ] : [
      // The code can sit on either side of the bottom information strip depending
      // on printing and layout. Read both halves before trying the whole footer.
      { x: 0.04, y: 0.89, width: 0.46, height: 0.105, mode: Tesseract.PSM.SINGLE_LINE },
      { x: 0.50, y: 0.89, width: 0.46, height: 0.105, mode: Tesseract.PSM.SINGLE_LINE },
      { x: 0.04, y: 0.86, width: 0.92, height: 0.13, mode: Tesseract.PSM.SPARSE_TEXT },
    ];

    for (const region of codeRegions) {
      const crop = this.prepareRegion(rectified.image, region, 'code', 'treatment' in region ? region.treatment : 'contrast');
      await worker.setParameters({
        tessedit_pageseg_mode: region.mode,
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789- ',
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      const { data } = await worker.recognize(crop);
      const text = data.text?.trim() ?? '';
      if (text) codeCandidates.push({ text, confidence: data.confidence ?? 0 });
    }

    if (focusedCode) {
      const rawText = codeCandidates.map((item) => item.text).join(' / ');
      const voted = this.voteForCode(codeCandidates);
      let recovered: Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null = null;
      try { recovered = await this.recoverCodeFromCatalog(codeCandidates, ''); } catch { /* OCR vote can still resolve the printed ID. */ }
      const identifiedCode = recovered ?? voted;
      return identifiedCode
        ? { ...identifiedCode, name: '', cardDetected: true, rawText }
        : { code: null, name: '', rarity: null, alternateArt: false, cardDetected: true, rawText };
    }

    // The name is in the lower nameplate, below the card-type line. Cropping the
    // rules-text area above it was returning ability text instead of the name.
    const nameCrop = this.prepareRegion(rectified.image, { x: 0.08, y: 0.86, width: 0.84, height: 0.08 }, 'name');
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SINGLE_LINE,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .\'-',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const nameResult = await worker.recognize(nameCrop);
    const name = this.extractCardName(nameResult.data.text ?? '');
    const rawText = `ID: ${codeCandidates.map((item) => item.text).join(' / ')}; NAME: ${nameResult.data.text?.trim() ?? ''}`;
    const voted = this.voteForCode(codeCandidates);
    let recovered: Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null = null;
    try {
      recovered = await this.recoverCodeFromCatalog(codeCandidates, name);
    } catch {
      // The normal OCR vote remains available when the online/local catalog is unavailable.
    }
    const identifiedCode = recovered ?? voted;
    if (!identifiedCode) {
      return { code: null, name, rarity: null, alternateArt: false, cardDetected: true, rawText };
    }
    return { ...identifiedCode, name, cardDetected: true, rawText };
  }

  private async rectifyCard(frame: HTMLCanvasElement): Promise<CardRectification> {
    const cv = await this.getOpenCv();
    // Work at a moderate resolution: contour detection does not need the full camera size.
    const scale = Math.min(1, 800 / Math.max(frame.width, frame.height));
    const working = document.createElement('canvas');
    working.width = Math.max(1, Math.round(frame.width * scale));
    working.height = Math.max(1, Math.round(frame.height * scale));
    working.getContext('2d')?.drawImage(frame, 0, 0, working.width, working.height);

    const source = cv.imread(working);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const dilated = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    let bestPoints: number[] | null = null;
    let bestScore = 0;

    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      const frameArea = working.width * working.height;
      // Camera exposure and card sleeves change edge contrast. Search at three
      // Canny sensitivities so a single fixed threshold does not decide detection.
      for (const [lowThreshold, highThreshold] of [[18, 65], [40, 120], [75, 200]]) {
        cv.Canny(blurred, edges, lowThreshold, highThreshold);
        cv.dilate(edges, dilated, kernel);
        const hierarchy = new cv.Mat();
        const contours = new cv.MatVector();
        try {
          cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          for (let index = 0; index < contours.size(); index += 1) {
            const contour = contours.get(index);
            const perimeter = cv.arcLength(contour, true);
            const approximation = new cv.Mat();
            try {
              cv.approxPolyDP(contour, approximation, perimeter * 0.025, true);
              if (approximation.rows !== 4 || !cv.isContourConvex(approximation)) continue;
              const area = Math.abs(cv.contourArea(approximation));
              if (area < frameArea * 0.025 || area > frameArea * 0.98) continue;
              const points = Array.from(approximation.data32S.slice(0, 8));
              const ordered = this.orderCorners(points);
              const width = (this.distance(ordered[0], ordered[1]) + this.distance(ordered[2], ordered[3])) / 2;
              const height = (this.distance(ordered[0], ordered[3]) + this.distance(ordered[1], ordered[2])) / 2;
              if (!width || !height) continue;
              const ratio = width / height;
              if (ratio < 0.48 || ratio > 0.90) continue;
              if (!this.hasCardLikeGeometry(ordered)) continue;
              if (ordered.some(([x, y]) => x < 2 || y < 2 || x > working.width - 3 || y > working.height - 3)) continue;
              const ratioFit = Math.max(0.15, 1 - Math.abs(ratio - 0.70));
              const score = area * ratioFit;
              if (score > bestScore) {
                bestScore = score;
                bestPoints = ordered.flatMap((point) => point);
              }
            } finally {
              approximation.delete();
              contour.delete();
            }
          }
        } finally {
          contours.delete();
          hierarchy.delete();
        }
      }

      if (!bestPoints) {
        this.trackingMisses += 1;
        // Keep the outline through a couple of blurry frames caused by hand
        // movement; the crop is still taken from the current frame.
        if (this.trackedCorners && this.trackingMisses <= 2 && Date.now() - this.lastShapeDetectionAt < 900) {
          bestPoints = this.trackedCorners.flatMap(({ x, y }) => [x * working.width, y * working.height]);
        } else {
          this.trackedCorners = null;
          return { image: frame, detected: false, bounds: null };
        }
      } else {
        const detectedCorners = Array.from({ length: 4 }, (_, index) => ({
          x: bestPoints![index * 2] / working.width,
          y: bestPoints![index * 2 + 1] / working.height,
        }));
        const canTrack = !!this.trackedCorners && Date.now() - this.lastShapeDetectionAt < 900 &&
          this.cornersAreNear(this.trackedCorners, detectedCorners);
        const previousWeight = canTrack ? 0.38 : 0;
        bestPoints = detectedCorners.flatMap((corner, index) => {
          const previous = this.trackedCorners?.[index];
          return previous && previousWeight
            ? [
                (corner.x * (1 - previousWeight) + previous.x * previousWeight) * working.width,
                (corner.y * (1 - previousWeight) + previous.y * previousWeight) * working.height,
              ]
            : [corner.x * working.width, corner.y * working.height];
        });
        this.trackedCorners = Array.from({ length: 4 }, (_, index) => ({
          x: bestPoints![index * 2] / working.width,
          y: bestPoints![index * 2 + 1] / working.height,
        }));
        this.trackingMisses = 0;
        this.lastShapeDetectionAt = Date.now();
      }

      const cornerX = bestPoints.filter((_, index) => index % 2 === 0);
      const cornerY = bestPoints.filter((_, index) => index % 2 === 1);
      const left = Math.min(...cornerX);
      const top = Math.min(...cornerY);
      const right = Math.max(...cornerX);
      const bottom = Math.max(...cornerY);
      const bounds = {
        x: left / working.width,
        y: top / working.height,
        width: (right - left) / working.width,
        height: (bottom - top) / working.height,
        corners: Array.from({ length: 4 }, (_, index) => ({
          x: bestPoints![index * 2] / working.width,
          y: bestPoints![index * 2 + 1] / working.height,
        })),
      };

      const outWidth = 560;
      const outHeight = 800;
      const sourcePoints = cv.matFromArray(4, 1, cv.CV_32FC2, bestPoints);
      const targetPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, outWidth - 1, 0, outWidth - 1, outHeight - 1, 0, outHeight - 1]);
      const transform = cv.getPerspectiveTransform(sourcePoints, targetPoints);
      const warped = new cv.Mat();
      const output = document.createElement('canvas');
      output.width = outWidth;
      output.height = outHeight;
      try {
        cv.warpPerspective(source, warped, transform, new cv.Size(outWidth, outHeight), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
        cv.imshow(output, warped);
        return { image: output, detected: true, bounds };
      } finally {
        sourcePoints.delete();
        targetPoints.delete();
        transform.delete();
        warped.delete();
      }
    } finally {
      source.delete();
      gray.delete();
      blurred.delete();
      edges.delete();
      dilated.delete();
      kernel.delete();
    }
  }

  private orderCorners(points: number[]): [number, number][] {
    const corners: [number, number][] = [
      [points[0], points[1]], [points[2], points[3]], [points[4], points[5]], [points[6], points[7]],
    ];
    const bySum = [...corners].sort((a, b) => a[0] + a[1] - (b[0] + b[1]));
    const byDifference = [...corners].sort((a, b) => a[0] - a[1] - (b[0] - b[1]));
    return [bySum[0], byDifference[3], bySum[3], byDifference[0]];
  }

  private distance(a: [number, number], b: [number, number]): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }

  private cornersAreNear(previous: { x: number; y: number }[], current: { x: number; y: number }[]): boolean {
    const averageMovement = current.reduce((total, corner, index) =>
      total + Math.hypot(corner.x - previous[index].x, corner.y - previous[index].y), 0) / current.length;
    return averageMovement < 0.18;
  }

  private hasCardLikeGeometry(points: [number, number][]): boolean {
    const sides = points.map((point, index) => this.distance(point, points[(index + 1) % 4]));
    const widthRatio = Math.max(sides[0], sides[2]) / Math.max(1, Math.min(sides[0], sides[2]));
    const heightRatio = Math.max(sides[1], sides[3]) / Math.max(1, Math.min(sides[1], sides[3]));
    if (widthRatio > 1.8 || heightRatio > 1.8) return false;
    return points.every((corner, index) => {
      const previous = points[(index + 3) % 4];
      const next = points[(index + 1) % 4];
      const first = [previous[0] - corner[0], previous[1] - corner[1]];
      const second = [next[0] - corner[0], next[1] - corner[1]];
      const denominator = Math.hypot(...first) * Math.hypot(...second);
      if (!denominator) return false;
      const cosine = Math.max(-1, Math.min(1, (first[0] * second[0] + first[1] * second[1]) / denominator));
      const angle = Math.acos(cosine) * 180 / Math.PI;
      return angle >= 55 && angle <= 125;
    });
  }

  private prepareRegion(
    source: HTMLCanvasElement,
    region: { x: number; y: number; width: number; height: number },
    kind: 'code' | 'name',
    treatment: 'raw' | 'contrast' | 'binary' = 'contrast',
  ): HTMLCanvasElement {
    const sx = Math.round(source.width * region.x);
    const sy = Math.round(source.height * region.y);
    const sw = Math.max(1, Math.round(source.width * region.width));
    const sh = Math.max(1, Math.round(source.height * region.height));
    const scale = Math.min(6, Math.max(3, 1500 / Math.max(sw, sh)));
    const border = 22;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(sw * scale) + border * 2;
    canvas.height = Math.round(sh * scale) + border * 2;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return canvas;
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, sx, sy, sw, sh, border, border, canvas.width - border * 2, canvas.height - border * 2);

    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const binaryThreshold = treatment === 'binary' ? this.otsuThreshold(pixels.data) : 158;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      const contrast = kind === 'code'
        ? Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128))
        : Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));
      // The focused crop often has pale lettering on a dark red footer.
      // Binarizing one pass gives Tesseract crisp character edges; retain a
      // grayscale pass too for low contrast or reflective cards.
      const value = treatment === 'binary' ? (contrast > binaryThreshold ? 255 : 0) : treatment === 'raw' ? gray : contrast;
      pixels.data[index] = value;
      pixels.data[index + 1] = value;
      pixels.data[index + 2] = value;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
  }

  private otsuThreshold(pixels: Uint8ClampedArray): number {
    const histogram = new Array<number>(256).fill(0);
    let total = 0;
    let weightedTotal = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = Math.max(0, Math.min(255, Math.round((pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114 - 128) * 1.55 + 128)));
      histogram[gray] += 1;
      weightedTotal += gray;
      total += 1;
    }
    let backgroundWeight = 0;
    let backgroundSum = 0;
    let bestVariance = -1;
    let threshold = 158;
    for (let level = 0; level < histogram.length; level += 1) {
      backgroundWeight += histogram[level];
      if (!backgroundWeight) continue;
      const foregroundWeight = total - backgroundWeight;
      if (!foregroundWeight) break;
      backgroundSum += level * histogram[level];
      const backgroundMean = backgroundSum / backgroundWeight;
      const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
      const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = level;
      }
    }
    return threshold;
  }

  private voteForCode(candidates: OcrCandidate[]): Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null {
    const votes = new Map<string, { score: number; raws: string[] }>();
    for (const candidate of candidates) {
      const parsed = this.parseReading(candidate.text);
      if (!parsed?.code) continue;
      const current = votes.get(parsed.code) ?? { score: 0, raws: [] };
      current.score += Math.max(1, candidate.confidence);
      current.raws.push(candidate.text);
      votes.set(parsed.code, current);
    }
    const ranked = [...votes].sort((a, b) => b[1].score - a[1].score);
    if (!ranked.length) return null;
    if (ranked.length > 1 && ranked[0][1].score < ranked[1][1].score * 1.35) return null;
    const [code, result] = ranked[0];
    const parsed = this.parseReading(result.raws.join(' '));
    return { code, rarity: parsed?.rarity ?? null, alternateArt: Boolean(parsed?.alternateArt) };
  }

  private async recoverCodeFromCatalog(candidates: OcrCandidate[], recognizedName: string): Promise<Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null> {
    const readings = candidates.flatMap((candidate) => {
      const normalized = candidate.text.toUpperCase()
        .replace(/[\u2014\u2013\u2212_]/g, '-')
        .replace(/\b[0OQ6]P(?=\s*\d)/g, 'OP')
        .replace(/\s+/g, ' ');
      const setMatch = normalized.match(/\b(OP|ST|EB|PRB)\s*-?\s*([0-9OQSBZ]{1,2})\s*-?\s*([0-9OQILSBZ]\s*[0-9OQILSBZ]\s*[0-9OQILSBZ])\b/);
      const promoMatch = normalized.match(/\b(P|DON)\s*-?\s*([0-9OQILSBZ]\s*[0-9OQILSBZ]\s*[0-9OQILSBZ])\b/);
      if (setMatch) {
        return [{
          set: `${setMatch[1]}${this.normalizeOcrDigits(setMatch[2]).padStart(2, '0')}`,
          number: this.normalizeOcrDigits(setMatch[3]),
          alternateArt: Boolean(this.parseReading(candidate.text)?.alternateArt),
          confidence: candidate.confidence,
        }];
      }
      if (promoMatch) {
        return [{
          set: promoMatch[1],
          number: this.normalizeOcrDigits(promoMatch[2]),
          alternateArt: Boolean(this.parseReading(candidate.text)?.alternateArt),
          confidence: candidate.confidence,
        }];
      }
      return [];
    });
    // A name alone is ambiguous across reprints and alternate art. Leave code
    // unresolved so the scanner can ask the collector to choose a catalog match.
    if (!readings.length) return null;

    const catalog = await this.getCatalog();
    const ranked: Array<{ card: CatalogCard; distance: number; artMismatch: number; exactCodeMatch: number; nameSimilarity: number; confidence: number }> = [];
    for (const reading of readings) {
      const typedNumber = reading.number;
      for (const card of catalog) {
        const upperCode = card.code.toUpperCase();
        let cardSet: string;
        let cardNumber: string;
        if (reading.set === 'P' || reading.set === 'DON') {
          const codeParts = upperCode.match(/^(P|DON)[-_ ]?(\d{1,3})/);
          if (!codeParts) continue;
          cardSet = codeParts[1];
          cardNumber = codeParts[2].padStart(3, '0');
        } else {
          const codeParts = upperCode.match(/^([A-Z]+)[-_ ]?(\d{1,2})[-_ ]?(\d{1,3})/);
          if (!codeParts) continue;
          cardSet = `${codeParts[1]}${codeParts[2].padStart(2, '0')}`;
          cardNumber = codeParts[3].padStart(3, '0');
        }
        if (cardSet !== reading.set) continue;

        const distance = this.editDistance(typedNumber, cardNumber);
        // A one-digit fuzzy correction can turn one real card into another. Only
        // resolve catalog candidates when all three printed digits agree.
        if (distance !== 0) continue;
        ranked.push({
          card,
          distance,
          artMismatch: (card.variant === 'Alternate art') === reading.alternateArt ? 0 : 1,
          exactCodeMatch: this.normalizeCode(card.code) === this.normalizeCode(`${reading.set}-${cardNumber}`) ? 0 : 1,
          nameSimilarity: this.nameSimilarity(this.normalizeName(recognizedName), card.normalizedName),
          confidence: reading.confidence,
        });
      }
    }
    ranked.sort((a, b) => a.distance - b.distance || a.artMismatch - b.artMismatch || a.exactCodeMatch - b.exactCodeMatch || b.nameSimilarity - a.nameSimilarity || b.confidence - a.confidence);
    const best = ranked[0];
    if (!best) return null;
    const second = ranked.find((item) => this.cardFamilyCode(item.card.code) !== this.cardFamilyCode(best.card.code));
    if (second && second.distance === best.distance && second.artMismatch === best.artMismatch && second.exactCodeMatch === best.exactCodeMatch && Math.abs(second.nameSimilarity - best.nameSimilarity) < 0.08) return null;
    const parsed = candidates.map((candidate) => this.parseReading(candidate.text)).find((item) => item?.code);
    return { code: best.card.code, rarity: parsed?.rarity ?? null, alternateArt: best.card.variant === 'Alternate art' };
  }

  private parseReading(rawText: string): Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null {
    const normalized = rawText.toUpperCase()
      .replace(/[\u2010-\u2015\u2212_]/g, '-')
      .replace(/[|!]/g, '1')
      .replace(/\b[0OQ6]P(?=\s*\d)/g, 'OP')
      .replace(/\s+/g, ' ');
    const setMatch = normalized.match(/\b(OP|ST|EB|PRB)\s*-?\s*([0-9OQSBZ]{1,2})\s*-?\s*([0-9OQILSBZ]\s*[0-9OQILSBZ]\s*[0-9OQILSBZ])\b/);
    const promoMatch = normalized.match(/\b(P|DON)\s*-?\s*([0-9OQILSBZ]\s*[0-9OQILSBZ]\s*[0-9OQILSBZ])\b/);
    let code: string | null = null;
    if (setMatch) {
      const setNumber = this.normalizeOcrDigits(setMatch[2]);
      const cardNumber = this.normalizeOcrDigits(setMatch[3]);
      code = `${setMatch[1]}${setNumber}-${cardNumber}`;
    } else if (promoMatch) {
      const cardNumber = this.normalizeOcrDigits(promoMatch[2]);
      code = `${promoMatch[1]}-${cardNumber}`;
    }
    if (!code) return null;
    const rarity = normalized.match(/(?:^|[^A-Z0-9])(SEC|SR|UC|R|C|L|SP|TR)(?=$|[^A-Z0-9])/)?.[1] ?? null;
    const alternateArt = Boolean(rarity && new RegExp(`[\\u2605\\u2606*]\\s*(?:${rarity})\\b`).test(normalized));
    return { code, rarity, alternateArt };
  }

  private extractCardName(rawText: string): string {
    return rawText.split(/\r?\n/)
      .map((line) => line.replace(/[^A-Z0-9 .'-]/gi, ' ').replace(/\s+/g, ' ').trim())
      .filter((line) => line.length >= 3 && !/^(LEADER|CHARACTER|EVENT|STAGE|LIFE|POWER|COST)$/i.test(line))
      .sort((a, b) => b.replace(/[^A-Z0-9]/gi, '').length - a.replace(/[^A-Z0-9]/gi, '').length)[0] ?? '';
  }

  private normalizeOcrDigits(value: string): string {
    return value.replace(/\s/g, '').replace(/[OQ]/g, '0').replace(/[IL]/g, '1')
      .replace(/S/g, '5').replace(/B/g, '8').replace(/Z/g, '2');
  }

  async findCard(code: string, recognizedName = '', requireNameMatch = false): Promise<IdentifiedCard | null> {
    const catalog = await this.getCatalog();
    const normalizedCode = this.normalizeCode(code);
    const exact = catalog.filter((card) => card.normalizedCode === normalizedCode);
    if (!recognizedName.trim()) {
      if (exact.length) return this.publicCardInEur(exact[0]);
      return requireNameMatch ? null : this.lookupCardByCode(code);
    }

    const nameKey = this.normalizeName(recognizedName);
    const candidates = catalog
      .map((card) => ({ card, codeDistance: this.editDistance(normalizedCode, card.normalizedCode), nameSimilarity: this.nameSimilarity(nameKey, card.normalizedName) }))
      .filter((item) => item.codeDistance <= 1)
      .sort((a, b) => this.matchScore(b.codeDistance, b.nameSimilarity) - this.matchScore(a.codeDistance, a.nameSimilarity));
    const best = candidates[0];
    if (!best) return null;
    // Require both signals to agree; fuzzy number-only matches are intentionally rejected.
    const minimumNameScore = best.codeDistance === 0 ? 0.38 : 0.62;
    if (best.nameSimilarity < minimumNameScore) return null;
    if (candidates[1] && this.matchScore(best.codeDistance, best.nameSimilarity) - this.matchScore(candidates[1].codeDistance, candidates[1].nameSimilarity) < 0.08) return null;
    return this.publicCardInEur(best.card);
  }

  async getCardColorsByCode(codes: string[]): Promise<Record<string, string[]>> {
    const catalog = await this.getCatalog();
    const colorsByCode = new Map(catalog.filter((card) => card.colors?.length).map((card) => [card.normalizedCode, card.colors!]));
    return Object.fromEntries(codes.map((code) => [code, colorsByCode.get(this.normalizeCode(code)) ?? []]));
  }

  async findCardPrintings(code: string): Promise<IdentifiedCard[]> {
    const enteredPrefix = this.normalizeCode(code);
    if (!enteredPrefix) return [];
    try {
      // Manual search reads the relevant endpoint directly so the chooser
      // always works from printing IDs, not a stale browser catalog snapshot.
      const endpoint = /^ST/i.test(code) ? '/api/allSTCards/'
        : /^P/i.test(code) ? '/api/allPromoCards/'
          : /^DON/i.test(code) ? '/api/allDonCards/'
            : '/api/allSetCards/';
      const response = await fetch(`https://www.optcgapi.com${endpoint}`, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`Card catalog request failed (${response.status}).`);
      const catalog = this.parseCatalogPayloads([await response.json()]);
      const matches = catalog
        // The user-entered number is a prefix. Keep each catalog printing as
        // its own result: card_image_id contains suffixes such as _p1 and _r1.
        .filter((card) => card.normalizedCode.startsWith(enteredPrefix))
        .sort((a, b) => {
          const exactDelta = Number(b.normalizedCode === enteredPrefix) - Number(a.normalizedCode === enteredPrefix);
          return exactDelta || a.code.localeCompare(b.code) || a.name.localeCompare(b.name);
        });
      if (matches.length) return Promise.all(matches.map((card) => this.publicCardInEur(card)));
      return [];
    } catch {
      // Use the cached catalog if the live endpoint is temporarily unavailable.
      try {
        const cachedMatches = (await this.getCatalog())
          .filter((card) => card.normalizedCode.startsWith(enteredPrefix))
          .sort((a, b) => a.code.localeCompare(b.code));
        if (cachedMatches.length) return Promise.all(cachedMatches.map((card) => this.publicCardInEur(card)));
      } catch { /* Report no results through the normal empty state. */ }
    }
    return [];
  }

  async findCardPrintingsByName(name: string): Promise<IdentifiedCard[]> {
    const nameKey = this.normalizeName(name);
    if (nameKey.length < 4) return [];
    const catalog = await this.getCatalog();
    const ranked = catalog
      .map((card) => ({ card, similarity: this.nameSimilarity(nameKey, card.normalizedName) }))
      .filter((item) => item.similarity >= 0.58)
      .sort((a, b) => b.similarity - a.similarity || a.card.name.localeCompare(b.card.name) || a.card.code.localeCompare(b.card.code))
      .slice(0, 40);
    return Promise.all(ranked.map(({ card }) => this.publicCardInEur(card)));
  }

  private matchScore(codeDistance: number, nameSimilarity: number): number {
    return (codeDistance === 0 ? 0.42 : 0.12) + nameSimilarity * 0.58;
  }

  private nameSimilarity(needle: string, candidate: string): number {
    if (!needle || !candidate) return 0;
    if (needle === candidate) return 1;
    if (candidate.includes(needle) || needle.includes(candidate)) return Math.min(1, Math.min(needle.length, candidate.length) / Math.max(needle.length, candidate.length));
    const words = needle.split(' ').filter((word) => word.length > 1);
    if (words.length > 1) {
      const matched = words.filter((word) => candidate.split(' ').some((part) => this.editDistance(word, part) <= Math.max(1, Math.floor(word.length * 0.25))));
      if (matched.length) return matched.length / words.length;
    }
    const distance = this.editDistance(needle, candidate);
    return 1 - distance / Math.max(needle.length, candidate.length);
  }

  private normalizeCode(value: string): string {
    return value.toUpperCase().replace(/[OQ]/g, '0').replace(/[IL]/g, '1').replace(/[^A-Z0-9]/g, '');
  }

  private canonicalCardCode(value: string): string {
    const normalized = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const match = normalized.match(/^([A-Z]+)(\d{2})0*(\d{1,3})$/);
    return match ? `${match[1]}${match[2]}${Number(match[3])}` : normalized;
  }

  private cardFamilyCode(value: string): string {
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    const baseCode = normalized.replace(/(?:[_-](?:P\d+|R\d+|SEC|SP|AA\d*|ALT\d*|PARALLEL|ALTERNATE))$/i, '');
    return this.canonicalCardCode(baseCode);
  }

  private normalizeName(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  private editDistance(a: string, b: string): number {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = previous[0];
      previous[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const above = previous[j];
        previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = above;
      }
    }
    return previous[b.length];
  }

  private publicCard(card: CatalogCard): IdentifiedCard {
    const { normalizedCode: _normalizedCode, normalizedName: _normalizedName, ...result } = card;
    return result;
  }

  private async publicCardInEur(card: CatalogCard): Promise<IdentifiedCard> {
    const result = this.publicCard(card);
    if (result.marketPrice === null) return result;
    try {
      return { ...result, marketPrice: Math.round(result.marketPrice * await this.getUsdToEurRate() * 100) / 100, priceUpdatedAt: new Date().toISOString() };
    } catch {
      return { ...result, marketPrice: null };
    }
  }

  private async getUsdToEurRate(): Promise<number> {
    if (this.cachedUsdToEur && Date.now() - this.cachedUsdToEur.savedAt < 24 * 60 * 60 * 1000) return this.cachedUsdToEur.rate;
    try {
      const stored = localStorage.getItem('grand-line-usd-eur-rate-v2');
      if (stored) {
        const cached = JSON.parse(stored) as { rate?: unknown; savedAt?: unknown };
        const rate = Number(cached.rate);
        const savedAt = Number(cached.savedAt);
        if (Number.isFinite(rate) && rate > 0 && Number.isFinite(savedAt) && Date.now() - savedAt < 24 * 60 * 60 * 1000) {
          this.cachedUsdToEur = { rate, savedAt };
          return rate;
        }
      }
    } catch { /* Fetch a fresh rate if browser storage is unavailable. */ }
    // The ECB publishes USD as a quote against EUR, so invert EUR/USD for USD/EUR.
    const response = await fetch('https://api.frankfurter.dev/v2/providers/ecb/rate/eur/usd', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Currency conversion failed (${response.status}).`);
    const data = await response.json() as { rate?: unknown };
    const eurUsdRate = Number(data.rate);
    if (!Number.isFinite(eurUsdRate) || eurUsdRate <= 0) throw new Error('The EUR/USD exchange rate is invalid.');
    const rate = 1 / eurUsdRate;
    const savedAt = Date.now();
    this.cachedUsdToEur = { rate, savedAt };
    try { localStorage.setItem('grand-line-usd-eur-rate-v2', JSON.stringify({ rate, savedAt })); } catch { /* Keep the rate in memory. */ }
    return rate;
  }

  async refreshMarketPrices(cards: CardPriceRequest[]): Promise<CardPriceResult[]> {
    const catalog = await this.getCatalog(true);
    const usdToEur = await this.getUsdToEurRate();

    const updatedAt = new Date().toISOString();
    const prices: CardPriceResult[] = [];
    for (const card of cards) {
      const normalizedCode = this.canonicalCardCode(card.code);
      const nameKey = this.normalizeName(card.name);
      const candidates = catalog.filter((entry) => this.cardFamilyCode(entry.code) === this.cardFamilyCode(card.code) && entry.marketPrice !== null);
      candidates.sort((a, b) => {
        const exactPrintingDelta = Number(this.normalizeCode(b.code) === this.normalizeCode(card.code)) - Number(this.normalizeCode(a.code) === this.normalizeCode(card.code));
        if (exactPrintingDelta) return exactPrintingDelta;
        const variantDelta = Number(b.variant === card.variant) - Number(a.variant === card.variant);
        if (variantDelta) return variantDelta;
        const scoreDelta = this.nameSimilarity(nameKey, b.normalizedName) - this.nameSimilarity(nameKey, a.normalizedName);
        return scoreDelta;
      });
      const usdPrice = candidates[0]?.marketPrice;
      if (usdPrice === null || usdPrice === undefined) continue;
      prices.push({ id: card.id, marketPrice: Math.round(usdPrice * usdToEur * 100) / 100, priceUpdatedAt: updatedAt });
    }
    return prices;
  }

  private async getCatalog(forceRefresh = false): Promise<CatalogCard[]> {
    if (forceRefresh) this.catalog = undefined;
    if (!this.catalog) this.catalog = this.loadCatalog(forceRefresh);
    try {
      return await this.catalog;
    } catch (error) {
      this.catalog = undefined;
      throw error;
    }
  }

  private async loadCatalog(forceRefresh = false): Promise<CatalogCard[]> {
    const cached = await this.readCatalogCache();
    if (!forceRefresh && cached && Date.now() - cached.savedAt < 24 * 60 * 60 * 1000) return cached.cards;
    const endpoints = ['/api/allSetCards/', '/api/allSTCards/', '/api/allPromoCards/', '/api/allDonCards/'];
    try {
      const responses = await Promise.allSettled(endpoints.map(async (endpoint) => {
        const response = await fetch(`https://www.optcgapi.com${endpoint}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Card catalog request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      }));
      const freshPayloads = responses.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const freshCards = this.parseCatalogPayloads(freshPayloads);
      if (!freshCards.length) {
        if (cached?.cards.length) return cached.cards;
        throw new Error('The card catalog returned no cards.');
      }
      const cardsByPrinting = new Map((cached?.cards ?? []).map((card) => [`${card.normalizedCode}|${card.normalizedName}`, card]));
      for (const card of freshCards) cardsByPrinting.set(`${card.normalizedCode}|${card.normalizedName}`, card);
      const cards = [...cardsByPrinting.values()];
      try {
        await this.writeCatalogCache(cards);
      } catch {
        // Keep the index in memory if this browser blocks IndexedDB.
      }
      return cards;
    } catch (error) {
      if (cached?.cards.length) return cached.cards;
      throw error;
    }
  }

  private parseCatalogPayloads(payloads: unknown[]): CatalogCard[] {
    const cards = new Map<string, CatalogCard>();
    for (const payload of payloads) {
      const container = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
      const nestedRecords = container?.['value'] ?? container?.['data'] ?? container?.['results'];
      const records = Array.isArray(payload) ? payload : Array.isArray(nestedRecords) ? nestedRecords : container ? Object.values(container) : [];
      for (const item of records) {
        if (!item || typeof item !== 'object') continue;
        const data = item as Record<string, unknown>;
        // card_set_id is shared by every parallel/reprint. card_image_id carries
        // the unique printing id (for example OP05-119_p1 or OP05-119_r1).
        const code = data['card_image_id'] ?? data['card_id'] ?? data['card_set_id'] ?? data['id'];
        const name = data['card_name'] ?? data['name'];
        if (typeof code !== 'string' || typeof name !== 'string' || !code.trim() || !name.trim()) continue;
        const image = data['card_image'] ?? data['card_image_url'] ?? data['image_url'];
        const marketPrice = this.parsePrice(data['market_price'] ?? data['marketPrice']);
        const rawColors = data['card_color'] ?? data['colors'] ?? data['color'];
        const colors = (Array.isArray(rawColors) ? rawColors : typeof rawColors === 'string' ? rawColors.split(/[\\/,|&+]+/) : [])
          .filter((color): color is string => typeof color === 'string')
          .map((color) => color.trim())
          .filter(Boolean);
        const entry: CatalogCard = {
          code: code.trim(),
          name: name.trim(),
          marketPrice,
          variant: /(?:_p\d+|-(?:sec|sp|aa\d*|alt\d*)$)/i.test(code) || /parallel|alternate|manga|wanted poster|\(sp\)/i.test(name) ? 'Alternate art' : 'Standard',
          imageUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
          colors: colors.length ? [...new Set(colors)] : undefined,
          normalizedCode: this.normalizeCode(code),
          normalizedName: this.normalizeName(name),
        };
        cards.set(`${entry.normalizedCode}|${entry.normalizedName}`, entry);
      }
    }
    return [...cards.values()];
  }

  private parsePrice(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    const price = Number(value);
    return Number.isFinite(price) && price >= 0 ? price : null;
  }

  private async readCatalogCache(): Promise<{ cards: CatalogCard[]; savedAt: number } | null> {
    try {
      const db = await this.openCatalogDatabase();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(this.catalogStoreName, 'readonly').objectStore(this.catalogStoreName).get(this.catalogCacheKey);
        request.onsuccess = () => resolve((request.result as { cards: CatalogCard[]; savedAt: number } | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } catch {
      return null;
    }
  }

  private async writeCatalogCache(cards: CatalogCard[]): Promise<void> {
    const db = await this.openCatalogDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.catalogStoreName, 'readwrite');
      transaction.objectStore(this.catalogStoreName).put({ key: this.catalogCacheKey, cards, savedAt: Date.now() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  private openCatalogDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.catalogDbName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.catalogStoreName, { keyPath: 'key' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private getOpenCv(): Promise<OpenCvApi> {
    if (!this.cv) {
      this.cv = this.loadOpenCv().catch((error) => {
        this.cv = undefined;
        throw error;
      });
    }
    return this.cv;
  }

  private async lookupCardByCode(code: string): Promise<IdentifiedCard | null> {
    const prefix = code.match(/^[A-Z]+/)?.[0] ?? '';
    const endpointGroups = prefix === 'ST' ? ['decks'] : prefix === 'P' ? ['promos', 'sets'] : prefix === 'DON' ? ['don', 'sets'] : ['sets'];
    for (const group of endpointGroups) {
      const response = await fetch(`https://www.optcgapi.com/api/${group}/card/${encodeURIComponent(code)}/`, { headers: { Accept: 'application/json' } });
      if (!response.ok) continue;
      const payload: unknown = await response.json();
      const container = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
      const nestedRecords = container?.['value'] ?? container?.['data'] ?? container?.['results'];
      const item = Array.isArray(payload) ? payload[0] : Array.isArray(nestedRecords) ? nestedRecords[0] : payload;
      if (!item || typeof item !== 'object') continue;
      const data = item as Record<string, unknown>;
      const name = data['card_name'] ?? data['name'];
      const actualCode = data['card_image_id'] ?? data['card_id'] ?? data['card_set_id'] ?? data['id'] ?? code;
      if (typeof name !== 'string' || typeof actualCode !== 'string') continue;
      const image = data['card_image'] ?? data['card_image_url'] ?? data['image_url'];
      const marketPrice = this.parsePrice(data['market_price'] ?? data['marketPrice']);
      const identified: IdentifiedCard = {
        code: actualCode,
        name,
        marketPrice,
        variant: /(?:_p\d+|parallel|alternate|-(?:sec|sp|aa\d*|alt\d*)$)/i.test(actualCode) || /parallel|alternate/i.test(name) ? 'Alternate art' : 'Standard',
        imageUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
      };
      if (identified.marketPrice === null) return identified;
      try {
        return { ...identified, marketPrice: Math.round(identified.marketPrice * await this.getUsdToEurRate() * 100) / 100, priceUpdatedAt: new Date().toISOString() };
      } catch {
        return { ...identified, marketPrice: null };
      }
    }
    return null;
  }

  private async loadOpenCv(): Promise<OpenCvApi> {
    const windowWithCv = window as WindowWithCv;
    if (!windowWithCv.cv) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-opencv]');
        if (existing) {
          existing.addEventListener('load', () => resolve(), { once: true });
          existing.addEventListener('error', () => reject(new Error('OpenCV could not be loaded.')), { once: true });
          return;
        }
        const script = document.createElement('script');
        script.src = '/assets/opencv/opencv.js';
        script.async = true;
        script.dataset['opencv'] = 'true';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('OpenCV could not be loaded.'));
        document.head.appendChild(script);
      });
    }
    const module = windowWithCv.cv;
    if (!module) throw new Error('OpenCV is unavailable.');
    if (typeof module === 'function') return module();
    return await module;
  }

  private getWorker(): Promise<Tesseract.Worker> {
    if (!this.worker) {
      this.worker = Tesseract.createWorker('eng', Tesseract.OEM.LSTM_ONLY, {
        workerPath: '/assets/tesseract/worker.min.js',
        logger: () => undefined,
      }, {
        load_system_dawg: '0',
        load_freq_dawg: '0',
        load_number_dawg: '0',
      });
    }
    return this.worker;
  }

  async dispose(): Promise<void> {
    if (!this.worker) return;
    const worker = await this.worker.catch(() => undefined);
    await worker?.terminate();
    this.worker = undefined;
  }
}
