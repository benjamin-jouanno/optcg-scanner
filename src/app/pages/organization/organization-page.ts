import { Component, effect, inject, Input, OnInit, signal, ViewEncapsulation } from '@angular/core';
import type { App } from '../../app';
import { CollectionCard } from '../../interfaces/collection-card';
import { CardRecognitionService } from '../../services/card-recognition.service';
import { CollectionCardTile } from '../../components/collection-card-tile/collection-card-tile';
import { LucideArrowRight, LucideInfo, LucideLayers, LucideX } from '@lucide/angular';

type ColorGroup = { key: string; label: string; colors: string[]; cards: CollectionCard[]; cardCount: number };
type ExtensionGroup = { code: string; colorGroups: ColorGroup[]; cardCount: number };

const COLOR_LABELS: Record<string, string> = {
  red: 'Rouge',
  green: 'Vert',
  blue: 'Bleu',
  purple: 'Violet',
  black: 'Noir',
  yellow: 'Jaune',
};
const COLOR_ORDER = ['red', 'green', 'blue', 'purple', 'black', 'yellow'];

@Component({
  selector: 'app-organization-page',
  standalone: true,
  imports: [CollectionCardTile, LucideArrowRight, LucideInfo, LucideLayers, LucideX],
  templateUrl: './organization-page.html',
  styleUrl: './organization-page.css',
  encapsulation: ViewEncapsulation.None,
})
export class OrganizationPage implements OnInit {
  @Input({ required: true }) context!: App;

  private readonly recognition = inject(CardRecognitionService);
  readonly colorsByCardId = signal<Record<string, string[]>>({});
  readonly colorLookupCompletedIds = signal<Record<string, boolean>>({});
  readonly loadingColors = signal(false);
  readonly colorLookupFailed = signal(false);
  readonly selectedExtension = signal<string | null>(null);
  readonly selectedColorKey = signal<string | null>(null);
  readonly sortModalOpen = signal(false);
  readonly selectedUnsortedIds = signal<string[]>([]);
  readonly savingSortedCards = signal(false);

  constructor() {
    effect(() => {
      const cards = this.context?.collectionCards() ?? [];
      const isLoading = this.loadingColors();
      if (cards.length && !isLoading) void this.loadMissingColors();
    });
  }

  ngOnInit(): void {
    void this.loadMissingColors();
  }

  get extensionGroups(): ExtensionGroup[] {
    const extensions = new Map<string, Map<string, { colors: string[]; cards: CollectionCard[] }>>();
    for (const card of this.context.collectionCards()) {
      const extension = this.extensionFor(card.code);
      const colors = this.cardColors(card);
      const colorKey = colors.length ? colors.map((color) => color.toLocaleLowerCase()).sort((a, b) => COLOR_ORDER.indexOf(a) - COLOR_ORDER.indexOf(b)).join('+') : 'unknown';
      const colorGroups = extensions.get(extension) ?? new Map<string, { colors: string[]; cards: CollectionCard[] }>();
      const group = colorGroups.get(colorKey) ?? { colors, cards: [] };
      group.cards.push(card);
      colorGroups.set(colorKey, group);
      extensions.set(extension, colorGroups);
    }

    return [...extensions.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'fr', { numeric: true }))
      .map(([code, colorGroups]) => ({
        code,
        colorGroups: [...colorGroups.entries()]
          .sort(([a], [b]) => this.colorSortOrder(a) - this.colorSortOrder(b) || a.localeCompare(b))
          .map(([key, group]) => ({
            key,
            colors: group.colors,
            label: key === 'unknown' ? 'Couleur à identifier' : group.colors.map((color) => this.colorLabel(color)).join(' + '),
            cards: group.cards.sort((a, b) => this.cardNumber(a.code).localeCompare(this.cardNumber(b.code), 'fr', { numeric: true })),
            cardCount: group.cards.reduce((count, card) => count + card.quantity, 0),
          })),
        cardCount: [...colorGroups.values()].reduce((count, group) => count + group.cards.reduce((sum, card) => sum + card.quantity, 0), 0),
      }));
  }

  get unsortedCards(): CollectionCard[] {
    return this.context.collectionCards()
      .filter((card) => card.physicalSorted === false)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }

  get unsortedQuantity(): number {
    return this.unsortedCards.reduce((count, card) => count + card.quantity, 0);
  }

  get selectedExtensionGroup(): ExtensionGroup | undefined {
    return this.extensionGroups.find((group) => group.code === this.selectedExtension());
  }

  get selectedColorGroup(): ColorGroup | undefined {
    return this.selectedExtensionGroup?.colorGroups.find((group) => group.key === this.selectedColorKey());
  }

  selectExtension(code: string): void {
    this.selectedExtension.set(code);
    this.selectedColorKey.set(null);
  }

  selectColor(key: string): void {
    this.selectedColorKey.set(key);
  }

  goBack(): void {
    if (this.selectedColorKey()) this.selectedColorKey.set(null);
    else this.selectedExtension.set(null);
  }

  openSortModal(): void {
    this.selectedUnsortedIds.set([]);
    this.sortModalOpen.set(true);
  }

  closeSortModal(): void {
    this.sortModalOpen.set(false);
    this.selectedUnsortedIds.set([]);
  }

  toggleUnsortedCard(id: string): void {
    this.selectedUnsortedIds.update((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  toggleAllUnsorted(checked: boolean): void {
    this.selectedUnsortedIds.set(checked ? this.unsortedCards.map((card) => card.id) : []);
  }

  isUnsortedCardSelected(id: string): boolean {
    return this.selectedUnsortedIds().includes(id);
  }

  get allUnsortedSelected(): boolean {
    return this.unsortedCards.length > 0 && this.selectedUnsortedIds().length === this.unsortedCards.length;
  }

  destinationColor(card: CollectionCard): string {
    const colors = this.cardColors(card);
    if (colors.length) return colors.map((color) => this.colorLabel(color)).join(' + ');
    return this.loadingColors() ? 'Couleur en cours d’identification…' : 'Couleur à identifier';
  }

  async markSelectedCardsSorted(): Promise<void> {
    const ids = this.selectedUnsortedIds();
    if (!ids.length || this.savingSortedCards()) return;
    this.savingSortedCards.set(true);
    try {
      await this.context.markCardsPhysicallySorted(ids);
    } finally {
      this.savingSortedCards.set(false);
    }
    if (!this.context.storageError()) this.closeSortModal();
  }

  extensionFor(code: string): string {
    const normalized = code.trim().toUpperCase();
    if (/^P-?\d+/.test(normalized)) return 'P — Promos';
    const match = normalized.match(/^([A-Z]+)-?(\d{2})-?(\d+)/);
    return match ? `${match[1]}-${match[2]}` : 'À identifier';
  }

  cardNumber(code: string): string {
    const normalized = code.trim().toUpperCase();
    const promo = normalized.match(/^P-?(\d+)/);
    if (promo) return promo[1];
    return normalized.match(/^[A-Z]+-?\d{2}-?(\d+)/)?.[1] ?? '—';
  }

  colorClass(colors: string[]): string {
    if (colors.length !== 1) return colors.length ? 'multi' : 'unknown';
    return colors[0].toLocaleLowerCase();
  }

  private cardColors(card: CollectionCard): string[] {
    return card.colors?.length ? card.colors : this.colorsByCardId()[card.id] ?? [];
  }

  private colorLabel(color: string): string {
    return COLOR_LABELS[color.toLocaleLowerCase()] ?? color;
  }

  private colorSortOrder(key: string): number {
    if (key === 'unknown') return COLOR_ORDER.length + 1;
    const first = key.split('+')[0];
    return COLOR_ORDER.indexOf(first);
  }

  private async loadMissingColors(): Promise<void> {
    if (this.loadingColors()) return;
    const completed = this.colorLookupCompletedIds();
    const cardsWithoutColors = this.context.collectionCards().filter((card) => !card.colors?.length && !completed[card.id] && card.code.trim());
    if (!cardsWithoutColors.length) return;
    this.loadingColors.set(true);
    try {
      const colorMap = await this.recognition.getCardColorsByCode(cardsWithoutColors.map((card) => card.code));
      const byCardId: Record<string, string[]> = {};
      for (const card of cardsWithoutColors) {
        const colors = colorMap[card.code] ?? [];
        if (colors.length) byCardId[card.id] = colors;
      }
      this.colorsByCardId.update((existing) => ({ ...existing, ...byCardId }));
      this.colorLookupCompletedIds.update((ids) => ({ ...ids, ...Object.fromEntries(cardsWithoutColors.map((card) => [card.id, true])) }));
    } catch {
      this.colorLookupFailed.set(true);
      this.colorLookupCompletedIds.update((ids) => ({ ...ids, ...Object.fromEntries(cardsWithoutColors.map((card) => [card.id, true])) }));
    } finally {
      this.loadingColors.set(false);
    }
  }
}
