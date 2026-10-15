import { Injectable, signal } from '@angular/core';
import type * as ort from 'onnxruntime-web';

interface GalleryCard {
  code: string;
  images: { name: string; vector: number[] }[];
}

export interface VisualCardPrediction {
  code: string;
  name: string;
  similarity: number;
  margin: number;
}

@Injectable({ providedIn: 'root' })
export class CardVisualRecognitionService {
  private model?: Promise<{ session: ort.InferenceSession; gallery: GalleryCard[] } | null>;
  private modelLoadError = '';
  readonly status = signal('Modèle en attente du premier scan');

  async identify(canvas: HTMLCanvasElement): Promise<VisualCardPrediction | null> {
    if (!this.model) this.status.set('Chargement du modèle visuel…');
    const model = await (this.model ??= this.loadModel());
    if (!model) {
      this.status.set(`Modèle indisponible : ${this.modelLoadError || 'chargement impossible'}`);
      return null;
    }
    const ort = await import('onnxruntime-web');

    const inputCanvas = document.createElement('canvas');
    inputCanvas.width = 224;
    inputCanvas.height = 224;
    const context = inputCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(canvas, 0, 0, inputCanvas.width, inputCanvas.height);
    const pixels = context.getImageData(0, 0, inputCanvas.width, inputCanvas.height).data;
    const input = new Float32Array(3 * inputCanvas.width * inputCanvas.height);
    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const plane = inputCanvas.width * inputCanvas.height;
    for (let pixel = 0; pixel < plane; pixel += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        input[channel * plane + pixel] = (pixels[pixel * 4 + channel] / 255 - mean[channel]) / std[channel];
      }
    }

    this.status.set('Modèle chargé · analyse de l’image…');
    let result: Awaited<ReturnType<typeof model.session.run>>;
    try {
      result = await model.session.run({ image: new ort.Tensor('float32', input, [1, 3, 224, 224]) });
    } catch (error) {
      this.status.set(`Erreur d’inférence : ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
    const embedding = result['embedding']?.data as Float32Array | undefined;
    if (!embedding?.length) {
      this.status.set('Erreur : le modèle n’a retourné aucun vecteur');
      return null;
    }
    const norm = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0)) || 1;
    const rankedByCode = new Map<string, { name: string; similarity: number }>();
    for (const card of model.gallery) {
      for (const image of card.images) {
        if (image.vector.length !== embedding.length) continue;
        let dot = 0;
        let galleryNorm = 0;
        for (let index = 0; index < embedding.length; index += 1) {
          const value = image.vector[index];
          dot += embedding[index] * value;
          galleryNorm += value * value;
        }
        const similarity = dot / (norm * (Math.sqrt(galleryNorm) || 1));
        if (similarity > (rankedByCode.get(card.code)?.similarity ?? -Infinity)) {
          rankedByCode.set(card.code, { name: image.name, similarity });
        }
      }
    }
    const ranked = [...rankedByCode.entries()]
      .map(([code, value]) => ({ code, ...value }))
      .sort((left, right) => right.similarity - left.similarity);
    const best = ranked[0];
    if (!best) {
      this.status.set('Modèle exécuté · aucun candidat dans la galerie');
      return null;
    }
    const margin = best.similarity - (ranked[1]?.similarity ?? 0);
    this.status.set(`Modèle exécuté · ${best.code} · similarité ${Math.round(best.similarity * 100)}% · marge ${Math.round(margin * 100)}%`);
    return {
      code: best.code,
      name: best.name,
      similarity: best.similarity,
      margin,
    };
  }

  private async loadModel(): Promise<{ session: ort.InferenceSession; gallery: GalleryCard[] } | null> {
    try {
      const galleryResponse = await fetch('/assets/card-model/gallery.json');
      if (!galleryResponse.ok) {
        this.modelLoadError = `galerie HTTP ${galleryResponse.status}`;
        return null;
      }
      const gallery = await galleryResponse.json() as GalleryCard[];
      if (!Array.isArray(gallery) || !gallery.length) {
        this.modelLoadError = 'galerie vide ou invalide';
        return null;
      }
      const ort = await import('onnxruntime-web');
      ort.env.wasm.wasmPaths = '/assets/onnxruntime/';
      const session = await ort.InferenceSession.create('/assets/card-model/one-piece-cards.onnx', { executionProviders: ['wasm'] });
      return { session, gallery };
    } catch (error) {
      this.modelLoadError = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}
