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
  LucidePlus,
  LucideRotateCcw,
  LucideRotateCw,
  LucideScanLine,
  LucideSearch,
  LucideShieldCheck,
  LucideSparkles,
  LucideStar,
  LucideTrash2,
  LucideTrendingUp,
  LucideX,
} from '@lucide/angular';
import { CardCondition, CardFinish, CollectionBackup, CollectionCard, CollectionStorageService } from './collection-storage.service';
import { CardRecognitionService, IdentifiedCard } from './card-recognition.service';

type Page = 'Accueil' | 'Ma collection' | 'Scanner' | 'Statistiques';
type ScanIndicatorState = 'idle' | 'missing' | 'detected' | 'added';
type NavItem = { label: Page; icon: string };

@Component({
  selector: 'app-root',
  imports: [
    DatePipe,
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
    LucidePlus,
    LucideRotateCcw,
    LucideRotateCw,
    LucideScanLine,
    LucideSearch,
    LucideShieldCheck,
    LucideSparkles,
    LucideStar,
    LucideTrash2,
    LucideTrendingUp,
    LucideX,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnDestroy {
  @ViewChild('cameraVideo') cameraVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('importInput') importInput?: ElementRef<HTMLInputElement>;
  @ViewChild('profileImageInput') profileImageInput?: ElementRef<HTMLInputElement>;

  private readonly storage = inject(CollectionStorageService);
  private readonly recognition = inject(CardRecognitionService);
  readonly collectionCards = signal<CollectionCard[]>([]);
  readonly wallpaperIndex = signal(this.pickWallpaperIndex());
  readonly collectionLoading = signal(true);
  readonly storageError = signal('');
  readonly cameraError = signal('');
  readonly cameraActive = signal(false);
  readonly ocrWorking = signal(false);
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
  readonly manualCardChoices = signal<IdentifiedCard[]>([]);
  readonly manualChoiceFinish = signal<CardFinish>('Standard');
  readonly scanFinish = signal<CardFinish>('Standard');
  readonly showHitsOnly = signal(false);
  readonly priceSortDirection = signal<'asc' | 'desc' | null>(null);
  editAlternateArt = false;
  readonly scanIndicatorState = signal<ScanIndicatorState>('idle');
  readonly cameraRotation = signal(0);
  readonly cameraZoom = signal(0.7);
  readonly pendingImport = signal<CollectionBackup | null>(null);
  readonly importError = signal('');
  readonly profileName = signal(this.readProfileSetting('grand-line-profile-name') || 'Monkey D.');
  readonly profileImage = signal(this.readProfileSetting('grand-line-profile-image'));
  readonly hitCardAnimationsEnabled = signal(this.readProfileSetting('grand-line-hit-animations') !== 'false');
  readonly profileSettingsOpen = signal(false);
  readonly profileNameDraft = signal('');
  readonly profileImageDraft = signal<string | null>(null);
  readonly hitCardAnimationsDraft = signal(true);
  readonly profileSettingsError = signal('');

  readonly navigation: NavItem[] = [
    { label: 'Accueil', icon: 'home' },
    { label: 'Ma collection', icon: 'collection' },
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
  editName = '';
  editCode = '';
  editCondition: CardCondition = 'Near Mint';
  editFinish: CardFinish = 'Standard';
  editQuantity = 1;
  private cameraStream?: MediaStream;
  private recognitionTimer?: ReturnType<typeof setTimeout>;
  private priceRefreshTimer?: ReturnType<typeof setInterval>;
  private recognitionBusy = false;
  private lastRecognizedCode = '';
  private candidateCode = '';
  private candidateAlternateArt = false;
  private candidateHits = 0;
  private missingFrames = 0;
  private noticeTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.loadCollection();
    this.priceRefreshTimer = setInterval(() => {
      if (!document.hidden && this.collectionCards().some((card) => this.needsMarketPriceRefresh(card))) {
        void this.refreshCollectionPrices(true);
      }
    }, 24 * 60 * 60 * 1000);
  }

  ngOnDestroy(): void {
    this.stopCamera();
    if (this.priceRefreshTimer) clearInterval(this.priceRefreshTimer);
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

  get collectionVisibleCards(): CollectionCard[] {
    const query = this.collectionSearchTerm.trim().toLocaleLowerCase();
    const cards = this.collectionCards().filter((card) => {
      const matchesSearch = !query || `${card.name} ${card.code}`.toLocaleLowerCase().includes(query);
      return matchesSearch && (!this.showHitsOnly() || this.isHit(card));
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
  }

  onCollectionSearch(value: string): void {
    this.collectionSearchTerm = value;
  }

  openProfileSettings(): void {
    this.profileNameDraft.set(this.profileName());
    this.profileImageDraft.set(this.profileImage());
    this.hitCardAnimationsDraft.set(this.hitCardAnimationsEnabled());
    this.profileSettingsError.set('');
    this.profileSettingsOpen.set(true);
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
      this.profileName.set(name);
      this.profileImage.set(this.profileImageDraft());
      this.hitCardAnimationsEnabled.set(this.hitCardAnimationsDraft());
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
    this.selectedCard.set(updated);
    this.scanSessionCards.update((cards) => cards.map((item) => item.id === updated.id ? updated : item));
    this.editingCardId.set(null);
    this.showNotice('Les détails de la carte ont été mis à jour.');
  }

  selectItem(item: Page): void {
    if (this.activeItem === 'Scanner' && item !== 'Scanner') this.stopCamera();
    if (this.activeItem !== 'Scanner' && item === 'Scanner') this.scanSessionCards.set([]);
    this.activeItem = item;
    this.searchTerm = '';
  }

  private pickWallpaperIndex(exclude?: number): number {
    const available = Array.from({ length: 16 }, (_, index) => index).filter((index) => index !== exclude);
    return available[Math.floor(Math.random() * available.length)];
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
      const video = this.cameraVideo?.nativeElement;
      if (video) {
        video.srcObject = this.cameraStream;
        await video.play();
        this.cameraActive.set(true);
        this.scanIndicatorState.set('missing');
        this.recognitionStatus.set('Place une carte entière dans le cadre. Analyse automatique en cours…');
        this.scheduleRecognition();
      }
    } catch (error) {
      this.cameraActive.set(false);
      this.cameraError.set(error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Autorise l’accès à la caméra dans ton navigateur puis réessaie.'
        : 'Impossible d’accéder à la caméra. Vérifie qu’elle est branchée et disponible.');
    }
  }

  async lookupManualCard(): Promise<void> {
    const code = this.manualCardCode.trim().toUpperCase().replace(/\s+/g, '');
    if (!code || this.lookingUpCard()) return;
    this.lookingUpCard.set(true);
    this.recognitionStatus.set(`Recherche de ${code} dans le catalogue…`);
    this.manualChoiceFinish.set('Standard');
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
    }
  }

  async selectManualPrinting(identified: IdentifiedCard): Promise<void> {
    if (this.lookingUpCard()) return;
    this.lookingUpCard.set(true);
    this.recognitionStatus.set(`Ajout de ${identified.code} à ta collection…`);
    try {
      await this.addManualPrinting(identified, this.manualChoiceFinish());
    } catch {
      this.recognitionStatus.set('Impossible d’ajouter cette version. Réessaie.');
    } finally {
      this.lookingUpCard.set(false);
    }
  }

  cancelManualPrintingChoice(): void {
    this.manualCardChoices.set([]);
    this.recognitionStatus.set('Choix de version annulé.');
  }

  private async addManualPrinting(identified: IdentifiedCard, finish: CardFinish): Promise<void> {
    await this.saveIdentifiedCard(identified, finish);
    if (this.storageError()) return;
    this.manualCardChoices.set([]);
    this.manualCardCode = '';
    if (this.cameraActive()) this.scanIndicatorState.set('added');
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

  cancelCardDeletion(): void {
    this.pendingDeletion.set(null);
  }

  async confirmCardDeletion(): Promise<void> {
    const card = this.pendingDeletion();
    if (!card) return;
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
      this.collectionCards.set(cards);
      if (cards.some((card) => this.needsMarketPriceRefresh(card))) void this.refreshCollectionPrices(true);
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

  private async saveCollection(cards: CollectionCard[]): Promise<void> {
    this.storageError.set('');
    try {
      const sorted = [...cards].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
      await this.storage.save(sorted);
      this.collectionCards.set(sorted);
    } catch (error) {
      this.storageError.set(error instanceof Error ? error.message : 'Impossible d’enregistrer la collection.');
      this.showNotice(this.storageError());
    }
  }

  private newId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `card-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private stopCamera(): void {
    if (this.recognitionTimer) clearTimeout(this.recognitionTimer);
    this.recognitionTimer = undefined;
    this.cameraStream?.getTracks().forEach((track) => track.stop());
    this.cameraStream = undefined;
    this.cameraActive.set(false);
    this.scanIndicatorState.set('idle');
    this.ocrWorking.set(false);
  }

  private scheduleRecognition(): void {
    if (!this.cameraActive() || this.recognitionTimer) return;
    this.recognitionTimer = setTimeout(() => {
      this.recognitionTimer = undefined;
      void this.scanLiveFrame();
    }, 1400);
  }

  private async scanLiveFrame(): Promise<void> {
    const video = this.cameraVideo?.nativeElement;
    if (!video || !video.videoWidth || this.recognitionBusy || !this.cameraActive()) {
      this.scheduleRecognition();
      return;
    }
    this.recognitionBusy = true;
    this.ocrWorking.set(true);
    try {
      const canvas = this.createOrientedFrame(video);
      const reading = await this.recognition.readCardCode(canvas);
      this.ocrWorking.set(false);
      this.recognitionDebugText.set(reading.rawText.replace(/\s+/g, ' ').slice(0, 100));
      const code = reading?.code ?? null;
      if (!code) {
        this.candidateCode = '';
        this.candidateAlternateArt = false;
        this.candidateHits = 0;
        this.missingFrames += 1;
        if (this.missingFrames >= 3) this.lastRecognizedCode = '';
        this.scanIndicatorState.set(reading.cardDetected ? 'detected' : 'missing');
        this.recognitionStatus.set(reading.cardDetected
          ? 'Carte cadrée, mais numéro illisible. Améliore la lumière et garde le bas de la carte net.'
          : 'Carte non détectée. Place la carte entière dans le cadre.');
      } else if (code === this.lastRecognizedCode) {
        this.missingFrames = 0;
        this.scanIndicatorState.set('added');
        this.recognitionStatus.set(`Carte ${code} déjà ajoutée. Retire-la du cadre avant le prochain scan.`);
      } else if (code === this.candidateCode) {
        this.missingFrames = 0;
        this.candidateAlternateArt ||= Boolean(reading?.alternateArt);
        this.scanIndicatorState.set('detected');
        this.candidateHits += 1;
        if (this.candidateHits >= 2) await this.addRecognizedCard(code, this.candidateAlternateArt, reading.name);
        else this.recognitionStatus.set(`Numéro lu : ${code}${reading.name ? ` · ${reading.name}` : ''}. Je confirme le nom et le numéro…`);
      } else {
        this.missingFrames = 0;
        this.candidateCode = code;
        this.candidateAlternateArt = Boolean(reading?.alternateArt);
        this.candidateHits = 1;
        this.scanIndicatorState.set('detected');
        this.recognitionStatus.set(`Numéro lu : ${code}${reading.name ? ` · ${reading.name}` : ''}. Je confirme le nom et le numéro…`);
      }
    } catch (error) {
      this.recognitionStatus.set(error instanceof Error && error.message.includes('OCR')
        ? 'Impossible de charger la reconnaissance. Vérifie ta connexion Internet.'
        : 'La lecture a échoué. Améliore la lumière et réessaie.');
    } finally {
      this.recognitionBusy = false;
      this.ocrWorking.set(false);
      this.scheduleRecognition();
    }
  }

  private async addRecognizedCard(code: string, alternateArt = false, recognizedName = ''): Promise<void> {
    this.recognitionStatus.set(`Vérification de ${code} dans le catalogue…`);
    const finish = this.scanFinish();
    let identified: IdentifiedCard | null;
    try {
      identified = await this.recognition.findCard(code, recognizedName, true);
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

  private async saveIdentifiedCard(identified: { code: string; name: string; variant: string; marketPrice: number | null; priceUpdatedAt?: string | null; imageUrl: string | null }, finish: CardFinish): Promise<void> {
    const existing = this.collectionCards().find((card) => card.code.toUpperCase() === identified.code.toUpperCase() && card.finish === finish && card.variant === identified.variant);
    const now = new Date().toISOString();
    const updated: CollectionCard = existing
      ? { ...existing, quantity: existing.quantity + 1, marketPrice: identified.marketPrice ?? existing.marketPrice, priceUpdatedAt: identified.priceUpdatedAt ?? existing.priceUpdatedAt, imageUrl: identified.imageUrl ?? existing.imageUrl, imageDataUrl: identified.imageUrl ? null : existing.imageDataUrl, addedAt: now }
      : {
          id: this.newId(), name: identified.name, code: identified.code, variant: identified.variant,
          finish, condition: 'Near Mint', quantity: 1, marketPrice: identified.marketPrice, priceUpdatedAt: identified.priceUpdatedAt ?? null, favorite: false,
          imageUrl: identified.imageUrl, imageDataUrl: null, addedAt: now,
        };
    await this.saveCollection(existing
      ? this.collectionCards().map((card) => card.id === existing.id ? updated : card)
      : [updated, ...this.collectionCards()]);
    if (!this.storageError()) {
      this.scanSessionCards.update((cards) => [updated, ...cards.filter((card) => card.id !== updated.id)]);
    }
  }

  private createOrientedFrame(video: HTMLVideoElement): HTMLCanvasElement {
    const scale = Math.min(1, 1200 / Math.max(video.videoWidth, video.videoHeight));
    const frameWidth = Math.round(video.videoWidth * scale);
    const frameHeight = Math.round(video.videoHeight * scale);
    const quarterTurn = this.cameraRotation() % 180 !== 0;
    const source = document.createElement('canvas');
    source.width = quarterTurn ? frameHeight : frameWidth;
    source.height = quarterTurn ? frameWidth : frameHeight;
    const sourceContext = source.getContext('2d');
    if (!sourceContext) return source;
    sourceContext.translate(source.width / 2, source.height / 2);
    sourceContext.rotate(this.cameraRotation() * Math.PI / 180);
    sourceContext.drawImage(video, -frameWidth / 2, -frameHeight / 2, frameWidth, frameHeight);

    // Render a virtual camera viewport matching the portrait preview before cutting out
    // the fixed scan guide. This keeps the OCR coordinates aligned with what the user sees.
    const stage = video.parentElement;
    const stageRect = stage?.getBoundingClientRect();
    const stageWidth = 600;
    const stageHeight = stageRect?.width && stageRect.height
      ? Math.round(stageWidth * stageRect.height / stageRect.width)
      : 800;
    const viewport = document.createElement('canvas');
    viewport.width = stageWidth;
    viewport.height = stageHeight;
    const viewportContext = viewport.getContext('2d');
    if (!viewportContext) return viewport;
    viewportContext.fillStyle = '#081117';
    viewportContext.fillRect(0, 0, stageWidth, stageHeight);

    const stageAspect = stageWidth / stageHeight;
    const sourceAspect = source.width / source.height;
    const zoom = this.cameraZoom();
    if (zoom >= 1) {
      const cropWidth = (sourceAspect > stageAspect ? source.height * stageAspect : source.width) / zoom;
      const cropHeight = (sourceAspect > stageAspect ? source.height : source.width / stageAspect) / zoom;
      viewportContext.drawImage(source, (source.width - cropWidth) / 2, (source.height - cropHeight) / 2, cropWidth, cropHeight, 0, 0, stageWidth, stageHeight);
    } else {
      const containScale = Math.min(stageWidth / source.width, stageHeight / source.height) * zoom;
      const drawWidth = source.width * containScale;
      const drawHeight = source.height * containScale;
      viewportContext.drawImage(source, (stageWidth - drawWidth) / 2, (stageHeight - drawHeight) / 2, drawWidth, drawHeight);
    }

    const guideHeight = Math.min(0.88, 560 / stageHeight) * stageHeight;
    const guideWidth = guideHeight * 0.70;
    const scanFrame = document.createElement('canvas');
    scanFrame.width = Math.round(guideWidth);
    scanFrame.height = Math.round(guideHeight);
    const scanContext = scanFrame.getContext('2d');
    if (scanContext) {
      scanContext.drawImage(viewport, (stageWidth - guideWidth) / 2, (stageHeight - guideHeight) / 2, guideWidth, guideHeight, 0, 0, scanFrame.width, scanFrame.height);
    }
    return scanFrame;
  }

}
