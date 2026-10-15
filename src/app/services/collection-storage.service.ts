import { Injectable } from '@angular/core';
import { CardCondition, CollectionBackup, CollectionCard } from '../interfaces/collection-card';

@Injectable({ providedIn: 'root' })
export class CollectionStorageService {
  private readonly databaseName = 'grand-line-card-log';
  private readonly storeName = 'cards';
  private database?: Promise<IDBDatabase>;

  async load(): Promise<CollectionCard[]> {
    const db = await this.openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(this.storeName, 'readonly').objectStore(this.storeName).getAll();
      request.onsuccess = () => resolve((request.result as CollectionCard[])
        .map((card) => ({ ...card, finish: card.finish ?? 'Standard' }))
        .sort((a, b) => b.addedAt.localeCompare(a.addedAt)));
      request.onerror = () => reject(request.error ?? new Error('Could not read the collection.'));
    });
  }

  async save(cards: CollectionCard[]): Promise<void> {
    const db = await this.openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);
      store.clear();
      for (const card of cards) store.put(card);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not save the collection.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Saving the collection was cancelled.'));
    });
  }

  createBackup(cards: CollectionCard[]): CollectionBackup {
    return {
      format: 'grand-line-card-log',
      version: 1,
      exportedAt: new Date().toISOString(),
      cards,
    };
  }

  parseBackup(json: string): CollectionBackup {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') throw new Error('This file is not a Grand Line Card Log backup.');
    const backup = value as Partial<CollectionBackup>;
    if (backup.format !== 'grand-line-card-log' || backup.version !== 1 || !Array.isArray(backup.cards)) {
      throw new Error('Unsupported backup format or version.');
    }

    const cards = backup.cards.map((input, index) => this.validateCard(input, index));
    if (new Set(cards.map((card) => card.id)).size !== cards.length) {
      throw new Error('This backup contains duplicate card IDs.');
    }
    return {
      format: 'grand-line-card-log',
      version: 1,
      exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : '',
      cards,
    };
  }

  private validateCard(value: unknown, index: number): CollectionCard {
    if (!value || typeof value !== 'object') throw new Error(`Card ${index + 1} is not a valid object.`);
    const card = value as Partial<CollectionCard>;
    const conditions: CardCondition[] = ['Near Mint', 'Lightly Played', 'Moderately Played', 'Heavily Played', 'Damaged'];

    if (typeof card.id !== 'string' || !card.id.trim()) throw new Error(`Card ${index + 1} is missing its ID.`);
    if (typeof card.name !== 'string' || !card.name.trim()) throw new Error(`Card ${index + 1} is missing its name.`);
    if (typeof card.code !== 'string' || typeof card.variant !== 'string') throw new Error(`Card ${index + 1} has invalid card details.`);
    if (card.finish !== undefined && card.finish !== 'Standard' && card.finish !== 'Foil') throw new Error(`Card ${index + 1} has an invalid finish.`);
    if (!conditions.includes(card.condition as CardCondition)) throw new Error(`Card ${index + 1} has an invalid condition.`);
    if (!Number.isInteger(card.quantity) || (card.quantity ?? 0) < 1 || (card.quantity ?? 0) > 100000) {
      throw new Error(`Card ${index + 1} has an invalid quantity.`);
    }
    if (card.marketPrice !== null && (typeof card.marketPrice !== 'number' || !Number.isFinite(card.marketPrice) || card.marketPrice < 0)) {
      throw new Error(`Card ${index + 1} has an invalid price.`);
    }
    if (card.imageDataUrl !== null && card.imageDataUrl !== undefined &&
      (typeof card.imageDataUrl !== 'string' || !card.imageDataUrl.startsWith('data:image/'))) {
      throw new Error(`Card ${index + 1} has an invalid image.`);
    }
    if (card.imageUrl !== null && card.imageUrl !== undefined &&
      (typeof card.imageUrl !== 'string' || !card.imageUrl.startsWith('https://'))) {
      throw new Error(`Card ${index + 1} has an invalid image URL.`);
    }
    if (typeof card.addedAt !== 'string' || Number.isNaN(Date.parse(card.addedAt))) {
      throw new Error(`Card ${index + 1} has an invalid date.`);
    }

    return {
      id: card.id,
      name: card.name.trim(),
      code: card.code.trim(),
      variant: card.variant.trim(),
      finish: card.finish ?? 'Standard',
      condition: card.condition as CardCondition,
      quantity: card.quantity as number,
      marketPrice: card.marketPrice ?? null,
      priceUpdatedAt: card.priceUpdatedAt ?? null,
      favorite: Boolean(card.favorite),
      imageUrl: card.imageUrl ?? null,
      imageDataUrl: card.imageDataUrl ?? null,
      addedAt: card.addedAt,
    };
  }

  private openDatabase(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    const database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('This browser does not support local database storage.'));
        return;
      }
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName, { keyPath: 'id' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open local database storage.'));
      request.onblocked = () => reject(new Error('Close other Grand Line Card Log tabs to upgrade the local database.'));
    }).catch((error) => {
      this.database = undefined;
      throw error;
    });
    this.database = database;
    return database;
  }
}
