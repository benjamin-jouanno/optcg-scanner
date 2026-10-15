export interface IdentifiedCard {
  code: string;
  name: string;
  marketPrice: number | null;
  priceUpdatedAt?: string | null;
  variant: string;
  imageUrl: string | null;
  colors?: string[];
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
