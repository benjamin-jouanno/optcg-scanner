import { Injectable } from '@angular/core';
import Tesseract from 'tesseract.js';

export interface IdentifiedCard {
  code: string;
  name: string;
  marketPrice: number | null;
  priceUpdatedAt?: string | null;
  variant: string;
  imageUrl: string | null;
}

export interface CardCodeReading {
  code: string | null;
  name: string;
  rarity: string | null;
  alternateArt: boolean;
  cardDetected: boolean;
  rawText: string;
}

export interface CardPriceRequest { id: string; code: string; name: string; variant: string; }
export interface CardPriceResult { id: string; marketPrice: number; priceUpdatedAt: string; }

interface CatalogCard extends IdentifiedCard {
  normalizedCode: string;
  normalizedName: string;
}

interface CardRectification {
  image: HTMLCanvasElement;
  detected: boolean;
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
  private readonly catalogCacheKey = 'all-cards-v3';

  async readCardCode(frame: HTMLCanvasElement): Promise<CardCodeReading> {
    const rectified = await this.rectifyCard(frame);
    if (!rectified.detected) {
      return { code: null, name: '', rarity: null, alternateArt: false, cardDetected: false, rawText: '' };
    }

    const worker = await this.getWorker();
    const codeCandidates: OcrCandidate[] = [];
    const codeRegions = [
      // Card ID / rarity sit in the tiny footer at the bottom-right corner.
      { x: 0.66, y: 0.93, width: 0.32, height: 0.065, mode: Tesseract.PSM.SINGLE_LINE },
      // Wider fallback tolerates camera crop offsets and cards with a taller footer.
      { x: 0.48, y: 0.89, width: 0.50, height: 0.105, mode: Tesseract.PSM.SPARSE_TEXT },
    ];

    for (const region of codeRegions) {
      const crop = this.prepareRegion(rectified.image, region, 'code');
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

    // The card name is printed below the rules text and immediately above the card-type line.
    const nameCrop = this.prepareRegion(rectified.image, { x: 0.08, y: 0.77, width: 0.80, height: 0.12 }, 'name');
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .\'-',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    const nameResult = await worker.recognize(nameCrop);
    const name = this.extractCardName(nameResult.data.text ?? '');
    const rawText = `ID: ${codeCandidates.map((item) => item.text).join(' / ')}; NAME: ${nameResult.data.text?.trim() ?? ''}`;
    const voted = this.voteForCode(codeCandidates);
    if (!voted) {
      return { code: null, name, rarity: null, alternateArt: false, cardDetected: true, rawText };
    }
    return { ...voted, name, cardDetected: true, rawText };
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
    const hierarchy = new cv.Mat();
    const contours = new cv.MatVector();
    let bestPoints: number[] | null = null;
    let bestScore = 0;

    try {
      cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
      cv.Canny(blurred, edges, 45, 140);
      cv.dilate(edges, dilated, kernel);
      cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      const frameArea = working.width * working.height;

      for (let index = 0; index < contours.size(); index += 1) {
        const contour = contours.get(index);
        const perimeter = cv.arcLength(contour, true);
        const approximation = new cv.Mat();
        try {
          cv.approxPolyDP(contour, approximation, perimeter * 0.025, true);
          if (approximation.rows !== 4 || !cv.isContourConvex(approximation)) continue;
          const area = Math.abs(cv.contourArea(approximation));
          if (area < frameArea * 0.24 || area > frameArea * 0.98) continue;
          const points = Array.from(approximation.data32S.slice(0, 8));
          const ordered = this.orderCorners(points);
          const width = (this.distance(ordered[0], ordered[1]) + this.distance(ordered[2], ordered[3])) / 2;
          const height = (this.distance(ordered[0], ordered[3]) + this.distance(ordered[1], ordered[2])) / 2;
          if (!width || !height) continue;
          const ratio = width / height;
          if (ratio < 0.48 || ratio > 0.90) continue;
          // Prefer the largest portrait quadrilateral close to the One Piece card aspect ratio.
          const score = area * Math.max(0.15, 1 - Math.abs(ratio - 0.70));
          if (score > bestScore) {
            bestScore = score;
            bestPoints = ordered.flatMap((point) => point);
          }
        } finally {
          approximation.delete();
        }
      }

      if (!bestPoints) return { image: frame, detected: false };

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
        return { image: output, detected: true };
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
      hierarchy.delete();
      contours.delete();
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

  private prepareRegion(
    source: HTMLCanvasElement,
    region: { x: number; y: number; width: number; height: number },
    kind: 'code' | 'name',
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
    for (let index = 0; index < pixels.data.length; index += 4) {
      const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
      const contrast = kind === 'code'
        ? Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128))
        : Math.max(0, Math.min(255, (gray - 128) * 1.25 + 128));
      pixels.data[index] = contrast;
      pixels.data[index + 1] = contrast;
      pixels.data[index + 2] = contrast;
      pixels.data[index + 3] = 255;
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
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

  private parseReading(rawText: string): Pick<CardCodeReading, 'code' | 'rarity' | 'alternateArt'> | null {
    const normalized = rawText.toUpperCase()
      .replace(/[—–−_]/g, '-')
      .replace(/[|!]/g, 'I')
      .replace(/\b0P(?=\s*\d)/g, 'OP')
      .replace(/\s+/g, ' ');
    const setMatch = normalized.match(/\b(OP|ST|EB|PRB)\s*-?\s*([0-9OQ]{1,2})\s*-?\s*([0-9OQIL]{1,3})\b/);
    const promoMatch = normalized.match(/\b(P|DON)\s*-?\s*([0-9OQIL]{1,3})\b/);
    let code: string | null = null;
    if (setMatch) {
      const setNumber = setMatch[2].replace(/[OQ]/g, '0');
      const cardNumber = setMatch[3].replace(/[OQ]/g, '0').replace(/[IL]/g, '1').padStart(3, '0');
      code = `${setMatch[1]}${setNumber}-${cardNumber}`;
    } else if (promoMatch) {
      const cardNumber = promoMatch[2].replace(/[OQ]/g, '0').replace(/[IL]/g, '1').padStart(3, '0');
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

  async findCard(code: string, recognizedName = '', requireNameMatch = false): Promise<IdentifiedCard | null> {
    if (!recognizedName.trim() && !requireNameMatch) return this.lookupCardByCode(code);
    const catalog = await this.getCatalog();
    const normalizedCode = this.normalizeCode(code);
    const exact = catalog.filter((card) => card.normalizedCode === normalizedCode);
    if (!recognizedName.trim()) return requireNameMatch ? null : exact.length ? this.publicCardInEur(exact[0]) : null;

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
      const stored = localStorage.getItem('grand-line-usd-eur-rate');
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
    const response = await fetch('https://api.frankfurter.dev/v2/providers/ecb/rate/usd/eur', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Currency conversion failed (${response.status}).`);
    const data = await response.json() as { rate?: unknown };
    const rate = Number(data.rate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('The USD/EUR exchange rate is invalid.');
    const savedAt = Date.now();
    this.cachedUsdToEur = { rate, savedAt };
    try { localStorage.setItem('grand-line-usd-eur-rate', JSON.stringify({ rate, savedAt })); } catch { /* Keep the rate in memory. */ }
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
      const responses = await Promise.all(endpoints.map(async (endpoint) => {
        const response = await fetch(`https://www.optcgapi.com${endpoint}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error(`Card catalog request failed (${response.status}).`);
        return response.json() as Promise<unknown>;
      }));
      const cards = this.parseCatalogPayloads(responses);
      if (!cards.length) throw new Error('The card catalog returned no cards.');
      try {
        await this.writeCatalogCache(cards);
      } catch {
        // Keep the index in memory if this browser blocks IndexedDB.
      }
      return cards;
    } catch (error) {
      if (!forceRefresh && cached?.cards.length) return cached.cards;
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
        const entry: CatalogCard = {
          code: code.trim(),
          name: name.trim(),
          marketPrice,
          variant: /(?:_p\d+|-(?:sec|sp|aa\d*|alt\d*)$)/i.test(code) || /parallel|alternate|manga|wanted poster|\(sp\)/i.test(name) ? 'Alternate art' : 'Standard',
          imageUrl: typeof image === 'string' && image.startsWith('https://') ? image : null,
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
