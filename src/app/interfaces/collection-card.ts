export type CardCondition = 'Near Mint' | 'Lightly Played' | 'Moderately Played' | 'Heavily Played' | 'Damaged';
export type CardFinish = 'Standard' | 'Foil';

export interface CollectionCard {
  id: string;
  name: string;
  code: string;
  variant: string;
  finish: CardFinish;
  condition: CardCondition;
  quantity: number;
  marketPrice: number | null;
  priceUpdatedAt?: string | null;
  favorite: boolean;
  imageUrl: string | null;
  imageDataUrl: string | null;
  colors?: string[];
  physicalSorted?: boolean;
  addedAt: string;
}

export interface CollectionBackup {
  format: 'grand-line-card-log';
  version: 1;
  exportedAt: string;
  cards: CollectionCard[];
}
