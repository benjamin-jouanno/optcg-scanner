import { Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import {
  LucideArrowDownUp,
  LucideArrowRight,
  LucideArrowUpRight,
  LucideBell,
  LucideBookOpen,
  LucideCamera,
  LucideChartNoAxesCombined,
  LucideCheck,
  LucideCircleAlert,
  LucideDollarSign,
  LucideEllipsis,
  LucideHeart,
  LucideHouse,
  LucideInfo,
  LucideLayers,
  LucideLibrary,
  LucidePencil,
  LucideRotateCcw,
  LucideRotateCw,
  LucideScanLine,
  LucideSearch,
  LucideMoon,
  LucideSun,
  LucideShieldCheck,
  LucideSparkles,
  LucideStar,
  LucideTrash2,
  LucideTrendingUp,
  LucideX,
} from '@lucide/angular';
import { CollectionStorageService } from './services/collection-storage.service';
import { CardCondition, CardFinish, CollectionBackup, CollectionCard } from './interfaces/collection-card';
import { CardFrameBounds, CardRecognitionService } from './services/card-recognition.service';
import { IdentifiedCard } from './interfaces/identified-card';
import { HomePage } from './pages/home/home-page';
import { CollectionPage } from './pages/collection/collection-page';
import { ScannerPage } from './pages/scanner/scanner-page';
import { StatisticsPage } from './pages/statistics/statistics-page';
import { OrganizationPage } from './pages/organization/organization-page';
import { CardVisualRecognitionService } from './services/card-visual-recognition.service';

type Page = 'Accueil' | 'Ma collection' | 'Organisation' | 'Scanner' | 'Statistiques';
type ScanIndicatorState = 'idle' | 'missing' | 'detected' | 'added';
type NavItem = { label: Page; icon: string };

@Component({
  selector: 'app-root',
  imports: [DatePipe, HomePage, CollectionPage, OrganizationPage, ScannerPage, StatisticsPage, LucideHouse, LucideLibrary, LucideScanLine, LucideChartNoAxesCombined, LucideSparkles, LucideArrowUpRight, LucideEllipsis, LucideSearch, LucideBell, LucideCircleAlert, LucideX, LucideLayers, LucideStar, LucidePencil, LucideTrash2, LucideMoon, LucideSun],
  templateUrl: './app.html',
})
export class App implements OnDestroy {
  readonly splashVisible = signal(true);
  readonly testPhotoUrl = signal('');
  readonly testPhotoName = signal('');
  readonly testPhotoPickerOpen = signal(false);
  readonly testPhotoUploadError = signal('');
  readonly testPhotos = [
    { name: 'card-sample.png', label: 'Photo de carte', url: '/testFiles/card-sample.png' },
    { name: 'capture-024813.png', label: 'Capture 024813', url: '/testFiles/capture-024813.png' },
    { name: 'capture-024852.png', label: 'Capture 024852', url: '/testFiles/capture-024852.png' },
  ];
  @ViewChild(ScannerPage) scannerPage?: ScannerPage;

  private readonly storage = inject(CollectionStorageService);
  private readonly recognition = inject(CardRecognitionService);
  private readonly visualRecognition = inject(CardVisualRecognitionService);
  readonly visualModelStatus = this.visualRecognition.status;
  readonly collectionCards = signal<CollectionCard[]>([]);
  readonly wallpaperIndex = signal(this.readWallpaperIndex());
  readonly theme = signal<'dark' | 'light'>(this.readTheme());
  readonly collectionLoading = signal(true);
  readonly storageError = signal('');
  readonly cameraError = signal('');
  readonly cameraActive = signal(false);
  readonly testPhotoActive = signal(false);
  readonly ocrWorking = signal(false);
  readonly visualModelWorking = signal(false);
  readonly detectedCardBounds = signal<CardFrameBounds | null>(null);
  readonly recognitionStatus = signal('Active la caméra pour commencer la reconnaissance automatique.');
  readonly recognitionDebugText = signal('');
  readonly lastIdentifiedCard = signal('');
  readonly lookingUpCard = signal(false);
  readonly pricesRefreshing = signal(false);
  readonly priceRefreshMessage = signal('');
  readonly selectedCard = signal<CollectionCard | null>(null);
  readonly pendingDeletion = signal<CollectionCard | null>(null);
  readonly editingCardId = signal<string | null>(null);
  readonly scanSessionCards = signal<CollectionCard[]>([]);
  readonly scanAddedCard = signal<CollectionCard | null>(null);
  readonly manualCardChoices = signal<IdentifiedCard[]>([]);
  readonly searchResults = signal<CollectionCard[]>([]);
  readonly searchDropdownOpen = signal(false);
  readonly manualChoiceSource = signal<'manual' | 'scanner-name'>('manual');
  readonly scannerNameReference = signal<string | null>(null);
  readonly scannerRecognizedName = signal('');
  readonly manualChoiceFinish = signal<CardFinish>('Standard');
  readonly scanFinish = signal<CardFinish>('Standard');
  readonly showHitsOnly = signal(false);
  readonly showDuplicatesOnly = signal(false);
  readonly selectedExtension = signal('all');
  readonly priceSortDirection = signal<'asc' | 'desc' | null>(null);
  editAlternateArt = false;
  readonly scanIndicatorState = signal<ScanIndicatorState>('idle');
  readonly cameraRotation = signal(0);
  readonly cameraZoom = signal(1);
  readonly cameraPanX = signal(0);
  readonly cameraPanY = signal(0);
  readonly cameraPanning = signal(false);
  private cameraPanPointer: { id: number; x: number; y: number } | null = null;
  readonly pendingImport = signal<CollectionBackup | null>(null);
  readonly importError = signal('');
  readonly profileName = signal(this.readProfileSetting('grand-line-profile-name') || 'Monkey D.');
  readonly profileImage = signal(this.readProfileSetting('grand-line-profile-image'));
  readonly hitCardAnimationsEnabled = signal(this.readProfileSetting('grand-line-hit-animations') !== 'false');
  readonly profileSettingsOpen = signal(false);
  readonly profileNameDraft = signal('');
  readonly profileImageDraft = signal<string | null>(null);
  readonly wallpaperDraft = signal(0);
  readonly themeDraft = signal<'dark' | 'light'>('dark');
  readonly wallpaperImagesLoaded = signal<Record<number, boolean>>({});
  readonly wallpaperImagesFailed = signal<Record<number, boolean>>({});
  readonly hitCardAnimationsDraft = signal(true);
  readonly profileSettingsError = signal('');
  readonly wallpaperOptions = Array.from({ length: 17 }, (_, index) => ({
    index,
    label: index === 16 ? 'Mer animée' : `Fond ${String(index + 1).padStart(2, '0')}`,
    animated: index === 16,
    imageUrl: index === 16 ? '' : `/assets/wallpaper-previews/wallpaper-${String(index + 1).padStart(2, '0')}.webp`,
  }));

  readonly navigation: NavItem[] = [
    { label: 'Accueil', icon: 'home' },
    { label: 'Ma collection', icon: 'collection' },
    { label: 'Organisation', icon: 'organize' },
    { label: 'Scanner', icon: 'scanner' },
    { label: 'Statistiques', icon: 'stats' },
  ];

  readonly conditions: CardCondition[] = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

  readonly monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

  activeItem: Page = 'Accueil';
  searchTerm = '';
  collectionSearchTerm = '';
  notice = '';
  manualCardCode = '';
  manualChoiceSearch = '';
  editName = '';
  editCode = '';
  editCondition: CardCondition = 'Near Mint';
  editFinish: CardFinish = 'Standard';
  editQuantity = 1;
  private cameraStream?: MediaStream;
  private testPhotoImage?: HTMLImageElement;
  private uploadedTestPhotoUrl?: string;
  private recognitionTimer?: ReturnType<typeof setTimeout>;
  private scanAddedCardTimer?: ReturnType<typeof setTimeout>;
  private priceRefreshTimer?: ReturnType<typeof setInterval>;
  private recognitionBusy = false;
  private lastRecognizedCode = '';
  private pendingAmbiguousScanCode = '';
  private candidateCode = '';
  private candidatePrintingCode = '';
  private candidateAlternateArt = false;
  private candidateHits = 0;
  private missingFrames = 0;
  private lastNameSearch = '';
  private noticeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    try { localStorage.removeItem('grand-line-cardsight-api-key'); } catch { /* Ignore unavailable browser storage. */ }
    void this.loadCollection();
    this.priceRefreshTimer = setInterval(() => {
      if (!document.hidden && this.collectionCards().some((card) => this.needsMarketPriceRefresh(card))) {
        void this.refreshCollectionPrices(true);
      }
    }, 24 * 60 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.stopCamera();
    if (this.uploadedTestPhotoUrl) URL.revokeObjectURL(this.uploadedTestPhotoUrl);
    if (this.priceRefreshTimer) clearInterval(this.priceRefreshTimer);
    if (this.scanAddedCardTimer) clearTimeout(this.scanAddedCardTimer);
    void this.recognition.dispose();
  }

  get visibleCards(): CollectionCard[] {
    const query = this.searchTerm.trim().toLocaleLowerCase();
    const cards = this.collectionCards();
    if (!query) return cards;
    return cards.filter((card) =>
      `${card.name} ${card.code} ${card.variant} ${card.condition}`.toLocaleLowerCase().includes(query),
    );
  }

  get filteredManualCardChoices(): IdentifiedCard[] {
    const query = this.manualChoiceSearch.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return query
      ? this.manualCardChoices().filter((card) => card.code.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(query))
      : this.manualCardChoices();
  }

  get collectionVisibleCards(): CollectionCard[] {
    const query = this.collectionSearchTerm.trim().toLocaleLowerCase();
    const cards = this.collectionCards().filter((card) => {
      const matchesSearch = !query || `${card.name} ${card.code}`.toLocaleLowerCase().includes(query);
      const matchesHitFilter = !this.showHitsOnly() || this.isHit(card);
      const matchesDuplicateFilter = !this.showDuplicatesOnly() || card.quantity > 1;
      const matchesExtension = this.selectedExtension() === 'all' || this.getExtensionCode(card.code) === this.selectedExtension();
      return matchesSearch && matchesHitFilter && matchesDuplicateFilter && matchesExtension;
    });
    const direction = this.priceSortDirection();
    if (direction) {
      cards.sort((a, b) => {
        if (a.marketPrice === null) return b.marketPrice === null ? 0 : 1;
        if (b.marketPrice === null) return -1;
        return direction === 'asc' ? a.marketPrice - b.marketPrice : b.marketPrice - a.marketPrice;
      });
    }
    return cards;
  }

  get collectionExtensionOptions(): { code: string; name: string | null }[] {
    const codes = new Set(this.collectionCards().map((card) => this.getExtensionCode(card.code)).filter((code): code is string => Boolean(code)));
    return [...codes]
      .sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }))
      .map((code) => ({ code, name: this.extensionNames[code] ?? null }));
  }

  getExtensionName(code: string): string | null {
    if (code === 'P — Promos') return 'Cartes promotionnelles';
    if (/^ST-\d{2}$/.test(code)) return 'Deck de démarrage';
    return this.extensionNames[code] ?? null;
  }

  private readonly extensionNames: Record<string, string> = {
    'OP-01': 'Romance Dawn',
    'OP-02': 'Paramount War',
    'OP-03': 'Pillars of Strength',
    'OP-04': 'Kingdoms of Intrigue',
    'OP-05': 'Awakening of the New Era',
    'OP-06': 'Wings of the Captain',
    'OP-07': '500 Years in the Future',
    'OP-08': 'Two Legends',
    'OP-09': 'Les Nouveaux Empereurs',
    'OP-10': 'Sang Royal',
    'OP-11': 'Des poings vifs comme l\u2019\u00e9clair',
    'OP-12': 'L\u2019H\u00e9ritage du Ma\u00eetre',
    'OP-13': 'Successeurs',
    'OP-14': 'Les Sept de la Mer d\u2019Azur',
    'OP-15': 'Aventure sur l\u2019\u00cele de Dieu',
    'OP-16': 'L\u2019Heure de la Bataille D\u00e9cisive',
    'OP-17': 'Les Guerriers les plus puissants au monde',
    'OP-18': 'The Dominance of God',
    'EB-01': 'Memorial Collection',
    'EB-02': 'Anime 25th Collection',
    'EB-03': 'Heroines Edition',
    'EB-04': 'Egghead Crisis',
    'EB-05': 'Heroines Edition vol. 2',
    'PRB-01': 'The Best',
    'PRB-02': 'The Best vol. 2',
  };

  private getExtensionCode(cardCode: string): string | null {
    const match = cardCode.trim().toUpperCase().match(/^([A-Z]+)\s*-?\s*(\d+)/);
    return match ? `${match[1]}-${match[2].padStart(2, '0')}` : null;
  }

  get totalQuantity(): number {
    return this.collectionCards().reduce((total, card) => total + card.quantity, 0);
  }

  get uniqueCardCount(): number {
    return this.collectionCards().length;
  }

  get uniqueSetCount(): number {
    return new Set(this.collectionCards().map((card) => {
      const match = card.code.match(/^([A-Z]+)\s*[-]?\s*(\d+)/i);
      return match ? `${match[1].toUpperCase()}-${match[2]}` : '';
    }).filter(Boolean)).size;
  }

  get collectionValue(): number {
    return this.collectionCards().reduce((total, card) => total + (card.marketPrice ?? 0) * card.quantity, 0);
  }

  get favoriteCount(): number {
    return this.collectionCards().filter((card) => card.favorite).length;
  }

  get collectionSets(): { code: string; count: number; progress: number; color: string }[] {
    const groups = new Map<string, number>();
    for (const card of this.collectionCards()) {
      const match = card.code.match(/^([A-Z]+)\s*[-]?\s*(\d+)/i);
      const code = match ? `${match[1].toUpperCase()}-${match[2]}` : 'À identifier';
      groups.set(code, (groups.get(code) ?? 0) + card.quantity);
    }
    const values = [...groups].map(([code, count]) => ({ code, count }));
    const maxCount = Math.max(1, ...values.map((value) => value.count));
    return values
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code))
      .slice(0, 6)
      .map((set, index) => ({
        ...set,
        progress: Math.max(6, Math.round((set.count / maxCount) * 100)),
        color: ['blue', 'violet', 'gold'][index % 3],
      }));
  }

  get monthlyAdds(): number[] {
    const now = new Date();
    const monthCounts = Array.from({ length: 12 }, (_, index) => {
      const month = (now.getMonth() + index + 1) % 12;
      const year = now.getFullYear() - (month > now.getMonth() ? 1 : 0);
      return this.collectionCards()
        .filter((card) => {
          const added = new Date(card.addedAt);
          return added.getFullYear() === year && added.getMonth() === month;
        })
        .reduce((total, card) => total + card.quantity, 0);
    });
    return monthCounts;
  }

  get monthLabels(): string[] {
    const now = new Date();
    return Array.from({ length: 12 }, (_, index) => this.monthNames[(now.getMonth() + index + 1) % 12]);
  }

  get chartBars(): number[] {
    const values = this.monthlyAdds;
    const max = Math.max(1, ...values);
    return values.map((value) => value === 0 ? 4 : Math.max(9, Math.round((value / max) * 100)));
  }

  get currentMonthAdds(): number {
    const now = new Date();
    return this.collectionCards()
      .filter((card) => {
        const added = new Date(card.addedAt);
        return added.getFullYear() === now.getFullYear() && added.getMonth() === now.getMonth();
      })
      .reduce((total, card) => total + card.quantity, 0);
  }

  onSearch(value: string): void {
    this.searchTerm = value;
    this.searchDropdownOpen.set(value.trim().length >= 2);
    const query = value.trim().toLocaleLowerCase();
    this.searchResults.set(query.length < 2 ? [] : this.collectionCards().filter((card) =>
      `${card.name} ${card.code}`.toLocaleLowerCase().includes(query),
    ).slice(0, 12));
  }

  openSearchDropdown(): void {
    if (this.searchTerm.trim().length >= 2) this.searchDropdownOpen.set(true);
  }

  onSearchFocusOut(event: FocusEvent): void {
    const container = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !container.contains(event.relatedTarget)) this.closeSearchDropdown();
  }

  closeSearchDropdown(): void {
    this.searchDropdownOpen.set(false);
  }

  openSearchResult(card: CollectionCard): void {
    this.searchDropdownOpen.set(false);
    this.searchTerm = '';
    this.searchResults.set([]);
    this.openCardDetails(card);
  }

  onCollectionSearch(value: string): void {
    this.collectionSearchTerm = value;
  }

  openProfileSettings(): void {
    this.profileNameDraft.set(this.profileName());
    this.profileImageDraft.set(this.profileImage());
    this.hitCardAnimationsDraft.set(this.hitCardAnimationsEnabled());
    this.wallpaperDraft.set(this.wallpaperIndex());
    this.themeDraft.set(this.theme());
    this.profileSettingsError.set('');
    this.profileSettingsOpen.set(true);
  }

  markWallpaperImageLoaded(index: number): void {
    this.wallpaperImagesLoaded.update((loaded) => loaded[index] ? loaded : { ...loaded, [index]: true });
  }

  markWallpaperImageFailed(index: number): void {
    this.wallpaperImagesLoaded.update((loaded) => loaded[index] ? loaded : { ...loaded, [index]: true });
    this.wallpaperImagesFailed.update((failed) => ({ ...failed, [index]: true }));
  }

  closeProfileSettings(): void {
    this.profileSettingsOpen.set(false);
  }

  profileInitial(): string {
    return this.profileName().trim().charAt(0).toLocaleUpperCase() || 'M';
  }

  async onProfileImageSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.profileSettingsError.set('Choisis un fichier image.');
      input.value = '';
      return;
    }
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image preview unavailable.');
      context.fillStyle = '#14232d';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      this.profileImageDraft.set(canvas.toDataURL('image/jpeg', 0.82));
      this.profileSettingsError.set('');
    } catch {
      this.profileSettingsError.set('Impossible de lire cette image. Essaie un autre fichier.');
    } finally {
      bitmap?.close();
      input.value = '';
    }
  }

  saveProfileSettings(): void {
    const name = this.profileNameDraft().trim();
    if (!name) {
      this.profileSettingsError.set('Saisis un nom avant d’enregistrer.');
      return;
    }
    try {
      localStorage.setItem('grand-line-profile-name', name);
      if (this.profileImageDraft()) localStorage.setItem('grand-line-profile-image', this.profileImageDraft()!);
      else localStorage.removeItem('grand-line-profile-image');
      localStorage.setItem('grand-line-hit-animations', String(this.hitCardAnimationsDraft()));
      localStorage.setItem('grand-line-wallpaper', String(this.wallpaperDraft()));
      localStorage.setItem('grand-line-theme', this.themeDraft());
      this.profileName.set(name);
      this.profileImage.set(this.profileImageDraft());
      this.hitCardAnimationsEnabled.set(this.hitCardAnimationsDraft());
      this.wallpaperIndex.set(this.wallpaperDraft());
      this.theme.set(this.themeDraft());
      this.profileSettingsOpen.set(false);
    } catch {
      this.profileSettingsError.set('Impossible d’enregistrer ces préférences dans le stockage local.');
    }
  }

  togglePriceSort(): void {
    this.priceSortDirection.update((direction) => direction === null || direction === 'asc' ? 'desc' : 'asc');
  }

  toggleScanFinish(): void {
    this.scanFinish.update((finish) => finish === 'Standard' ? 'Foil' : 'Standard');
  }

  rotateCameraLeft(): void {
    this.cameraRotation.update((rotation) => (rotation + 270) % 360);
  }

  rotateCameraRight(): void {
    this.cameraRotation.update((rotation) => (rotation + 90) % 360);
  }

  setCameraZoom(value: string): void {
    this.cameraZoom.set(Number(value));
  }

  startCameraPan(event: PointerEvent): void {
    if (!this.cameraActive() && !this.testPhotoActive()) return;
    if ((event.target as Element | null)?.closest('button, input')) return;
    const stage = event.currentTarget as HTMLElement;
    this.cameraPanPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    this.cameraPanning.set(true);
    event.preventDefault();
  }

  moveCameraPan(event: PointerEvent): void {
    if (this.cameraPanPointer?.id !== event.pointerId) return;
    this.cameraPanX.update((value) => value + event.clientX - this.cameraPanPointer!.x);
    this.cameraPanY.update((value) => value + event.clientY - this.cameraPanPointer!.y);
    this.cameraPanPointer = { ...this.cameraPanPointer, x: event.clientX, y: event.clientY };
  }

  endCameraPan(event: PointerEvent): void {
    if (this.cameraPanPointer?.id !== event.pointerId) return;
    this.cameraPanPointer = null;
    this.cameraPanning.set(false);
    const stage = event.currentTarget as HTMLElement;
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }

  openCardDetails(card: CollectionCard): void {
    this.editingCardId.set(null);
    this.selectedCard.set(card);
  }

  closeCardDetails(): void {
    this.editingCardId.set(null);
    this.selectedCard.set(null);
  }

  startEditingCard(card: CollectionCard): void {
    this.selectedCard.set(card);
    this.editingCardId.set(card.id);
    this.editName = card.name;
    this.editCode = card.code;
    this.editAlternateArt = card.variant === 'Alternate art';
    this.editCondition = card.condition;
    this.editFinish = card.finish;
    this.editQuantity = card.quantity;
  }

  cancelCardEdit(): void {
    this.editingCardId.set(null);
  }

  adjustEditQuantity(amount: number): void {
    const current = Number.isFinite(this.editQuantity) ? this.editQuantity : 1;
    this.editQuantity = Math.min(100000, Math.max(1, current + amount));
  }

  async saveCardEdits(): Promise<void> {
    const card = this.selectedCard();
    if (!card) return;
    const name = this.editName.trim();
    const quantity = Number(this.editQuantity);
    if (!name) {
      this.showNotice('Le nom de la carte est obligatoire.');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
      this.showNotice('La quantité doit être comprise entre 1 et 100 000.');
      return;
    }
    const updated: CollectionCard = {
      ...card,
      name,
      code: this.editCode.trim(),
      variant: this.editAlternateArt ? 'Alternate art' : 'Standard',
      finish: this.editFinish,
      condition: this.editCondition,
      quantity,
    };
    await this.saveCollection(this.collectionCards().map((item) => item.id === card.id ? updated : item));
    if (this.storageError()) return;
    const savedCard = this.collectionCards().find((item) => this.duplicateCardKey(item) === this.duplicateCardKey(updated)) ?? updated;
    this.selectedCard.set(savedCard);
    this.scanSessionCards.update((cards) => cards.map((item) => item.id === card.id ? savedCard : item));
    this.editingCardId.set(null);
    this.showNotice('Les détails de la carte ont été mis à jour.');
  }

  selectItem(item: Page): void {
    if (this.activeItem === 'Scanner' && item !== 'Scanner') this.stopCamera();
    if (this.activeItem !== 'Scanner' && item === 'Scanner') this.scanSessionCards.set([]);
    this.activeItem = item;
    this.searchTerm = '';
    this.searchResults.set([]);
    this.searchDropdownOpen.set(false);
  }

  finishSplash(event: AnimationEvent): void {
    if (event.target !== event.currentTarget) return;
    this.activeItem = 'Accueil';
    this.splashVisible.set(false);
  }

  private readWallpaperIndex(): number {
    const stored = Number(this.readProfileSetting('grand-line-wallpaper'));
    return Number.isInteger(stored) && stored >= 0 && stored < 17 ? stored : 0;
  }

  get activeWallpaperIndex(): number {
    return this.profileSettingsOpen() ? this.wallpaperDraft() : this.wallpaperIndex();
  }

  private readTheme(): 'dark' | 'light' {
    return this.readProfileSetting('grand-line-theme') === 'light' ? 'light' : 'dark';
  }

  private readProfileSetting(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  formatPrice(value: number | null): string {
    if (value === null) return 'À estimer';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(value);
  }

  isHit(card: Pick<CollectionCard, 'marketPrice'>): boolean {
    return card.marketPrice !== null && card.marketPrice > 2.5;
  }

  cardFramePolygonPoints(bounds: CardFrameBounds): string {
    return bounds.corners.map((corner) => `${corner.x * 1000},${corner.y * 1000}`).join(' ');
  }

  isRedHit(card: Pick<CollectionCard, 'marketPrice'>): boolean {
    return this.isHit(card) && card.marketPrice! > 100;
  }

  isGoldHit(card: Pick<CollectionCard, 'marketPrice'>): boolean {
    return this.isHit(card) && card.marketPrice! <= 100;
  }

  private needsMarketPriceRefresh(card: CollectionCard): boolean {
    if (card.marketPrice === null) return true;
    const lastUpdated = card.priceUpdatedAt ? Date.parse(card.priceUpdatedAt) : Number.NaN;
    return !Number.isFinite(lastUpdated) || Date.now() - lastUpdated >= 24 * 60 * 60 * 1000;
  }

  async startCamera(): Promise<void> {
    this.cameraError.set('');
    this.testPhotoActive.set(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      this.cameraError.set('La caméra est indisponible. Ouvre cette page en HTTPS ou dans localhost.');
      return;
    }

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      if (this.activeItem !== 'Scanner') {
        this.stopCamera();
        return;
      }
      const video = this.scannerPage?.cameraVideo?.nativeElement;
      if (!video) {
        this.cameraStream.getTracks().forEach((track) => track.stop());
        this.cameraStream = undefined;
        this.cameraError.set('La zone vidéo du scanner n’est pas disponible. Ouvre la page Scanner puis réessaie.');
        return;
      }
      video.srcObject = this.cameraStream;
      await video.play();
      this.cameraActive.set(true);
      this.scanIndicatorState.set('missing');
      this.recognitionStatus.set('Caméra active · recherche de la forme de la carte…');
      void this.scanLiveFrame();
    } catch (error) {
      this.cameraActive.set(false);
      this.cameraError.set(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Autorise l’accès à la caméra dans ton navigateur puis réessaie.'
        : 'Impossible d’accéder à la caméra. Vérifie qu’elle est branchée et disponible.');
    }
  }

  openTestPhotoPicker(): void {
    if (this.ocrWorking() || this.visualModelWorking() || this.lookingUpCard()) return;
    this.testPhotoUploadError.set('');
    this.testPhotoPickerOpen.set(true);
  }

  closeTestPhotoPicker(): void {
    this.testPhotoPickerOpen.set(false);
    this.testPhotoUploadError.set('');
  }

  async selectTestPhoto(photo: { name: string; label: string; url: string }): Promise<void> {
    if (this.recognitionBusy || this.lookingUpCard()) return;
    this.releaseUploadedTestPhotoUrl();
    this.testPhotoPickerOpen.set(false);
    this.testPhotoUploadError.set('');
    this.testPhotoUrl.set(photo.url);
    this.testPhotoName.set(photo.name);
    await this.runTestPhoto(photo.url);
  }

  async onTestPhotoUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.testPhotoUploadError.set('Choisis un fichier image (JPG, PNG ou WEBP).');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      this.testPhotoUploadError.set('La photo doit faire moins de 25 Mo.');
      return;
    }

    this.releaseUploadedTestPhotoUrl();
    const imageUrl = URL.createObjectURL(file);
    this.uploadedTestPhotoUrl = imageUrl;
    this.testPhotoPickerOpen.set(false);
    this.testPhotoUploadError.set('');
    this.testPhotoUrl.set(imageUrl);
    this.testPhotoName.set(file.name);
    await this.runTestPhoto(imageUrl);
  }

  private async runTestPhoto(imageUrl: string): Promise<void> {
    if (this.recognitionBusy || this.lookingUpCard()) return;
    this.stopCamera();
    this.testPhotoActive.set(true);
    this.cameraError.set('');
    this.scanIndicatorState.set('idle');
    this.recognitionDebugText.set('');
    this.lastRecognizedCode = '';
    this.candidateCode = '';
    this.candidateHits = 0;
    this.lastNameSearch = '';
    this.recognitionStatus.set('Photo chargée. Analyse automatique en cours…');
    try {
      const image = new Image();
      image.src = imageUrl;
      await image.decode();
      this.testPhotoImage = image;
      this.scanIndicatorState.set('missing');
      this.scheduleRecognition();
    } catch {
      this.testPhotoActive.set(false);
      this.testPhotoImage = undefined;
      this.cameraError.set('Impossible de charger ou analyser la photo de test.');
      this.recognitionStatus.set('Impossible de charger la photo de test.');
    }
  }

  private releaseUploadedTestPhotoUrl(): void {
    if (!this.uploadedTestPhotoUrl) return;
    URL.revokeObjectURL(this.uploadedTestPhotoUrl);
    this.uploadedTestPhotoUrl = undefined;
  }

  async lookupManualCard(): Promise<void> {
    const code = this.manualCardCode.trim().toUpperCase().replace(/\s+/g, '');
    if (!code || this.lookingUpCard()) return;
    this.lookingUpCard.set(true);
    this.recognitionStatus.set(`Recherche de ${code} dans le catalogue…`);
    this.manualChoiceFinish.set('Standard');
    this.manualChoiceSource.set('manual');
    this.manualChoiceSearch = '';
    this.scannerNameReference.set(null);
    this.scannerRecognizedName.set('');
    try {
      const printings = await this.recognition.findCardPrintings(code);
      if (!printings.length) {
        this.recognitionStatus.set(`Aucune carte trouvée pour ${code}. Vérifie le numéro et réessaie.`);
        return;
      }
      this.manualCardChoices.set(printings);
      this.recognitionStatus.set(`${printings.length} versions trouvées pour ${code}. Choisis celle de ta carte.`);
    } catch {
      this.recognitionStatus.set('Le catalogue est indisponible. Vérifie ta connexion et réessaie.');
    } finally {
      this.lookingUpCard.set(false);
      this.scheduleRecognition();
    }
  }

  async selectManualPrinting(identified: IdentifiedCard): Promise<void> {
    if (this.lookingUpCard()) return;
    this.lookingUpCard.set(true);
    this.recognitionStatus.set(`Ajout de ${identified.code} à ta collection…`);
    try {
      await this.addManualPrinting(identified, this.manualChoiceFinish());
      if (this.pendingAmbiguousScanCode && !this.storageError()) {
        this.lastRecognizedCode = this.pendingAmbiguousScanCode;
        this.pendingAmbiguousScanCode = '';
      }
    } catch {
      this.recognitionStatus.set('Impossible d’ajouter cette version. Réessaie.');
    } finally {
      this.lookingUpCard.set(false);
      this.scheduleRecognition();
    }
  }

  cancelManualPrintingChoice(): void {
    this.manualCardChoices.set([]);
    this.manualChoiceSearch = '';
    this.scannerNameReference.set(null);
    this.scannerRecognizedName.set('');
    this.pendingAmbiguousScanCode = '';
    this.recognitionStatus.set('Choix de version annulé.');
    this.scheduleRecognition();
  }

  private async addManualPrinting(identified: IdentifiedCard, finish: CardFinish): Promise<void> {
    await this.saveIdentifiedCard(identified, finish);
    if (this.storageError()) return;
    this.manualCardChoices.set([]);
    this.manualChoiceSearch = '';
    this.scannerNameReference.set(null);
    this.scannerRecognizedName.set('');
    this.manualCardCode = '';
    if (this.cameraActive() || this.testPhotoActive()) this.scanIndicatorState.set('added');
    this.lastIdentifiedCard.set(`${identified.name} · ${identified.code}`);
    this.recognitionStatus.set(`Ajoutée : ${identified.name} (${identified.code}).`);
  }

  async refreshCollectionPrices(missingOnly = false): Promise<void> {
    if (this.pricesRefreshing()) return;
    const allCards = this.collectionCards();
    const cards = missingOnly ? allCards.filter((card) => this.needsMarketPriceRefresh(card)) : allCards;
    if (!cards.length) {
      this.priceRefreshMessage.set(allCards.length ? 'Les prix sont à jour.' : 'Ta collection est vide.');
      return;
    }
    this.pricesRefreshing.set(true);
    this.priceRefreshMessage.set('Mise à jour des prix…');
    try {
      const updates = await this.recognition.refreshMarketPrices(cards.map(({ id, code, name, variant }) => ({ id, code, name, variant })));
      if (!updates.length) {
        this.priceRefreshMessage.set('Aucun prix actuel trouvé pour les cartes de ta collection.');
        return;
      }
      const priceById = new Map(updates.map((item) => [item.id, item]));
      await this.saveCollection(allCards.map((card) => {
        const update = priceById.get(card.id);
        return update ? { ...card, marketPrice: update.marketPrice, priceUpdatedAt: update.priceUpdatedAt } : card;
      }));
      if (!this.storageError()) this.priceRefreshMessage.set(`${updates.length} prix mis à jour en euros.`);
    } catch {
      this.priceRefreshMessage.set('Impossible de récupérer les prix. Vérifie ta connexion et réessaie.');
    } finally {
      this.pricesRefreshing.set(false);
    }
  }

  async toggleFavorite(card: CollectionCard): Promise<void> {
    const nextFavorite = !card.favorite;
    const updated = this.collectionCards().map((item) => item.id === card.id ? { ...item, favorite: nextFavorite } : item);
    await this.saveCollection(updated);
    if (!this.storageError() && this.selectedCard()?.id === card.id) {
      this.selectedCard.update((selected) => selected ? { ...selected, favorite: nextFavorite } : selected);
    }
  }

  async deleteCard(card: CollectionCard): Promise<void> {
    this.pendingDeletion.set(card);
  }

  async deleteScanSessionCard(card: CollectionCard): Promise<void> {
    await this.removeCardFromCollection(card);
  }

  cancelCardDeletion(): void {
    this.pendingDeletion.set(null);
  }

  async confirmCardDeletion(): Promise<void> {
    const card = this.pendingDeletion();
    if (!card) return;
    await this.removeCardFromCollection(card);
  }

  private async removeCardFromCollection(card: CollectionCard): Promise<void> {
    const updated = this.collectionCards().filter((item) => item.id !== card.id);
    await this.saveCollection(updated);
    if (!this.storageError()) {
      this.pendingDeletion.set(null);
      this.scanSessionCards.update((items) => items.filter((item) => item.id !== card.id));
      if (this.selectedCard()?.id === card.id) this.closeCardDetails();
      this.showNotice('Carte supprimée de ta collection.');
    }
  }

  exportCollection(): void {
    const backup = this.storage.createBackup(this.collectionCards());
    const contents = JSON.stringify(backup, null, 2);
    const blob = new Blob([contents], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `grand-line-collection-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showNotice(`${this.uniqueCardCount} fiches exportées en JSON.`);
  }

  async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.importError.set('');
    if (file.size > 100 * 1024 * 1024) {
      this.importError.set('Ce fichier dépasse la limite d’import de 100 Mo.');
      this.pendingImport.set(this.storage.createBackup([]));
      return;
    }
    try {
      this.pendingImport.set(this.storage.parseBackup(await file.text()));
    } catch (error) {
      this.importError.set(error instanceof Error ? error.message : 'Le fichier JSON n’a pas pu être lu.');
      this.pendingImport.set(this.storage.createBackup([]));
    }
  }

  cancelImport(): void {
    this.pendingImport.set(null);
    this.importError.set('');
  }

  async applyImport(mode: 'merge' | 'replace'): Promise<void> {
    const backup = this.pendingImport();
    if (!backup || this.importError()) return;
    const current = this.collectionCards();
    const imported = mode === 'replace'
      ? backup.cards
      : [...backup.cards.filter((incoming) => !current.some((card) => card.id === incoming.id)), ...current];
    await this.saveCollection(imported);
    if (this.storageError()) return;
    const count = mode === 'replace' ? imported.length : imported.length - current.length;
    this.cancelImport();
    this.showNotice(mode === 'replace'
      ? `Collection remplacée : ${imported.length} fiches importées.`
      : `${count} nouvelles fiches importées.`);
  }

  showNotice(message: string): void {
    this.notice = message;
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    this.noticeTimer = setTimeout(() => (this.notice = ''), 3600);
  }

  private async loadCollection(): Promise<void> {
    try {
      let cards = await this.storage.load();
      if (cards.length === 0) {
        const legacyCards = this.readLegacyScans();
        if (legacyCards.length) {
          await this.storage.save(legacyCards);
          cards = legacyCards;
        }
        try {
          localStorage.removeItem('grand-line-card-log.cards');
        } catch {
          // The migration key is optional; IndexedDB remains the source of truth.
        }
      }
      const mergedCards = this.mergeDuplicateCards(cards);
      this.collectionCards.set(mergedCards);
      if (mergedCards.length !== cards.length) await this.storage.save(mergedCards);
      if (mergedCards.some((card) => this.needsMarketPriceRefresh(card))) void this.refreshCollectionPrices(true);
    } catch (error) {
      this.storageError.set(error instanceof Error ? error.message : 'Le stockage local est indisponible.');
    } finally {
      this.collectionLoading.set(false);
    }
  }

  private readLegacyScans(): CollectionCard[] {
    try {
      const raw = localStorage.getItem('grand-line-card-log.cards');
      if (!raw) return [];
      const legacy: unknown = JSON.parse(raw);
      if (!Array.isArray(legacy)) return [];
      return legacy
        .filter((item) => item && typeof item === 'object' && (item as { number?: string }).number === 'Ajoutée par scan')
        .map((item, index) => {
          const card = item as { name?: string; set?: string; image?: string };
          return {
            id: `migrated-${Date.now()}-${index}`,
            name: card.name ?? 'Carte sans nom',
            code: '',
            variant: 'Version à confirmer',
            finish: 'Standard',
            condition: 'Near Mint' as CardCondition,
            quantity: 1,
            marketPrice: null,
            favorite: false,
            imageUrl: null,
            imageDataUrl: card.image?.startsWith('data:image/') ? card.image : null,
            addedAt: new Date().toISOString(),
          };
        });
    } catch {
      return [];
    }
  }

  async markCardsPhysicallySorted(cardIds: string[]): Promise<void> {
    const selectedIds = new Set(cardIds);
    await this.saveCollection(this.collectionCards().map((card) =>
      selectedIds.has(card.id) ? { ...card, physicalSorted: true } : card,
    ));
  }

  private async saveCollection(cards: CollectionCard[]): Promise<void> {
    this.storageError.set('');
    try {
      const sorted = this.mergeDuplicateCards(cards).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      await this.storage.save(sorted);
      this.collectionCards.set(sorted);
    } catch (error) {
      this.storageError.set(error instanceof Error ? error.message : 'Impossible d’enregistrer la collection.');
      this.showNotice(this.storageError());
    }
  }

  private mergeDuplicateCards(cards: CollectionCard[]): CollectionCard[] {
    const merged = new Map<string, CollectionCard>();
    const unkeyed: CollectionCard[] = [];
    for (const card of cards) {
      const key = this.duplicateCardKey(card);
      if (!key) {
        unkeyed.push(card);
        continue;
      }
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, card);
        continue;
      }
      merged.set(key, {
        ...existing,
        quantity: existing.quantity + card.quantity,
        favorite: existing.favorite || card.favorite,
        physicalSorted: existing.physicalSorted === true && card.physicalSorted === true,
        marketPrice: existing.marketPrice ?? card.marketPrice,
        priceUpdatedAt: existing.priceUpdatedAt ?? card.priceUpdatedAt,
        imageUrl: existing.imageUrl ?? card.imageUrl,
        imageDataUrl: existing.imageDataUrl ?? card.imageDataUrl,
        colors: [...new Set([...(existing.colors ?? []), ...(card.colors ?? [])])],
        addedAt: existing.addedAt > card.addedAt ? existing.addedAt : card.addedAt,
      });
    }
    return [...merged.values(), ...unkeyed];
  }

  private duplicateCardKey(card: CollectionCard): string | null {
    const normalizedCode = card.code.trim().toUpperCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-');
    if (!normalizedCode) return null;
    return [normalizedCode, card.variant.trim().toLowerCase(), card.finish, card.condition].join('|');
  }

  private newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private stopCamera(): void {
    if (this.recognitionTimer) clearTimeout(this.recognitionTimer);
    this.recognitionTimer = undefined;
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.cameraStream = undefined;
    this.testPhotoImage = undefined;
    this.testPhotoActive.set(false);
    this.cameraActive.set(false);
    this.scanIndicatorState.set('idle');
    this.ocrWorking.set(false);
    this.visualModelWorking.set(false);
    this.detectedCardBounds.set(null);
    this.recognition.resetCardTracking();
  }

  private scheduleRecognition(): void {
    if ((!this.cameraActive() && !this.testPhotoActive()) || this.recognitionTimer || this.manualCardChoices().length || this.lookingUpCard()) return;
    // Keep searching promptly while no card outline is visible, then ease off
    // once a card has been found and the visual model is following it.
    const retryDelay = this.detectedCardBounds() ? 1000 : 350;
    this.recognitionTimer = setTimeout(() => {
      this.recognitionTimer = undefined;
      void this.scanLiveFrame();
    }, retryDelay);
  }

  scanNow(): void {
    if ((!this.cameraActive() && !this.testPhotoActive()) || this.recognitionBusy || this.lookingUpCard() || this.manualCardChoices().length) return;
    if (this.recognitionTimer) clearTimeout(this.recognitionTimer);
    this.recognitionTimer = undefined;
    this.lastNameSearch = '';
    void this.scanLiveFrame();
  }

  private async scanLiveFrame(): Promise<void> {
    const video = this.scannerPage?.cameraVideo?.nativeElement;
    const testImage = this.testPhotoImage;
    const videoReady = this.cameraActive() && !!video?.videoWidth;
    const imageReady = this.testPhotoActive() && !!testImage?.naturalWidth;
    if ((!videoReady && !imageReady) || this.recognitionBusy || (!this.cameraActive() && !this.testPhotoActive())) {
      this.scheduleRecognition();
      return;
    }

    this.recognitionBusy = true;
    this.ocrWorking.set(true);
    this.visualModelWorking.set(false);
    try {
      const sourceImage = videoReady && video ? video : testImage!;
      const cameraFrame = this.createCameraFrame(sourceImage, this.cameraZoom(), imageReady);
      const detection = await this.recognition.detectCardShape(cameraFrame);
      if (!detection) {
        this.detectedCardBounds.set(null);
        this.candidateCode = '';
        this.candidateHits = 0;
        this.candidateAlternateArt = false;
        this.missingFrames += 1;
        if (this.missingFrames >= 3) this.lastRecognizedCode = '';
        this.scanIndicatorState.set('missing');
        this.recognitionStatus.set('Recherche de la forme de la carte sur toute l’image…');
        this.recognitionDebugText.set('Aucun cadre de carte détecté.');
        return;
      }

      this.missingFrames = 0;
      this.detectedCardBounds.set(detection.bounds);
      this.scanIndicatorState.set('detected');
      this.recognitionStatus.set('Carte cadrée · identification visuelle en cours…');
      this.ocrWorking.set(false);
      this.visualModelWorking.set(true);

      let prediction: Awaited<ReturnType<CardVisualRecognitionService['identify']>> = null;
      try {
        prediction = await this.visualRecognition.identify(detection.cardImage);
      } finally {
        this.visualModelWorking.set(false);
      }

      if (!prediction) {
        this.candidateCode = '';
        this.candidateHits = 0;
        this.candidateAlternateArt = false;
        this.recognitionStatus.set(this.visualModelStatus());
        this.recognitionDebugText.set('La forme de la carte est détectée ; le modèle n’a pas retourné de candidat.');
        return;
      }

      this.recognitionDebugText.set(`Modèle : ${prediction.name} · ${prediction.code} · similarité ${Math.round(prediction.similarity * 100)}% · marge ${Math.round(prediction.margin * 100)}%`);
      const trustedPrediction = prediction.similarity > 0.5 ? prediction : null;
      if (!trustedPrediction) {
        this.candidateCode = '';
        this.candidateHits = 0;
        this.candidateAlternateArt = false;
        this.recognitionStatus.set(`Carte détectée. Suggestion du modèle : ${prediction.code} (${Math.round(prediction.similarity * 100)}%, marge ${Math.round(prediction.margin * 100)}%), confiance insuffisante.`);
        return;
      }

      const code = trustedPrediction.code;
      const baseCode = this.getBaseCardCode(code) ?? code;
      const lastRecognizedBaseCode = this.getBaseCardCode(this.lastRecognizedCode) ?? this.lastRecognizedCode;
      if (baseCode === lastRecognizedBaseCode) {
        this.scanIndicatorState.set('added');
        this.recognitionStatus.set(`Carte ${code} déjà ajoutée. Retire-la du cadre avant le prochain scan.`);
      } else if (baseCode === this.candidateCode) {
        this.candidateHits += 1;
        if (this.candidateHits >= (trustedPrediction.similarity >= 0.7 ? 2 : 3)) {
          await this.resolveAmbiguousModelMatch(code, trustedPrediction.similarity < 0.7);
        }
        else this.recognitionStatus.set(`Modèle : ${trustedPrediction.name} (${code}). Confirmation sur une autre image…`);
      } else {
        this.candidateCode = baseCode;
        this.candidatePrintingCode = code;
        this.candidateAlternateArt = false;
        this.candidateHits = 1;
        this.recognitionStatus.set(`Modèle : ${trustedPrediction.name} (${code}). Confirmation sur une autre image…`);
      }
    } catch (error) {
      this.recognitionStatus.set(error instanceof Error ? `Détection impossible : ${error.message}` : 'Détection impossible. Vérifie le cadrage et réessaie.');
    } finally {
      this.recognitionBusy = false;
      this.ocrWorking.set(false);
      this.visualModelWorking.set(false);
      this.scheduleRecognition();
    }
  }
  private async lookupScannerName(name: string, reference: string | null = null): Promise<void> {
    if (this.manualCardChoices().length || this.lookingUpCard()) return;
    this.lookingUpCard.set(true);
    this.manualChoiceSource.set('scanner-name');
    this.manualChoiceFinish.set('Standard');
    this.manualChoiceSearch = '';
    this.scannerNameReference.set(reference);
    this.scannerRecognizedName.set(name.trim());
    this.recognitionStatus.set(`Recherche de « ${name.trim()} » dans le catalogue…`);
    try {
      const matches = await this.recognition.findCardPrintingsByName(name);
      if (!matches.length) {
        this.scannerNameReference.set(null);
        this.scannerRecognizedName.set('');
        this.recognitionStatus.set(`Aucune impression trouvée pour « ${name.trim()} ». Corrige la lumière ou utilise le numéro manuellement.`);
        return;
      }
      this.manualCardChoices.set(matches);
      this.recognitionStatus.set(`${matches.length} impressions ressemblent à « ${name.trim()} ». Choisis la bonne carte.`);
    } catch {
      this.recognitionStatus.set('Le catalogue est indisponible. Vérifie ta connexion puis réessaie.');
    } finally {
      this.lookingUpCard.set(false);
    }
  }

  private async resolveAmbiguousModelMatch(predictedCode: string, forceSelector = false): Promise<void> {
    const baseCode = this.getBaseCardCode(predictedCode);
    if (!baseCode) {
      this.recognitionStatus.set(`Le modèle reconnaît ${predictedCode}, mais le numéro n’a pas le format attendu.`);
      return;
    }

    this.lookingUpCard.set(true);
    this.pendingAmbiguousScanCode = '';
    this.candidateCode = '';
    this.candidateHits = 0;
    this.manualChoiceSource.set('manual');
    this.manualChoiceFinish.set(this.scanFinish());
    this.manualChoiceSearch = '';
    this.recognitionStatus.set(`Recherche des versions de ${baseCode}…`);
    try {
      const printings = await this.recognition.findCardPrintings(baseCode);
      if (printings.length > 1 || (forceSelector && printings.length === 1)) {
        this.pendingAmbiguousScanCode = predictedCode;
        this.manualCardChoices.set(printings);
        this.recognitionStatus.set(`${printings.length} versions trouvées pour ${baseCode}. Choisis celle de ta carte.`);
      } else if (printings.length === 1) {
        await this.addRecognizedCard(printings[0].code, printings[0].variant === 'Alternate art');
      } else {
        this.recognitionStatus.set(`Aucune version trouvée pour ${baseCode}. Vérifie le numéro dans l’ajout manuel.`);
      }
    } finally {
      this.lookingUpCard.set(false);
    }
  }

  private getBaseCardCode(code: string): string | null {
    const match = code.trim().toUpperCase().match(/^([A-Z]+\d*)[-_](\d+)(?:[-_].+)?$/);
    return match ? `${match[1]}-${match[2]}` : null;
  }

  private nameKey(value: string): string {
    return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  }

  private async addRecognizedCard(code: string, alternateArt = false): Promise<void> {
    this.recognitionStatus.set(`Vérification de ${code} dans le catalogue…`);
    const finish = this.scanFinish();
    let identified: IdentifiedCard | null;
    try {
      // readCardCode already resolves the OCR evidence against the card catalog;
      // another strict name gate would reject good IDs when the nameplate OCR is blank.
      identified = await this.recognition.findCard(code);
    } catch {
      this.candidateCode = '';
      this.candidateHits = 0;
      this.scanIndicatorState.set('detected');
      this.recognitionStatus.set('Le catalogue local ne peut pas être chargé. Vérifie la connexion puis réessaie.');
      return;
    }
    if (identified && alternateArt) identified.variant = 'Alternate art';
    if (!identified) {
      this.candidateCode = '';
      this.candidateHits = 0;
      this.scanIndicatorState.set('detected');
      this.recognitionStatus.set(`Nom et numéro non confirmés pour ${code}. La carte n'a pas été ajoutée ; utilise la recherche manuelle.`);
      return;
    }
    await this.saveIdentifiedCard(identified, finish);
    if (this.storageError()) {
      this.scanIndicatorState.set('detected');
      this.recognitionStatus.set('Carte reconnue, mais impossible de l’enregistrer. Vérifie le stockage local.');
      return;
    }
    this.lastRecognizedCode = code;
    this.scanIndicatorState.set('added');
    this.candidateCode = '';
    this.candidateHits = 0;
    this.lastIdentifiedCard.set(`${identified.name} · ${identified.code}`);
    this.recognitionStatus.set(`Ajoutée : ${identified.name} (${identified.code}). Retire-la du cadre avant le prochain scan.`);
  }

  private async saveIdentifiedCard(identified: { code: string; name: string; variant: string; marketPrice: number | null; priceUpdatedAt?: string | null; imageUrl: string | null; colors?: string[] }, finish: CardFinish): Promise<void> {
    const normalizedCode = identified.code.trim().toUpperCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-');
    const existing = this.collectionCards().find((card) => card.code.trim().toUpperCase().replace(/[_\s]+/g, '-').replace(/-+/g, '-') === normalizedCode && card.finish === finish && card.variant === identified.variant);
    const now = new Date().toISOString();
    const updated: CollectionCard = existing
      ? { ...existing, quantity: existing.quantity + 1, physicalSorted: false, marketPrice: identified.marketPrice ?? existing.marketPrice, priceUpdatedAt: identified.priceUpdatedAt ?? existing.priceUpdatedAt, imageUrl: identified.imageUrl ?? existing.imageUrl, imageDataUrl: identified.imageUrl ? null : existing.imageDataUrl, colors: identified.colors?.length ? identified.colors : existing.colors, addedAt: now }
      : {
          id: this.newId(), name: identified.name, code: identified.code, variant: identified.variant,
          finish, condition: 'Near Mint', quantity: 1, marketPrice: identified.marketPrice, priceUpdatedAt: identified.priceUpdatedAt ?? null, favorite: false,
          imageUrl: identified.imageUrl, imageDataUrl: null, colors: identified.colors, physicalSorted: false, addedAt: now,
        };
    await this.saveCollection(existing
      ? this.collectionCards().map((card) => card.id === existing.id ? updated : card)
      : [updated, ...this.collectionCards()]);
    if (!this.storageError()) {
      this.scanSessionCards.update((cards) => [updated, ...cards.filter((card) => card.id !== updated.id)]);
      this.scanAddedCard.set(updated);
      if (this.scanAddedCardTimer) clearTimeout(this.scanAddedCardTimer);
      this.scanAddedCardTimer = setTimeout(() => this.scanAddedCard.set(null), 3200);
    }
  }

  formatScanPrice(price: number | null): string {
    return price === null ? 'Prix indisponible' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(price);
  }

  private createCameraFrame(sourceImage: HTMLVideoElement | HTMLImageElement, zoom = this.cameraZoom(), focusBottomRight = false): HTMLCanvasElement {
    const sourceWidth = sourceImage instanceof HTMLVideoElement ? sourceImage.videoWidth : sourceImage.naturalWidth;
    const sourceHeight = sourceImage instanceof HTMLVideoElement ? sourceImage.videoHeight : sourceImage.naturalHeight;
    const scale = Math.min(1, 1200 / Math.max(sourceWidth, sourceHeight));
    const frameWidth = Math.round(sourceWidth * scale);
    const frameHeight = Math.round(sourceHeight * scale);
    const quarterTurn = this.cameraRotation() % 180 !== 0;
    const source = document.createElement('canvas');
    source.width = quarterTurn ? frameHeight : frameWidth;
    source.height = quarterTurn ? frameWidth : frameHeight;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) return source;
    sourceContext.translate(source.width / 2, source.height / 2);
    sourceContext.rotate(this.cameraRotation() * Math.PI / 180);
    sourceContext.drawImage(sourceImage, -frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight);

    // Render the complete virtual camera viewport to match the visible camera preview.
    const stage = this.scannerPage?.cameraVideo?.nativeElement.parentElement;
    const stageRect = stage?.getBoundingClientRect();
    const stageWidth = 1200;
    const stageHeight = stageRect?.width && stageRect.height
      ? Math.round(stageWidth * stageRect.height / stageRect.width)
      : 800;
    const panX = this.cameraPanX() * stageWidth / (stageRect?.width || stageWidth);
    const panY = this.cameraPanY() * stageWidth / (stageRect?.width || stageWidth);
    const viewport = document.createElement('canvas');
    viewport.width = stageWidth;
    viewport.height = stageHeight;
    const viewportContext = viewport.getContext('2d');
    if (!viewportContext) return viewport;
    viewportContext.fillStyle = '#081117';
    viewportContext.fillRect(0, 0, stageWidth, stageHeight);

    const stageAspect = stageWidth / stageHeight;
    const sourceAspect = source.width / source.height;
    if (zoom >= 1) {
      const cropWidth = (sourceAspect > stageAspect ? source.height * stageAspect : source.width) / zoom;
      const cropHeight = (sourceAspect > stageAspect ? source.height : source.width / stageAspect) / zoom;
      const cropX = (focusBottomRight ? source.width - cropWidth : (source.width - cropWidth) / 2) - panX * cropWidth / stageWidth;
      const cropY = (focusBottomRight ? source.height - cropHeight : (source.height - cropHeight) / 2) - panY * cropHeight / stageHeight;
      viewportContext.drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, stageWidth, stageHeight);
    } else {
      const containScale = Math.min(stageWidth / source.width, stageHeight / source.height) * zoom;
      const drawWidth = source.width * containScale;
      const drawHeight = source.height * containScale;
      const drawX = (focusBottomRight ? stageWidth - drawWidth : (stageWidth - drawWidth) / 2) + panX;
      const drawY = (focusBottomRight ? stageHeight - drawHeight : (stageHeight - drawHeight) / 2) + panY;
      viewportContext.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    }

    return viewport;
  }

}
